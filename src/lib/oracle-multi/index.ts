// src/lib/oracle-multi/index.ts
// ORACLE_MULTI_ASSET_V4 orchestrator.
// Pipeline: fetch all sources → normalize → snapshot (KV) → rank per class → predict → publish
// Guards: never_invent_data, require_source_data, forbid_hallucinated_returns,
//         must_flag_predictions, must_flag_degraded_mode, must_preserve_last_valid_snapshot.

import {
  type AssetClass,
  type AssetMetrics,
  type AssetSnapshot,
  type ClassOracleResponse,
  type MultiOracleResponse,
  type NormalizedAsset,
  type PricePoint,
  ASSET_CLASS_LABELS,
  ASSET_CLASS_ORDER,
  ORACLE_SCORE_WEIGHTS,
  CONFIDENCE_THRESHOLD,
  MIN_HISTORY_DAYS,
} from './types';
import { fetchFciAssets, FCI_SOURCE_CONFIDENCE, FCI_EVIDENCE_URLS } from './sources/fci-source';
import { fetchPlazoFijoAssets, PLAZO_FIJO_SOURCE_CONFIDENCE, PLAZO_FIJO_EVIDENCE_URLS } from './sources/plazo-fijo';
import { fetchAccionesAssets, ACCIONES_SOURCE_CONFIDENCE, ACCIONES_EVIDENCE_URLS } from './sources/acciones';
import { fetchBonosAssets, BONOS_SOURCE_CONFIDENCE, BONOS_EVIDENCE_URLS } from './sources/bonds';
import { fetchCedearsAssets, CEDEARS_SOURCE_CONFIDENCE, CEDEARS_EVIDENCE_URLS } from './sources/cedears';
import { fetchEtfCedearsAssets, ETF_CEDEARS_SOURCE_CONFIDENCE, ETF_CEDEARS_EVIDENCE_URLS } from './sources/etf-cedears';
import { fetchMepRate } from './mep';
import {
  type MultiStorage,
  type StorageAdapter,
  resolveMultiStorage,
  buildSnapshot,
  saveSnapshot,
  loadRecentSnapshots,
  buildPriceSeries,
} from './storage';
import { rankAssets, assignGlobalRanks } from './rank';
import { MultiAssetSearcher } from './search';

export { MemoryStorageAdapter, KVStorageAdapter, resolveMultiStorage } from './storage';
export type { StorageAdapter, MultiStorage } from './storage';
export type {
  AssetClass,
  AssetMetrics,
  AssetPrediction,
  AssetSnapshot,
  ClassOracleResponse,
  MultiOracleResponse,
  NormalizedAsset,
  PricePoint,
  SearchResponse,
  PredictionsResponse,
} from './types';
export { ASSET_CLASS_LABELS, ASSET_CLASS_ORDER, ORACLE_SCORE_WEIGHTS } from './types';
export { MultiAssetSearcher } from './search';

// ─── Per-source config ─────────────────────────────────────────────────────

interface SourceConfig {
  confidence: number;
  evidence: string[];
  /** True if the source should persist snapshots to the assets KV (FCI has its own KV) */
  useAssetsKV: boolean;
}

const SOURCE_CONFIG: Record<AssetClass, SourceConfig> = {
  FCI: { confidence: FCI_SOURCE_CONFIDENCE, evidence: FCI_EVIDENCE_URLS, useAssetsKV: false },
  PLAZO_FIJO: { confidence: PLAZO_FIJO_SOURCE_CONFIDENCE, evidence: PLAZO_FIJO_EVIDENCE_URLS, useAssetsKV: true },
  ACCIONES: { confidence: ACCIONES_SOURCE_CONFIDENCE, evidence: ACCIONES_EVIDENCE_URLS, useAssetsKV: true },
  BONOS: { confidence: BONOS_SOURCE_CONFIDENCE, evidence: BONOS_EVIDENCE_URLS, useAssetsKV: true },
  CEDEARS: { confidence: CEDEARS_SOURCE_CONFIDENCE, evidence: CEDEARS_EVIDENCE_URLS, useAssetsKV: true },
  ETF_CEDEARS: { confidence: ETF_CEDEARS_SOURCE_CONFIDENCE, evidence: ETF_CEDEARS_EVIDENCE_URLS, useAssetsKV: true },
};

// ─── Options ───────────────────────────────────────────────────────────────

export interface RunMultiOracleOptions {
  storage?: MultiStorage;
  env?: {
    ORACLE_FCI_HISTORY?: KVNamespace;
    ORACLE_ASSETS_HISTORY?: KVNamespace;
    ORACLE_PREDICTIONS?: KVNamespace;
  };
  /** Asset classes to fetch — defaults to all 6 */
  classes?: AssetClass[];
  /** Optional search query — filters output */
  searchQuery?: string;
  /** Top N per class in output (default 25) */
  topN?: number;
}

// ─── Orchestrator ──────────────────────────────────────────────────────────

const DEFAULT_GUARDS = {
  never_invent_data: true,
  require_source_data: true,
  forbid_hallucinated_returns: true,
  must_flag_predictions: true,
  must_flag_degraded_mode: true,
  must_preserve_last_valid_snapshot: true,
} as const;

export async function runMultiOracle(options: RunMultiOracleOptions = {}): Promise<MultiOracleResponse> {
  const storage = options.storage ?? resolveMultiStorage(options.env);
  const classes = options.classes ?? ASSET_CLASS_ORDER;
  const topN = options.topN ?? 25;

  const errors: string[] = [];
  const fallbackChain: string[] = ['multi_oracle_start'];
  const evidence: string[] = [];
  for (const cls of classes) {
    evidence.push(...SOURCE_CONFIG[cls].evidence);
  }

  // Step 1: Fetch MEP rate (needed for USD-denominated assets)
  fallbackChain.push('fetch_mep');
  const mepResult = await fetchMepRate();
  if (!mepResult.ok) {
    errors.push(`mep_fetch: ${mepResult.error ?? 'unknown'}`);
    fallbackChain.push('mep_fallback_default_1500');
  }

  // Step 2: Fetch each asset class in parallel
  fallbackChain.push('fetch_all_classes_parallel');
  const fetchResults = await Promise.allSettled([
    classes.includes('FCI') ? fetchFciAssets() : Promise.resolve(null),
    classes.includes('PLAZO_FIJO') ? fetchPlazoFijoAssets() : Promise.resolve(null),
    classes.includes('ACCIONES') ? fetchAccionesAssets(mepResult.rate) : Promise.resolve(null),
    classes.includes('BONOS') ? fetchBonosAssets(mepResult.rate) : Promise.resolve(null),
    classes.includes('CEDEARS') ? fetchCedearsAssets(mepResult.rate) : Promise.resolve(null),
    classes.includes('ETF_CEDEARS') ? fetchEtfCedearsAssets(mepResult.rate) : Promise.resolve(null),
  ]);

  const classResults: Partial<Record<AssetClass, { assets: NormalizedAsset[]; errors: string[]; fallback: string[]; degraded: boolean }>> = {};
  const classesFetched: AssetClass[] = [];
  const classesFailed: AssetClass[] = [];

  const expectedOrder: AssetClass[] = ['FCI', 'PLAZO_FIJO', 'ACCIONES', 'BONOS', 'CEDEARS', 'ETF_CEDEARS'];

  for (let i = 0; i < expectedOrder.length; i++) {
    const cls = expectedOrder[i];
    if (!classes.includes(cls)) continue;
    const settled = fetchResults[i];
    if (settled.status !== 'fulfilled' || settled.value === null) {
      if (settled.status === 'rejected') {
        errors.push(`${cls}_fetch_rejected: ${String(settled.reason)}`);
      }
      classesFailed.push(cls);
      continue;
    }
    const val = settled.value;
    errors.push(...val.errors);
    fallbackChain.push(...val.fallback_chain);
    classResults[cls] = {
      assets: val.assets,
      errors: val.errors,
      fallback: val.fallback_chain,
      degraded: 'degraded' in val ? val.degraded : false,
    };
    if (val.assets.length > 0) {
      classesFetched.push(cls);
    } else {
      classesFailed.push(cls);
    }
  }

  // Step 3: Persist today's snapshot per class (idempotent)
  // Guard: must_preserve_last_valid_snapshot — only overwrite if today's data is non-empty
  fallbackChain.push('persist_snapshots');
  for (const cls of classesFetched) {
    const result = classResults[cls]!;
    if (result.assets.length === 0) continue;
    const snapshot = buildSnapshot(result.assets, cls, 'MULTI_ORACLE_V4');
    const targetKV: StorageAdapter = cls === 'FCI' ? storage.fci : storage.assets;
    try {
      await saveSnapshot(targetKV, snapshot);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`snapshot_save_${cls}: ${msg}`);
    }
  }

  // Step 4: Load historical snapshots per class to build price series
  const priceSeriesByClass = new Map<AssetClass, Map<string, PricePoint[]>>();
  let totalHistoryDays = 0;
  for (const cls of classesFetched) {
    const targetKV: StorageAdapter = cls === 'FCI' ? storage.fci : storage.assets;
    try {
      const snapshots = await loadRecentSnapshots(targetKV, cls, 90);
      totalHistoryDays = Math.max(totalHistoryDays, snapshots.length);
      const series = buildPriceSeries(snapshots);
      priceSeriesByClass.set(cls, series);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`history_load_${cls}: ${msg}`);
    }
  }

  // Step 5: Rank per class
  const rankedByClass: Record<AssetClass, AssetMetrics[]> = {} as Record<AssetClass, AssetMetrics[]>;
  for (const cls of ASSET_CLASS_ORDER) {
    rankedByClass[cls] = [];
  }
  for (const cls of classesFetched) {
    const result = classResults[cls]!;
    const series = priceSeriesByClass.get(cls) ?? new Map<string, PricePoint[]>();
    const ranked = rankAssets({
      assets: result.assets,
      priceSeries: series,
      sourceConfidence: SOURCE_CONFIG[cls].confidence,
    });
    rankedByClass[cls] = ranked.metrics;
  }

  // Step 6: Assign global ranks
  const allRanked: AssetMetrics[] = [];
  for (const cls of ASSET_CLASS_ORDER) {
    allRanked.push(...rankedByClass[cls]);
  }
  assignGlobalRanks(allRanked);

  // Step 7: Optional search filter
  let filtered = allRanked;
  let searchActive = false;
  if (options.searchQuery && options.searchQuery.trim().length >= 2) {
    const searcher = new MultiAssetSearcher(allRanked);
    const results = searcher.search(options.searchQuery, 200);
    filtered = results.map((r) => r.asset);
    searchActive = true;
    fallbackChain.push(`search_filter_applied`);
  }

  // Step 8: Build top-10 lists
  const top10ByScore = [...filtered].sort((a, b) => b.oracle_score - a.oracle_score).slice(0, 10);
  const top10ByMcap = [...filtered]
    .filter((a) => a.market_cap_ars != null && a.market_cap_ars > 0)
    .sort((a, b) => (b.market_cap_ars ?? 0) - (a.market_cap_ars ?? 0))
    .slice(0, 10);
  const top10Predicted30d = filtered
    .filter((a) => a.prediction && a.prediction.expected_return_30d !== null)
    .sort((a, b) => (b.prediction?.expected_return_30d ?? -Infinity) - (a.prediction?.expected_return_30d ?? -Infinity))
    .slice(0, 10);
  const top10MostStable = [...filtered]
    .filter((a) => a.volatility !== null)
    .sort((a, b) => (a.volatility ?? 1) - (b.volatility ?? 1)) // lowest vol = most stable
    .slice(0, 10);
  const topGainers7d = [...filtered]
    .filter((a) => a.momentum_7d !== null)
    .sort((a, b) => (b.momentum_7d ?? -Infinity) - (a.momentum_7d ?? -Infinity))
    .slice(0, 10);
  const topLosers7d = [...filtered]
    .filter((a) => a.momentum_7d !== null)
    .sort((a, b) => (a.momentum_7d ?? Infinity) - (b.momentum_7d ?? Infinity))
    .slice(0, 10);

  // Step 9: Predictions summary
  // FASE_0.6_2026_07_09: exclude tombstones (data_quality='insufficient') from
  // assetsWithPred. Tombstones have prediction != null but confidence=0 and
  // data_quality='insufficient' — they signal "data unavailable/corrupt" not a
  // real prediction. Without this exclusion, predictions_count was 459+ (all
  // tombstones from FCI entries with price:null), making the counter meaningless.
  const assetsWithPred = filtered.filter(
    (a) => a.prediction != null && a.prediction.data_quality !== 'insufficient',
  );
  const avgConf = assetsWithPred.length > 0
    ? assetsWithPred.reduce((s, a) => s + (a.prediction?.confidence ?? 0), 0) / assetsWithPred.length
    : null;
  const highConvictionCount = assetsWithPred.filter((a) => (a.prediction?.confidence ?? 0) > 0.85).length;

  // Step 10: Build per-class top N
  const byClassOutput: Record<AssetClass, AssetMetrics[]> = {} as Record<AssetClass, AssetMetrics[]>;
  for (const cls of ASSET_CLASS_ORDER) {
    byClassOutput[cls] = filtered
      .filter((a) => a.asset_class === cls)
      .slice(0, topN);
  }

  // Step 11: Determine source status
  const totalAssets = allRanked.length;
  const sourceStatus: MultiOracleResponse['source_status'] =
    totalAssets === 0 ? 'ERROR'
    : classesFailed.length >= classes.length / 2 ? 'DEGRADED'
    : classesFailed.length > 0 ? 'PARTIAL_SUCCESS'
    : 'SUCCESS';

  // Guard: must_flag_degraded_mode
  if (sourceStatus === 'DEGRADED') {
    fallbackChain.push('degraded_mode_active');
  }

  // Snapshot date = today
  const snapshotDate = new Date().toISOString().slice(0, 10);

  return {
    generated_at: new Date().toISOString(),
    snapshot_date: snapshotDate,
    source: 'MULTI_ORACLE_V4',
    source_status: sourceStatus,
    total_assets: totalAssets,
    assets_in_output: filtered.length,
    rankings: {
      top10_by_oracle_score: top10ByScore,
      top10_by_market_cap: top10ByMcap,
      top10_predicted_30d: top10Predicted30d,
      top10_most_stable: top10MostStable,
      top_gainers_7d: topGainers7d,
      top_losers_7d: topLosers7d,
    },
    by_class: byClassOutput,
    predictions_summary: {
      active: assetsWithPred.length > 0,
      assets_with_predictions: assetsWithPred.length,
      avg_confidence: avgConf,
      high_conviction_count: highConvictionCount,
    },
    metadata: {
      classes_fetched: classesFetched,
      classes_failed: classesFailed,
      history_days_available: totalHistoryDays,
      prediction_engine_active: totalHistoryDays >= MIN_HISTORY_DAYS,
      guards: { ...DEFAULT_GUARDS },
      fallback_chain_used: fallbackChain,
      score_weights: ORACLE_SCORE_WEIGHTS,
    },
    errors,
    evidence,
  };
}

// ─── Per-class orchestrator (for /api/oracle/{stocks|bonds|cedears|...}) ────

export async function runClassOracle(
  cls: AssetClass,
  options: { storage?: MultiStorage; env?: RunMultiOracleOptions['env']; searchQuery?: string; topN?: number } = {},
): Promise<ClassOracleResponse> {
  const full = await runMultiOracle({
    ...options,
    classes: [cls],
  });

  const allAssets = full.by_class[cls] ?? [];
  const filtered = options.searchQuery && options.searchQuery.trim().length >= 2
    ? (() => {
        const searcher = new MultiAssetSearcher(allAssets);
        return searcher.search(options.searchQuery!, 100).map((r) => r.asset);
      })()
    : allAssets;

  return {
    generated_at: full.generated_at,
    snapshot_date: full.snapshot_date,
    source: full.source,
    source_status: full.source_status,
    asset_class: cls,
    total_assets: full.total_assets,
    assets_in_output: filtered.length,
    rankings: {
      top10_by_oracle_score: filtered.slice(0, 10),
      top10_by_market_cap: [...filtered]
        .filter((a) => a.market_cap_ars != null)
        .sort((a, b) => (b.market_cap_ars ?? 0) - (a.market_cap_ars ?? 0))
        .slice(0, 10),
      top10_predicted_30d: filtered
        .filter((a) => a.prediction && a.prediction.expected_return_30d !== null)
        .sort((a, b) => (b.prediction?.expected_return_30d ?? -Infinity) - (a.prediction?.expected_return_30d ?? -Infinity))
        .slice(0, 10),
      top10_most_stable: [...filtered]
        .filter((a) => a.volatility !== null)
        .sort((a, b) => (a.volatility ?? 1) - (b.volatility ?? 1))
        .slice(0, 10),
      top_gainers_7d: [...filtered]
        .filter((a) => a.momentum_7d !== null)
        .sort((a, b) => (b.momentum_7d ?? -Infinity) - (a.momentum_7d ?? -Infinity))
        .slice(0, 10),
      top_losers_7d: [...filtered]
        .filter((a) => a.momentum_7d !== null)
        .sort((a, b) => (a.momentum_7d ?? Infinity) - (b.momentum_7d ?? Infinity))
        .slice(0, 10),
    },
    assets: filtered,
    metadata: {
      history_days_available: full.metadata.history_days_available,
      prediction_engine_active: full.metadata.prediction_engine_active,
      guards: full.metadata.guards,
      fallback_chain_used: full.metadata.fallback_chain_used,
      score_weights: full.metadata.score_weights,
    },
    errors: full.errors,
    evidence: full.evidence,
  };
}
