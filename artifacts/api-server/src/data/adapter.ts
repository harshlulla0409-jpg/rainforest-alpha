/**
 * ─────────────────────────────────────────────────────────────────────────────
 * DATA ADAPTER
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * HOW TO PLUG IN YOUR OWN DATAFRAME
 * ──────────────────────────────────
 * Replace the `loadDataset` function below with your own loader.
 *
 * Each row must satisfy the `Row` interface:
 *   - One numeric column per alpha signal (e.g. "obi_pressure", "vwap_spread")
 *   - Three forward-return columns: r60, r300, r1800
 *     (these are the returns in basis-point-like units at 60s, 300s, 1800s horizons)
 *
 * PYTHON EXPORT EXAMPLE
 * ──────────────────────
 *   import json, pandas as pd
 *
 *   df_is  = ...   # your in-sample dataframe
 *   df_oos = ...   # your out-of-sample dataframe
 *
 *   # Columns required: obi_pressure, trade_flow_imb, microprice_dev,
 *   #                   vwap_spread, depth_slope, cancel_ratio,
 *   #                   r60, r300, r1800
 *   # Any extra columns are ignored by the server.
 *
 *   with open("data/is.json", "w") as f:
 *       json.dump(df_is[COLS].to_dict(orient="records"), f)
 *
 *   with open("data/oos.json", "w") as f:
 *       json.dump(df_oos[COLS].to_dict(orient="records"), f)
 *
 * Then update `loadDataset` below to read from those files, e.g.:
 *
 *   import { readFileSync } from "fs";
 *   import { join } from "path";
 *
 *   function loadDataset(split: "is" | "oos"): Row[] {
 *     const raw = readFileSync(join(__dirname, "../../data", `${split}.json`), "utf8");
 *     return JSON.parse(raw) as Row[];
 *   }
 *
 * STREAMING / DATABASE ALTERNATIVE
 * ──────────────────────────────────
 * If your dataset is too large for a JSON file, replace `loadDataset` with a
 * function that queries your database or streaming store, applies the upstream
 * filters in SQL/DuckDB, and returns only the matching rows.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type Row = {
  [alphaId: string]: number;
  r60: number;
  r300: number;
  r1800: number;
};

export const ALPHA_IDS = [
  "obi_pressure",
  "trade_flow_imb",
  "microprice_dev",
  "vwap_spread",
  "depth_slope",
  "cancel_ratio",
] as const;

export type AlphaId = (typeof ALPHA_IDS)[number];

// ── In-memory cache so the dataset is generated/loaded only once ──────────────
let cache: { is: Row[]; oos: Row[] } | null = null;

export function getDataset(split: "is" | "oos"): Row[] {
  if (!cache) {
    cache = {
      is:  generateSyntheticDataset(42, 3000),
      oos: generateSyntheticDataset(137, 1000),
    };
  }
  return cache[split];
}

export function clearCache(): void {
  cache = null;
}

// ── Synthetic data generator (replace this with your real loader) ─────────────
function gaussianRandom(mean = 0, std = 1): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function generateSyntheticDataset(seed: number, nRows: number): Row[] {
  const rng = (s: number): number => {
    const x = Math.sin(s * 9301 + 49297) * 233280;
    return x - Math.floor(x);
  };

  return Array.from({ length: nRows }, (_, i) => {
    const s = seed + i;
    const alphaVals: Record<string, number> = {};

    ALPHA_IDS.forEach((id, ai) => {
      alphaVals[id] = gaussianRandom(0, 1) * (rng(s * (ai + 1)) > 0.5 ? 1 : -1);
    });

    const signal =
      0.25 * alphaVals["obi_pressure"]! +
      0.15 * alphaVals["trade_flow_imb"]! +
      0.10 * alphaVals["microprice_dev"]! -
      0.08 * alphaVals["vwap_spread"]! +
      0.05 * alphaVals["depth_slope"]! -
      0.04 * alphaVals["cancel_ratio"]!;

    return {
      ...alphaVals,
      r60:   signal * 0.8  + gaussianRandom(0, 2.5),
      r300:  signal * 1.2  + gaussianRandom(0, 3.5),
      r1800: signal * 1.8  + gaussianRandom(0, 5.0),
    };
  });
}
