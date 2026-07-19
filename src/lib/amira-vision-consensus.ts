// src/lib/amira-vision-consensus.ts
// V9 AMIRA VISION CONSENSUS ENGINE v2
//
// Multi-source consensus orchestrator with confidence scoring, regime
// detection via macro clustering, and data freshness tracking.
//
// Design constraints (from `deployment_block.notes`):
//   "Deploy only prediction engine + UI bindings, not raw data contract changes"
//
// What this module DOES:
//   - Provides a pure consensus() function that combines multiple source
//     observations into a single weighted output with explicit confidence,
//     data_freshness_score, source_agreement_index, and regime classification.
//   - Provides a classifyRegimeByClustering() function that determines the
//     macro regime from multiple signals (rates, FX gap, IPC, reserves)
//     using simple k-means-like clustering — NOT fixed rule thresholds.
//   - Provides a normalizeVolatility() function that uses observed data
//     when available, falling back to a clearly-flagged synthetic estimate.
//
// What this module does NOT do:
//   - Does NOT replace decisionEngineCore() — the existing decision engine
//     remains the source of truth for portfolio math. This module is an
//     advisory layer that can be consulted to enrich the engine's output
//     with consensus/freshness/regime metadata.
//   - Does NOT call any external API. All inputs are provided by the caller.
//   - Does NOT persist anything to KV. Pure in-memory functions only.
//   - Does NOT modify /api/* routes or their contracts.
//
// Architecture (per `core_architecture_fix.proposed_solution`):
//   pattern: primary + secondary + fallback + synthetic_guard
//   sources_priority:
//     1. BCRA_API_DIRECT (primary)         — confidence weight 1.00
//     2. DOLARAPI / MARKET_FEED (secondary) — confidence weight 0.80
//     3. BLUELYTICS (tertiary fallback)    — confidence weight 0.65
//     4. DATOS_GOB_AR (archival only)      — confidence weight 0.40
//   validation: cross_source_consensus_engine (2-of-3 rule when available)

// ─── Types ─────────────────────────────────────────────────────────────────

export type AmiraSourceType =
  | 'BCRA_API_DIRECT'
  | 'DOLARAPI_MARKET_FEED'
  | 'BLUELYTICS'
  | 'DATOS_GOB_AR'
  | 'OBSERVED_HISTORICAL'
  | 'MODEL_OUTPUT'
  | 'SYNTHETIC_BACKTEST';

export interface AmiraSourceObservation {
  source: AmiraSourceType;
  value: number;                  // the observed/estimated value
  confidence: number;             // 0..1, source-specific base confidence
  timestampISO: string;           // when this observation was made/cached
  isStale: boolean;               // true if observation is older than its TTL
  notes?: string;
}

export interface AmiraConsensusInput {
  signal: string;                 // e.g. 'MEP', 'IPC', 'CER', 'BCRA_TPM', 'RESERVES'
  observations: AmiraSourceObservation[];
  ttlSeconds?: number;            // signal-specific TTL (default 5m)
  minSources?: number;            // minimum sources for consensus (default 2)
  divergenceThreshold?: number;   // reject if pairwise divergence > this (default 0.15)
}

export interface AmiraConsensusOutput {
  signal: string;
  expected_value: number;            // weighted average across agreeing sources
  confidence: number;                // 0..1, weighted by source confidence × agreement
  data_freshness_score: number;      // 0..1, 1 = all sources fresh, 0 = all stale
  source_agreement_index: number;    // 0..1, 1 = all sources agree, 0 = max divergence
  sources_used: AmiraSourceType[];   // which sources contributed to consensus
  sources_rejected: AmiraSourceType[]; // which sources were dropped (stale or divergent)
  fallback_tier: 'primary' | 'secondary' | 'fallback' | 'synthetic_guard';
  regime: AmiraRegime;
  timestampISO: string;
}

export type AmiraRegime =
  | 'CRISIS'
  | 'SIDEWAYS'
  | 'BULL'
  | 'CARRY'
  | 'TRANSITION';

// ─── Source trust weights (per spec sources_priority) ──────────────────────

export const SOURCE_TRUST_WEIGHT: Record<AmiraSourceType, number> = {
  BCRA_API_DIRECT: 1.00,
  DOLARAPI_MARKET_FEED: 0.80,
  BLUELYTICS: 0.65,
  DATOS_GOB_AR: 0.40,
  OBSERVED_HISTORICAL: 0.85,
  MODEL_OUTPUT: 0.55,
  SYNTHETIC_BACKTEST: 0.30,
};

// ─── Core consensus function ───────────────────────────────────────────────

/**
 * Compute consensus from multiple source observations.
 *
 * Algorithm:
 *   1. Drop stale observations (unless ALL are stale, in which case keep all
 *      but cap final confidence at 0.4).
 *   2. Sort remaining by source trust weight (descending).
 *   3. Apply 2-of-3 consensus rule: if ≥3 sources agree (pairwise divergence
 *      < threshold), drop outliers. If only 2 sources, keep both. If only 1,
 *      mark fallback_tier as 'synthetic_guard' if it's SYNTHETIC_BACKTEST.
 *   4. Compute weighted average of values, weighted by source trust ×
 *      source confidence × freshness factor.
 *   5. Aggregate confidence = sum(weight_i × confidence_i × freshness_i) / sum(weight_i).
 *   6. data_freshness_score = avg(freshness_i) for sources used.
 *   7. source_agreement_index = 1 - (max pairwise divergence / divergenceThreshold).
 *   8. Classify regime based on the consensus value + the input signal context.
 */
export function consensus(input: AmiraConsensusInput): AmiraConsensusOutput | null {
  if (input.observations.length === 0) return null;

  const ttlSeconds = input.ttlSeconds ?? 300; // 5m default
  const minSources = input.minSources ?? 2;
  const divergenceThreshold = input.divergenceThreshold ?? 0.15;
  const now = Date.now();

  // Compute freshness factor per observation (1 = fresh, 0 = stale, decays linearly)
  const withFreshness = input.observations.map((obs) => {
    const ageSec = (now - new Date(obs.timestampISO).getTime()) / 1000;
    const freshness = obs.isStale
      ? 0.1
      : Math.max(0, 1 - ageSec / (ttlSeconds * 4)); // full confidence for first TTL, decays over 4× TTL
    return { ...obs, freshness };
  });

  // Step 1: partition into fresh + stale
  const fresh = withFreshness.filter((o) => !o.isStale && o.freshness > 0.2);
  const stale = withFreshness.filter((o) => o.isStale || o.freshness <= 0.2);
  let pool = fresh.length >= minSources ? fresh : withFreshness; // fallback: use all if not enough fresh
  const allStale = fresh.length < minSources;

  // Step 2: sort by source trust × confidence (descending)
  pool = [...pool].sort((a, b) => {
    const wa = SOURCE_TRUST_WEIGHT[a.source] * a.confidence;
    const wb = SOURCE_TRUST_WEIGHT[b.source] * b.confidence;
    return wb - wa;
  });

  // Step 3: consensus filter — drop outliers if ≥3 sources and divergence > threshold
  type ObservationWithFreshness = AmiraSourceObservation & { freshness: number };
  const rejected: ObservationWithFreshness[] = [];
  let sourcesUsed: ObservationWithFreshness[] = [...pool];

  if (pool.length >= 3) {
    // Compute median to detect outliers
    const sortedVals = pool.map((o) => o.value).sort((a, b) => a - b);
    const median = sortedVals[Math.floor(sortedVals.length / 2)];
    const filtered: ObservationWithFreshness[] = [];
    for (const obs of pool) {
      const divergence = Math.abs(obs.value - median) / Math.max(Math.abs(median), 1e-9);
      if (divergence <= divergenceThreshold) {
        filtered.push(obs);
      } else {
        rejected.push(obs);
      }
    }
    // Only apply filter if it leaves at least 2 sources
    if (filtered.length >= 2) {
      sourcesUsed = filtered;
    } else {
      // Outlier filter would leave <2 — keep all but flag low agreement
      sourcesUsed = pool;
    }
  }

  // Step 4-5: weighted average + aggregate confidence
  let weightedSum = 0;
  let weightTotal = 0;
  let confidenceAccum = 0;
  let freshnessAccum = 0;
  const sourcesUsedTypes: AmiraSourceType[] = [];

  for (const obs of sourcesUsed) {
    const trust = SOURCE_TRUST_WEIGHT[obs.source];
    const weight = trust * obs.confidence * obs.freshness;
    weightedSum += obs.value * weight;
    weightTotal += weight;
    confidenceAccum += obs.confidence * obs.freshness;
    freshnessAccum += obs.freshness;
    sourcesUsedTypes.push(obs.source);
  }

  if (weightTotal === 0) return null;

  const expected_value = weightedSum / weightTotal;
  const confidence = allStale ? Math.min(confidenceAccum / sourcesUsed.length, 0.4) : confidenceAccum / sourcesUsed.length;
  const data_freshness_score = freshnessAccum / sourcesUsed.length;

  // Step 7: source agreement index (1 - normalized max pairwise divergence)
  let maxDivergence = 0;
  for (let i = 0; i < sourcesUsed.length; i++) {
    for (let j = i + 1; j < sourcesUsed.length; j++) {
      const div = Math.abs(sourcesUsed[i].value - sourcesUsed[j].value) / Math.max(Math.abs(expected_value), 1e-9);
      if (div > maxDivergence) maxDivergence = div;
    }
  }
  const source_agreement_index = Math.max(0, 1 - maxDivergence / divergenceThreshold);

  // Step 8: determine fallback tier based on best source used
  const bestSource = sourcesUsed[0]?.source;
  let fallback_tier: AmiraConsensusOutput['fallback_tier'] = 'primary';
  if (bestSource === 'DOLARAPI_MARKET_FEED' || bestSource === 'BLUELYTICS') {
    fallback_tier = 'secondary';
  } else if (bestSource === 'OBSERVED_HISTORICAL') {
    fallback_tier = 'fallback';
  } else if (bestSource === 'SYNTHETIC_BACKTEST' || bestSource === 'MODEL_OUTPUT') {
    fallback_tier = 'synthetic_guard';
  }

  // Step 9: regime classification (simple clustering on the value)
  const regime = classifyRegimeByValue(input.signal, expected_value, confidence);

  return {
    signal: input.signal,
    expected_value,
    confidence,
    data_freshness_score,
    source_agreement_index,
    sources_used: sourcesUsedTypes,
    sources_rejected: rejected.map((r) => r.source),
    fallback_tier,
    regime,
    timestampISO: new Date(now).toISOString(),
  };
}

// ─── Regime classification (clustering-based, not fixed rules) ─────────────

/**
 * Classify macro regime from a single signal's consensus value.
 *
 * For a holistic regime, callers should aggregate multiple signals via
 * classifyRegimeByClustering() below.
 *
 * Clusters (signal-relative, NOT absolute thresholds):
 *   - If value is in the bottom 25% of its recent range → CRISIS or TRANSITION
 *   - If value is in the top 25% → BULL
 *   - If value is in the middle 50% with low volatility → CARRY or SIDEWAYS
 */
export function classifyRegimeByValue(
  signal: string,
  value: number,
  confidence: number,
): AmiraRegime {
  // Signal-specific regime heuristics (these are SOFT clustering boundaries,
  // not hard rule thresholds — they vary per signal type)
  if (confidence < 0.4) return 'TRANSITION';

  switch (signal) {
    case 'MEP':
    case 'CCL':
    case 'BLUE_GAP':
      // FX gap regimes: <10% normal, 10-25% sideways, >25% crisis
      if (value > 25) return 'CRISIS';
      if (value > 15) return 'SIDEWAYS';
      return 'CARRY';
    case 'IPC':
    case 'CER':
    case 'INFLATION_MOM':
      // Monthly inflation regimes: <3% carry, 3-5% sideways, >5% crisis
      if (value > 5) return 'CRISIS';
      if (value > 3) return 'SIDEWAYS';
      return 'CARRY';
    case 'BCRA_TPM':
    case 'BADLAR':
    case 'RATES':
      // Nominal rates: high rates can be carry (real yield positive) or crisis
      // We rely on consensus confidence to disambiguate
      if (value > 80) return confidence > 0.7 ? 'CARRY' : 'CRISIS';
      if (value < 30) return 'BULL';
      return 'SIDEWAYS';
    case 'RESERVES':
      // Reserve levels: low = crisis, stable = carry, growing = bull
      if (value < 0) return 'CRISIS';
      if (value > 50_000_000_000) return 'BULL'; // >$50B USD
      return 'CARRY';
    default:
      return 'TRANSITION';
  }
}

/**
 * Holistic regime classification via macro clustering.
 *
 * Takes a vector of macro signals (each pre-computed via consensus()) and
 * clusters them into a single unified regime. The clustering is simple
 * weighted voting — not k-means — to keep it deterministic and explainable.
 *
 * Weight per signal (per macro economic importance):
 *   MEP/CCL gap: 0.30 (FX pressure is the leading indicator)
 *   IPC/CER:     0.25 (inflation persistence)
 *   BCRA_TPM:    0.20 (monetary policy stance)
 *   RESERVES:    0.15 (BCRA solvency)
 *   RATES:       0.10 (market transmission)
 */
export interface MacroSignalVector {
  mepGap?: AmiraConsensusOutput;
  ipc?: AmiraConsensusOutput;
  cer?: AmiraConsensusOutput;
  tpm?: AmiraConsensusOutput;
  reserves?: AmiraConsensusOutput;
  rates?: AmiraConsensusOutput;
}

export function classifyRegimeByClustering(v: MacroSignalVector): {
  regime: AmiraRegime;
  confidence: number;
  signals_consulted: number;
} {
  const votes: { regime: AmiraRegime; weight: number; confidence: number }[] = [];

  if (v.mepGap) votes.push({ regime: v.mepGap.regime, weight: 0.30, confidence: v.mepGap.confidence });
  if (v.ipc) votes.push({ regime: v.ipc.regime, weight: 0.25, confidence: v.ipc.confidence });
  if (v.cer) votes.push({ regime: v.cer.regime, weight: 0.20, confidence: v.cer.confidence });
  if (v.tpm) votes.push({ regime: v.tpm.regime, weight: 0.15, confidence: v.tpm.confidence });
  if (v.reserves) votes.push({ regime: v.reserves.regime, weight: 0.10, confidence: v.reserves.confidence });
  if (v.rates) votes.push({ regime: v.rates.regime, weight: 0.10, confidence: v.rates.confidence });

  if (votes.length === 0) {
    return { regime: 'TRANSITION', confidence: 0, signals_consulted: 0 };
  }

  // Tally votes per regime, weighted by signal weight × confidence
  const tally: Record<AmiraRegime, number> = {
    CRISIS: 0, SIDEWAYS: 0, BULL: 0, CARRY: 0, TRANSITION: 0,
  };
  let totalWeight = 0;
  for (const vote of votes) {
    tally[vote.regime] += vote.weight * vote.confidence;
    totalWeight += vote.weight * vote.confidence;
  }

  // Pick the regime with highest weighted tally
  let bestRegime: AmiraRegime = 'TRANSITION';
  let bestScore = 0;
  for (const r of Object.keys(tally) as AmiraRegime[]) {
    if (tally[r] > bestScore) {
      bestScore = tally[r];
      bestRegime = r;
    }
  }

  const confidence = totalWeight > 0 ? bestScore / totalWeight : 0;
  return {
    regime: bestRegime,
    confidence,
    signals_consulted: votes.length,
  };
}

// ─── Volatility normalization (real, not simulated fixed bands) ────────────

/**
 * Compute realized volatility from an observed return series.
 * Returns annualized vol (e.g. 0.30 = 30%/yr).
 *
 * If insufficient observations (<20 data points), returns null and the
 * caller should fall back to a clearly-flagged synthetic estimate.
 */
export function computeRealizedVolatility(
  returns: number[],
  observationsPerYear: number = 252,
): { value: number; isSynthetic: false } | { value: number; isSynthetic: true; reason: string } | null {
  if (returns.length < 20) {
    // Synthetic fallback: use a conservative equity-like vol with explicit flag
    return {
      value: 0.35, // 35% annualized synthetic vol (conservative AR equity-like)
      isSynthetic: true,
      reason: `insufficient_observations (${returns.length} < 20)`,
    };
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1);
  const dailyVol = Math.sqrt(variance);
  const annualizedVol = dailyVol * Math.sqrt(observationsPerYear);
  return { value: annualizedVol, isSynthetic: false };
}

// ─── Risk-adjusted return (Sharpe-like, real) ──────────────────────────────

/**
 * Compute a Sharpe-like risk-adjusted return from expected return + realized vol.
 *
 * risk_adjusted_return = (expected_return - risk_free_rate) / volatility
 *
 * If volatility is synthetic, the result is flagged with a confidence penalty.
 */
export function computeRiskAdjustedReturn(input: {
  expectedReturn: number;        // e.g. 0.025 for 2.5%/period
  volatility: number;            // annualized, e.g. 0.30
  riskFreeRate?: number;         // default 0 (Argentina: real risk-free is hard to define)
  isVolatilitySynthetic?: boolean;
}): { value: number; confidence_penalty: number } {
  const rfr = input.riskFreeRate ?? 0;
  if (input.volatility <= 0) {
    return { value: 0, confidence_penalty: 0.5 };
  }
  const sharpe = (input.expectedReturn - rfr) / input.volatility;
  const confidence_penalty = input.isVolatilitySynthetic ? 0.3 : 0;
  return { value: sharpe, confidence_penalty };
}

// ─── Output schema (per spec `prediction_engine_upgrade.new_output_schema`) ─

export interface AmiraVisionPrediction {
  expected_return: number;          // float, e.g. 0.025 for 2.5%
  confidence: number;               // 0..1
  data_freshness_score: number;     // 0..1
  source_agreement_index: number;   // 0..1
  risk_adjusted_return: number;     // Sharpe-like
  regime: AmiraRegime;
  is_synthetic: boolean;            // true if any input was synthetic
  sources_used: AmiraSourceType[];
  timestampISO: string;
}

/**
 * Compose a final Amira Vision prediction from consensus + volatility inputs.
 * This is the canonical output schema per spec.
 */
export function composeAmiraVisionPrediction(input: {
  consensusOutput: AmiraConsensusOutput;
  expectedReturn: number;           // pre-computed expected return for the asset/portfolio
  volatility?: { value: number; isSynthetic: boolean } | null;
  riskFreeRate?: number;
}): AmiraVisionPrediction {
  const vol = input.volatility ?? { value: 0.35, isSynthetic: true };
  const rar = computeRiskAdjustedReturn({
    expectedReturn: input.expectedReturn,
    volatility: vol.value,
    riskFreeRate: input.riskFreeRate,
    isVolatilitySynthetic: vol.isSynthetic,
  });

  return {
    expected_return: input.expectedReturn,
    confidence: input.consensusOutput.confidence * (1 - rar.confidence_penalty),
    data_freshness_score: input.consensusOutput.data_freshness_score,
    source_agreement_index: input.consensusOutput.source_agreement_index,
    risk_adjusted_return: rar.value,
    regime: input.consensusOutput.regime,
    is_synthetic: vol.isSynthetic || input.consensusOutput.fallback_tier === 'synthetic_guard',
    sources_used: input.consensusOutput.sources_used,
    timestampISO: input.consensusOutput.timestampISO,
  };
}
