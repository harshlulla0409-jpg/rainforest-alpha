import { useState, useEffect, useRef, useCallback } from "react";

const INITIAL_ALPHAS = [
  { id: "lead_score_slow", label: "Lead Score Slow", desc: "" },
  { id: "basis_z_fast", label: "Basis Z Fast", desc: "" },
  { id: "basis_z_slow", label: "Basis Z Slow", desc: "" },
  { id: "basis_deviation", label: "Basis Deviation", desc: "" },
  { id: "cross_asset_ofi_fast", label: "Cross Asset OFI Fast", desc: "" },
  { id: "cross_asset_ofi_slow", label: "Cross Asset OFI Slow", desc: "" },
  { id: "imbalance_divergence", label: "Imbalance Div", desc: "" },
  { id: "return_divergence", label: "Return Divergence", desc: "" },
  { id: "vol_spillover", label: "Vol Spillover", desc: "" },
  { id: "resistance_ratio", label: "Resistance Ratio", desc: "" },
  { id: "book_pressure_cash", label: "Book Pressure Cash", desc: "" },
  { id: "rel_book_pressure", label: "Rel Book Pressure", desc: "" },
  { id: "rel_cancel_bid", label: "Rel Cancel Bid", desc: "" },
  { id: "rel_cancel_ask", label: "Rel Cancel Ask", desc: "" },
  { id: "rel_imbalance_velocity", label: "Rel Imbalance Vel", desc: "" },
  { id: "rel_smart_ofi", label: "Rel Smart OFI", desc: "" },
  { id: "rel_liquidity_skew", label: "Rel Liquidity Skew", desc: "" },
  { id: "rel_book_divergence", label: "Rel Book Div", desc: "" },
  { id: "rel_bid_depletion", label: "Rel Bid Depletion", desc: "" },
  { id: "rel_weighted_imbalance", label: "Rel Weighted Imb", desc: "" },
  { id: "toxicity_vpin_slow", label: "VPIN Slow", desc: "" },
  { id: "toxicity_vpin_fast", label: "VPIN Fast", desc: "" },
  { id: "spoof_flicker_fut", label: "Spoof Flicker Fut", desc: "" },
  { id: "spoof_flicker_cash", label: "Spoof Flicker Cash", desc: "" },
  { id: "limit_replenish_fut", label: "Limit Replenish Fut", desc: "" },
  { id: "trade_accel_fut", label: "Trade Accel Fut", desc: "" },
  { id: "limit_imbalance_fast_fut", label: "Limit Imb Fast Fut", desc: "" },
  { id: "limit_imbalance_slow_fut", label: "Limit Imb Slow Fut", desc: "" },
  { id: "limit_imbalance_fast_cash", label: "Limit Imb Fast Cash", desc: "" },
  { id: "limit_imbalance_slow_cash", label: "Limit Imb Slow Cash", desc: "" },
  { id: "sector_momentum_slow", label: "Sector Mom Slow", desc: "" },
  { id: "sector_momentum_fast", label: "Sector Mom Fast", desc: "" },
  { id: "vol_participation_fast", label: "Vol Part Fast", desc: "" },
  { id: "vol_participation_slow", label: "Vol Part Slow", desc: "" },
  { id: "sector_dispersion", label: "Sector Dispersion", desc: "" },
  { id: "macro_fracture_slow", label: "Macro Frac Slow", desc: "" },
  { id: "macro_fracture_fast", label: "Macro Frac Fast", desc: "" },
  { id: "relative_strength_slow", label: "Rel Strength Slow", desc: "" },
  { id: "relative_strength_fast", label: "Rel Strength Fast", desc: "" },
  { id: "trend_acceleration", label: "Trend Accel", desc: "" },
  { id: "stock_momentum_fast", label: "Stock Mom Fast", desc: "" },
  { id: "vwap_deviation_z", label: "VWAP Dev Z", desc: "" },
  { id: "unified_lead_score", label: "Unified Lead Score", desc: "" },
  { id: "taker_imbalance_fut", label: "Taker Imb Fut", desc: "" },
  { id: "taker_imbalance_cash", label: "Taker Imb Cash", desc: "" },
  { id: "l1_imbalance_fut", label: "L1 Imb Fut", desc: "" },
  { id: "l1_imbalance_cash", label: "L1 Imb Cash", desc: "" },
];

const INITIAL_FILTERS = [
  { id: "filter_mddv_cash", label: "MDDV Cash", desc: "" },
  { id: "filter_mddv_fut", label: "MDDV Fut", desc: "" },
  { id: "filter_spread_bps_cash", label: "Spread BPS Cash", desc: "" },
  { id: "filter_volatility_cash", label: "Volatility Cash", desc: "" },
  { id: "filter_lot_size_fut", label: "Lot Size Fut", desc: "" }
];

const RETURN_HORIZONS = [
  { label: "60s", key: "r60" },
  { label: "300s", key: "r300" },
  { label: "1800s", key: "r1800" },
];

const DEFAULT_BPS_THRESHOLDS = [-20, -10, -5, -2, 0, 2, 5, 10, 20];

// ── Types ─────────────────────────────────────────────────────────────────────

type BucketStat = { label: string; n: number; r60: number; r300: number; r1800: number };
type AggStats   = { n: number; r60: number; r300: number; r1800: number };

type Level = {
  alphaId: string;
  thresholds: number[];
  selectedBuckets: number[];
  buckets: BucketStat[];
  filteredRows: number;
  totalRows: number;
};

type RegressionResult = {
  intercept: number;
  coefficients: Record<string, number>;
  rSquared: number;
};

type OOSResults = {
  stats: AggStats;
  n: number;
  totalRows: number;
};

// ── API helpers ───────────────────────────────────────────────────────────────

const BASE_URL = import.meta.env.VITE_API_URL || "";

export async function apiFetchMeta(): Promise<{ isRows: number; oosRows: number }> {
  // Now targets 127.0.0
  const res = await fetch(`${BASE_URL}/api/data/meta`); 
  if (!res.ok) throw new Error(`meta ${res.status}`);
  return res.json();
}

export async function apiFetchBuckets(
  dataset: "is" | "oos",
  side: 1 | -1,
  alphaId: string,
  thresholds: number[],
  upstreamFilters: { alphaId: string; thresholds: number[]; selectedBuckets: number[] }[],
): Promise<{ buckets: BucketStat[]; filteredRows: number; totalRows: number }> {
  // Now targets 127.0.0
  const res = await fetch(`${BASE_URL}/api/buckets`, { 
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataset, side, alphaId, thresholds, upstreamFilters }),
  });
  if (!res.ok) throw new Error(`buckets ${res.status}`);
  return res.json();
}

export async function apiRunRegression(
  dataset: "is" | "oos",
  side: 1 | -1,
  features: string[],
  target: string,
  name: string
): Promise<RegressionResult> {
  const res = await fetch(`${BASE_URL}/api/regression`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataset, side, features, target, name }),
  });
  if (!res.ok) throw new Error(`regression ${res.status}`);
  return res.json();
}

// ── Stat helpers ──────────────────────────────────────────────────────────────

function aggStats(buckets: BucketStat[], selected: number[]): AggStats {
  const rows = buckets.filter((_, i) => selected.includes(i));
  const totalN = rows.reduce((s, b) => s + b.n, 0);
  if (totalN === 0) return { n: 0, r60: 0, r300: 0, r1800: 0 };
  const wmean = (key: "r60" | "r300" | "r1800") =>
    rows.reduce((s, b) => s + b[key] * b.n, 0) / totalN;
  return { n: totalN, r60: wmean("r60"), r300: wmean("r300"), r1800: wmean("r1800") };
}

function buildUpstreamFilters(levels: Level[], upToIdx: number) {
  return levels.slice(0, upToIdx).map((l) => ({
    alphaId: l.alphaId,
    thresholds: l.thresholds,
    selectedBuckets: l.selectedBuckets,
  }));
}

// ── Color / bar helpers ───────────────────────────────────────────────────────

function pnlColor(val: number, mult: number = 1) {
  const adj = val * mult;
  if (adj > 2) return "#27ae60";
  if (adj > 0.5) return "#2ecc71";
  if (adj > -0.5) return "#a4b595";
  if (adj > -2) return "#d35400";
  return "#e74c3c";
}

function barWidth(val: number, maxAbs: number) {
  return maxAbs === 0 ? 0 : Math.min(100, (Math.abs(val) / maxAbs) * 100);
}

// ── Main component ────────────────────────────────────────────────────────────

export default function HFTGame() {
  const [phase, setPhase] = useState<"intro" | "build" | "oos" | "results">("intro");
  const [meta, setMeta] = useState<{ isRows: number; oosRows: number } | null>(null);

  // Dynamic alpha list that allows us to inject custom signals
  const [availableAlphas, setAvailableAlphas] = useState(INITIAL_ALPHAS);
  const [levels, setLevels] = useState<Level[]>([]);
  const [filters, setFilters] = useState<Level[]>([]);
  const [editingState, setEditingState] = useState<{ type: "alpha" | "filter"; idx: number } | null>(null);
  const [pendingAlpha, setPendingAlpha] = useState(INITIAL_ALPHAS[0].id);
  const [pendingThresholds, setPendingThresholds] = useState([...DEFAULT_BPS_THRESHOLDS]);
  const [thresholdInput, setThresholdInput] = useState(DEFAULT_BPS_THRESHOLDS.join(", "));
  const [previewData, setPreviewData] = useState<{ buckets: BucketStat[]; filteredRows: number } | null>(null);

  const [gameDirection, setGameDirection] = useState<"long" | "short">("long");

  const [regressionFeatures, setRegressionFeatures] = useState<string[]>([]);
  const [regressionTarget, setRegressionTarget] = useState<string>("r60");
  const [regressionName, setRegressionName] = useState<string>("custom_alpha");
  const [regressionResults, setRegressionResults] = useState<RegressionResult | null>(null);
  const [isRegressionLoading, setIsRegressionLoading] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const [oosProgress, setOosProgress] = useState(0);
  const [oosResults, setOosResults] = useState<OOSResults | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Derived stats from current level selections ────────────────────────────
  const allLevels = [...levels, ...filters];
  const lastActiveLvl = [...allLevels].reverse().find((l) => l.selectedBuckets.length > 0);
  const currentStats: AggStats = lastActiveLvl
    ? aggStats(lastActiveLvl.buckets, lastActiveLvl.selectedBuckets)
    : { n: 0, r60: 0, r300: 0, r1800: 0 };
  const directionMult = gameDirection === "long" ? 1 : -1;
  const score = (currentStats.r60 * 1 + currentStats.r300 * 0.7 + currentStats.r1800 * 0.4) * directionMult;
  const coverage = meta && currentStats.n > 0 ? (currentStats.n / meta.isRows) * 100 : 0;

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  // If direction is swapped midway, flush out the build stack
  useEffect(() => {
    setLevels([]);
    setFilters([]);
    setEditingState(null);
    setPreviewData(null);
  }, [gameDirection]);

  // ── Refresh preview whenever pendingAlpha/thresholds/editingLevel change ───
  const refreshPreview = useCallback(async (
    type: "alpha" | "filter", lvlIdx: number, alphaId: string, thresholds: number[], sideVal: 1 | -1,
  ) => {
    const upstream = type === "alpha" 
      ? buildUpstreamFilters(levels, lvlIdx)
      : [...buildUpstreamFilters(levels, levels.length), ...buildUpstreamFilters(filters, lvlIdx)];
    try {
      const data = await apiFetchBuckets("is", sideVal, alphaId, thresholds, upstream);
      setPreviewData({ buckets: data.buckets, filteredRows: data.filteredRows });
    } catch {
      setPreviewData(null);
    }
  }, [levels, filters]);

  useEffect(() => {
    if (editingState === null) { setPreviewData(null); return; }
    refreshPreview(editingState.type, editingState.idx, pendingAlpha, pendingThresholds, directionMult as 1 | -1);
  }, [editingState, pendingAlpha, pendingThresholds, directionMult, refreshPreview]);

  // ── Game flow ──────────────────────────────────────────────────────────────

  async function startGame() {
    setIsLoading(true);
    setApiError(null);
    try {
      const m = await apiFetchMeta();
      setMeta(m);
      setAvailableAlphas(INITIAL_ALPHAS);
      setLevels([]);
      setFilters([]);
      setEditingState(null);
      setRegressionFeatures([]);
      setRegressionTarget("r60");
      setRegressionName("custom_alpha");
      setRegressionResults(null);
      setPendingAlpha(INITIAL_ALPHAS[0].id);
      setPendingThresholds([...DEFAULT_BPS_THRESHOLDS]);
      setThresholdInput(DEFAULT_BPS_THRESHOLDS.join(", "));
      setOosResults(null);
      setPhase("build");
    } catch (e) {
      setApiError(String(e));
    } finally {
      setIsLoading(false);
    }
  }

  function addLevel(type: "alpha" | "filter") {
    setEditingState({ type, idx: type === "alpha" ? levels.length : filters.length });
    setPendingAlpha(type === "alpha" ? availableAlphas[0].id : INITIAL_FILTERS[0].id);
    setPendingThresholds([...DEFAULT_BPS_THRESHOLDS]);
    setThresholdInput(DEFAULT_BPS_THRESHOLDS.join(", "));
  }

  function editLevel(type: "alpha" | "filter", idx: number) {
    const lvl = type === "alpha" ? levels[idx] : filters[idx];
    setEditingState({ type, idx });
    setPendingAlpha(lvl.alphaId);
    setPendingThresholds([...lvl.thresholds]);
    setThresholdInput(lvl.thresholds.join(", "));
  }

  async function applyPendingLevel() {
    if (editingState === null) return;
    setIsLoading(true);
    setApiError(null);
    try {
      const { type, idx } = editingState;
      const upstream = type === "alpha" 
        ? buildUpstreamFilters(levels, idx)
        : [...buildUpstreamFilters(levels, levels.length), ...buildUpstreamFilters(filters, idx)];
        
      const data = await apiFetchBuckets("is", directionMult as 1 | -1, pendingAlpha, pendingThresholds, upstream);
      const newLvl: Level = {
        alphaId: pendingAlpha,
        thresholds: [...pendingThresholds],
        buckets: data.buckets,
        filteredRows: data.filteredRows,
        totalRows: data.totalRows,
        selectedBuckets: [],
      };
      
      if (type === "alpha") setLevels((prev) => [...prev.slice(0, idx), newLvl]);
      else setFilters((prev) => [...prev.slice(0, idx), newLvl]);
      
      setEditingState(null);
    } catch (e) {
      setApiError(String(e));
    } finally {
      setIsLoading(false);
    }
  }

  function toggleBucket(type: "alpha" | "filter", lvlIdx: number, bucketIdx: number) {
    const updater = (prev: Level[]) =>
      prev.slice(0, lvlIdx + 1).map((lvl, i) => {
        if (i !== lvlIdx) return lvl;
        const sel = lvl.selectedBuckets.includes(bucketIdx)
          ? lvl.selectedBuckets.filter((b) => b !== bucketIdx)
          : [...lvl.selectedBuckets, bucketIdx];
        return { ...lvl, selectedBuckets: sel };
      });
    if (type === "alpha") setLevels(updater);
    else setFilters(updater);
  }

  function removeLevel(type: "alpha" | "filter", idx: number) {
    if (type === "alpha") setLevels((prev) => prev.slice(0, idx));
    else setFilters((prev) => prev.slice(0, idx));
    setEditingState(null);
  }

  async function startOOS() {
    if (!levels.length) return;
    setPhase("oos");
    setOosProgress(0);
    setApiError(null);

    // Fire OOS API call immediately — animate in parallel
    const isFilterStage = filters.length > 0;
    const lastLvl = isFilterStage ? filters[filters.length - 1] : levels[levels.length - 1];
    
    const upstream = isFilterStage
      ? [...buildUpstreamFilters(levels, levels.length), ...buildUpstreamFilters(filters, filters.length - 1)]
      : buildUpstreamFilters(levels, levels.length - 1);

    let oosResultData: OOSResults | null = null;
    try {
      const data = await apiFetchBuckets("oos", directionMult as 1 | -1, lastLvl.alphaId, lastLvl.thresholds, upstream);
      const stats = aggStats(data.buckets, lastLvl.selectedBuckets);
      oosResultData = { stats, n: stats.n, totalRows: data.totalRows };
    } catch (e) {
      setApiError(String(e));
    }

    // Animate progress bar then reveal results
    let progress = 0;
    timerRef.current = setInterval(() => {
      progress += 2;
      setOosProgress(Math.min(progress, 100));
      if (progress >= 100) {
        if (timerRef.current) clearInterval(timerRef.current);
        setOosResults(oosResultData);
        setPhase("results");
      }
    }, 60);
  }

  async function runRegression() {
    setIsRegressionLoading(true);
    setApiError(null);
    try {
      const data = await apiRunRegression("is", directionMult as 1 | -1, regressionFeatures, regressionTarget, regressionName);
      setRegressionResults(data);
      
      if (!availableAlphas.find((a) => a.id === regressionName)) {
        setAvailableAlphas((prev) => [...prev, {
          id: regressionName,
          label: regressionName,
          desc: `OLS on ${regressionTarget}`
        }]);
      }
    } catch (e) {
      setApiError(String(e));
    } finally {
      setIsRegressionLoading(false);
    }
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  function renderIntro() {
    return (
      <div className="intro-screen">
        <div className="intro-logo">
          <span className="logo-hft">RAINFOREST</span>
          <span className="logo-alpha">TRADING</span>
          <span className="logo-bucket">SIMULATOR</span>
        </div>
        <p className="intro-sub">Strategy research simulation · In-sample optimization · OOS validation</p>
        <div className="intro-rules">
          <div className="rule"><span className="rule-num">01</span><span>Choose an alpha signal & bucket by basis points of forward return</span></div>
          <div className="rule"><span className="rule-num">02</span><span>Select buckets where the edge is in your favor</span></div>
          <div className="rule"><span className="rule-num">03</span><span>Drill deeper with additional alpha layers</span></div>
          <div className="rule"><span className="rule-num">04</span><span>Trade your rule on an unseen OOS day — see if it holds</span></div>
        </div>
        <div className="dir-selector">
          <button 
            className={`dir-btn long ${gameDirection === "long" ? "active" : ""}`} 
            onClick={() => setGameDirection("long")}
          >LONG STRATEGY</button>
          <button 
            className={`dir-btn short ${gameDirection === "short" ? "active" : ""}`} 
            onClick={() => setGameDirection("short")}
          >SHORT STRATEGY</button>
        </div>
        {apiError && <div className="error-box">⚠ {apiError}</div>}
        <button className="btn-primary btn-big" onClick={startGame} disabled={isLoading}>
          {isLoading ? "CONNECTING…" : "INITIALIZE SIMULATION"}
        </button>
      </div>
    );
  }

  function renderBucketLevel(lvl: Level, lvlIdx: number, type: "alpha" | "filter") {
    const maxAbs = Math.max(...lvl.buckets.map((b) =>
      Math.max(Math.abs(b.r60), Math.abs(b.r300), Math.abs(b.r1800))), 0.1);
      
    const sourceList = type === "alpha" ? availableAlphas : INITIAL_FILTERS;
    const prefix = type === "alpha" ? "L" : "F";

    return (
      <div key={lvlIdx} className="level-card">
        <div className="level-header">
          <div className={`level-badge ${type === "filter" ? "filter-badge" : ""}`}>{prefix}{lvlIdx + 1}</div>
          <div className="level-info">
            <span className="level-alpha">{sourceList.find((a) => a.id === lvl.alphaId)?.label}</span>
            <span className="level-thresholds">{lvl.thresholds.join(", ")} bps</span>
          </div>
          <div className="level-actions">
            <button className="btn-xs" onClick={() => editLevel(type, lvlIdx)}>EDIT</button>
            <button className="btn-xs btn-danger" onClick={() => removeLevel(type, lvlIdx)}>✕</button>
          </div>
        </div>
        <div className="buckets-grid">
          {lvl.buckets.map((b, bi) => {
            const selected = lvl.selectedBuckets.includes(bi);
            const dominant = Math.abs(b.r60) > 0.5 ? (b.r60 > 0 ? "long" : "short") : "neutral";
            return (
              <div
                key={bi}
                className={`bucket-row ${selected ? "selected" : ""} ${dominant}`}
                onClick={() => toggleBucket(type, lvlIdx, bi)}
              >
                <div className="bucket-label">{b.label}</div>
                <div className="bucket-n">n={b.n.toLocaleString()}</div>
                <div className="bucket-bars">
                  {RETURN_HORIZONS.map(({ key, label }) => {
                    const v = b[key as "r60" | "r300" | "r1800"];
                    return (
                      <div key={key} className="bar-row">
                        <span className="bar-label">{label}</span>
                        <div className="bar-track">
                          <div
                            className="bar-fill"
                            style={{
                              width: `${barWidth(v, maxAbs)}%`,
                              background: pnlColor(v, directionMult),
                              marginLeft: v < 0 ? `${100 - barWidth(v, maxAbs)}%` : "0",
                            }}
                          />
                        </div>
                        <span className="bar-val" style={{ color: pnlColor(v, directionMult) }}>
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
    if (editingState === null) return null;
    const { type, idx } = editingState;
    const isNew = idx === (type === "alpha" ? levels.length : filters.length);
    const sourceList = type === "alpha" ? availableAlphas : INITIAL_FILTERS;

    return (
      <div className="editor-panel">
        <div className="editor-title">{isNew ? `ADD ${type.toUpperCase()} ${idx + 1}` : `EDIT ${type.toUpperCase()} ${idx + 1}`}</div>
        <div className="editor-row">
          <label>{type === "alpha" ? "Alpha Signal" : "Filter Metric"}</label>
          <div className="alpha-select-grid">
            {sourceList.map((a) => (
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
              const parsed = e.target.value
                .split(",")
                .map((s) => parseFloat(s.trim()))
                .filter((n) => !isNaN(n))
                .sort((a, b) => a - b);
              if (parsed.length > 0) setPendingThresholds(parsed);
            }}
          />
        </div>
        {previewData && (
          <div className="editor-preview">
            <div className="preview-label">
              PREVIEW ({previewData.filteredRows.toLocaleString()} rows → {previewData.buckets.length} buckets)
            </div>
            <div className="preview-mini-buckets">
              {previewData.buckets.map((b, bi) => (
                <div key={bi} className="preview-bucket">
                  <span className="preview-bucket-label">{b.label}</span>
                  <span className="preview-bucket-n">n={b.n}</span>
                  <span className="preview-bucket-ret" style={{ color: pnlColor(b.r60, directionMult) }}>
                    60s: {b.r60 >= 0 ? "+" : ""}{b.r60.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {apiError && <div className="error-box">⚠ {apiError}</div>}
        <div className="editor-btns">
          <button className="btn-primary" onClick={applyPendingLevel} disabled={isLoading}>
            {isLoading ? "LOADING…" : "APPLY"}
          </button>
          <button className="btn-ghost" onClick={() => setEditingState(null)}>CANCEL</button>
        </div>
      </div>
    );
  }

  function renderBuild() {
    const hasSelections = levels.some((l) => l.selectedBuckets?.length > 0);
    const lastLevelComplete = levels.length > 0 && levels[levels.length - 1].selectedBuckets?.length > 0;
    const canAddMore = lastLevelComplete && levels.length < 5;
    const canGo = hasSelections && editingState === null;

    return (
      <div className="build-screen">
        <div className="build-left">
          <div className="build-header">
            <div className="build-title">STRATEGY BUILDER</div>
            <div className="build-subtitle">IN-SAMPLE · {meta?.isRows.toLocaleString() ?? "—"} EVENTS</div>
          </div>

          {editingState !== null && renderEditor()}

          {editingState === null && (
            <>
              {levels.map((lvl, idx) => renderBucketLevel(lvl, idx, "alpha"))}
              <div className="add-level-row">
                {levels.length === 0 && (
                  <button className="btn-primary" onClick={() => addLevel("alpha")}>+ ADD FIRST ALPHA LAYER</button>
                )}
                {canAddMore && (
                  <button className="btn-secondary" onClick={() => addLevel("alpha")}>+ ADD DEEPER LAYER (L{levels.length + 1})</button>
                )}
                {hasSelections && !canAddMore && levels.length >= 5 && (
                  <div className="max-depth-msg">MAX DEPTH REACHED (5 layers)</div>
                )}
              </div>
              
              {levels.length > 0 && (
                <div className="mt-8 border-t border-[#2ecc71]/20 pt-6">
                  <div className="build-title" style={{ fontSize: "16px", color: "#1abc9c" }}>FILTER LAYERS</div>
                  <div className="build-subtitle mb-4">POST-ALPHA EXECUTION FILTERS</div>
                  {filters.map((lvl, idx) => renderBucketLevel(lvl, idx, "filter"))}
                  <div className="add-level-row">
                     <button className="btn-secondary" style={{ borderColor: "#1abc9c", color: "#1abc9c" }} onClick={() => addLevel("filter")}>+ ADD FILTER LAYER</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="build-right">
          <div className="stats-panel">
            <div className="stats-title">CURRENT RULE</div>
            <div className="stats-row">
              <span className="stats-label">Depth</span>
              <span className="stats-val">{allLevels.filter((l) => l.selectedBuckets?.length > 0).length} layers</span>
            </div>
            <div className="stats-row">
              <span className="stats-label">Coverage</span>
              <span className="stats-val">{coverage.toFixed(1)}%</span>
            </div>
            <div className="stats-row">
              <span className="stats-label">Matched rows</span>
              <span className="stats-val">{currentStats.n.toLocaleString()}</span>
            </div>
            <div className="stats-divider" />
            <div className="stats-title">EXPECTED EDGE</div>
            {RETURN_HORIZONS.map(({ key, label }) => (
              <div key={key} className="stats-row">
                <span className="stats-label">{label}</span>
                <span className="stats-val" style={{ color: pnlColor(currentStats[key as "r60" | "r300" | "r1800"], directionMult) }}>
                  {currentStats[key as "r60" | "r300" | "r1800"] >= 0 ? "+" : ""}{currentStats[key as "r60" | "r300" | "r1800"].toFixed(3)} bps
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

          {/* REGRESSION STUDIO */}
          <div className="stats-panel mt-4 flex flex-col gap-3">
            <div className="stats-title">REGRESSION STUDIO</div>
            
            <div className="flex flex-col gap-2">
              {INITIAL_ALPHAS.map(a => (
                <label key={a.id} className="flex items-center gap-2 text-[10px] text-[#819985] cursor-pointer hover:text-[#cce3ce] transition-colors">
                  <input
                    type="checkbox"
                    className="accent-[#2ecc71] bg-black/30 border-[#2ecc71]/30 cursor-pointer rounded-sm"
                    checked={regressionFeatures.includes(a.id)}
                    onChange={(e) => {
                      if (e.target.checked) setRegressionFeatures([...regressionFeatures, a.id]);
                      else setRegressionFeatures(regressionFeatures.filter(f => f !== a.id));
                    }}
                  />
                  {a.label}
                </label>
              ))}
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[9px] text-[#55735b] tracking-widest uppercase">Target Horizon</span>
              <select
                className="w-full p-1.5 bg-black/30 border border-[#2ecc71]/20 text-[#cce3ce] font-mono text-[11px] rounded outline-none focus:border-[#2ecc71] transition-colors"
                value={regressionTarget}
                onChange={(e) => setRegressionTarget(e.target.value)}
              >
                {RETURN_HORIZONS.map(rh => (
                  <option key={rh.key} value={rh.key}>{rh.key} ({rh.label})</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[9px] text-[#55735b] tracking-widest uppercase">Signal Name</span>
              <input
                className="w-full p-1.5 bg-black/30 border border-[#2ecc71]/20 text-[#cce3ce] font-mono text-[11px] rounded outline-none focus:border-[#2ecc71] transition-colors"
                value={regressionName}
                onChange={(e) => setRegressionName(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                placeholder="e.g. alpha_1"
              />
            </div>

            <button className="btn-secondary w-full" onClick={runRegression} disabled={isRegressionLoading || regressionFeatures.length === 0 || !regressionName.trim()}>
              {isRegressionLoading ? "RUNNING..." : "RUN OLS REGRESSION"}
            </button>

            {regressionResults && (
              <div className="mt-2 pt-3 border-t border-[#2ecc71]/10 text-[10px] flex flex-col gap-1 text-[#cce3ce]">
                <div className="flex justify-between text-[#819985]"><span>R-Squared</span> <span className="text-[#cce3ce]">{(regressionResults.rSquared * 100).toFixed(2)}%</span></div>
                <div className="flex justify-between text-[#819985]"><span>Intercept</span> <span className="text-[#cce3ce]">{regressionResults.intercept.toFixed(4)}</span></div>
                <div className="text-[#55735b] mt-2 mb-1 border-b border-[#2ecc71]/10 pb-1">Coefficients</div>
                {Object.entries(regressionResults.coefficients).map(([k, v]) => (
                  <div key={k} className="flex justify-between items-center">
                    <span className="text-[#819985] text-[9px] truncate max-w-[100px]" title={k}>{k}</span>
                    <span className={v >= 0 ? "text-[#27ae60]" : "text-[#e74c3c]"}>{v >= 0 ? '+' : ''}{v.toFixed(4)}</span>
                  </div>
                ))}
              </div>
            )}
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
          {apiError && <div className="error-box">⚠ {apiError}</div>}
        </div>
      </div>
    );
  }

  function renderOOS() {
    return (
      <div className="oos-screen">
        <div className="oos-title">EXECUTING STRATEGY</div>
        <div className="oos-sub">Out-of-sample day · {meta?.oosRows.toLocaleString() ?? "—"} events</div>
        <div className="oos-progress-wrap">
          <div className="oos-progress-bar" style={{ width: `${oosProgress}%` }} />
        </div>
        <div className="oos-pct">{oosProgress}%</div>
        <div className="oos-log">
          {[...Array(Math.floor(oosProgress / 5))].map((_, i) => (
            <div key={i} className="oos-log-line">
              [{new Date(Date.now() - (20 - i) * 3000).toISOString().slice(11, 19)}]{" "}
              TRADE {gameDirection.toUpperCase()} · bucket matched · forwarded to execution
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderResults() {
    if (!oosResults) return null;
    const { stats } = oosResults;
    const oosScore = (stats.r60 * 1 + stats.r300 * 0.7 + stats.r1800 * 0.4) * directionMult;
    const isGood = oosScore > 0;
    const isGoodIS = score > 0;
    const overfitRatio = isGoodIS ? oosScore / score : 0;

    let grade: string, gradeColor: string;
    if (oosScore > 2)       { grade = "S"; gradeColor = "#27ae60"; }
    else if (oosScore > 1)  { grade = "A"; gradeColor = "#2ecc71"; }
    else if (oosScore > 0)  { grade = "B"; gradeColor = "#a4b595"; }
    else if (oosScore > -1) { grade = "C"; gradeColor = "#f1c40f"; }
    else if (oosScore > -2) { grade = "D"; gradeColor = "#e67e22"; }
    else                    { grade = "F"; gradeColor = "#e74c3c"; }

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
                <span style={{ color: pnlColor(currentStats[key as "r60" | "r300" | "r1800"], directionMult) }}>
                  {currentStats[key as "r60" | "r300" | "r1800"] >= 0 ? "+" : ""}{currentStats[key as "r60" | "r300" | "r1800"].toFixed(3)} bps
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
                <span style={{ color: pnlColor(stats[key as "r60" | "r300" | "r1800"], directionMult) }}>
                  {stats[key as "r60" | "r300" | "r1800"] >= 0 ? "+" : ""}{stats[key as "r60" | "r300" | "r1800"].toFixed(3)} bps
                </span>
              </div>
            ))}
            <div className="rc-score" style={{ color: isGood ? "#27ae60" : "#e74c3c" }}>
              Score: {oosScore.toFixed(2)}
            </div>
          </div>
          <div className="result-card">
            <div className="rc-title">RULE SUMMARY</div>
            {allLevels.filter((l) => l.selectedBuckets?.length > 0).map((lvl, i) => {
              const isFilter = i >= levels.length;
              const displayIdx = isFilter ? i - levels.length : i;
              const prefix = isFilter ? "F" : "L";
              const sourceList = isFilter ? INITIAL_FILTERS : availableAlphas;
              
              return (
              <div key={i} className="rc-rule-row">
                <span className="rc-rule-depth" style={{ color: isFilter ? "#1abc9c" : "#2ecc71" }}>{prefix}{displayIdx + 1}</span>
                <span>{sourceList.find((a) => a.id === lvl.alphaId)?.label}</span>
                <span className="rc-rule-buckets">
                  {lvl.selectedBuckets.map((bi) => lvl.buckets[bi]?.label).join(", ")}
                </span>
              </div>
              );
            })}
            <div className="rc-row">
              <span>Coverage</span>
              <span>
                {coverage.toFixed(1)}% IS / {oosResults.totalRows > 0 ? ((oosResults.n / oosResults.totalRows) * 100).toFixed(1) : 0}% OOS
              </span>
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
          <button className="btn-ghost" onClick={startGame}>NEW SIMULATION</button>
        </div>
      </div>
    );
  }

  function renderHUD() {
    if (phase === "intro") return null;
    return (
      <div className="hud">
        <div className="hud-left">
          <span className="hud-logo">RAINFOREST·TRADING</span>
          <span className={`hud-phase ${phase}`}>{phase.toUpperCase()}</span>
          {phase !== "intro" && <span className={`hud-phase hud-dir ${gameDirection}`}>{gameDirection.toUpperCase()}</span>}
        </div>
        <div className="hud-right">
          {phase === "build" && (
            <>
              <div className="hud-stat"><span>IS rows</span><span>{meta?.isRows.toLocaleString() ?? "—"}</span></div>
              <div className="hud-stat"><span>Matched</span><span>{currentStats.n.toLocaleString()}</span></div>
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
          background: #061208;
          color: #cce3ce;
          font-family: 'Space Mono', monospace;
          min-height: 100vh;
          overflow-x: hidden;
        }

        #root, .game-root {
          min-height: 100vh;
          background: #061208;
          background-image:
            radial-gradient(ellipse 80% 50% at 50% -10%, rgba(46,204,113,0.07) 0%, transparent 60%),
            repeating-linear-gradient(0deg, transparent, transparent 39px, rgba(46,204,113,0.03) 39px, rgba(46,204,113,0.03) 40px),
            repeating-linear-gradient(90deg, transparent, transparent 39px, rgba(46,204,113,0.02) 39px, rgba(46,204,113,0.02) 40px);
        }

        .hud {
          position: sticky; top: 0; z-index: 100;
          display: flex; justify-content: space-between; align-items: center;
          padding: 10px 24px;
          background: rgba(6,18,8,0.92);
          border-bottom: 1px solid rgba(46,204,113,0.2);
          backdrop-filter: blur(8px);
        }
        .hud-left { display: flex; align-items: center; gap: 16px; }
        .hud-logo { font-family: 'Barlow Condensed', sans-serif; font-weight: 800; font-size: 16px; letter-spacing: 2px; color: #2ecc71; }
        .hud-phase { font-size: 10px; letter-spacing: 2px; padding: 2px 8px; border-radius: 2px; background: rgba(46,204,113,0.1); border: 1px solid rgba(46,204,113,0.3); }
        .hud-phase.build { color: #2ecc71; }
        .hud-phase.oos { color: #f1c40f; border-color: rgba(241,196,15,0.4); background: rgba(241,196,15,0.08); }
        .hud-phase.results { color: #27ae60; border-color: rgba(39,174,96,0.4); background: rgba(39,174,96,0.08); }
        .hud-right { display: flex; gap: 24px; }
        .hud-stat { display: flex; flex-direction: column; align-items: flex-end; }
        .hud-stat span:first-child { font-size: 9px; color: #55735b; letter-spacing: 1px; }
        .hud-stat span:last-child { font-size: 13px; color: #cce3ce; }

        .intro-screen {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          min-height: 100vh; gap: 40px; padding: 40px 24px; text-align: center;
        }
        .intro-logo {
          display: flex; flex-direction: column; align-items: center; line-height: 1;
          font-family: 'Barlow Condensed', sans-serif; font-weight: 800;
        }
        .logo-hft { font-size: 14px; letter-spacing: 10px; color: #2ecc71; margin-bottom: 4px; }
        .logo-alpha { font-size: 56px; letter-spacing: 6px; color: #ffffff; }
        .logo-bucket { font-size: 16px; letter-spacing: 8px; color: #4a905a; margin-top: 4px; }
        .intro-sub { font-size: 11px; color: #55735b; letter-spacing: 2px; }
        .intro-rules { display: flex; flex-direction: column; gap: 12px; max-width: 440px; width: 100%; }
        .rule { display: flex; align-items: flex-start; gap: 16px; text-align: left; padding: 12px 16px; background: rgba(46,204,113,0.04); border: 1px solid rgba(46,204,113,0.1); border-radius: 4px; font-size: 12px; color: #819985; }
        .rule-num { font-family: 'Barlow Condensed', sans-serif; font-size: 20px; font-weight: 700; color: #2ecc71; min-width: 28px; }

        .btn-primary, .btn-secondary, .btn-ghost, .btn-fire, .btn-xs, .btn-danger {
          cursor: pointer; border: none; font-family: 'Space Mono', monospace; transition: all 0.15s;
        }
        .btn-primary {
          padding: 10px 24px; font-size: 12px; letter-spacing: 2px;
          background: #2ecc71; color: #061208; font-weight: 700; border-radius: 3px;
        }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none !important; }
        .btn-primary:hover:not(:disabled) { background: #27ae60; transform: translateY(-1px); }
        .btn-big { padding: 14px 40px; font-size: 14px; }
        .btn-secondary {
          padding: 10px 20px; font-size: 11px; letter-spacing: 2px;
          background: transparent; color: #2ecc71; border: 1px solid #2ecc71; border-radius: 3px;
        }
        .btn-secondary:hover { background: rgba(46,204,113,0.1); }
        .btn-ghost {
          padding: 10px 20px; font-size: 11px; letter-spacing: 2px;
          background: transparent; color: #55735b; border: 1px solid rgba(85,115,91,0.4); border-radius: 3px;
        }
        .btn-ghost:hover { color: #cce3ce; border-color: #819985; }
        .btn-xs {
          padding: 3px 8px; font-size: 9px; letter-spacing: 1px;
          background: transparent; color: #4a9062; border: 1px solid rgba(74,144,98,0.3); border-radius: 2px;
        }
        .btn-xs:hover { color: #2ecc71; border-color: #2ecc71; }
        .btn-danger { color: #e74c3c !important; border-color: rgba(231,76,60,0.3) !important; }
        .btn-danger:hover { color: #e95e4f !important; background: rgba(231,76,60,0.1) !important; }
        .btn-fire {
          display: flex; flex-direction: column; align-items: center;
          padding: 16px 28px; background: linear-gradient(135deg, #d35400, #c0392b);
          color: #fff; border-radius: 4px; width: 100%;
          box-shadow: 0 0 24px rgba(211,84,0,0.3);
        }
        .btn-fire:hover { transform: translateY(-2px); box-shadow: 0 0 40px rgba(211,84,0,0.5); }
        .btn-fire-main { font-size: 14px; font-weight: 700; letter-spacing: 3px; }
        .btn-fire-sub { font-size: 10px; letter-spacing: 1px; opacity: 0.8; margin-top: 4px; }

        .dir-selector { display: flex; gap: 16px; margin: 10px 0 20px; }
        .dir-btn { padding: 12px 24px; font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; letter-spacing: 2px; border: 2px solid transparent; border-radius: 4px; cursor: pointer; transition: all 0.2s; background: rgba(0,0,0,0.4); color: #819985; }
        .dir-btn.long.active { border-color: #2ecc71; color: #2ecc71; background: rgba(46,204,113,0.1); box-shadow: 0 0 16px rgba(46,204,113,0.2); }
        .dir-btn.short.active { border-color: #e74c3c; color: #e74c3c; background: rgba(231,76,60,0.1); box-shadow: 0 0 16px rgba(231,76,60,0.2); }
        .dir-btn:not(.active):hover { color: #cce3ce; background: rgba(255,255,255,0.05); }
        .hud-dir.long { color: #2ecc71; border-color: rgba(46,204,113,0.4); background: rgba(46,204,113,0.08); }
        .hud-dir.short { color: #e74c3c; border-color: rgba(231,76,60,0.4); background: rgba(231,76,60,0.08); }

        .error-box { padding: 10px 14px; background: rgba(231,76,60,0.08); border: 1px solid rgba(231,76,60,0.3); border-radius: 4px; font-size: 10px; color: #e95e4f; max-width: 440px; width: 100%; }

        .build-screen { display: flex; gap: 0; min-height: calc(100vh - 49px); }
        .build-left { flex: 1; padding: 24px; overflow-y: auto; display: flex; flex-direction: column; gap: 20px; }
        .build-right { width: 240px; padding: 20px 16px; border-left: 1px solid rgba(46,204,113,0.1); display: flex; flex-direction: column; gap: 16px; position: sticky; top: 49px; max-height: calc(100vh - 49px); overflow-y: auto; }
        .build-title { font-family: 'Barlow Condensed', sans-serif; font-size: 22px; font-weight: 700; letter-spacing: 3px; color: #2ecc71; }
        .build-subtitle { font-size: 9px; letter-spacing: 2px; color: #55735b; margin-top: 2px; }

        .level-card { background: rgba(46,204,113,0.03); border: 1px solid rgba(46,204,113,0.12); border-radius: 6px; overflow: hidden; }
        .level-header { display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: rgba(46,204,113,0.06); border-bottom: 1px solid rgba(46,204,113,0.1); }
        .level-badge { font-family: 'Barlow Condensed', sans-serif; font-size: 20px; font-weight: 800; color: #2ecc71; min-width: 28px; }
        .filter-badge { color: #1abc9c; }
        .level-info { flex: 1; }
        .level-alpha { font-family: 'Barlow Condensed', sans-serif; font-size: 16px; font-weight: 700; letter-spacing: 1px; color: #cce3ce; }
        .level-thresholds { display: block; font-size: 9px; color: #55735b; margin-top: 1px; }
        .level-actions { display: flex; gap: 6px; }

        .buckets-grid { display: flex; flex-direction: column; }
        .bucket-row {
          display: grid; grid-template-columns: 160px 80px 1fr 100px;
          align-items: center; gap: 12px; padding: 8px 14px;
          cursor: pointer; border-bottom: 1px solid rgba(46,204,113,0.05); transition: background 0.1s;
        }
        .bucket-row:last-child { border-bottom: none; }
        .bucket-row:hover { background: rgba(46,204,113,0.06); }
        .bucket-row.selected { background: rgba(39,174,96,0.05); border-left: 3px solid #27ae60; }
        .bucket-row.long:hover { background: rgba(39,174,96,0.04); }
        .bucket-row.short:hover { background: rgba(231,76,60,0.04); }
        .bucket-label { font-size: 10px; color: #819985; letter-spacing: 0.5px; }
        .bucket-n { font-size: 9px; color: #55735b; }
        .bucket-bars { display: flex; flex-direction: column; gap: 4px; }
        .bar-row { display: flex; align-items: center; gap: 6px; }
        .bar-label { font-size: 8px; color: #55735b; min-width: 28px; }
        .bar-track { flex: 1; height: 5px; background: rgba(255,255,255,0.06); border-radius: 2px; overflow: hidden; position: relative; }
        .bar-fill { position: absolute; top: 0; height: 100%; border-radius: 2px; transition: width 0.3s; }
        .bar-val { font-size: 9px; min-width: 48px; text-align: right; }
        .bucket-select-indicator { font-size: 9px; letter-spacing: 1px; text-align: center; padding: 3px 8px; border-radius: 2px; border: 1px solid; }
        .bucket-select-indicator.on { color: #27ae60; border-color: rgba(39,174,96,0.4); background: rgba(39,174,96,0.08); }
        .bucket-select-indicator.off { color: #2a4a30; border-color: rgba(42,74,48,0.4); }

        .add-level-row { padding: 16px 0 0; display: flex; justify-content: flex-start; }
        .max-depth-msg { font-size: 10px; color: #55735b; letter-spacing: 1px; }
        .hint-box { font-size: 11px; color: #55735b; padding: 12px; background: rgba(46,204,113,0.03); border: 1px dashed rgba(46,204,113,0.15); border-radius: 4px; text-align: center; line-height: 1.6; }

        .stats-panel { background: rgba(46,204,113,0.03); border: 1px solid rgba(46,204,113,0.12); border-radius: 6px; padding: 14px; }
        .stats-title { font-family: 'Barlow Condensed', sans-serif; font-size: 11px; letter-spacing: 2px; color: #4a9062; margin-bottom: 10px; }
        .stats-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; font-size: 10px; }
        .stats-label { color: #55735b; }
        .stats-val { color: #cce3ce; }
        .stats-divider { height: 1px; background: rgba(46,204,113,0.1); margin: 8px 0; }
        .stats-score { font-family: 'Barlow Condensed', sans-serif; font-size: 24px; font-weight: 700; }
        .stats-score.positive { color: #27ae60; }
        .stats-score.negative { color: #e74c3c; }
        .coverage-bar-wrap { height: 3px; background: rgba(255,255,255,0.06); border-radius: 2px; overflow: hidden; margin-top: 10px; }
        .coverage-bar { height: 100%; background: linear-gradient(90deg, #2ecc71, #27ae60); border-radius: 2px; transition: width 0.5s; }

        .editor-panel { background: rgba(46,204,113,0.04); border: 1px solid rgba(46,204,113,0.2); border-radius: 6px; padding: 18px; }
        .editor-title { font-family: 'Barlow Condensed', sans-serif; font-size: 14px; font-weight: 700; letter-spacing: 3px; color: #2ecc71; margin-bottom: 16px; }
        .editor-row { margin-bottom: 14px; }
        .editor-row label { display: block; font-size: 9px; letter-spacing: 1px; color: #55735b; margin-bottom: 6px; }
        .alpha-select-grid { display: flex; flex-wrap: wrap; gap: 6px; }
        .alpha-chip { padding: 5px 10px; font-size: 10px; background: rgba(46,204,113,0.05); border: 1px solid rgba(46,204,113,0.15); color: #819985; border-radius: 3px; cursor: pointer; transition: all 0.12s; }
        .alpha-chip:hover { border-color: #2ecc71; color: #cce3ce; }
        .alpha-chip.active { background: rgba(46,204,113,0.15); border-color: #2ecc71; color: #2ecc71; }
        .threshold-input { width: 100%; padding: 8px 10px; background: rgba(0,0,0,0.3); border: 1px solid rgba(46,204,113,0.2); color: #cce3ce; font-family: 'Space Mono', monospace; font-size: 11px; border-radius: 3px; outline: none; }
        .threshold-input:focus { border-color: #2ecc71; }
        .editor-preview { margin-bottom: 14px; }
        .preview-label { font-size: 9px; letter-spacing: 1px; color: #55735b; margin-bottom: 8px; }
        .preview-mini-buckets { display: flex; flex-direction: column; gap: 3px; max-height: 140px; overflow-y: auto; }
        .preview-bucket { display: flex; gap: 10px; font-size: 9px; padding: 3px 8px; background: rgba(0,0,0,0.2); border-radius: 2px; }
        .preview-bucket-label { color: #819985; flex: 1; }
        .preview-bucket-n { color: #55735b; min-width: 50px; }
        .preview-bucket-ret { min-width: 70px; text-align: right; }
        .editor-btns { display: flex; gap: 10px; }

        .oos-screen { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: calc(100vh - 49px); padding: 40px 24px; gap: 28px; }
        .oos-title { font-family: 'Barlow Condensed', sans-serif; font-size: 36px; font-weight: 800; letter-spacing: 6px; color: #f1c40f; }
        .oos-sub { font-size: 11px; color: #55735b; letter-spacing: 2px; }
        .oos-progress-wrap { width: 100%; max-width: 500px; height: 6px; background: rgba(255,255,255,0.06); border-radius: 3px; overflow: hidden; }
        .oos-progress-bar { height: 100%; background: linear-gradient(90deg, #d35400, #f1c40f); border-radius: 3px; transition: width 0.06s linear; box-shadow: 0 0 12px rgba(241,196,15,0.5); }
        .oos-pct { font-family: 'Barlow Condensed', sans-serif; font-size: 48px; font-weight: 800; color: #f1c40f; }
        .oos-log { width: 100%; max-width: 600px; height: 160px; overflow-y: auto; background: rgba(0,0,0,0.4); border: 1px solid rgba(241,196,15,0.1); border-radius: 4px; padding: 10px 12px; font-size: 9px; color: #55735b; display: flex; flex-direction: column; gap: 2px; }
        .oos-log-line { color: #6a8a70; }

        .results-screen { max-width: 860px; margin: 0 auto; padding: 36px 24px; display: flex; flex-direction: column; gap: 28px; }
        .results-header { display: flex; align-items: center; gap: 24px; }
        .grade-badge { font-family: 'Barlow Condensed', sans-serif; font-size: 72px; font-weight: 800; border: 3px solid; border-radius: 8px; width: 90px; height: 90px; display: flex; align-items: center; justify-content: center; }
        .results-title { font-family: 'Barlow Condensed', sans-serif; font-size: 32px; font-weight: 800; letter-spacing: 4px; color: #cce3ce; }
        .results-sub { font-size: 10px; color: #55735b; letter-spacing: 2px; margin-top: 4px; }
        .results-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
        .result-card { padding: 16px; background: rgba(46,204,113,0.03); border: 1px solid rgba(46,204,113,0.12); border-radius: 6px; }
        .result-card.highlight { background: rgba(39,174,96,0.04); border-color: rgba(39,174,96,0.2); }
        .rc-title { font-family: 'Barlow Condensed', sans-serif; font-size: 11px; letter-spacing: 2px; color: #4a9062; margin-bottom: 12px; }
        .rc-row { display: flex; justify-content: space-between; font-size: 11px; padding: 4px 0; border-bottom: 1px solid rgba(46,204,113,0.05); }
        .rc-score { font-family: 'Barlow Condensed', sans-serif; font-size: 20px; font-weight: 700; margin-top: 10px; color: #cce3ce; }
        .rc-rule-row { display: flex; align-items: flex-start; gap: 8px; font-size: 10px; padding: 4px 0; border-bottom: 1px solid rgba(46,204,113,0.05); }
        .rc-rule-depth { font-family: 'Barlow Condensed', sans-serif; color: #2ecc71; font-weight: 700; min-width: 20px; }
        .rc-rule-buckets { color: #55735b; font-size: 9px; margin-top: 2px; }
        .verdict { padding: 14px 18px; border-radius: 4px; font-size: 12px; line-height: 1.6; }
        .verdict.good { background: rgba(39,174,96,0.06); border: 1px solid rgba(39,174,96,0.2); color: #27ae60; }
        .verdict.warn { background: rgba(241,196,15,0.06); border: 1px solid rgba(241,196,15,0.2); color: #f1c40f; }
        .verdict.bad { background: rgba(231,76,60,0.06); border: 1px solid rgba(231,76,60,0.2); color: #e74c3c; }
        .results-btns { display: flex; gap: 12px; }

        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(46,204,113,0.2); border-radius: 2px; }

        @media (max-width: 700px) {
          .build-screen { flex-direction: column; }
          .build-right { width: 100%; position: static; border-left: none; border-top: 1px solid rgba(46,204,113,0.1); }
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
