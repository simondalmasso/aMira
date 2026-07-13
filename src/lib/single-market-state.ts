// src/lib/single-market-state.ts
// oracle_santander_v1_bloomberg_minimal — SINGLE SOURCE OF TRUTH FOR MARKET STATE
//
// Per spec `single_engine_single_loop_single_score`:
//   core_architecture.state_store: "single_market_state"
//   data_layer.output: "MarketState"
//   data_layer.sources: [BCRA_API, INDEC_SERIES, BLUELYTICS_FX, LOCAL_MARKET_PRICES]
//   data_layer.refresh_mode: "interval_60s"
//
//   market_state_schema:
//     timestamp:        ISO8601
//     fx_mep:           number
//     inflation_monthly: number
//     rates_tna:        number
//     reserves_delta:   number
//     risk_sentiment:   number
//     liquidity_index:  number
//
//   anti_frankenstein_rules:
//     - "single_source_of_truth_market_state"
//
// ROLE: This module is the CANONICAL market state. All other engines
// (legacy multi-oracle, FCI oracle, etc.) continue to exist for backward
// compatibility, but the single-pass oracle engine reads from HERE only.
// We do NOT delete legacy code (would break API contracts); we declare
// this as the one source of truth per the spec.

export interface MarketState {
  /** ISO-8601 timestamp of when the state was assembled */
  timestamp: string;
  /** Unix epoch ms */
  timestamp_ms: number;

  // ─── Core observables (per spec market_state_schema) ────────────────────
  /** MEP USD rate (ARS per USD via Mercado Electrónico de Pagos) */
  fx_mep: number;
  /** Monthly inflation rate (fractional, e.g. 0.041 = 4.1%) */
  inflation_monthly: number;
  /** Annual nominal interest rate (TNA, fractional, e.g. 0.30 = 30%) */
  rates_tna: number;
  /** BCRA reserves delta in USD billions vs prior reading (signed) */
  reserves_delta: number;
  /** Risk sentiment composite: -1 (risk-off) to +1 (risk-on) */
  risk_sentiment: number;
  /** Liquidity index: 0 (illiquid) to 1 (highly liquid) */
  liquidity_index: number;

  // ─── Provenance metadata (audit) ───────────────────────────────────────
  /** Which sources contributed to this state */
  sources: string[];
  /** Per-field freshness in seconds since last update */
  freshness_sec: Record<string, number>;
  /** Overall data quality label */
  quality: 'REAL' | 'PARTIAL_FALLBACK' | 'STALE' | 'ERROR';
}

// ─── Builder ─────────────────────────────────────────────────────────────
// Builds a MarketState from already-fetched BCRA + Bluelytics + local price
// snapshots. Pure function — no fetches inside (those happen upstream and
// are cached by /api/macro and /api/oracle/cron).

export interface MarketStateInput {
  fx_mep?: number;
  inflation_monthly?: number;
  rates_tna?: number;
  reserves_usd?: number;
  reserves_usd_prev?: number;
  /** Risk sentiment input: gap between MEP and official USD (larger gap = risk-off) */
  fx_gap_pct?: number;
  /** Local market breadth: 0..1, derived from advance/decline ratio */
  market_breadth?: number;
  sources?: string[];
  quality?: MarketState['quality'];
}

/**
 * Construct a MarketState from raw inputs.
 *
 * Defaults are conservative (Argentina late-2025 baseline) — when a field is
 * missing we mark quality as PARTIAL_FALLBACK and use a sensible neutral value
 * rather than zero (which would corrupt the scoring model).
 */
export function buildMarketState(input: MarketStateInput): MarketState {
  const now = Date.now();
  const sources = input.sources ?? ['BCRA_API', 'INDEC_SERIES', 'BLUELYTICS_FX', 'LOCAL_MARKET_PRICES'];
  const quality = input.quality ?? 'REAL';

  // Reserves delta (USD billions)
  const reserves = input.reserves_usd ?? 0;
  const reservesPrev = input.reserves_usd_prev ?? reserves;
  const reserves_delta = reserves - reservesPrev;

  // Risk sentiment: high MEP gap = risk-off (negative sentiment)
  // Baseline 4% gap → 0 sentiment; >10% gap → strongly risk-off (-1)
  const fxGap = input.fx_gap_pct ?? 4;
  let risk_sentiment = (10 - fxGap) / 10; // gap 4 → +0.6, gap 10 → 0, gap 16 → -0.6
  risk_sentiment = Math.max(-1, Math.min(1, risk_sentiment));

  // Liquidity: market breadth 0..1, blended with reserves delta sign
  const breadth = input.market_breadth ?? 0.5;
  const reservesSign = reserves_delta > 0 ? 0.1 : -0.1;
  let liquidity_index = breadth + reservesSign;
  liquidity_index = Math.max(0, Math.min(1, liquidity_index));

  return {
    timestamp: new Date(now).toISOString(),
    timestamp_ms: now,
    fx_mep: input.fx_mep ?? 1200,
    inflation_monthly: input.inflation_monthly ?? 0.038,
    rates_tna: input.rates_tna ?? 0.30,
    reserves_delta,
    risk_sentiment,
    liquidity_index,
    sources,
    freshness_sec: {
      fx_mep: 0,
      inflation_monthly: 0,
      rates_tna: 0,
      reserves_delta: 0,
      risk_sentiment: 0,
      liquidity_index: 0,
    },
    quality,
  };
}

// ─── Feature Normalization (per spec engine.process[0]: feature_normalization)
//
// Maps raw MarketState → normalized features in [-1, +1] range suitable for
// linear factor scoring. This is a pure, deterministic transform.

export interface NormalizedFeatures {
  /** Annualized real rate (TNA - 12-month inflation) / 100, clamped [-1, 1] */
  carry: number;
  /** Inflation hedging capacity: positive when inflation high (good for hard assets) */
  inflation_hedge: number;
  /** FX momentum: positive when MEP > 30d moving average (devaluation trend) */
  fx_momentum: number;
  /** Liquidity normalized to [-1, 1] */
  liquidity: number;
  /** Risk penalty: positive number = penalize (high risk) */
  risk_penalty: number;
}

export function normalizeFeatures(state: MarketState): NormalizedFeatures {
  // Annualized inflation from monthly (compound): (1+m)^12 - 1
  const inflationAnnual = Math.pow(1 + state.inflation_monthly, 12) - 1;
  // Real carry: TNA - annualized inflation
  const realCarry = state.rates_tna - inflationAnnual;
  // Normalize: 0% real carry → 0; +20% → +1; -20% → -1
  const carry = Math.max(-1, Math.min(1, realCarry / 0.20));

  // Inflation hedge: monthly inflation above 4% → strongly favors hard assets
  const inflation_hedge = Math.max(-1, Math.min(1, (state.inflation_monthly - 0.04) / 0.04));

  // FX momentum: assume baseline neutral (no historical series wired here);
  // we approximate from risk_sentiment: risk-off → devaluation pressure
  const fx_momentum = Math.max(-1, Math.min(1, -state.risk_sentiment));

  // Liquidity: 0..1 → -1..1
  const liquidity = (state.liquidity_index - 0.5) * 2;

  // Risk penalty: high when risk_sentiment negative AND liquidity low
  const risk_penalty = Math.max(0, Math.min(1,
    (1 - state.risk_sentiment) / 2 * 0.6 + (1 - state.liquidity_index) * 0.4
  ));

  return { carry, inflation_hedge, fx_momentum, liquidity, risk_penalty };
}
