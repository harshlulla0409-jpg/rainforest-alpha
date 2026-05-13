import { Router, type IRouter } from "express";
import {
  GetBucketsBody,
  GetBucketsResponse,
  GetDataMetaResponse,
} from "@workspace/api-zod";
import { getDataset, ALPHA_IDS, type Row } from "../data/adapter";

const router: IRouter = Router();

// ── GET /api/data/meta ────────────────────────────────────────────────────────
router.get("/data/meta", (_req, res) => {
  const isRows  = getDataset("is").length;
  const oosRows = getDataset("oos").length;
  const data = GetDataMetaResponse.parse({ isRows, oosRows, alphas: [...ALPHA_IDS] });
  res.json(data);
});

// ── POST /api/buckets ─────────────────────────────────────────────────────────
router.post("/buckets", (req, res) => {
  const parsed = GetBucketsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { dataset, alphaId, thresholds, upstreamFilters } = parsed.data;

  let rows: Row[] = getDataset(dataset);
  const totalRows = rows.length;

  // Apply each upstream filter in order
  if (upstreamFilters && upstreamFilters.length > 0) {
    for (const filter of upstreamFilters) {
      const bucketed = splitIntoBuckets(rows, filter.alphaId, filter.thresholds);
      rows = filter.selectedBuckets.flatMap((bi) => bucketed[bi] ?? []);
    }
  }

  const filteredRows = rows.length;

  // Split by the current alpha/thresholds
  const bucketed = splitIntoBuckets(rows, alphaId, thresholds);

  const buckets = bucketed.map((bRows, i) => ({
    label: bucketLabel(thresholds, i),
    ...computeStats(bRows),
  }));

  const data = GetBucketsResponse.parse({ buckets, filteredRows, totalRows });
  res.json(data);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function splitIntoBuckets(rows: Row[], alphaId: string, thresholds: number[]): Row[][] {
  const buckets: Row[][] = Array.from({ length: thresholds.length + 1 }, () => []);
  for (const row of rows) {
    const val = (row[alphaId] ?? 0) * 10; // scale to bps-ish, matching frontend convention
    let bi = 0;
    for (; bi < thresholds.length; bi++) {
      if (val < thresholds[bi]!) break;
    }
    buckets[bi]!.push(row);
  }
  return buckets;
}

function computeStats(rows: Row[]): { n: number; r60: number; r300: number; r1800: number } {
  if (rows.length === 0) return { n: 0, r60: 0, r300: 0, r1800: 0 };
  const n = rows.length;
  const mean = (key: "r60" | "r300" | "r1800") =>
    rows.reduce((s, r) => s + (r[key] ?? 0), 0) / n;
  return { n, r60: mean("r60"), r300: mean("r300"), r1800: mean("r1800") };
}

function bucketLabel(thresholds: number[], i: number): string {
  if (i === 0) return `< ${thresholds[0]} bps`;
  if (i === thresholds.length) return `\u2265 ${thresholds[thresholds.length - 1]} bps`;
  return `${thresholds[i - 1]} \u2013 ${thresholds[i]} bps`;
}

export default router;
