// src/lib/oracle-multi/types.ts
// ORACLE_MULTI_ASSET_V4 — Unified type definitions across all asset classes.
// Guards: never_invent_data, require_source_data, forbid_hallucinated_returns,
//         must_flag_predictions, must_flag_degraded_mode, must_preserve_last_valid_snapshot.

// ─── Asset Classes ──────────────────────────────────────────────────────────

export type AssetClass =
  | 'FCI'              // Fondos Comunes de Inversión (argentinadatos)
  | 'PLAZO_FIJO'       // Plazo Fijo bancario (argentinadatos tasas/plazoFijo)
  | 'ACCIONES'         // Acciones argentinas BYMA (Yahoo Finance *.BA)
  | 'BONOS'            // Bonos soberanos AR (Yahoo Finance *.BA)
  | 'CEDEARS'          // CEDEARs de acciones extranjeras (Yahoo Finance *.BA)
  | 'ETF_CEDEARS';     // ETFs con CEDEAR en AR (Yahoo Finance US underlying)

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  FCI: 'FCI — Fondos Comunes de Inversión',
  PLAZO_FIJO: 'Plazo Fijo — TNA bancaria',
  ACCIONES: 'Acciones — BYMA (pesos)',
  BONOS: 'Bonos — Soberanos AR',
  CEDEARS: 'CEDEARs — Acciones USA',
  ETF_CEDEARS: 'ETF CEDEARs — SPY/QQQ/.../ARKK',
};

export const ASSET_CLASS_ORDER: AssetClass[] = [
  'FCI',
  'PLAZO_FIJO',
  'ACCIONES',
  'BONOS',
  'CEDEARS',
  'ETF_CEDEARS',
];

// ─── Normalized Asset (universal shape) ──────────────────────────────────────

export interface NormalizedAsset {
  /** Stable unique ID — `${assetClass}:${ticker|fundName}` */
  id: string;
  asset_class: AssetClass;
  /** Human-friendly name */
  name: string;
  /** Ticker (stocks/bonds/cedears/etfs) or fund name (FCI) or bank name (PF) */
  ticker?: string;
  /** Sub-category inside the asset class — e.g. FCI: rentaFija | rentaVariable */
  sub_category?: string;
  /** Currency of the underlying quote */
  currency: 'ARS' | 'USD';
  /** ISO date YYYY-MM-DD of the snapshot */
  date: string;
  /** Last price (NAV for FCI, TNA fraction for PF, ARS price for stocks/bonds, USD price for ETFs) */
  price: number;
  /** Volume (shares traded) — null for FCI/PF */
  volume: number | null;
  /** Market cap / AUM / patrimonio in ARS (null when not applicable) */
  market_cap_ars: number | null;
  /** Manager / issuer / bank — when applicable */
  issuer?: string;
  /** Original source identifier */
  source: string;
}

// ─── Historical Snapshot stored in KV ────────────────────────────────────────

export interface AssetSnapshot {
  date: string; // YYYY-MM-DD
  fetched_at: string; // ISO8601
  source: string;
  asset_class: AssetClass;
  total_assets: number;
  assets: Array<{
    id: string;
    name: string;
    ticker?: string;
    sub_category?: string;
    currency: 'ARS' | 'USD';
    date: string;
    price: number;
    volume: number | null;
    market_cap_ars: number | null;
    issuer?: string;
  }>;
}

// ─── Price Series (used by predictor) ────────────────────────────────────────

export interface PricePoint {
  date: string; // YYYY-MM-DD
  price: number;
}

export type PriceSeries = {
  asset_id: string;
  series: PricePoint[];
};

// ─── Prediction (per asset, ensemble of 4 models) ────────────────────────────

export interface AssetPrediction {
  expected_return_7d: number | null;   // fractional (0.01 = +1%)
  expected_return_30d: number | null;
  expected_return_90d: number | null;
  confidence: number;                   // 0-1
  bull_probability: number;             // 0-1
  bear_probability: number;             // 0-1
  volatility_score: number;             // 0-1
  trend_strength: number;               // 0-1 (|r2| from linear regression)
  models_used: string[];
  /**
   * FASE_0.5_HARDEN_NULL_PRICE (2026-07-03):
   *   'insufficient' = tombstone returned by predictAsset when series is empty
   *   or all prices are null/NaN/non-positive. Confidence is 0 in that case.
   *   Undefined means 'sufficient' (preserves backward compatibility).
   */
  data_quality?: 'sufficient' | 'insufficient';
}

// ─── Ranked Asset (with V4 Oracle Score + prediction) ────────────────────────

export interface AssetMetrics {
  // Identity
  id: string;
  asset_class: AssetClass;
  name: string;
  ticker?: string;
  sub_category?: string;
  currency: 'ARS' | 'USD';
  issuer?: string;
  date: string;
  source: string;

  // Raw
  price: number;
  volume: number | null;
  market_cap_ars: number | null;

  // Computed metrics (all 0-1 normalized within asset class unless noted)
  momentum_7d: number | null;          // fractional
  momentum_30d: number | null;         // fractional
  volatility: number | null;           // 0-1
  volume_norm: number | null;          // 0-1 (log-scaled within class)
  liquidity: number | null;            // 0-1 (log-scaled market_cap_ars)
  trend_strength: number | null;       // 0-1 (|r2|)
  relative_performance: number | null; // 0-1 (vs asset-class mean)
  analyst_factor: number;              // 0-1 (neutral 0.5 when no analyst data)

  // Composite
  oracle_score: number;                // 0-100
  rank_in_class: number;
  rank_global: number;

  // Prediction (optional — only if confidence >= 0.65 AND history >= 9 days)
  prediction?: AssetPrediction;

  // Provenance
  confidence: number;                  // source confidence (FCI 0.95, Yahoo 0.85, PF 0.95)

  /**
   * FASE_0.5_HARDEN_NULL_PRICE (2026-07-03):
   *   'insufficient' = asset's price series was too corrupted (null/NaN/<=0 prices)
   *   to compute meaningful momentum/volatility/trend metrics. Asset is still
   *   ranked (using 0.5 neutral fallbacks per existing algorithm), but consumers
   *   can use this flag to filter or visually flag low-confidence entries.
   *   Undefined means 'sufficient' (preserves backward compatibility).
   */
  data_quality?: 'sufficient' | 'insufficient';
}

// ─── Oracle Engine Config (V4 weights) ───────────────────────────────────────

export const ORACLE_SCORE_WEIGHTS = {
  momentum: 0.25,
  volume: 0.15,
  liquidity: 0.15,
  volatility: 0.10,           // inverse: lower vol = higher score
  trend_strength: 0.15,
  relative_performance: 0.10,
  analyst_factor: 0.10,
} as const;

export const PREDICTION_WINDOWS = [7, 30, 90] as const;
export const MIN_HISTORY_DAYS = 9;
export const CONFIDENCE_THRESHOLD = 0.65;

// ─── API Response ────────────────────────────────────────────────────────────

export interface MultiOracleResponse {
  generated_at: string;
  snapshot_date: string;
  source: string;
  source_status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'DEGRADED' | 'ERROR';
  total_assets: number;
  assets_in_output: number;

  rankings: {
    top10_by_oracle_score: AssetMetrics[];
    top10_by_market_cap: AssetMetrics[];
    top10_predicted_30d: AssetMetrics[];
    top10_most_stable: AssetMetrics[];
    top_gainers_7d: AssetMetrics[];
    top_losers_7d: AssetMetrics[];
  };

  by_class: Record<AssetClass, AssetMetrics[]>;
  predictions_summary: {
    active: boolean;
    assets_with_predictions: number;
    avg_confidence: number | null;
    high_conviction_count: number; // confidence > 0.85
  };

  metadata: {
    classes_fetched: AssetClass[];
    classes_failed: AssetClass[];
    history_days_available: number;
    prediction_engine_active: boolean;
    guards: {
      never_invent_data: boolean;
      require_source_data: boolean;
      forbid_hallucinated_returns: boolean;
      must_flag_predictions: boolean;
      must_flag_degraded_mode: boolean;
      must_preserve_last_valid_snapshot: boolean;
    };
    fallback_chain_used: string[];
    score_weights: typeof ORACLE_SCORE_WEIGHTS;
  };

  errors: string[];
  evidence: string[];
}

// ─── Per-class Responses (for individual /api/oracle/* routes) ───────────────

export interface ClassOracleResponse {
  generated_at: string;
  snapshot_date: string;
  source: string;
  source_status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'DEGRADED' | 'ERROR';
  asset_class: AssetClass;
  total_assets: number;
  assets_in_output: number;
  rankings: {
    top10_by_oracle_score: AssetMetrics[];
    top10_by_market_cap: AssetMetrics[];
    top10_predicted_30d: AssetMetrics[];
    top10_most_stable: AssetMetrics[];
    top_gainers_7d: AssetMetrics[];
    top_losers_7d: AssetMetrics[];
  };
  assets: AssetMetrics[];
  metadata: {
    history_days_available: number;
    prediction_engine_active: boolean;
    guards: MultiOracleResponse['metadata']['guards'];
    fallback_chain_used: string[];
    score_weights: typeof ORACLE_SCORE_WEIGHTS;
  };
  errors: string[];
  evidence: string[];
}

// ─── Search Response ─────────────────────────────────────────────────────────

export interface SearchResponse {
  query: string;
  total_results: number;
  results: Array<{
    asset: AssetMetrics;
    score: number; // 0-1 fuzzy match score (1 = exact)
  }>;
  searched_at: string;
}

// ─── Predictions Response ────────────────────────────────────────────────────

export interface PredictionsResponse {
  generated_at: string;
  snapshot_date: string;
  total_predictions: number;
  high_conviction_count: number;
  predictions: Array<{
    asset_id: string;
    name: string;
    asset_class: AssetClass;
    ticker?: string;
    expected_return_30d: number | null;
    confidence: number;
    bull_probability: number;
    bear_probability: number;
    volatility_score: number;
    models_used: string[];
  }>;
  metadata: {
    guards: MultiOracleResponse['metadata']['guards'];
    confidence_threshold: number;
    min_history_days: number;
  };
}
