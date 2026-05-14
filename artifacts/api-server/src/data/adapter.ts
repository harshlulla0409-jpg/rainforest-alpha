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
  side: number;
  [alphaId: string]: number;
  r60: number;
  r300: number;
  r1800: number;
};

export const ALPHA_IDS = [
  "lead_score_slow",
  "basis_z_fast",
  "basis_z_slow",
  "basis_deviation",
  "cross_asset_ofi_fast",
  "cross_asset_ofi_slow",
  "imbalance_divergence",
  "return_divergence",
  "vol_spillover",
  "resistance_ratio",
  "book_pressure_cash",
  "rel_book_pressure",
  "rel_cancel_bid",
  "rel_cancel_ask",
  "rel_imbalance_velocity",
  "rel_smart_ofi",
  "rel_liquidity_skew",
  "rel_book_divergence",
  "rel_bid_depletion",
  "rel_weighted_imbalance",
  "toxicity_vpin_slow",
  "toxicity_vpin_fast",
  "spoof_flicker_fut",
  "spoof_flicker_cash",
  "limit_replenish_fut",
  "trade_accel_fut",
  "limit_imbalance_fast_fut",
  "limit_imbalance_slow_fut",
  "limit_imbalance_fast_cash",
  "limit_imbalance_slow_cash",
  "sector_momentum_slow",
  "sector_momentum_fast",
  "vol_participation_fast",
  "vol_participation_slow",
  "sector_dispersion",
  "macro_fracture_slow",
  "macro_fracture_fast",
  "relative_strength_slow",
  "relative_strength_fast",
  "trend_acceleration",
  "stock_momentum_fast",
  "vwap_deviation_z",
  "unified_lead_score",
  "taker_imbalance_fut",
  "taker_imbalance_cash",
  "l1_imbalance_fut",
  "l1_imbalance_cash"
] as const;

export const FILTER_IDS = [
  "filter_mddv_cash",
  "filter_mddv_fut",
  "filter_spread_bps_cash",
  "filter_volatility_cash",
  "filter_lot_size_fut"
] as const;

export type AlphaId = (typeof ALPHA_IDS)[number];
export type FilterId = (typeof FILTER_IDS)[number];

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

// ── Dynamic helper to apply custom regression signal ──────────────────────────
// Call this from your /api/regression route after computing coefficients
// to ensure the bucketing endpoint splits perfectly on the OLS weights!
export function applyRegressionWeights(name: string, coefficients: Record<string, number>): void {
  if (!cache) return;
  for (const split of ["is", "oos"] as const) {
    for (const row of cache[split]) {
      let val = 0;
      for (const [feat, weight] of Object.entries(coefficients)) {
        val += (row[feat] || 0) * weight;
      }
      row[name] = val;
    }
  }
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
    
    FILTER_IDS.forEach((id, ai) => {
      alphaVals[id] = Math.abs(gaussianRandom(10, 5) * (rng(s * (ai + 50)) > 0.5 ? 1 : -1));
    });

    const signal =
      0.25 * alphaVals["lead_score_slow"]! +
      0.15 * alphaVals["basis_z_fast"]! +
      0.10 * alphaVals["imbalance_divergence"]! -
      0.08 * alphaVals["vwap_deviation_z"]! +
      0.05 * alphaVals["book_pressure_cash"]! -
      0.04 * alphaVals["unified_lead_score"]!;

    return {
      ...alphaVals,
      side: rng(s * 100) > 0.5 ? 1 : -1,
      custom_regression_signal: signal, // baseline fallback for testing
      r60:   signal * 0.8  + gaussianRandom(0, 2.5),
      r300:  signal * 1.2  + gaussianRandom(0, 3.5),
      r1800: signal * 1.8  + gaussianRandom(0, 5.0),
    };
  });
}
