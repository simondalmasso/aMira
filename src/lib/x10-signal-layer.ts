// ============================================================================
// Ω-MYTHOS X10 ENGINE — L1 SIGNAL LAYER
// Probabilistic signal extraction from L0 raw macro data
// Each signal is: [0, 1] normalized + confidence-weighted + provenance-tagged
// NO state degradation: signals preserve source label end-to-end
// ============================================================================
//
// ARCHITECTURE:
//   L0_DATA_LAYER (BCRA/INDEC/Bluelytics) → THIS FILE → L2_STRATEGY_LAYER
//
// SIGNAL MODULES:
//   1. macro_regime_detector      — classify macro regime (CARRY/WARNING/CRISIS/RISK_OFF)
//   2. inflation_trend_estimator  — inflation momentum + trend direction
//   3. carry_spread_engine        — real carry spread + Fisher-adjusted
//   4. volatility_regime_classifier — FX/rates/inflation volatility regime
//   5. liquidity_stress_detector   — money market stress + reserve pressure
//
// X10 RULE: If data confidence < 0.7, reduce allocation aggressiveness automatically
//
// OPERATING MODEL (from Ω_X10_ORACLE_DEPLOYMENT_REALITY_CHECK):
//   - Event-driven macro engine (NOT a trading machine)
//   - Loop: ingest → classify → compute risk → allocate → simulate (NOT predict)
//   - Output: allocation_map, risk_exposure_vector, regime_state, confidence_score, stress_test_band
//   - Deploy for automation, discipline, no-human execution bias removal
//   - NOT for profit generation by itself
// ============================================================================

import {
  type MacroState,
  type DataLabel,
  type DataProvenance,
  DATA_STALE_THRESHOLDS,
} from './live-data';

// ============================================================================
// CORE SIGNAL TYPES
// ============================================================================
export type SignalStrength = 'low' | 'medium' | 'high' | 'extreme';
export type TrendDirection = 'accelerating' | 'stable' | 'decelerating' | 'reversing';
export type VolatilityRegime = 'calm' | 'normal' | 'elevated' | 'stressed' | 'crisis';
export type LiquidityCondition = 'abundant' | 'normal' | 'tight' | 'stressed' | 'frozen';
export type MacroRegimeX10 = 'CARRY_FAVORABLE' | 'CARRY_NEUTRAL' | 'WARNING' | 'CRISIS' | 'GLOBAL_RISK_OFF';

export interface SignalOutput {
  /** Normalized signal value [0, 1] where 0=no stress/risk, 1=extreme */
  value: number;
  /** Human-readable strength category */
  strength: SignalStrength;
  /** Direction or trend of the signal */
  direction: TrendDirection;
  /** Confidence in this signal based on data quality [0, 1] */
  confidence: number;
  /** Data provenance of the primary inputs */
  sourceLabel: DataLabel;
  /** Which inputs drove this signal */
  drivers: string[];
  /** Timestamp of computation */
  timestamp: string;
  /** Age of the underlying data in minutes */
  dataAgeMinutes: number;
  /** Whether signal should be discounted due to stale/error data */
  isDiscounted: boolean;
}

export interface L1SignalBundle {
  regime: {
    regime: MacroRegimeX10;
    signal: SignalOutput;
  };
  inflation: {
    trend: TrendDirection;
    momentum: number;         // monthly change in inflation rate (pp)
    signal: SignalOutput;
  };
  carry: {
    realSpread: number;       // Fisher-adjusted real carry spread
    fisherRate: number;       // ((1+tna/12)/(1+ipc_mensual))-1
    isViable: boolean;
    signal: SignalOutput;
  };
  volatility: {
    regime: VolatilityRegime;
    fxVol: number;
    ratesVol: number;
    inflationVol: number;
    signal: SignalOutput;
  };
  liquidity: {
    condition: LiquidityCondition;
    moneyMarketStress: number;
    reservePressure: number;
    signal: SignalOutput;
  };
  /** Aggregate data confidence [0, 1] — weighted average across all signals */
  aggregateConfidence: number;
  /** Whether any input is ERROR → triggers X10 freeze */
  hasError: boolean;
  /** Whether all real inputs are STALE → triggers capital preservation mode */
  allStale: boolean;
  /** Timestamp of the bundle */
  timestamp: string;
  /** Source of the underlying macro data */
  macroSource: DataLabel;
  /** Data age in minutes */
  dataAgeMinutes: number;
}

// ============================================================================
// CONFIDENCE COMPUTATION — Data quality → signal confidence
// ============================================================================
const LABEL_CONFIDENCE: Record<DataLabel, number> = {
  OBSERVADO: 0.95,
  REAL: 0.85,
  PARTIAL_FALLBACK: 0.50,
  SIMULADO: 0.30,
  STALE: 0.20,
  ERROR: 0.05,
};

/** Compute confidence from a set of provenance entries, weighted by importance */
function computeConfidenceFromProvenance(
  provenance: Record<string, DataProvenance>,
  weightMap: Record<string, number>
): number {
  let totalWeight = 0;
  let weightedConf = 0;
  for (const [key, weight] of Object.entries(weightMap)) {
    const p = provenance[key];
    if (!p) continue;
    const baseConf = LABEL_CONFIDENCE[p.label] ?? 0.30;
    // Age penalty: reduce confidence as data gets older
    const agePenalty = Math.min(0.3, (p.ageMinutes / 1440) * 0.3); // up to -0.3 per day of age
    const fetchErrorPenalty = p.fetchError ? 0.15 : 0;
    const conf = Math.max(0.05, baseConf - agePenalty - fetchErrorPenalty);
    weightedConf += conf * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? weightedConf / totalWeight : 0.10;
}

/** Determine if a signal should be discounted (confidence < 0.7) */
function isDiscounted(confidence: number): boolean {
  return confidence < 0.7;
}

/** Map value [0,1] to SignalStrength */
function toStrength(v: number): SignalStrength {
  if (v < 0.25) return 'low';
  if (v < 0.50) return 'medium';
  if (v < 0.75) return 'high';
  return 'extreme';
}

// ============================================================================
// MODULE 1: MACRO REGIME DETECTOR
// ============================================================================
function detectMacroRegime(macro: MacroState): { regime: MacroRegimeX10; signal: SignalOutput } {
  const gap = macro.mep.gap;
  const inflation30d = macro.inflation.expected30d;
  const carry = macro.rates.moneyMarket / 12 - macro.crawlingPeg;
  const netCarryPositive = carry > 1.0;
  const gapLow = gap < 15;
  const inflLow = inflation30d < 3.0;

  let regime: MacroRegimeX10;
  let value: number;
  let direction: TrendDirection;
  let drivers: string[];

  if (gap > 50 || inflation30d > 6) {
    regime = 'CRISIS';
    value = Math.min(1, Math.max(gap / 80, inflation30d / 10));
    direction = 'accelerating';
    drivers = gap > 50 ? ['MEP gap extremo', `gap=${gap.toFixed(1)}%`] : ['Inflación severa', `IPC 30d=${inflation30d.toFixed(1)}%`];
  } else if (carry < 0.5 && gap > 20) {
    regime = 'GLOBAL_RISK_OFF';
    value = Math.min(1, (1 - carry) * 0.5 + gap / 100);
    direction = 'accelerating';
    drivers = ['Carry insuficiente', `net carry=${carry.toFixed(2)}%`, `gap=${gap.toFixed(1)}%`];
  } else if (gap > 25 || inflation30d > 3.5) {
    regime = 'WARNING';
    value = Math.min(1, Math.max(gap / 60, (inflation30d - 2) / 6));
    direction = gap > 30 ? 'accelerating' : 'stable';
    drivers = gap > 25 ? ['Brecha elevada', `gap=${gap.toFixed(1)}%`] : ['Inflación moderada-alta', `IPC 30d=${inflation30d.toFixed(1)}%`];
  } else if (netCarryPositive && gapLow && inflLow) {
    regime = 'CARRY_FAVORABLE';
    value = Math.min(1, carry / 3);
    direction = 'stable';
    drivers = ['Carry positivo', `net=${carry.toFixed(2)}%`, 'Gap bajo', 'Inflación baja'];
  } else {
    regime = 'CARRY_NEUTRAL';
    value = Math.min(1, 0.3 + Math.max(0, (3 - carry) / 5));
    direction = 'stable';
    drivers = ['Carry moderado', `net=${carry.toFixed(2)}%`];
  }

  const confidence = computeConfidenceFromProvenance(macro.provenance, {
    mepRate: 0.35,
    inflation: 0.25,
    rates: 0.25,
    crawlingPeg: 0.15,
  });

  const signal: SignalOutput = {
    value: Math.round(value * 1000) / 1000,
    strength: toStrength(value),
    direction,
    confidence: Math.round(confidence * 100) / 100,
    sourceLabel: macro.source,
    drivers,
    timestamp: new Date().toISOString(),
    dataAgeMinutes: macro.ageMinutes,
    isDiscounted: isDiscounted(confidence),
  };

  return { regime, signal };
}

// ============================================================================
// MODULE 2: INFLATION TREND ESTIMATOR
// ============================================================================
function estimateInflationTrend(macro: MacroState): { trend: TrendDirection; momentum: number; signal: SignalOutput } {
  const monthly = macro.inflation.monthly;
  const expected30d = macro.inflation.expected30d;
  const expected90d = macro.inflation.expected90d;
  const cerMonthly = macro.cer.monthlyChange;

  // Momentum: expected30d - current monthly (positive = accelerating)
  const momentum = expected30d - monthly;

  // Trend classification
  let trend: TrendDirection;
  if (momentum > 0.5) trend = 'accelerating';
  else if (momentum < -0.5) trend = 'decelerating';
  else if (Math.abs(momentum) <= 0.5 && monthly > 4) trend = 'stable'; // high but stable
  else if (momentum < -1.0) trend = 'reversing';
  else trend = 'stable';

  // Inflation stress value [0, 1]
  // Use combination of level + momentum + CER confirmation
  const levelStress = Math.min(1, monthly / 8);
  const momentumStress = Math.min(1, Math.max(0, momentum) / 3);
  const cerConfirmation = cerMonthly > 0 ? Math.min(1, cerMonthly / 6) : 0.5;
  const inflationValue = levelStress * 0.5 + momentumStress * 0.3 + cerConfirmation * 0.2;

  const drivers: string[] = [];
  if (momentum > 0.3) drivers.push(`Acelerando +${momentum.toFixed(2)}pp`);
  else if (momentum < -0.3) drivers.push(`Desacelerando ${momentum.toFixed(2)}pp`);
  else drivers.push(`Estable (${monthly.toFixed(1)}%/mes)`);
  if (cerMonthly > monthly + 0.5) drivers.push(`CER > IPC (${cerMonthly.toFixed(1)} vs ${monthly.toFixed(1)})`);

  const confidence = computeConfidenceFromProvenance(macro.provenance, {
    inflation: 0.50,
    cer: 0.30,
    rates: 0.20,
  });

  const signal: SignalOutput = {
    value: Math.round(inflationValue * 1000) / 1000,
    strength: toStrength(inflationValue),
    direction: trend,
    confidence: Math.round(confidence * 100) / 100,
    sourceLabel: macro.provenance.inflation?.label ?? macro.source,
    drivers,
    timestamp: new Date().toISOString(),
    dataAgeMinutes: macro.ageMinutes,
    isDiscounted: isDiscounted(confidence),
  };

  return { trend, momentum: Math.round(momentum * 100) / 100, signal };
}

// ============================================================================
// MODULE 3: CARRY SPREAD ENGINE — Fisher-adjusted real carry
// ============================================================================
function computeCarrySpread(macro: MacroState): { realSpread: number; fisherRate: number; isViable: boolean; signal: SignalOutput } {
  const tna = macro.rates.moneyMarket;
  const ipcMensual = macro.inflation.monthly;
  const crawlingPeg = macro.crawlingPeg;

  // Fisher Formula: ((1 + tna/12) / (1 + ipc_mensual)) - 1
  const fisherRate = ((1 + tna / 12 / 100) / (1 + ipcMensual / 100)) - 1;

  // Real spread in USD terms: carry after FX depreciation
  const nominal30d = tna / 12 / 100;
  const deval30d = crawlingPeg / 100;
  const realSpread = ((1 + nominal30d) / (1 + deval30d) - 1) * 100;

  // Alternative: if gap is large, use gap-adjusted devaluation expectation
  const gap = macro.mep.gap;
  const impliedDevalExpectation = gap > 30 ? deval30d + gap / 100 / 12 : deval30d;
  const adjustedRealSpread = ((1 + nominal30d) / (1 + impliedDevalExpectation) - 1) * 100;

  const isViable = adjustedRealSpread > 0;

  // Carry stress: how far from "comfortable" carry (positive spread > 0.5%/month)
  const carryValue = Math.min(1, Math.max(0, (1 - adjustedRealSpread / 3)));

  const drivers: string[] = [];
  if (adjustedRealSpread > 1) drivers.push(`Carry fuerte +${adjustedRealSpread.toFixed(2)}% real`);
  else if (adjustedRealSpread > 0) drivers.push(`Carry marginal +${adjustedRealSpread.toFixed(2)}% real`);
  else drivers.push(`Carry negativo ${adjustedRealSpread.toFixed(2)}% real`);
  if (gap > 20) drivers.push(`Gap riesgo: ${gap.toFixed(1)}%`);

  const confidence = computeConfidenceFromProvenance(macro.provenance, {
    rates: 0.40,
    inflation: 0.30,
    mepRate: 0.20,
    crawlingPeg: 0.10,
  });

  const signal: SignalOutput = {
    value: Math.round(carryValue * 1000) / 1000,
    strength: toStrength(carryValue),
    direction: isViable ? 'stable' : 'accelerating',
    confidence: Math.round(confidence * 100) / 100,
    sourceLabel: macro.source,
    drivers,
    timestamp: new Date().toISOString(),
    dataAgeMinutes: macro.ageMinutes,
    isDiscounted: isDiscounted(confidence),
  };

  return {
    realSpread: Math.round(adjustedRealSpread * 100) / 100,
    fisherRate: Math.round(fisherRate * 10000) / 100, // in basis points
    isViable,
    signal,
  };
}

// ============================================================================
// MODULE 4: VOLATILITY REGIME CLASSIFIER
// ============================================================================
function classifyVolatilityRegime(macro: MacroState): { regime: VolatilityRegime; fxVol: number; ratesVol: number; inflationVol: number; signal: SignalOutput } {
  // FX volatility proxy: gap width * gap volatility proxy
  const gap = macro.mep.gap;
  const fxVol = Math.min(1, gap / 60); // Wider gap = higher FX vol

  // Rates volatility: spread between BCRA policy and market rates
  const rateSpread = Math.abs(macro.rates.bcraPolicy - macro.rates.moneyMarket);
  const ratesVol = Math.min(1, rateSpread / 15);

  // Inflation volatility: difference between expected 30d and 90d (term structure slope)
  const inflationTermSpread = Math.abs(macro.inflation.expected30d - macro.inflation.expected90d / 3);
  const inflationVol = Math.min(1, (inflationTermSpread + macro.inflation.monthly) / 10);

  // Composite volatility
  const compositeVol = fxVol * 0.40 + ratesVol * 0.25 + inflationVol * 0.35;

  // Regime classification
  let regime: VolatilityRegime;
  if (compositeVol < 0.15) regime = 'calm';
  else if (compositeVol < 0.35) regime = 'normal';
  else if (compositeVol < 0.55) regime = 'elevated';
  else if (compositeVol < 0.75) regime = 'stressed';
  else regime = 'crisis';

  const drivers: string[] = [];
  if (fxVol > 0.5) drivers.push(`FX vol alta (gap=${gap.toFixed(1)}%)`);
  if (ratesVol > 0.3) drivers.push(`Dispersión tasas (${rateSpread.toFixed(1)}pp)`);
  if (inflationVol > 0.4) drivers.push(`Vol inflación (${inflationTermSpread.toFixed(2)}pp term)`);

  const confidence = computeConfidenceFromProvenance(macro.provenance, {
    mepRate: 0.40,
    rates: 0.30,
    inflation: 0.30,
  });

  const signal: SignalOutput = {
    value: Math.round(compositeVol * 1000) / 1000,
    strength: toStrength(compositeVol),
    direction: compositeVol > 0.5 ? 'accelerating' : 'stable',
    confidence: Math.round(confidence * 100) / 100,
    sourceLabel: macro.source,
    drivers,
    timestamp: new Date().toISOString(),
    dataAgeMinutes: macro.ageMinutes,
    isDiscounted: isDiscounted(confidence),
  };

  return {
    regime,
    fxVol: Math.round(fxVol * 100) / 100,
    ratesVol: Math.round(ratesVol * 100) / 100,
    inflationVol: Math.round(inflationVol * 100) / 100,
    signal,
  };
}

// ============================================================================
// MODULE 5: LIQUIDITY STRESS DETECTOR
// ============================================================================
function detectLiquidityStress(macro: MacroState): { condition: LiquidityCondition; moneyMarketStress: number; reservePressure: number; signal: SignalOutput } {
  // Money market stress: policy rate vs money market spread (inverted — high spread = stress)
  const mmSpread = Math.abs(macro.rates.bcraPolicy - macro.rates.moneyMarket);
  const moneyMarketStress = Math.min(1, mmSpread / 10);

  // Reserve pressure proxy: rate spread + crawling peg intensity
  const crawlingIntensity = Math.min(1, macro.crawlingPeg / 5);
  const rateGapUSD = Math.max(0, macro.rates.moneyMarket - 5) / 40; // How far from USD-neutral
  const reservePressure = Math.min(1, (crawlingIntensity * 0.5 + rateGapUSD * 0.5));

  // Liquidity condition
  const liquidityStress = moneyMarketStress * 0.5 + reservePressure * 0.5;

  let condition: LiquidityCondition;
  if (liquidityStress < 0.15) condition = 'abundant';
  else if (liquidityStress < 0.35) condition = 'normal';
  else if (liquidityStress < 0.55) condition = 'tight';
  else if (liquidityStress < 0.75) condition = 'stressed';
  else condition = 'frozen';

  const drivers: string[] = [];
  if (mmSpread > 3) drivers.push(`Spread tasas ${mmSpread.toFixed(1)}pp`);
  if (macro.crawlingPeg > 2) drivers.push(`Crawling peg alto ${macro.crawlingPeg.toFixed(1)}%/mes`);
  if (macro.rates.moneyMarket > 30) drivers.push(`Tasa MM elevada ${macro.rates.moneyMarket.toFixed(1)}%`);

  const confidence = computeConfidenceFromProvenance(macro.provenance, {
    rates: 0.50,
    reserves: 0.30,
    crawlingPeg: 0.20,
  });

  const signal: SignalOutput = {
    value: Math.round(liquidityStress * 1000) / 1000,
    strength: toStrength(liquidityStress),
    direction: liquidityStress > 0.5 ? 'accelerating' : 'stable',
    confidence: Math.round(confidence * 100) / 100,
    sourceLabel: macro.source,
    drivers,
    timestamp: new Date().toISOString(),
    dataAgeMinutes: macro.ageMinutes,
    isDiscounted: isDiscounted(confidence),
  };

  return {
    condition,
    moneyMarketStress: Math.round(moneyMarketStress * 100) / 100,
    reservePressure: Math.round(reservePressure * 100) / 100,
    signal,
  };
}

// ============================================================================
// X10 DIRECTIVES — Confidence-based allocation throttle
// ============================================================================

/**
 * X10 RULE: If data confidence < 0.7, reduce allocation aggressiveness automatically.
 * Returns a multiplier [0, 1] that scales risk-taking.
 *   - confidence >= 0.7 → multiplier = 1.0 (no throttling)
 *   - confidence = 0.5  → multiplier = 0.5
 *   - confidence = 0.3  → multiplier = 0.2
 *   - confidence = 0.0  → multiplier = 0.0 (capital preservation only)
 */
export function computeX10ConfidenceMultiplier(aggregateConfidence: number): number {
  if (aggregateConfidence >= 0.7) return 1.0;
  if (aggregateConfidence >= 0.5) return (aggregateConfidence - 0.3) / 0.4; // 0.5 → 0.5, 0.7 → 1.0
  if (aggregateConfidence >= 0.3) return (aggregateConfidence - 0.2) / 1.5; // 0.3 → 0.067, 0.5 → 0.2
  return Math.max(0, aggregateConfidence / 0.3 * 0.05); // Near zero
}

/**
 * X10 FALLBACK: If all macro inputs STALE → revert to capital preservation mode.
 * Capital preservation = 70% money market + 30% CER, zero MEP, zero risk.
 */
export function isCapitalPreservationMode(bundle: L1SignalBundle): boolean {
  return bundle.allStale || bundle.aggregateConfidence < 0.25;
}

/**
 * X10 EMERGENCY: If ERROR state detected → freeze strategy updates.
 * Returns true if strategy engine should NOT compute new allocations.
 */
export function isEmergencyFreeze(bundle: L1SignalBundle): boolean {
  return bundle.hasError;
}

// ============================================================================
// MAIN: COMPUTE L1 SIGNAL BUNDLE
// ============================================================================
export function computeL1Signals(macro: MacroState): L1SignalBundle {
  const regimeResult = detectMacroRegime(macro);
  const inflationResult = estimateInflationTrend(macro);
  const carryResult = computeCarrySpread(macro);
  const volatilityResult = classifyVolatilityRegime(macro);
  const liquidityResult = detectLiquidityStress(macro);

  // Aggregate confidence: weighted average across all signal confidences
  const confidenceWeights = {
    regime: 0.30,
    inflation: 0.25,
    carry: 0.20,
    volatility: 0.15,
    liquidity: 0.10,
  };

  const aggregateConfidence =
    regimeResult.signal.confidence * confidenceWeights.regime +
    inflationResult.signal.confidence * confidenceWeights.inflation +
    carryResult.signal.confidence * confidenceWeights.carry +
    volatilityResult.signal.confidence * confidenceWeights.volatility +
    liquidityResult.signal.confidence * confidenceWeights.liquidity;

  // Check for ERROR in any provenance
  const hasError = Object.values(macro.provenance).some(p => p.label === 'ERROR');

  // Check if ALL real inputs are STALE (no fresh data at all)
  const allStale = !hasError && Object.values(macro.provenance)
    .filter(p => p.label !== 'ERROR' && p.label !== 'PARTIAL_FALLBACK') // exclude always-simulated
    .every(p => p.label === 'STALE' || p.label === 'ERROR');

  return {
    regime: regimeResult,
    inflation: inflationResult,
    carry: carryResult,
    volatility: volatilityResult,
    liquidity: liquidityResult,
    aggregateConfidence: Math.round(aggregateConfidence * 100) / 100,
    hasError,
    allStale,
    timestamp: new Date().toISOString(),
    macroSource: macro.source,
    dataAgeMinutes: macro.ageMinutes,
  };
}
