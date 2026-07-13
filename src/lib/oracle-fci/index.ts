// src/lib/oracle-fci/index.ts
// Orchestrator: fetch → normalize → snapshot → rank → predict → search

import { fetchAllCategories } from './fetch';
import { normalizeAndDeduplicate } from './normalize';
import {
  buildSnapshot,
  saveSnapshot,
  loadRecentSnapshots,
  buildVcpSeries,
  StorageAdapter,
  KVStorageAdapter,
  MemoryStorageAdapter,
} from './storage';
import { rankFunds } from './rank';
import { FciSearcher } from './search';
import {
  CATEGORY_ENDPOINTS,
  CATEGORY_LABELS,
  FundCategory,
  FundMetrics,
  NormalizedFund,
  OracleFciResponse,
} from './types';

export { MemoryStorageAdapter, KVStorageAdapter } from './storage';
export type { StorageAdapter } from './storage';
export type { OracleFciResponse, FundMetrics, FundPrediction, FundCategory, NormalizedFund, FciSnapshot } from './types';
export { CATEGORY_LABELS, CATEGORY_ENDPOINTS } from './types';

/** Resolve storage adapter: KV in prod (if bound), memory in dev */
export function resolveStorage(kv?: unknown): StorageAdapter {
  if (kv && typeof kv === 'object' && 'get' in kv && 'put' in kv) {
    return new KVStorageAdapter(kv as KVNamespace);
  }
  return new MemoryStorageAdapter();
}

export interface RunOracleOptions {
  storage?: StorageAdapter;
  topN?: number;            // top funds per category in output (default 25)
  searchQuery?: string;     // optional search filter
}

/** Run the full Oracle pipeline. Returns structured response. */
export async function runOracleFci(options: RunOracleOptions = {}): Promise<OracleFciResponse> {
  const { storage, topN = 25, searchQuery } = options;

  const errors: string[] = [];
  const evidence: string[] = Object.values(CATEGORY_ENDPOINTS);
  const fallbackChainUsed: string[] = [];

  // Step 1: fetch all categories in parallel
  const fetched = await fetchAllCategories();
  fallbackChainUsed.push(...fetched.fallbackChainUsed);
  for (const [cat, err] of Object.entries(fetched.errors)) {
    errors.push(`fetch_${cat}: ${err}`);
  }

  // Step 2: normalize + dedup per category
  const allFunds: NormalizedFund[] = [];
  const categoriesFetched: FundCategory[] = [];
  for (const cat of Object.keys(fetched.data) as FundCategory[]) {
    const raw = fetched.data[cat];
    if (!raw) continue;
    categoriesFetched.push(cat);
    const normalized = normalizeAndDeduplicate(raw, cat, CATEGORY_LABELS[cat]);
    allFunds.push(...normalized);
  }

  if (allFunds.length === 0) {
    // All sources failed — try cached snapshot fallback
    fallbackChainUsed.push('cached_snapshot');
    if (storage) {
      const snapshots = await loadRecentSnapshots(storage, 1);
      if (snapshots.length > 0) {
        const lastSnap = snapshots[snapshots.length - 1];
        // Reconstruct NormalizedFund[] from snapshot
        const restoredFunds: NormalizedFund[] = lastSnap.funds.map((f) => ({
          name: f.name,
          category: f.category,
          categoryLabel: CATEGORY_LABELS[f.category],
          horizonte: '',
          date: f.date,
          vcp: f.vcp,
          ccp: f.ccp,
          patrimonio: f.patrimonio,
          currency: 'ARS', // conservative default
          manager: 'Otros / No identificado',
        }));
        return buildResponse({
          funds: restoredFunds,
          storage,
          vcpSeries: new Map(),
          topN,
          searchQuery,
          source: `CACHED_SNAPSHOT — ${lastSnap.date} (live fetch failed)`,
          sourceStatus: 'DEGRADED',
          categoriesFetched: [],
          fallbackChainUsed,
          errors,
          evidence,
          historyDays: 1,
        });
      }
    }
    // No cache either — return error
    return {
      generated_at: new Date().toISOString(),
      snapshot_date: new Date().toISOString().slice(0, 10),
      source: 'NO_DATA_AVAILABLE',
      source_status: 'ERROR',
      total_funds: 0,
      funds_in_output: 0,
      rankings: {
        top10_by_oracle_score: [],
        top10_by_patrimonio: [],
        top10_predicted_30d: [],
        top10_most_stable: [],
      },
      by_category: {} as Record<FundCategory, FundMetrics[]>,
      metadata: {
        categories_fetched: [],
        history_days_available: 0,
        prediction_engine_active: false,
        guards: {
          never_invent_data: true,
          source_required: true,
          confidence_threshold: 0.65,
        },
        fallback_chain_used: fallbackChainUsed,
      },
      errors,
      evidence,
    };
  }

  // Step 3: persist today's snapshot (idempotent)
  if (storage) {
    const snapshot = buildSnapshot(allFunds, 'ARGENTINADATOS_API');
    try {
      await saveSnapshot(storage, snapshot);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`snapshot_save: ${msg}`);
    }
  }

  // Step 4: build VCP series from history
  let historyDays = 0;
  if (storage) {
    try {
      const snapshots = await loadRecentSnapshots(storage, 35);
      historyDays = snapshots.length;
      const vcpSeries = buildVcpSeries(snapshots);

      return buildResponse({
        funds: allFunds,
        storage,
        vcpSeries,
        topN,
        searchQuery,
        source: 'ARGENTINADATOS_API',
        sourceStatus: 'SUCCESS',
        categoriesFetched,
        fallbackChainUsed,
        errors,
        evidence,
        historyDays,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`history_load: ${msg}`);
    }
  }

  // No storage — run without history (predictions disabled, momentum null)
  return buildResponse({
    funds: allFunds,
    storage: null,
    vcpSeries: new Map(),
    topN,
    searchQuery,
    source: 'ARGENTINADATOS_API',
    sourceStatus: 'SUCCESS',
    categoriesFetched,
    fallbackChainUsed,
    errors,
    evidence,
    historyDays,
  });
}

interface BuildResponseArgs {
  funds: NormalizedFund[];
  storage: StorageAdapter | null;
  vcpSeries?: Map<string, import('./storage').VcpSeries>;
  topN: number;
  searchQuery?: string;
  source: string;
  sourceStatus: OracleFciResponse['source_status'];
  categoriesFetched: FundCategory[];
  fallbackChainUsed: string[];
  errors: string[];
  evidence: string[];
  historyDays: number;
}

async function buildResponse(args: BuildResponseArgs): Promise<OracleFciResponse> {
  const {
    funds,
    storage,
    vcpSeries = new Map(),
    topN,
    searchQuery,
    source,
    sourceStatus,
    categoriesFetched,
    fallbackChainUsed,
    errors,
    evidence,
    historyDays,
  } = args;

  // Rank all funds (oracle_score computed)
  const rankedAll = rankFunds(funds, vcpSeries);

  // Optional search filter
  let filtered = rankedAll;
  if (searchQuery && searchQuery.trim().length >= 2) {
    const searcher = new FciSearcher(rankedAll);
    const results = searcher.search(searchQuery, 100);
    filtered = results.map((r) => r.fund);
  }

  // Build per-category lists (top N per category)
  const byCategory = {} as Record<FundCategory, FundMetrics[]>;
  for (const cat of Object.keys(CATEGORY_LABELS) as FundCategory[]) {
    byCategory[cat] = filtered
      .filter((f) => f.category === cat)
      .slice(0, topN);
  }

  // Top 10 lists
  const top10ByScore = [...filtered].sort((a, b) => b.oracle_score - a.oracle_score).slice(0, 10);
  const top10ByPatrimonio = [...filtered].sort((a, b) => b.patrimonio - a.patrimonio).slice(0, 10);
  const top10Predicted30d = filtered
    .filter((f) => f.prediction && f.prediction.expected_return_30d !== null)
    .sort((a, b) => (b.prediction?.expected_return_30d ?? -Infinity) - (a.prediction?.expected_return_30d ?? -Infinity))
    .slice(0, 10);
  const top10MostStable = [...filtered]
    .filter((f) => f.stability !== null)
    .sort((a, b) => (b.stability ?? 0) - (a.stability ?? 0))
    .slice(0, 10);

  // Snapshot date = most common date in funds
  const dateCounts = new Map<string, number>();
  for (const f of funds) dateCounts.set(f.date, (dateCounts.get(f.date) ?? 0) + 1);
  let snapshotDate = new Date().toISOString().slice(0, 10);
  let maxCount = 0;
  for (const [d, c] of dateCounts) {
    if (c > maxCount) {
      maxCount = c;
      snapshotDate = d;
    }
  }

  return {
    generated_at: new Date().toISOString(),
    snapshot_date: snapshotDate,
    source,
    source_status: sourceStatus,
    total_funds: funds.length,
    funds_in_output: filtered.length,
    rankings: {
      top10_by_oracle_score: top10ByScore,
      top10_by_patrimonio: top10ByPatrimonio,
      top10_predicted_30d: top10Predicted30d,
      top10_most_stable: top10MostStable,
    },
    by_category: byCategory,
    metadata: {
      categories_fetched: categoriesFetched,
      history_days_available: historyDays,
      prediction_engine_active: historyDays >= 9,
      guards: {
        never_invent_data: true,
        source_required: true,
        confidence_threshold: 0.65,
      },
      fallback_chain_used: fallbackChainUsed,
    },
    errors,
    evidence,
  };
}
