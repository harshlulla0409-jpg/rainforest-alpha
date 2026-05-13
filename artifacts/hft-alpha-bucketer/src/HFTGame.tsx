import { useState, useEffect, useRef, useCallback } from "react";

const ALPHAS = [
  { id: "obi_pressure", label: "OBI Pressure", desc: "Order-book imbalance pressure" },
  { id: "trade_flow_imb", label: "Trade Flow Imb.", desc: "Signed trade-flow imbalance" },
  { id: "microprice_dev", label: "Microprice Dev.", desc: "Microprice vs mid deviation" },
  { id: "vwap_spread", label: "VWAP Spread", desc: "VWAP vs last-trade spread" },
  { id: "depth_slope", label: "Depth Slope", desc: "LOB depth asymmetry slope" },
  { id: "cancel_ratio", label: "Cancel Ratio", desc: "Cancel/place order ratio" },
];

const RETURN_HORIZONS = [
  { label: "60s", key: "r60", seconds: 60 },
  { label: "300s", key: "r300", seconds: 300 },
  { label: "1800s", key: "r1800", seconds: 1800 },
];

function gaussianRandom(mean = 0, std = 1) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

type Row = {
  [key: string]: number;
  r60: number;
  r300: number;
  r1800: number;
  idx: number;
};

function generateDataset(seed: number, nRows = 2000): Row[] {
  const rng = (s: number) => {
    const x = Math.sin(s * 9301 + 49297) * 233280;
    return x - Math.floor(x);
  };
  const rows: Row[] = [];
  for (let i = 0; i < nRows; i++) {
    const s = seed + i;
    const alphaVals: { [key: string]: number } = {};
    ALPHAS.forEach((a, ai) => {
      alphaVals[a.id] = gaussianRandom(0, 1) * (rng(s * (ai + 1)) > 0.5 ? 1 : -1);
    });
    const signal =
      0.25 * alphaVals["obi_pressure"] +
      0.15 * alphaVals["trade_flow_imb"] +
      0.10 * alphaVals["microprice_dev"] -
      0.08 * alphaVals["vwap_spread"] +
      0.05 * alphaVals["depth_slope"] -
      0.04 * alphaVals["cancel_ratio"];
    const r60  = signal * 0.8  + gaussianRandom(0, 2.5);
    const r300 = signal * 1.2  + gaussianRandom(0, 3.5);
    const r1800 = signal * 1.8  + gaussianRandom(0, 5.0);
    rows.push({ ...alphaVals, r60, r300, r1800, idx: i });
  }
  return rows;
}

const DEFAULT_BPS_THRESHOLDS = [-20, -10, -5, -2, 0, 2, 5, 10, 20];

function bucketRows(rows: Row[], alphaId: string, thresholds: number[]): Row[][] {
  const buckets: Row[][] = Array.from({ length: thresholds.length + 1 }, () => []);
  rows.forEach((row) => {
    const val = row[alphaId] * 10;
    let bi = 0;
    for (; bi < thresholds.length; bi++) {
      if (val < thresholds[bi]) break;
    }
    buckets[bi].push(row);
  });
  return buckets;
}

type BucketStats = { n: number; r60: number; r300: number; r1800: number };

function bucketStats(rows: Row[]): BucketStats {
  if (!rows.length) return { n: 0, r60: 0, r300: 0, r1800: 0 };
  const mean = (key: string) => rows.reduce((s, r) => s + r[key], 0) / rows.length;
  return { n: rows.length, r60: mean("r60"), r300: mean("r300"), r1800: mean("r1800") };
}

function bucketLabel(thresholds: number[], i: number) {
  if (i === 0) return `< ${thresholds[0]} bps`;
  if (i === thresholds.length) return `≥ ${thresholds[thresholds.length - 1]} bps`;
  return `${thresholds[i - 1]} – ${thresholds[i]} bps`;
}

function pnlColor(val: number) {
  if (val > 2) return "#00ff9d";
  if (val > 0.5) return "#7fff7f";
  if (val > -0.5) return "#c8c8a0";
  if (val > -2) return "#ff9966";
  return "#ff4455";
}

function barWidth(val: number, maxAbs: number) {
  return maxAbs === 0 ? 0 : Math.min(100, (Math.abs(val) / maxAbs) * 100);
}

type Level = {
  alphaId: string;
  thresholds: number[];
  buckets: Row[][];
  selectedBuckets: number[];
};

type OOSResults = {
  stats: BucketStats;
  n: number;
  totalRows: number;
};

export default function HFTGame() {
  const [phase, setPhase] = useState<"intro" | "build" | "oos" | "results">("intro");
  const [inSampleData, setInSampleData] = useState<Row[]>([]);
  const [oosData, setOosData] = useState<Row[]>([]);

  const [levels, setLevels] = useState<Level[]>([]);
  const [editingLevel, setEditingLevel] = useState<number | null>(null);
  const [pendingAlpha, setPendingAlpha] = useState(ALPHAS[0].id);
  const [pendingThresholds, setPendingThresholds] = useState([...DEFAULT_BPS_THRESHOLDS]);
  const [thresholdInput, setThresholdInput] = useState(DEFAULT_BPS_THRESHOLDS.join(", "));

  const [oosProgress, setOosProgress] = useState(0);
  const [oosResults, setOosResults] = useState<OOSResults | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const activeRows = useCallback(() => {
    if (!levels.length) return inSampleData;
    let rows = inSampleData;
    for (const lvl of levels) {
      if (!lvl.selectedBuckets || !lvl.selectedBuckets.length) break;
      const buckets = bucketRows(rows, lvl.alphaId, lvl.thresholds);
      rows = lvl.selectedBuckets.flatMap((bi) => buckets[bi] || []);
    }
    return rows;
  }, [levels, inSampleData]);

  const oosActiveRows = useCallback(() => {
    if (!levels.length) return oosData;
    let rows = oosData;
    for (const lvl of levels) {
      if (!lvl.selectedBuckets || !lvl.selectedBuckets.length) break;
      const buckets = bucketRows(rows, lvl.alphaId, lvl.thresholds);
      rows = lvl.selectedBuckets.flatMap((bi) => buckets[bi] || []);
    }
    return rows;
  }, [levels, oosData]);

  function startGame() {
    const is = generateDataset(42, 3000);
    const oos = generateDataset(137, 1000);
    setInSampleData(is);
    setOosData(oos);
    setLevels([]);
    setEditingLevel(null);
    setPendingAlpha(ALPHAS[0].id);
    setPendingThresholds([...DEFAULT_BPS_THRESHOLDS]);
    setThresholdInput(DEFAULT_BPS_THRESHOLDS.join(", "));
    setPhase("build");
  }

  function addLevel() {
    const lvlIdx = levels.length;
    setEditingLevel(lvlIdx);
    setPendingAlpha(ALPHAS[0].id);
    const t = [...DEFAULT_BPS_THRESHOLDS];
    setPendingThresholds(t);
    setThresholdInput(t.join(", "));
  }

  function editLevel(idx: number) {
    const lvl = levels[idx];
    setEditingLevel(idx);
    setPendingAlpha(lvl.alphaId);
    setPendingThresholds([...lvl.thresholds]);
    setThresholdInput(lvl.thresholds.join(", "));
  }

  function applyPendingLevel() {
    if (editingLevel === null) return;
    const rows = editingLevel === 0 ? inSampleData : (() => {
      let r = inSampleData;
      for (let i = 0; i < editingLevel; i++) {
        const lvl = levels[i];
        if (!lvl.selectedBuckets?.length) break;
        const b = bucketRows(r, lvl.alphaId, lvl.thresholds);
        r = lvl.selectedBuckets.flatMap((bi) => b[bi] || []);
      }
      return r;
    })();
    const buckets = bucketRows(rows, pendingAlpha, pendingThresholds);
    const newLvl: Level = {
      alphaId: pendingAlpha,
      thresholds: [...pendingThresholds],
      buckets,
      selectedBuckets: [],
    };
    const newLevels = [...levels.slice(0, editingLevel), newLvl];
    setLevels(newLevels);
    setEditingLevel(null);
  }

  function toggleBucket(lvlIdx: number, bucketIdx: number) {
    setLevels((prev) => {
      const updated = prev.map((lvl, i) => {
        if (i !== lvlIdx) return lvl;
        const sel = lvl.selectedBuckets.includes(bucketIdx)
          ? lvl.selectedBuckets.filter((b) => b !== bucketIdx)
          : [...lvl.selectedBuckets, bucketIdx];
        return { ...lvl, selectedBuckets: sel };
      });
      return updated.slice(0, lvlIdx + 1);
    });
  }

  function removeLevel(idx: number) {
    setLevels((prev) => prev.slice(0, idx));
    setEditingLevel(null);
  }

  function startOOS() {
    setPhase("oos");
    setOosProgress(0);
    setOosResults(null);
    let progress = 0;
    timerRef.current = setInterval(() => {
      progress += 2;
      setOosProgress(progress);
      if (progress >= 100) {
        if (timerRef.current) clearInterval(timerRef.current);
        const rows = oosActiveRows();
        const stats = bucketStats(rows);
        setOosResults({ stats, n: rows.length, totalRows: oosData.length });
        setPhase("results");
      }
    }, 60);
  }

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const currentRows = activeRows();
  const currentStats = bucketStats(currentRows);
  const score = currentStats.r60 * 1 + currentStats.r300 * 0.7 + currentStats.r1800 * 0.4;
  const coverage = inSampleData.length ? (currentRows.length / inSampleData.length) * 100 : 0;

  function renderIntro() {
    return (
      <div className="intro-screen">
        <div className="intro-logo">
          <span className="logo-hft">HFT</span>
          <span className="logo-alpha">ALPHA</span>
          <span className="logo-bucket">BUCKETER</span>
        </div>
        <p className="intro-sub">Strategy research simulation · In-sample optimization · OOS validation</p>
        <div className="intro-rules">
          <div className="rule"><span className="rule-num">01</span><span>Choose an alpha signal & bucket by basis points of forward return</span></div>
          <div className="rule"><span className="rule-num">02</span><span>Select buckets where the edge is in your favor</span></div>
          <div className="rule"><span className="rule-num">03</span><span>Drill deeper with additional alpha layers</span></div>
          <div className="rule"><span className="rule-num">04</span><span>Trade your rule on an unseen OOS day — see if it holds</span></div>
        </div>
        <button className="btn-primary btn-big" onClick={startGame}>INITIALIZE SIMULATION</button>
      </div>
    );
  }

  function renderBucketLevel(lvl: Level, lvlIdx: number) {
    const maxAbs = Math.max(...lvl.buckets.map((b) => {
      const s = bucketStats(b);
      return Math.max(Math.abs(s.r60), Math.abs(s.r300), Math.abs(s.r1800));
    }), 0.1);

    return (
      <div key={lvlIdx} className="level-card">
        <div className="level-header">
          <div className="level-badge">L{lvlIdx + 1}</div>
          <div className="level-info">
            <span className="level-alpha">{ALPHAS.find((a) => a.id === lvl.alphaId)?.label}</span>
            <span className="level-thresholds">{lvl.thresholds.join(", ")} bps</span>
          </div>
          <div className="level-actions">
            <button className="btn-xs" onClick={() => editLevel(lvlIdx)}>EDIT</button>
            <button className="btn-xs btn-danger" onClick={() => removeLevel(lvlIdx)}>✕</button>
          </div>
        </div>
        <div className="buckets-grid">
          {lvl.buckets.map((bRows, bi) => {
            const stats = bucketStats(bRows);
            const selected = lvl.selectedBuckets.includes(bi);
            const dominant = Math.abs(stats.r60) > 0.5 ? (stats.r60 > 0 ? "long" : "short") : "neutral";
            return (
              <div
                key={bi}
                className={`bucket-row ${selected ? "selected" : ""} ${dominant}`}
                onClick={() => toggleBucket(lvlIdx, bi)}
              >
                <div className="bucket-label">{bucketLabel(lvl.thresholds, bi)}</div>
                <div className="bucket-n">n={stats.n.toLocaleString()}</div>
                <div className="bucket-bars">
                  {RETURN_HORIZONS.map(({ key, label }) => {
                    const v = stats[key as keyof BucketStats] as number;
                    return (
                      <div key={key} className="bar-row">
                        <span className="bar-label">{label}</span>
                        <div className="bar-track">
                          <div
                            className="bar-fill"
                            style={{
                              width: `${barWidth(v, maxAbs)}%`,
                              background: pnlColor(v),
                              marginLeft: v < 0 ? `${100 - barWidth(v, maxAbs)}%` : "0",
                            }}
                          />
                        </div>
                        <span className="bar-val" style={{ color: pnlColor(v) }}>
                          {v >= 0 ? "+" : ""}{v.toFixed(2)}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className={`bucket-select-indicator ${selected ? "on" : "off"}`}>
                  {selected ? "✓ SELECTED" : "SELECT"}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function renderEditor() {
    if (editingLevel === null) return null;
    const isNew = editingLevel === levels.length;
    const feedRows = editingLevel === 0 ? inSampleData : (() => {
      let r = inSampleData;
      for (let i = 0; i < editingLevel; i++) {
        const lvl = levels[i];
        if (!lvl.selectedBuckets?.length) break;
        const b = bucketRows(r, lvl.alphaId, lvl.thresholds);
        r = lvl.selectedBuckets.flatMap((bi) => b[bi] || []);
      }
      return r;
    })();
    const previewBuckets = bucketRows(feedRows, pendingAlpha, pendingThresholds);

    return (
      <div className="editor-panel">
        <div className="editor-title">{isNew ? `ADD LEVEL ${editingLevel + 1}` : `EDIT LEVEL ${editingLevel + 1}`}</div>
        <div className="editor-row">
          <label>Alpha Signal</label>
          <div className="alpha-select-grid">
            {ALPHAS.map((a) => (
              <button
                key={a.id}
                className={`alpha-chip ${pendingAlpha === a.id ? "active" : ""}`}
                onClick={() => setPendingAlpha(a.id)}
                title={a.desc}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
        <div className="editor-row">
          <label>Thresholds (bps, comma-separated)</label>
          <input
            className="threshold-input"
            value={thresholdInput}
            onChange={(e) => {
              setThresholdInput(e.target.value);
              const parsed = e.target.value.split(",").map((s) => parseFloat(s.trim())).filter((n) => !isNaN(n)).sort((a, b) => a - b);
              if (parsed.length > 0) setPendingThresholds(parsed);
            }}
          />
        </div>
        <div className="editor-preview">
          <div className="preview-label">PREVIEW ({feedRows.length.toLocaleString()} rows → {previewBuckets.length} buckets)</div>
          <div className="preview-mini-buckets">
            {previewBuckets.map((bRows, bi) => {
              const stats = bucketStats(bRows);
              return (
                <div key={bi} className="preview-bucket">
                  <span className="preview-bucket-label">{bucketLabel(pendingThresholds, bi)}</span>
                  <span className="preview-bucket-n">n={stats.n}</span>
                  <span className="preview-bucket-ret" style={{ color: pnlColor(stats.r60) }}>
                    60s: {stats.r60 >= 0 ? "+" : ""}{stats.r60.toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="editor-btns">
          <button className="btn-primary" onClick={applyPendingLevel}>APPLY</button>
          <button className="btn-ghost" onClick={() => setEditingLevel(null)}>CANCEL</button>
        </div>
      </div>
    );
  }

  function renderBuild() {
    const hasSelections = levels.some((l) => l.selectedBuckets?.length > 0);
    const lastLevelComplete = levels.length > 0 && levels[levels.length - 1].selectedBuckets?.length > 0;
    const canAddMore = lastLevelComplete && levels.length < 5;
    const canGo = hasSelections && editingLevel === null;

    return (
      <div className="build-screen">
        <div className="build-left">
          <div className="build-header">
            <div className="build-title">STRATEGY BUILDER</div>
            <div className="build-subtitle">IN-SAMPLE · {inSampleData.length.toLocaleString()} EVENTS</div>
          </div>

          {editingLevel !== null && renderEditor()}

          {editingLevel === null && (
            <>
              {levels.map((lvl, idx) => renderBucketLevel(lvl, idx))}
              <div className="add-level-row">
                {levels.length === 0 && (
                  <button className="btn-primary" onClick={addLevel}>+ ADD FIRST ALPHA LAYER</button>
                )}
                {canAddMore && (
                  <button className="btn-secondary" onClick={addLevel}>+ ADD DEEPER LAYER (L{levels.length + 1})</button>
                )}
                {hasSelections && !canAddMore && levels.length >= 5 && (
                  <div className="max-depth-msg">MAX DEPTH REACHED (5 layers)</div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="build-right">
          <div className="stats-panel">
            <div className="stats-title">CURRENT RULE</div>
            <div className="stats-row">
              <span className="stats-label">Depth</span>
              <span className="stats-val">{levels.filter((l) => l.selectedBuckets?.length > 0).length} layers</span>
            </div>
            <div className="stats-row">
              <span className="stats-label">Coverage</span>
              <span className="stats-val">{coverage.toFixed(1)}%</span>
            </div>
            <div className="stats-row">
              <span className="stats-label">Matched rows</span>
              <span className="stats-val">{currentRows.length.toLocaleString()}</span>
            </div>
            <div className="stats-divider" />
            <div className="stats-title">EXPECTED EDGE</div>
            {RETURN_HORIZONS.map(({ key, label }) => (
              <div key={key} className="stats-row">
                <span className="stats-label">{label}</span>
                <span className="stats-val" style={{ color: pnlColor(currentStats[key as keyof BucketStats] as number) }}>
                  {(currentStats[key as keyof BucketStats] as number) >= 0 ? "+" : ""}{(currentStats[key as keyof BucketStats] as number).toFixed(3)} bps
                </span>
              </div>
            ))}
            <div className="stats-divider" />
            <div className="stats-row">
              <span className="stats-label">SCORE</span>
              <span className={`stats-score ${score > 0 ? "positive" : "negative"}`}>
                {score >= 0 ? "+" : ""}{score.toFixed(2)}
              </span>
            </div>
            <div className="coverage-bar-wrap">
              <div className="coverage-bar" style={{ width: `${Math.min(100, coverage)}%` }} />
            </div>
          </div>

          {canGo && (
            <button className="btn-fire" onClick={startOOS}>
              <span className="btn-fire-main">FIRE STRATEGY</span>
              <span className="btn-fire-sub">TRADE ON OOS DAY →</span>
            </button>
          )}
          {!hasSelections && (
            <div className="hint-box">Select buckets above to define your rule, then fire it on the unseen day.</div>
          )}
        </div>
      </div>
    );
  }

  function renderOOS() {
    return (
      <div className="oos-screen">
        <div className="oos-title">EXECUTING STRATEGY</div>
        <div className="oos-sub">Out-of-sample day · {oosData.length.toLocaleString()} events</div>
        <div className="oos-progress-wrap">
          <div className="oos-progress-bar" style={{ width: `${oosProgress}%` }} />
        </div>
        <div className="oos-pct">{oosProgress}%</div>
        <div className="oos-log">
          {[...Array(Math.floor(oosProgress / 5))].map((_, i) => (
            <div key={i} className="oos-log-line">
              [{new Date(Date.now() - (20 - i) * 3000).toISOString().slice(11, 19)}]{" "}
              TRADE {i % 2 === 0 ? "LONG" : "SHORT"} @ {(100 + gaussianRandom(0, 0.05)).toFixed(4)} · filled {Math.floor(10 + Math.random() * 90)} lots
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderResults() {
    if (!oosResults) return null;
    const { stats } = oosResults;
    const oosScore = stats.r60 * 1 + stats.r300 * 0.7 + stats.r1800 * 0.4;
    const isGood = oosScore > 0;
    const isGoodIS = score > 0;

    const overfitRatio = isGoodIS ? oosScore / score : 0;
    let grade: string, gradeColor: string;
    if (oosScore > 2)       { grade = "S"; gradeColor = "#00ff9d"; }
    else if (oosScore > 1)  { grade = "A"; gradeColor = "#7fff7f"; }
    else if (oosScore > 0)  { grade = "B"; gradeColor = "#c8ff80"; }
    else if (oosScore > -1) { grade = "C"; gradeColor = "#ffcc44"; }
    else if (oosScore > -2) { grade = "D"; gradeColor = "#ff9966"; }
    else                    { grade = "F"; gradeColor = "#ff4455"; }

    return (
      <div className="results-screen">
        <div className="results-header">
          <div className="grade-badge" style={{ color: gradeColor, borderColor: gradeColor }}>{grade}</div>
          <div className="results-title-group">
            <div className="results-title">{isGood ? "STRATEGY VALIDATED" : "STRATEGY FAILED"}</div>
            <div className="results-sub">Out-of-sample performance report</div>
          </div>
        </div>

        <div className="results-grid">
          <div className="result-card">
            <div className="rc-title">IN-SAMPLE EDGE</div>
            {RETURN_HORIZONS.map(({ key, label }) => (
              <div key={key} className="rc-row">
                <span>{label}</span>
                <span style={{ color: pnlColor(currentStats[key as keyof BucketStats] as number) }}>
                  {(currentStats[key as keyof BucketStats] as number) >= 0 ? "+" : ""}{(currentStats[key as keyof BucketStats] as number).toFixed(3)} bps
                </span>
              </div>
            ))}
            <div className="rc-score">Score: {score.toFixed(2)}</div>
          </div>
          <div className="result-card highlight">
            <div className="rc-title">OUT-OF-SAMPLE RESULT</div>
            {RETURN_HORIZONS.map(({ key, label }) => (
              <div key={key} className="rc-row">
                <span>{label}</span>
                <span style={{ color: pnlColor(stats[key as keyof BucketStats] as number) }}>
                  {(stats[key as keyof BucketStats] as number) >= 0 ? "+" : ""}{(stats[key as keyof BucketStats] as number).toFixed(3)} bps
                </span>
              </div>
            ))}
            <div className="rc-score" style={{ color: isGood ? "#00ff9d" : "#ff4455" }}>
              Score: {oosScore.toFixed(2)}
            </div>
          </div>
          <div className="result-card">
            <div className="rc-title">RULE SUMMARY</div>
            {levels.filter((l) => l.selectedBuckets?.length > 0).map((lvl, i) => (
              <div key={i} className="rc-rule-row">
                <span className="rc-rule-depth">L{i + 1}</span>
                <span>{ALPHAS.find((a) => a.id === lvl.alphaId)?.label}</span>
                <span className="rc-rule-buckets">{lvl.selectedBuckets.map((bi) => bucketLabel(lvl.thresholds, bi)).join(", ")}</span>
              </div>
            ))}
            <div className="rc-row">
              <span>Coverage</span>
              <span>{coverage.toFixed(1)}% IS / {oosResults.n > 0 ? ((oosResults.n / oosResults.totalRows) * 100).toFixed(1) : 0}% OOS</span>
            </div>
          </div>
        </div>

        <div className="results-verdict">
          {isGood && overfitRatio > 0.5 && (
            <div className="verdict good">Strong signal transfer. Your alpha holds out-of-sample. This is the real deal.</div>
          )}
          {isGood && overfitRatio <= 0.5 && (
            <div className="verdict warn">Marginal OOS transfer. You may have over-fit some noise — the edge is thin.</div>
          )}
          {!isGood && isGoodIS && (
            <div className="verdict bad">Strategy collapsed out-of-sample. Classic overfit. Go back and be more selective.</div>
          )}
          {!isGood && !isGoodIS && (
            <div className="verdict bad">Even in-sample was poor. Try different alphas or thresholds.</div>
          )}
        </div>

        <div className="results-btns">
          <button className="btn-primary" onClick={() => { setPhase("build"); setOosResults(null); }}>REFINE STRATEGY</button>
          <button className="btn-ghost" onClick={() => { startGame(); }}>NEW SIMULATION</button>
        </div>
      </div>
    );
  }

  function renderHUD() {
    if (phase === "intro") return null;
    return (
      <div className="hud">
        <div className="hud-left">
          <span className="hud-logo">HFT·ALPHA</span>
          <span className={`hud-phase ${phase}`}>{phase.toUpperCase()}</span>
        </div>
        <div className="hud-right">
          {phase === "build" && (
            <>
              <div className="hud-stat"><span>IS rows</span><span>{inSampleData.length.toLocaleString()}</span></div>
              <div className="hud-stat"><span>Matched</span><span>{currentRows.length.toLocaleString()}</span></div>
              <div className="hud-stat"><span>Score</span><span style={{ color: pnlColor(score) }}>{score >= 0 ? "+" : ""}{score.toFixed(2)}</span></div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400&family=Barlow+Condensed:wght@300;400;600;700;800&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          background: #060a0f;
          color: #c8d8e8;
          font-family: 'Space Mono', monospace;
          min-height: 100vh;
          overflow-x: hidden;
        }

        #root, .game-root {
          min-height: 100vh;
          background: #060a0f;
          background-image:
            radial-gradient(ellipse 80% 50% at 50% -10%, rgba(0,180,255,0.07) 0%, transparent 60%),
            repeating-linear-gradient(0deg, transparent, transparent 39px, rgba(0,180,255,0.03) 39px, rgba(0,180,255,0.03) 40px),
            repeating-linear-gradient(90deg, transparent, transparent 39px, rgba(0,180,255,0.02) 39px, rgba(0,180,255,0.02) 40px);
        }

        .hud {
          position: sticky; top: 0; z-index: 100;
          display: flex; justify-content: space-between; align-items: center;
          padding: 10px 24px;
          background: rgba(6,10,15,0.92);
          border-bottom: 1px solid rgba(0,180,255,0.2);
          backdrop-filter: blur(8px);
        }
        .hud-left { display: flex; align-items: center; gap: 16px; }
        .hud-logo { font-family: 'Barlow Condensed', sans-serif; font-weight: 800; font-size: 18px; letter-spacing: 3px; color: #00aaff; }
        .hud-phase { font-size: 10px; letter-spacing: 2px; padding: 2px 8px; border-radius: 2px; background: rgba(0,180,255,0.1); border: 1px solid rgba(0,180,255,0.3); }
        .hud-phase.build { color: #00aaff; }
        .hud-phase.oos { color: #ffcc44; border-color: rgba(255,204,68,0.4); background: rgba(255,204,68,0.08); }
        .hud-phase.results { color: #00ff9d; border-color: rgba(0,255,157,0.4); background: rgba(0,255,157,0.08); }
        .hud-right { display: flex; gap: 24px; }
        .hud-stat { display: flex; flex-direction: column; align-items: flex-end; }
        .hud-stat span:first-child { font-size: 9px; color: #4a6070; letter-spacing: 1px; }
        .hud-stat span:last-child { font-size: 13px; color: #c8d8e8; }

        .intro-screen {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          min-height: 100vh; gap: 40px; padding: 40px 24px; text-align: center;
        }
        .intro-logo {
          display: flex; flex-direction: column; align-items: center; line-height: 1;
          font-family: 'Barlow Condensed', sans-serif; font-weight: 800;
        }
        .logo-hft { font-size: 18px; letter-spacing: 12px; color: #00aaff; margin-bottom: 4px; }
        .logo-alpha { font-size: 72px; letter-spacing: 8px; color: #ffffff; }
        .logo-bucket { font-size: 22px; letter-spacing: 10px; color: #4a9090; margin-top: 4px; }
        .intro-sub { font-size: 11px; color: #4a6070; letter-spacing: 2px; }
        .intro-rules { display: flex; flex-direction: column; gap: 12px; max-width: 440px; width: 100%; }
        .rule { display: flex; align-items: flex-start; gap: 16px; text-align: left; padding: 12px 16px; background: rgba(0,180,255,0.04); border: 1px solid rgba(0,180,255,0.1); border-radius: 4px; font-size: 12px; color: #8aa0b0; }
        .rule-num { font-family: 'Barlow Condensed', sans-serif; font-size: 20px; font-weight: 700; color: #00aaff; min-width: 28px; }

        .btn-primary, .btn-secondary, .btn-ghost, .btn-fire, .btn-xs, .btn-danger {
          cursor: pointer; border: none; font-family: 'Space Mono', monospace; transition: all 0.15s;
        }
        .btn-primary {
          padding: 10px 24px; font-size: 12px; letter-spacing: 2px;
          background: #00aaff; color: #060a0f; font-weight: 700;
          border-radius: 3px;
        }
        .btn-primary:hover { background: #33bbff; transform: translateY(-1px); }
        .btn-big { padding: 14px 40px; font-size: 14px; }
        .btn-secondary {
          padding: 10px 20px; font-size: 11px; letter-spacing: 2px;
          background: transparent; color: #00aaff; border: 1px solid #00aaff; border-radius: 3px;
        }
        .btn-secondary:hover { background: rgba(0,170,255,0.1); }
        .btn-ghost {
          padding: 10px 20px; font-size: 11px; letter-spacing: 2px;
          background: transparent; color: #4a6070; border: 1px solid rgba(74,96,112,0.4); border-radius: 3px;
        }
        .btn-ghost:hover { color: #c8d8e8; border-color: #8aa0b0; }
        .btn-xs {
          padding: 3px 8px; font-size: 9px; letter-spacing: 1px;
          background: transparent; color: #4a8090; border: 1px solid rgba(74,128,144,0.3); border-radius: 2px;
        }
        .btn-xs:hover { color: #00aaff; border-color: #00aaff; }
        .btn-danger { color: #ff4455 !important; border-color: rgba(255,68,85,0.3) !important; }
        .btn-danger:hover { color: #ff6677 !important; background: rgba(255,68,85,0.1) !important; }
        .btn-fire {
          display: flex; flex-direction: column; align-items: center;
          padding: 16px 28px; background: linear-gradient(135deg, #ff6600, #ff3300);
          color: #fff; border-radius: 4px; width: 100%;
          box-shadow: 0 0 24px rgba(255,80,0,0.3);
        }
        .btn-fire:hover { transform: translateY(-2px); box-shadow: 0 0 40px rgba(255,80,0,0.5); }
        .btn-fire-main { font-size: 14px; font-weight: 700; letter-spacing: 3px; }
        .btn-fire-sub { font-size: 10px; letter-spacing: 1px; opacity: 0.8; margin-top: 4px; }

        .build-screen { display: flex; gap: 0; min-height: calc(100vh - 49px); }
        .build-left { flex: 1; padding: 24px; overflow-y: auto; display: flex; flex-direction: column; gap: 20px; }
        .build-right { width: 240px; padding: 20px 16px; border-left: 1px solid rgba(0,180,255,0.1); display: flex; flex-direction: column; gap: 16px; position: sticky; top: 49px; max-height: calc(100vh - 49px); overflow-y: auto; }
        .build-header { }
        .build-title { font-family: 'Barlow Condensed', sans-serif; font-size: 22px; font-weight: 700; letter-spacing: 3px; color: #00aaff; }
        .build-subtitle { font-size: 9px; letter-spacing: 2px; color: #4a6070; margin-top: 2px; }

        .level-card { background: rgba(0,180,255,0.03); border: 1px solid rgba(0,180,255,0.12); border-radius: 6px; overflow: hidden; }
        .level-header { display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: rgba(0,180,255,0.06); border-bottom: 1px solid rgba(0,180,255,0.1); }
        .level-badge { font-family: 'Barlow Condensed', sans-serif; font-size: 20px; font-weight: 800; color: #00aaff; min-width: 28px; }
        .level-info { flex: 1; }
        .level-alpha { font-family: 'Barlow Condensed', sans-serif; font-size: 16px; font-weight: 700; letter-spacing: 1px; color: #c8d8e8; }
        .level-thresholds { display: block; font-size: 9px; color: #4a6070; margin-top: 1px; }
        .level-actions { display: flex; gap: 6px; }

        .buckets-grid { display: flex; flex-direction: column; }
        .bucket-row {
          display: grid;
          grid-template-columns: 160px 80px 1fr 100px;
          align-items: center;
          gap: 12px;
          padding: 8px 14px;
          cursor: pointer;
          border-bottom: 1px solid rgba(0,180,255,0.05);
          transition: background 0.1s;
        }
        .bucket-row:last-child { border-bottom: none; }
        .bucket-row:hover { background: rgba(0,180,255,0.06); }
        .bucket-row.selected { background: rgba(0,255,157,0.05); border-left: 3px solid #00ff9d; }
        .bucket-row.long:hover { background: rgba(0,255,157,0.04); }
        .bucket-row.short:hover { background: rgba(255,68,85,0.04); }

        .bucket-label { font-size: 10px; color: #8aa0b0; letter-spacing: 0.5px; }
        .bucket-n { font-size: 9px; color: #4a6070; }
        .bucket-bars { display: flex; flex-direction: column; gap: 4px; }
        .bar-row { display: flex; align-items: center; gap: 6px; }
        .bar-label { font-size: 8px; color: #4a6070; min-width: 28px; }
        .bar-track { flex: 1; height: 5px; background: rgba(255,255,255,0.06); border-radius: 2px; overflow: hidden; position: relative; }
        .bar-fill { position: absolute; top: 0; height: 100%; border-radius: 2px; transition: width 0.3s; }
        .bar-val { font-size: 9px; min-width: 48px; text-align: right; }

        .bucket-select-indicator { font-size: 9px; letter-spacing: 1px; text-align: center; padding: 3px 8px; border-radius: 2px; border: 1px solid; }
        .bucket-select-indicator.on { color: #00ff9d; border-color: rgba(0,255,157,0.4); background: rgba(0,255,157,0.08); }
        .bucket-select-indicator.off { color: #2a3a4a; border-color: rgba(42,58,74,0.4); }

        .add-level-row { padding: 16px 0 0; display: flex; justify-content: flex-start; }
        .max-depth-msg { font-size: 10px; color: #4a6070; letter-spacing: 1px; }
        .hint-box { font-size: 11px; color: #4a6070; padding: 12px; background: rgba(0,180,255,0.03); border: 1px dashed rgba(0,180,255,0.15); border-radius: 4px; text-align: center; line-height: 1.6; }

        .stats-panel { background: rgba(0,180,255,0.03); border: 1px solid rgba(0,180,255,0.12); border-radius: 6px; padding: 14px; }
        .stats-title { font-family: 'Barlow Condensed', sans-serif; font-size: 11px; letter-spacing: 2px; color: #4a8090; margin-bottom: 10px; }
        .stats-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; font-size: 10px; }
        .stats-label { color: #4a6070; }
        .stats-val { color: #c8d8e8; }
        .stats-divider { height: 1px; background: rgba(0,180,255,0.1); margin: 8px 0; }
        .stats-score { font-family: 'Barlow Condensed', sans-serif; font-size: 24px; font-weight: 700; }
        .stats-score.positive { color: #00ff9d; }
        .stats-score.negative { color: #ff4455; }
        .coverage-bar-wrap { height: 3px; background: rgba(255,255,255,0.06); border-radius: 2px; overflow: hidden; margin-top: 10px; }
        .coverage-bar { height: 100%; background: linear-gradient(90deg, #00aaff, #00ff9d); border-radius: 2px; transition: width 0.5s; }

        .editor-panel { background: rgba(0,180,255,0.04); border: 1px solid rgba(0,180,255,0.2); border-radius: 6px; padding: 18px; }
        .editor-title { font-family: 'Barlow Condensed', sans-serif; font-size: 14px; font-weight: 700; letter-spacing: 3px; color: #00aaff; margin-bottom: 16px; }
        .editor-row { margin-bottom: 14px; }
        .editor-row label { display: block; font-size: 9px; letter-spacing: 1px; color: #4a6070; margin-bottom: 6px; }
        .alpha-select-grid { display: flex; flex-wrap: wrap; gap: 6px; }
        .alpha-chip { padding: 5px 10px; font-size: 10px; background: rgba(0,180,255,0.05); border: 1px solid rgba(0,180,255,0.15); color: #8aa0b0; border-radius: 3px; cursor: pointer; transition: all 0.12s; }
        .alpha-chip:hover { border-color: #00aaff; color: #c8d8e8; }
        .alpha-chip.active { background: rgba(0,170,255,0.15); border-color: #00aaff; color: #00aaff; }
        .threshold-input { width: 100%; padding: 8px 10px; background: rgba(0,0,0,0.3); border: 1px solid rgba(0,180,255,0.2); color: #c8d8e8; font-family: 'Space Mono', monospace; font-size: 11px; border-radius: 3px; outline: none; }
        .threshold-input:focus { border-color: #00aaff; }
        .editor-preview { margin-bottom: 14px; }
        .preview-label { font-size: 9px; letter-spacing: 1px; color: #4a6070; margin-bottom: 8px; }
        .preview-mini-buckets { display: flex; flex-direction: column; gap: 3px; max-height: 140px; overflow-y: auto; }
        .preview-bucket { display: flex; gap: 10px; font-size: 9px; padding: 3px 8px; background: rgba(0,0,0,0.2); border-radius: 2px; }
        .preview-bucket-label { color: #8aa0b0; flex: 1; }
        .preview-bucket-n { color: #4a6070; min-width: 50px; }
        .preview-bucket-ret { min-width: 70px; text-align: right; }
        .editor-btns { display: flex; gap: 10px; }

        .oos-screen { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: calc(100vh - 49px); padding: 40px 24px; gap: 28px; }
        .oos-title { font-family: 'Barlow Condensed', sans-serif; font-size: 36px; font-weight: 800; letter-spacing: 6px; color: #ffcc44; }
        .oos-sub { font-size: 11px; color: #4a6070; letter-spacing: 2px; }
        .oos-progress-wrap { width: 100%; max-width: 500px; height: 6px; background: rgba(255,255,255,0.06); border-radius: 3px; overflow: hidden; }
        .oos-progress-bar { height: 100%; background: linear-gradient(90deg, #ff6600, #ffcc44); border-radius: 3px; transition: width 0.06s linear; box-shadow: 0 0 12px rgba(255,180,0,0.5); }
        .oos-pct { font-family: 'Barlow Condensed', sans-serif; font-size: 48px; font-weight: 800; color: #ffcc44; }
        .oos-log { width: 100%; max-width: 600px; height: 160px; overflow-y: auto; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,204,68,0.1); border-radius: 4px; padding: 10px 12px; font-size: 9px; color: #4a6070; display: flex; flex-direction: column; gap: 2px; }
        .oos-log-line { color: #6a8090; }

        .results-screen { max-width: 860px; margin: 0 auto; padding: 36px 24px; display: flex; flex-direction: column; gap: 28px; }
        .results-header { display: flex; align-items: center; gap: 24px; }
        .grade-badge { font-family: 'Barlow Condensed', sans-serif; font-size: 72px; font-weight: 800; border: 3px solid; border-radius: 8px; width: 90px; height: 90px; display: flex; align-items: center; justify-content: center; }
        .results-title { font-family: 'Barlow Condensed', sans-serif; font-size: 32px; font-weight: 800; letter-spacing: 4px; color: #c8d8e8; }
        .results-sub { font-size: 10px; color: #4a6070; letter-spacing: 2px; margin-top: 4px; }
        .results-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
        .result-card { padding: 16px; background: rgba(0,180,255,0.03); border: 1px solid rgba(0,180,255,0.12); border-radius: 6px; }
        .result-card.highlight { background: rgba(0,255,157,0.04); border-color: rgba(0,255,157,0.2); }
        .rc-title { font-family: 'Barlow Condensed', sans-serif; font-size: 11px; letter-spacing: 2px; color: #4a8090; margin-bottom: 12px; }
        .rc-row { display: flex; justify-content: space-between; font-size: 11px; padding: 4px 0; border-bottom: 1px solid rgba(0,180,255,0.05); }
        .rc-score { font-family: 'Barlow Condensed', sans-serif; font-size: 20px; font-weight: 700; margin-top: 10px; color: #c8d8e8; }
        .rc-rule-row { display: flex; align-items: flex-start; gap: 8px; font-size: 10px; padding: 4px 0; border-bottom: 1px solid rgba(0,180,255,0.05); }
        .rc-rule-depth { font-family: 'Barlow Condensed', sans-serif; color: #00aaff; font-weight: 700; min-width: 20px; }
        .rc-rule-buckets { color: #4a6070; font-size: 9px; margin-top: 2px; }
        .verdict { padding: 14px 18px; border-radius: 4px; font-size: 12px; line-height: 1.6; }
        .verdict.good { background: rgba(0,255,157,0.06); border: 1px solid rgba(0,255,157,0.2); color: #00ff9d; }
        .verdict.warn { background: rgba(255,204,68,0.06); border: 1px solid rgba(255,204,68,0.2); color: #ffcc44; }
        .verdict.bad { background: rgba(255,68,85,0.06); border: 1px solid rgba(255,68,85,0.2); color: #ff4455; }
        .results-btns { display: flex; gap: 12px; }

        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(0,180,255,0.2); border-radius: 2px; }

        @media (max-width: 700px) {
          .build-screen { flex-direction: column; }
          .build-right { width: 100%; position: static; border-left: none; border-top: 1px solid rgba(0,180,255,0.1); }
          .results-grid { grid-template-columns: 1fr; }
          .bucket-row { grid-template-columns: 120px 60px 1fr 80px; }
        }
      `}</style>
      <div className="game-root">
        {renderHUD()}
        {phase === "intro"   && renderIntro()}
        {phase === "build"   && renderBuild()}
        {phase === "oos"     && renderOOS()}
        {phase === "results" && renderResults()}
      </div>
    </>
  );
}
