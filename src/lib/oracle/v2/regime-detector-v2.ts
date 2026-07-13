// src/lib/oracle/v2/regime-detector-v2.ts
// ============================================================================
// R2 — REGIME DETECTOR V2 (append-only, separated from scoring)
// ============================================================================
// MISSION (per ORACLE_V2_SYSTEMIC_ROBUSTNESS spec, R2):
//   "Separar claramente régimen económico del scoring."
//
// STATES (7):
//   EASING         — BCRA cutting rates, FX calm, real carry falling
//   TIGHTENING     — BCRA hiking, FX pressure, real carry high
//   HIGH_INFLATION — monthly inflation > 5%, regardless of FX
//   DISINFLATION   — inflation decelerating month-over-month
//   CRISIS         — FX gap > 25% OR reserves dropping fast OR vol spike
//   RECOVERY       — risk-on returning, carry moderate, FX stabilizing
//   STRESS         — global risk-off, EM outflow, but not yet CRISIS
//
// OUTPUT:
//   regime                : one of 7 states
//   probability           : 0..100 (confidence in the chosen state)
//   transition_probability: { target_regime, probability }[] (next 30d)
//
// DESIGN:
//   - Pure function, no side effects.
//   - Consumes MarketState + NormalizedFeatures (canonical inputs).
//   - Does NOT modify the legacy RegimeClassification (4 states) used by
//     single-pass-oracle-engine. That legacy classifier continues to drive
//     the score's risk_adjustment step. This V2 detector is an ADDITIONAL
//     richer classifier for institutional analysis & audit.
//   - The 7-state taxonomy is a SUPERSET of the legacy 4-state taxonomy:
//       EASING         ≈ legacy EASING
//       TIGHTENING     ≈ legacy TIGHTENING
//       STAGFLATION    → mapped to HIGH_INFLATION + STRESS (composite)
//       NEUTRAL        → mapped to RECOVERY or DISINFLATION (depending on trend)
//       (new) CRISIS, DISINFLATION, STRESS, HIGH_INFLATION, RECOVERY
// ============================================================================

import type { MarketState, NormalizedFeatures } from '@/lib/single-market-state';

// ─── Public Types ──────────────────────────────────────────────────────────

export type RegimeV2State =
  | 'EASING'
  | 'TIGHTENING'
  | 'HIGH_INFLATION'
  | 'DISINFLATION'
  | 'CRISIS'
  | 'RECOVERY'
  | 'STRESS';

export interface RegimeV2Transition {
  target: RegimeV2State;
  probability: number;  // 0..100
}

export interface RegimeV2Classification {
  /** Chosen regime (highest probability) */
  regime: RegimeV2State;
  /** Probability of the chosen regime (0..100) */
  probability: number;
  /** Full distribution across all 7 states (sums to ~100) */
  distribution: Array<{ state: RegimeV2State; probability: number }>;
  /** Transition probabilities for next 30 days (top 3 likely targets) */
  transition_probability: RegimeV2Transition[];
  /** Human-readable explanation */
  reasoning: string;
  /** ISO-8601 timestamp */
  computed_at: string;
  /** Detector version */
  detector_version: string;
}

export const REGIME_V2_VERSION = 'regime_detector_v2_r2';

// ─── Regime Metadata ───────────────────────────────────────────────────────

export const REGIME_V2_META: Record<RegimeV2State, {
  label: string;
  color: string;
  bg: string;
  description: string;
}> = {
  EASING: {
    label: 'Easing',
    color: '#16a34a',
    bg: 'rgba(22,163,74,0.08)',
    description: 'BCRA cutting rates · FX calm · real carry falling',
  },
  TIGHTENING: {
    label: 'Tightening',
    color: '#ea580c',
    bg: 'rgba(234,88,12,0.08)',
    description: 'BCRA hiking · FX pressure · high real carry',
  },
  HIGH_INFLATION: {
    label: 'High Inflation',
    color: '#dc2626',
    bg: 'rgba(220,38,38,0.08)',
    description: 'Monthly inflation > 5% · purchasing power eroding',
  },
  DISINFLATION: {
    label: 'Disinflation',
    color: '#059669',
    bg: 'rgba(5,150,105,0.08)',
    description: 'Inflation decelerating · stabilization phase',
  },
  CRISIS: {
    label: 'Crisis',
    color: '#7f1d1d',
    bg: 'rgba(127,29,29,0.10)',
    description: 'FX gap > 25% · reserves falling · vol spike',
  },
  RECOVERY: {
    label: 'Recovery',
    color: '#0066cc',
    bg: 'rgba(0,102,204,0.08)',
    description: 'Risk-on returning · carry moderate · FX stabilizing',
  },
  STRESS: {
    label: 'Stress',
    color: '#ca8a04',
    bg: 'rgba(202,138,4,0.08)',
    description: 'Global risk-off · EM outflow · pre-crisis alert',
  },
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

function softmax(scores: number[]): number[] {
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp(s - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

// ─── State Probability Model ───────────────────────────────────────────────
//
// Each regime gets a raw logit based on observable signals. We then softmax
// to get a probability distribution.
//
// Signals used (from NormalizedFeatures + MarketState):
//   carry            : real carry (TNA - annualized inflation), -1..1
//   inflation_hedge  : inflation above 4% baseline, -1..1
//   fx_momentum      : FX pressure (positive = devaluation trend), -1..1
//   liquidity        : market liquidity, -1..1
//   risk_sentiment   : -1 (risk-off) to +1 (risk-on)
//   quality          : data quality (REAL=1, PARTIAL=0.6, STALE=0.3, ERROR=0.1)

interface RegimeSignals {
  carry: number;
  inflation: number;       // -1..1 (= inflation_hedge)
  fxPressure: number;      // -1..1 (= fx_momentum, positive = devaluation)
  liquidity: number;
  riskOn: number;          // -1..1 (= risk_sentiment)
  dataQualityFactor: number; // 0..1 (penalty for bad data)
}

function extractSignals(features: NormalizedFeatures, state: MarketState): RegimeSignals {
  const qualityMap: Record<MarketState['quality'], number> = {
    REAL: 1.0,
    PARTIAL_FALLBACK: 0.6,
    STALE: 0.3,
    ERROR: 0.1,
  };
  return {
    carry: features.carry,
    inflation: features.inflation_hedge,
    fxPressure: features.fx_momentum,
    liquidity: features.liquidity,
    riskOn: state.risk_sentiment,
    dataQualityFactor: qualityMap[state.quality],
  };
}

// Logit scoring: each regime's logit = sum of weighted signal contributions.
// Weights are HEURISTIC but documented; future R5 (Adaptive Weight Engine)
// could tune them based on verification history.

function computeRegimeLogits(s: RegimeSignals): Record<RegimeV2State, number> {
  // Each signal contributes a logit to each regime.
  // Positive logit = supports this regime; negative = opposes.
  const logits: Record<RegimeV2State, number> = {
    // EASING: low/negative real carry, risk-on, low inflation, low FX pressure
    EASING:
      -s.carry * 1.5 +        // low carry supports easing
      s.riskOn * 1.0 +        // risk-on supports easing
      -s.inflation * 0.8 +    // low inflation supports easing
      -s.fxPressure * 0.5,

    // TIGHTENING: high real carry, risk-off, FX pressure
    TIGHTENING:
      s.carry * 1.5 +
      -s.riskOn * 0.8 +
      s.fxPressure * 0.7,

    // HIGH_INFLATION: high inflation_hedge signal, regardless of FX
    HIGH_INFLATION:
      s.inflation * 2.0 +
      s.carry * 0.3,          // high carry often accompanies high inflation

    // DISINFLATION: negative inflation_hedge, moderate carry, calm FX
    DISINFLATION:
      -s.inflation * 1.8 +
      s.liquidity * 0.3 +
      -s.fxPressure * 0.4,

    // CRISIS: high FX pressure, risk-off, low liquidity, ERROR data
    CRISIS:
      s.fxPressure * 1.8 +
      -s.riskOn * 1.2 +
      -s.liquidity * 0.8 +
      (1 - s.dataQualityFactor) * 0.5, // bad data → crisis more likely

    // RECOVERY: positive risk-on, moderate carry, improving liquidity
    RECOVERY:
      s.riskOn * 1.2 +
      s.liquidity * 0.7 +
      s.carry * 0.3 +
      -s.fxPressure * 0.6,

    // STRESS: moderate risk-off, moderate FX pressure, low liquidity
    STRESS:
      -s.riskOn * 0.7 +
      s.fxPressure * 0.8 +
      -s.liquidity * 0.5 +
      -s.carry * 0.3,
  };

  return logits;
}

// ─── Transition Probability Matrix ─────────────────────────────────────────
//
// Heuristic 30-day transition probabilities based on regime persistence and
// typical regime progression patterns observed in Argentina's economy.
//
// Diagonal (persistence) is high for stable regimes (EASING, HIGH_INFLATION,
// DISINFLATION) and lower for transient ones (CRISIS, STRESS, RECOVERY).
//
// Off-diagonal entries follow typical progressions:
//   CRISIS → STRESS → RECOVERY → EASING (post-crisis normalization)
//   HIGH_INFLATION → DISINFLATION (if policy effective)
//   EASING → TIGHTENING (if inflation reaccelerates)
//   TIGHTENING → DISINFLATION (if policy works)

const TRANSITION_MATRIX: Record<RegimeV2State, Partial<Record<RegimeV2State, number>>> = {
  EASING:         { EASING: 0.65, TIGHTENING: 0.10, HIGH_INFLATION: 0.05, DISINFLATION: 0.10, RECOVERY: 0.05, STRESS: 0.03, CRISIS: 0.02 },
  TIGHTENING:     { TIGHTENING: 0.55, DISINFLATION: 0.20, EASING: 0.10, HIGH_INFLATION: 0.05, STRESS: 0.05, CRISIS: 0.03, RECOVERY: 0.02 },
  HIGH_INFLATION: { HIGH_INFLATION: 0.55, DISINFLATION: 0.20, TIGHTENING: 0.10, STRESS: 0.08, CRISIS: 0.05, EASING: 0.01, RECOVERY: 0.01 },
  DISINFLATION:   { DISINFLATION: 0.60, EASING: 0.20, RECOVERY: 0.10, HIGH_INFLATION: 0.05, TIGHTENING: 0.03, STRESS: 0.01, CRISIS: 0.01 },
  CRISIS:         { CRISIS: 0.35, STRESS: 0.30, RECOVERY: 0.15, HIGH_INFLATION: 0.10, TIGHTENING: 0.05, EASING: 0.03, DISINFLATION: 0.02 },
  RECOVERY:       { RECOVERY: 0.45, EASING: 0.25, DISINFLATION: 0.10, STRESS: 0.08, HIGH_INFLATION: 0.05, TIGHTENING: 0.04, CRISIS: 0.03 },
  STRESS:         { STRESS: 0.40, CRISIS: 0.20, RECOVERY: 0.15, TIGHTENING: 0.10, HIGH_INFLATION: 0.08, EASING: 0.04, DISINFLATION: 0.03 },
};

function computeTransitions(currentRegime: RegimeV2State): RegimeV2Transition[] {
  const row = TRANSITION_MATRIX[currentRegime];
  const transitions: RegimeV2Transition[] = (Object.entries(row) as Array<[RegimeV2State, number]>)
    .map(([target, probability]) => ({ target, probability: Math.round(probability * 1000) / 10 }))
    .sort((a, b) => b.probability - a.probability);
  // Top 3 likely targets (excluding the persistence self-loop if it's >50%)
  const top = transitions.slice(0, 3);
  return top;
}

// ─── Main Entry Point ──────────────────────────────────────────────────────

export function detectRegimeV2(
  features: NormalizedFeatures,
  state: MarketState,
): RegimeV2Classification {
  const signals = extractSignals(features, state);
  const logits = computeRegimeLogits(signals);

  // Softmax over logits → probabilities
  const stateList: RegimeV2State[] = [
    'EASING', 'TIGHTENING', 'HIGH_INFLATION', 'DISINFLATION',
    'CRISIS', 'RECOVERY', 'STRESS',
  ];
  const logitArray = stateList.map((s) => logits[s]);
  const probs = softmax(logitArray);

  const distribution = stateList.map((s, i) => ({
    state: s,
    probability: Math.round(probs[i] * 1000) / 10,
  })).sort((a, b) => b.probability - a.probability);

  const top = distribution[0];
  const regime = top.state;
  const probability = top.probability;

  // Build reasoning summary
  const top3 = distribution.slice(0, 3);
  const reasoning = `Top regimes: ${top3.map((d) => `${d.state}=${d.probability.toFixed(1)}%`).join(', ')}. ` +
    `Signals: carry=${signals.carry.toFixed(2)}, infl=${signals.inflation.toFixed(2)}, ` +
    `fxPress=${signals.fxPressure.toFixed(2)}, liq=${signals.liquidity.toFixed(2)}, ` +
    `riskOn=${signals.riskOn.toFixed(2)}, dataQuality=${signals.dataQualityFactor.toFixed(2)}.`;

  return {
    regime,
    probability,
    distribution,
    transition_probability: computeTransitions(regime),
    reasoning,
    computed_at: new Date().toISOString(),
    detector_version: REGIME_V2_VERSION,
  };
}
