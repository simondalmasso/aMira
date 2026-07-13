// ============================================================================
// Ω-MYTHOS_X10_ENGINE — Consolidated Computation Engine for Cloudflare Worker
// Pure functions — no I/O, no side effects, deterministic
// Combines: Oracle + Signal Layer + Strategy Layer + Capital Buckets + X10
// ============================================================================

import {
  type MacroState,
  type DataLabel,
  type CapitalRegime,
  type MacroRegimeX10,
  type MacroRegime,
  type OracleState,
  type OracleSignal,
  type SignalOutput,
  type SignalStrength,
  type TrendDirection,
  type VolatilityRegime,
  type LiquidityCondition,
  type StrategicMode,
  type ScenarioBound,
  type X10EngineOutput,
} from './types';

// ============================================================================
// HELPERS
// ============================================================================

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }
function clamp(x: number, min: number, max: number): number { return Math.max(min, Math.min(max, x)); }
function round2(x: number): number { return Math.round(x * 100) / 100; }
function round4(x: number): number { return Math.round(x * 10000) / 10000; }
function isoNow(): string { return new Date().toISOString(); }

// ============================================================================
// ORACLE — Regime + devaluation probability + confidence
// ============================================================================

export function computeOracle(macro: MacroState): OracleState {
  // ─── 1. FX Momentum (0–100) ───
  const gap = macro.mep.gap;
  const fxMomentum = clamp01(gap / 60) * 100;

  // ─── 2. Inflation Acceleration (0–100) ───
  const inflBaseline = 2.0;
  const inflationAccel = clamp01((macro.inflation.expected30d - inflBaseline) / 8) * 100;

  // ─── 3. Reserve Pressure (0–100) ───
  const rateSpread = Math.abs(macro.rates.bcraPolicy - macro.rates.moneyMarket);
  const crawlingIntensity = clamp01(macro.crawlingPeg / 5) * 100;
  const reservePressure = clamp01((rateSpread * 5 + crawlingIntensity) / 150) * 100;

  // ─── 4. Rate Gap USD (0–100) ───
  const usdNeutralRate = 5.0;
  const rateGapRaw = macro.rates.moneyMarket - usdNeutralRate;
  const rateGapUSD = clamp01(rateGapRaw / 40) * 100;

  // ─── Devaluation Score ───
  const devalScore =
    (fxMomentum * 0.35) +
    (inflationAccel * 0.25) +
    (reservePressure * 0.20) +
    (rateGapUSD * 0.20);

  const devaluationProbability = clamp01(devalScore / 100) * 100;
  const devaluationRiskBand = devaluationProbability < 25 ? 'stable'
    : devaluationProbability < 50 ? 'caution'
    : devaluationProbability < 75 ? 'high'
    : 'crisis';

  // ─── Regime Determination ───
  const regime = determineRegime(macro, devaluationProbability);

  // ─── Confidence ───
  const signalAgreement = computeSignalAgreement(fxMomentum, inflationAccel, reservePressure, rateGapUSD);
  const realPct = macro.realDataPct;
  const dataQuality = macro.source === 'OBSERVADO' ? 95
    : macro.source === 'REAL' ? Math.min(90, 40 + realPct * 0.55)
    : macro.source === 'STALE' ? 25
    : macro.source === 'ERROR' ? 10
    : 40;
  const confidenceScore = Math.round(signalAgreement * 0.6 + dataQuality * 0.4);

  // ─── Signals ───
  const signals: OracleSignal[] = [
    { name: 'Tipo de cambio', value: round2(fxMomentum), weight: 0.35, contribution: round2(fxMomentum * 0.35), direction: fxMomentum > 50 ? 'bajista' : fxMomentum > 25 ? 'neutral' : 'alcista' },
    { name: 'Inflación', value: round2(inflationAccel), weight: 0.25, contribution: round2(inflationAccel * 0.25), direction: inflationAccel > 50 ? 'bajista' : inflationAccel > 25 ? 'neutral' : 'alcista' },
    { name: 'Reservas', value: round2(reservePressure), weight: 0.20, contribution: round2(reservePressure * 0.20), direction: reservePressure > 50 ? 'bajista' : reservePressure > 25 ? 'neutral' : 'alcista' },
    { name: 'Tasas', value: round2(rateGapUSD), weight: 0.20, contribution: round2(rateGapUSD * 0.20), direction: rateGapUSD > 70 ? 'bajista' : rateGapUSD > 40 ? 'neutral' : 'alcista' },
  ];

  return {
    regime,
    devaluationProbability: round2(devaluationProbability),
    devaluationRiskBand,
    confidenceScore,
    fxMomentum: round2(fxMomentum),
    inflationAcceleration: round2(inflationAccel),
    reservePressure: round2(reservePressure),
    rateGapUSD: round2(rateGapUSD),
    timestamp: isoNow(),
    source: macro.source,
    signals,
    dataQualityPct: Math.round(dataQuality),
  };
}

function determineRegime(macro: MacroState, devalProb: number): MacroRegime {
  // ─── CRISIS PRIORITY OVERRIDE ───
  // If volatility spike + FX gap, CRISIS probability floor +0.3
  const volSpike = macro.mep.gap > 30;  // Gap > 30% = volatility spike
  const fxGap = macro.mep.gap > 25;
  const crisisRecallBoost = (volSpike && fxGap) ? 0.3 : 0;  // Was 0.25, now 0.3 per PATCH 2
  const adjustedDevalProb = Math.min(100, devalProb + crisisRecallBoost * 100);

  // ─── HARD RULES ───
  if (macro.source === 'ERROR') return 'CRISIS';
  if (macro.source === 'PARTIAL_FALLBACK' && adjustedDevalProb > 50) return 'CRISIS';
  if (adjustedDevalProb > 75) return 'CRISIS';
  if (adjustedDevalProb > 50) return 'WARNING';
  if (macro.mep.gap > 50) return 'HIGH_VOL';

  // ─── CARRY DETECTION (lowered priority — carry_bias inflation removed) ───
  // Before: CARRY_FAVORABLE triggered too easily (fisherReal > 0.01, inflation < 4, gap < 25)
  // Now: Require STRONGER evidence — fisherReal > 0.015, inflation < 3, gap < 15
  const fisherReal = ((1 + macro.rates.moneyMarket / 12) / (1 + macro.inflation.monthly / 100)) - 1;
  if (fisherReal > 0.015 && macro.inflation.monthly < 3 && macro.mep.gap < 15) return 'CARRY_FAVORABLE';
  if (fisherReal > 0.008 && macro.inflation.monthly < 4) return 'CARRY';

  // ─── ENTROPY VALIDATION ───
  // Regimes must NOT collapse into 1 dominant state.
  // If all signals are near zero, force NORMAL (the statistical baseline)
  // NORMAL must remain statistically dominant — this is the default state
  const signalSum = adjustedDevalProb + macro.mep.gap;
  if (signalSum < 15) return 'NORMAL';  // Flat signals = NORMAL (raised threshold from 10 to 15)

  return 'NORMAL';
}

function computeSignalAgreement(fx: number, infl: number, reserves: number, rates: number): number {
  const values = [fx, infl, reserves, rates];
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const maxVariance = 2500; // Max possible variance (100^2 / 4)
  // High agreement = low variance = high score
  return clamp01(1 - variance / maxVariance) * 100;
}

// ============================================================================
// REGIME CLASSIFICATION (X10 signal layer → CapitalRegime)
// ============================================================================

export function classifyRegime(macro: MacroState): { regime: CapitalRegime; confidence: number; oracle: OracleState } {
  const oracle = computeOracle(macro);
  const regime = mapOracleToCapitalRegime(oracle.regime);
  const confidence = oracle.confidenceScore / 100;
  return { regime, confidence, oracle };
}

function mapOracleToCapitalRegime(regime: MacroRegime): CapitalRegime {
  switch (regime) {
    case 'CARRY_FAVORABLE': return 'CARRY_FAVORABLE';
    case 'CARRY': return 'NORMAL';
    case 'NORMAL': return 'NORMAL';
    case 'WARNING': return 'HIGH_VOL';
    case 'HIGH_VOL': return 'HIGH_VOL';
    case 'CRISIS': return 'CRISIS';
    case 'GLOBAL_RISK_OFF': return 'CRISIS';
    default: return 'NORMAL';
  }
}

// ============================================================================
// L1 SIGNALS — Probabilistic signal extraction
// ============================================================================

export interface L1Signals {
  regime: { regime: MacroRegimeX10; signal: SignalOutput };
  inflation: { name: string; signal: SignalOutput };
  carry: { name: string; signal: SignalOutput };
  volatility: { name: string; signal: SignalOutput };
  liquidity: { name: string; signal: SignalOutput };
  aggregateConfidence: number;
  capitalPreservationMode: boolean;
  emergencyFreeze: boolean;
}

export function computeL1Signals(macro: MacroState): L1Signals {
  const now = isoNow();

  // ─── Regime Signal ───
  const oracle = computeOracle(macro);
  const regimeX10: MacroRegimeX10 = oracle.regime === 'CARRY' || oracle.regime === 'CARRY_FAVORABLE' ? 'CARRY_FAVORABLE'
    : oracle.regime === 'NORMAL' ? 'CARRY_NEUTRAL'
    : oracle.regime === 'WARNING' || oracle.regime === 'HIGH_VOL' ? 'WARNING'
    : 'CRISIS';
  const regimeSignal: SignalOutput = {
    value: clamp01(oracle.devaluationProbability / 100),
    strength: oracle.devaluationProbability > 75 ? 'extreme' : oracle.devaluationProbability > 50 ? 'high' : oracle.devaluationProbability > 25 ? 'medium' : 'low',
    direction: oracle.devaluationProbability > 50 ? 'accelerating' : oracle.devaluationProbability > 25 ? 'stable' : 'decelerating',
    confidence: oracle.confidenceScore / 100,
    sourceLabel: macro.source,
    drivers: ['fx_gap', 'inflation', 'reserves', 'rate_spread'],
    timestamp: now,
    dataAgeMinutes: macro.ageMinutes,
    isDiscounted: macro.source === 'STALE' || macro.source === 'ERROR',
  };

  // ─── Inflation Signal ───
  const inflationSignal: SignalOutput = {
    value: clamp01(macro.inflation.expected30d / 10),
    strength: macro.inflation.expected30d > 8 ? 'extreme' : macro.inflation.expected30d > 5 ? 'high' : macro.inflation.expected30d > 3 ? 'medium' : 'low',
    direction: macro.inflation.expected30d > macro.inflation.monthly ? 'accelerating' : macro.inflation.expected30d < macro.inflation.monthly * 0.8 ? 'decelerating' : 'stable',
    confidence: macro.provenance.inflation.label === 'REAL' ? 0.9 : macro.provenance.inflation.label === 'STALE' ? 0.3 : 0.5,
    sourceLabel: macro.provenance.inflation.label,
    drivers: ['ipc_mensual', 'expectativas_30d'],
    timestamp: now,
    dataAgeMinutes: macro.ageMinutes,
    isDiscounted: macro.provenance.inflation.label === 'STALE' || macro.provenance.inflation.label === 'ERROR',
  };

  // ─── Carry Signal ───
  const fisherReal = ((1 + macro.rates.moneyMarket / 12) / (1 + macro.inflation.monthly / 100)) - 1;
  const carrySignal: SignalOutput = {
    value: clamp01(fisherReal * 50 + 0.5), // Normalize: 0 = negative carry, 1 = strong positive carry
    strength: fisherReal > 0.02 ? 'extreme' : fisherReal > 0.01 ? 'high' : fisherReal > 0 ? 'medium' : 'low',
    direction: fisherReal > 0.005 ? 'accelerating' : fisherReal < -0.005 ? 'reversing' : 'stable',
    confidence: macro.provenance.rates.label === 'REAL' && macro.provenance.inflation.label === 'REAL' ? 0.85 : 0.4,
    sourceLabel: macro.source,
    drivers: ['fisher_real_rate', 'money_market_tna', 'inflation'],
    timestamp: now,
    dataAgeMinutes: macro.ageMinutes,
    isDiscounted: macro.source === 'STALE' || macro.source === 'ERROR',
  };

  // ─── Volatility Signal ───
  const gapVol = macro.mep.gap;
  const volRegime: VolatilityRegime = gapVol > 80 ? 'crisis' : gapVol > 50 ? 'stressed' : gapVol > 25 ? 'elevated' : gapVol > 10 ? 'normal' : 'calm';
  const volatilitySignal: SignalOutput = {
    value: clamp01(gapVol / 80),
    strength: volRegime === 'crisis' ? 'extreme' : volRegime === 'stressed' ? 'high' : volRegime === 'elevated' ? 'medium' : 'low',
    direction: macro.mep.gap > 30 ? 'accelerating' : 'stable',
    confidence: macro.provenance.mepRate.label === 'REAL' ? 0.85 : 0.4,
    sourceLabel: macro.provenance.mepRate.label,
    drivers: ['mep_gap', 'fx_volatility'],
    timestamp: now,
    dataAgeMinutes: macro.ageMinutes,
    isDiscounted: macro.provenance.mepRate.label === 'STALE',
  };

  // ─── Liquidity Signal ───
  const liqRegime: LiquidityCondition = macro.rates.bcraPolicy > 50 ? 'frozen'
    : macro.rates.bcraPolicy > 30 ? 'stressed'
    : macro.rates.bcraPolicy > 15 ? 'tight'
    : macro.rates.bcraPolicy > 5 ? 'normal' : 'abundant';
  const liquiditySignal: SignalOutput = {
    value: clamp01(macro.rates.bcraPolicy / 50),
    strength: liqRegime === 'frozen' ? 'extreme' : liqRegime === 'stressed' ? 'high' : liqRegime === 'tight' ? 'medium' : 'low',
    direction: macro.rates.bcraPolicy > 30 ? 'accelerating' : 'decelerating',
    confidence: macro.provenance.rates.label === 'REAL' ? 0.8 : 0.4,
    sourceLabel: macro.provenance.rates.label,
    drivers: ['bcra_policy_rate', 'leliq', 'badlar'],
    timestamp: now,
    dataAgeMinutes: macro.ageMinutes,
    isDiscounted: macro.provenance.rates.label === 'STALE',
  };

  // ─── Aggregate ───
  const allConfidences = [regimeSignal.confidence, inflationSignal.confidence, carrySignal.confidence, volatilitySignal.confidence, liquiditySignal.confidence];
  const aggregateConfidence = allConfidences.reduce((s, c) => s + c, 0) / allConfidences.length;
  const capitalPreservationMode = macro.source === 'STALE' || macro.source === 'ERROR' || aggregateConfidence < 0.5;
  const emergencyFreeze = macro.source === 'ERROR';

  return {
    regime: { regime: regimeX10, signal: regimeSignal },
    inflation: { name: 'inflation', signal: inflationSignal },
    carry: { name: 'carry', signal: carrySignal },
    volatility: { name: 'volatility', signal: volatilitySignal },
    liquidity: { name: 'liquidity', signal: liquiditySignal },
    aggregateConfidence: round2(aggregateConfidence),
    capitalPreservationMode,
    emergencyFreeze,
  };
}

// ============================================================================
// CAPITAL BUCKETS — Regime-dependent allocation
// ============================================================================

const BASE_ALLOCATIONS: Record<CapitalRegime, Record<string, { weight: number; return: number }>> = {
  CRISIS: {
    capital_preservation: { weight: 0.80, return: -0.002 },   // Negative: capital preservation still erodes in crisis
    inflation_hedge: { weight: 0.10, return: -0.005 },        // CER lags inflation spikes
    carry_opportunistic: { weight: 0.00, return: -0.020 },    // Carry destroyed in crisis
    usd_hedge_growth: { weight: 0.10, return: 0.003 },       // USD hedge is the only positive in crisis
    tactical: { weight: 0.00, return: -0.030 },              // Tactical destroyed in crisis
  },
  HIGH_VOL: {
    capital_preservation: { weight: 0.50, return: 0.002 },
    inflation_hedge: { weight: 0.25, return: 0.004 },
    carry_opportunistic: { weight: 0.00, return: 0.008 },    // Disabled in HIGH_VOL
    usd_hedge_growth: { weight: 0.20, return: 0.005 },
    tactical: { weight: 0.05, return: 0.010 },
  },
  NORMAL: {
    capital_preservation: { weight: 0.40, return: 0.004 },
    inflation_hedge: { weight: 0.25, return: 0.006 },
    carry_opportunistic: { weight: 0.15, return: 0.010 },
    usd_hedge_growth: { weight: 0.15, return: 0.005 },
    tactical: { weight: 0.05, return: 0.012 },
  },
  CARRY_FAVORABLE: {
    capital_preservation: { weight: 0.25, return: 0.005 },
    inflation_hedge: { weight: 0.15, return: 0.007 },
    carry_opportunistic: { weight: 0.25, return: 0.012 },
    usd_hedge_growth: { weight: 0.25, return: 0.006 },
    tactical: { weight: 0.10, return: 0.015 },
  },
};

// Santander products mapped to buckets
const BUCKET_PRODUCTS: Record<string, { id: string; name: string; category: string }[]> = {
  capital_preservation: [
    { id: 'super_ahorro', name: 'Super Ahorro Santander', category: 'money_market' },
    { id: 'fci_money_market', name: 'FCI Money Market', category: 'money_market' },
  ],
  inflation_hedge: [
    { id: 'pf_uva', name: 'Plazo Fijo UVA', category: 'cer_indexed' },
    { id: 'lecaps', name: 'Lecaps', category: 'cer_indexed' },
  ],
  carry_opportunistic: [
    { id: 'pf_tradicional', name: 'Plazo Fijo Tradicional', category: 'nominal' },
    { id: 'fci_renta_fija', name: 'FCI Renta Fija', category: 'nominal' },
  ],
  usd_hedge_growth: [
    { id: 'fci_usd', name: 'FCI USD Santander', category: 'fx_hedge' },
    { id: 'bono_usd', name: 'Bono USD', category: 'fx_hedge' },
  ],
  tactical: [
    { id: 'lecaps_tactical', name: 'Lecaps Tactical', category: 'opportunistic' },
  ],
};

export function computeAllocation(
  macro: MacroState,
  mode: StrategicMode,
  capitalUSD: number,
): { allocations: X10EngineOutput['portfolio_allocation']; regime: CapitalRegime } {
  const { regime } = classifyRegime(macro);
  const allocations = BASE_ALLOCATIONS[regime];

  // Adjust for strategic mode
  let riskMultiplier = mode === 'CONSERVATIVE' ? 0.5 : mode === 'AGGRESSIVE' ? 1.5 : 1.0;

  // X10 directive: confidence < 0.7 → auto de-risk
  const signals = computeL1Signals(macro);
  if (signals.aggregateConfidence < 0.7) {
    riskMultiplier *= 0.5; // Halve risk
  }

  // Build portfolio allocations
  const portfolio: X10EngineOutput['portfolio_allocation'] = [];
  for (const [bucketKey, bucketAlloc] of Object.entries(allocations)) {
    let weight = bucketAlloc.weight;
    // Apply risk multiplier to non-preservation buckets
    if (bucketKey !== 'capital_preservation' && bucketKey !== 'inflation_hedge') {
      weight = Math.min(weight * riskMultiplier, weight * 1.5); // Cap risk scaling
    }

    const products = BUCKET_PRODUCTS[bucketKey] || [];
    if (products.length === 0) continue;
    const perProductWeight = weight / products.length;

    for (const product of products) {
      portfolio.push({
        productId: product.id,
        productName: product.name,
        weight: round4(perProductWeight),
        amountUSD: round2(capitalUSD * perProductWeight),
        category: product.category,
        strategySource: bucketKey === 'carry_opportunistic' ? 'carry_optimization' : 'usd_hedged_allocations',
      });
    }
  }

  // Normalize weights to sum to 1.0
  const totalWeight = portfolio.reduce((s, a) => s + a.weight, 0);
  if (totalWeight > 0) {
    for (const alloc of portfolio) {
      alloc.weight = round4(alloc.weight / totalWeight);
      alloc.amountUSD = round2(capitalUSD * alloc.weight);
    }
  }

  return { allocations: portfolio, regime };
}

// ============================================================================
// RISK METRICS
// ============================================================================

export function computeRiskMetrics(macro: MacroState, regime: CapitalRegime, confidence: number) {
  const fisherReal = ((1 + macro.rates.moneyMarket / 12) / (1 + macro.inflation.monthly / 100)) - 1;
  const bucketAllocs = BASE_ALLOCATIONS[regime];
  // Symmetric return model: allows negative returns (CRISIS regime)
  const expectedReturn30d = Object.values(bucketAllocs).reduce((s, b) => s + b.weight * b.return, 0) * 100;
  const probabilityOfLoss = regime === 'CRISIS' ? 0.55 : regime === 'HIGH_VOL' ? 0.25 : regime === 'NORMAL' ? 0.10 : 0.08;
  const maxDrawdown = regime === 'CRISIS' ? 15 : regime === 'HIGH_VOL' ? 8 : regime === 'NORMAL' ? 3 : 2;
  const capitalAtRisk = probabilityOfLoss > 0.15 ? 0.15 : probabilityOfLoss;

  return {
    expectedReturn30d: round2(expectedReturn30d),
    expectedReturn90d: round2(expectedReturn30d * 2.8),
    probabilityOfLoss: round2(probabilityOfLoss),
    maxDrawdownEstimate: round2(maxDrawdown),
    capitalAtRisk: round2(capitalAtRisk),
    sharpeEstimate: round2(expectedReturn30d / (maxDrawdown || 1)),
    fisherRealRate: round4(fisherReal),
    volatilityRegime: regime === 'CRISIS' ? 'crisis' : regime === 'HIGH_VOL' ? 'stressed' : regime === 'CARRY_FAVORABLE' ? 'calm' : 'normal',
    liquidityCondition: macro.rates.bcraPolicy > 50 ? 'frozen' : macro.rates.bcraPolicy > 30 ? 'stressed' : 'normal',
    capitalPreservationPct: round2(bucketAllocs.capital_preservation.weight * 100),
  };
}

// ============================================================================
// SCENARIO BOUNDS
// ============================================================================

export function computeScenarios(macro: MacroState, regime: CapitalRegime): {
  downside: ScenarioBound;
  base: ScenarioBound;
  upside: ScenarioBound;
} {
  // Symmetric distribution: CRISIS has negative base return, not positive
  const baseReturn = regime === 'CRISIS' ? -2.5 : regime === 'HIGH_VOL' ? -0.3 : regime === 'CARRY_FAVORABLE' ? 1.2 : 0.6;

  return {
    downside: {
      returnMin: round2(baseReturn - 5),
      returnMax: round2(baseReturn - 1),
      probability: round2(regime === 'CRISIS' ? 0.40 : 0.15),
      label: 'Downside',
    },
    base: {
      returnMin: round2(baseReturn - 1),
      returnMax: round2(baseReturn + 1),
      probability: round2(regime === 'CRISIS' ? 0.35 : 0.55),
      label: 'Base',
    },
    upside: {
      returnMin: round2(baseReturn + 0.5),
      returnMax: round2(baseReturn + 3),
      probability: round2(regime === 'CRISIS' ? 0.25 : 0.30),
      label: 'Upside',
    },
  };
}

// ============================================================================
// X10 DIRECTIVES — Safety guardrails
// ============================================================================

export function computeX10Directives(macro: MacroState, signals: L1Signals) {
  return {
    confidenceThrottle: {
      active: signals.aggregateConfidence < 0.7,
      reason: signals.aggregateConfidence < 0.7 ? `Confidence ${round2(signals.aggregateConfidence)} < 0.7 threshold` : '',
    },
    capitalPreservationFallback: {
      active: macro.source === 'STALE' || macro.source === 'ERROR' || signals.capitalPreservationMode,
      reason: macro.source === 'STALE' ? 'Macro data STALE' : macro.source === 'ERROR' ? 'Macro data ERROR' : signals.capitalPreservationMode ? 'Capital preservation triggered' : '',
    },
    emergencyFreeze: {
      active: macro.source === 'ERROR' || signals.emergencyFreeze,
      reason: macro.source === 'ERROR' ? 'Macro data ERROR — freeze all strategy updates' : '',
    },
    deRiskMode: {
      active: signals.regime.signal.value > 0.6 || signals.aggregateConfidence < 0.5,
      reason: signals.regime.signal.value > 0.6 ? 'High regime stress detected' : signals.aggregateConfidence < 0.5 ? 'Very low confidence' : '',
    },
  };
}

// ============================================================================
// FULL X10 ENGINE — Orchestrates all layers
// ============================================================================

export function runX10Engine(macro: MacroState, mode: StrategicMode, capitalUSD: number): X10EngineOutput {
  const startMs = Date.now();

  // L1: Signals
  const signals = computeL1Signals(macro);

  // L2: Strategy (allocation)
  const { allocations, regime } = computeAllocation(macro, mode, capitalUSD);

  // L3: Risk metrics
  const riskMetrics = computeRiskMetrics(macro, regime, signals.aggregateConfidence);

  // L4: Scenarios
  const scenarios = computeScenarios(macro, regime);

  // X10 Directives
  const x10Directives = computeX10Directives(macro, signals);

  return {
    engineVersion: 'X10-CF-WORKER-v1.0',
    timestamp: isoNow(),
    durationMs: Date.now() - startMs,
    dataLayer: {
      macroSource: macro.source,
      dataAgeMinutes: macro.ageMinutes,
      realDataPct: macro.realDataPct,
      hasError: macro.source === 'ERROR',
      allStale: macro.source === 'STALE',
    },
    signalLayer: {
      regime: signals.regime,
      inflation: signals.inflation,
      carry: signals.carry,
      volatility: signals.volatility,
      liquidity: signals.liquidity,
      aggregateConfidence: signals.aggregateConfidence,
      capitalPreservationMode: signals.capitalPreservationMode,
      emergencyFreeze: signals.emergencyFreeze,
    },
    portfolio_allocation: allocations,
    risk_metrics: riskMetrics,
    confidence_score: round2(signals.aggregateConfidence),
    scenario_downside: scenarios.downside,
    scenario_base: scenarios.base,
    scenario_upside: scenarios.upside,
    x10Directives,
  };
}
