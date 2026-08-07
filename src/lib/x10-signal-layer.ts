// Canonical X10 L1 signal layer. Pure, deterministic, provenance-aware.

import type { DataLabel, DataProvenance, MacroState } from './live-data';

export type SignalStrength = 'low' | 'medium' | 'high' | 'extreme';
export type TrendDirection = 'accelerating' | 'stable' | 'decelerating' | 'reversing';
export type VolatilityRegime = 'calm' | 'normal' | 'elevated' | 'stressed' | 'crisis';
export type LiquidityCondition = 'abundant' | 'normal' | 'tight' | 'stressed' | 'frozen';
export type MacroRegimeX10 = 'CARRY_FAVORABLE' | 'CARRY_NEUTRAL' | 'WARNING' | 'CRISIS' | 'GLOBAL_RISK_OFF';

export interface SignalOutput {
  value: number;
  strength: SignalStrength;
  direction: TrendDirection;
  confidence: number;
  sourceLabel: DataLabel;
  drivers: string[];
  timestamp: string;
  dataAgeMinutes: number;
  isDiscounted: boolean;
}

export interface L1SignalBundle {
  regime: { regime: MacroRegimeX10; signal: SignalOutput };
  inflation: { trend: TrendDirection; momentum: number; signal: SignalOutput };
  carry: { realSpread: number; fisherRate: number; isViable: boolean; signal: SignalOutput };
  volatility: { regime: VolatilityRegime; fxVol: number; ratesVol: number; inflationVol: number; signal: SignalOutput };
  liquidity: { condition: LiquidityCondition; moneyMarketStress: number; reservePressure: number; signal: SignalOutput };
  aggregateConfidence: number;
  hasError: boolean;
  allStale: boolean;
  timestamp: string;
  macroSource: DataLabel;
  dataAgeMinutes: number;
}

const LABEL_CONFIDENCE: Record<DataLabel, number> = {
  OBSERVADO: 0.95,
  REAL: 0.85,
  PARTIAL_FALLBACK: 0.50,
  RECONSTRUIDO: 0.40,
  SIMULADO: 0.30,
  STALE: 0.20,
  ERROR: 0.05,
};

const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const strength = (value: number): SignalStrength => value < 0.25 ? 'low' : value < 0.5 ? 'medium' : value < 0.75 ? 'high' : 'extreme';

function confidenceFrom(
  provenance: Record<string, DataProvenance>,
  weights: Record<string, number>,
): number {
  let weighted = 0;
  let total = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const item = provenance[key];
    if (!item) continue;
    const agePenalty = Math.min(0.3, (item.ageMinutes / 1440) * 0.3);
    const errorPenalty = item.fetchError ? 0.15 : 0;
    weighted += Math.max(0.05, LABEL_CONFIDENCE[item.label] - agePenalty - errorPenalty) * weight;
    total += weight;
  }
  return total === 0 ? 0.1 : weighted / total;
}

function signal(
  macro: MacroState,
  value: number,
  direction: TrendDirection,
  confidence: number,
  drivers: string[],
  sourceLabel: DataLabel = macro.source,
): SignalOutput {
  return {
    value: round(clamp01(value), 3),
    strength: strength(clamp01(value)),
    direction,
    confidence: round(clamp01(confidence), 2),
    sourceLabel,
    drivers,
    timestamp: new Date().toISOString(),
    dataAgeMinutes: macro.ageMinutes,
    isDiscounted: confidence < 0.7,
  };
}

function regimeSignal(macro: MacroState): L1SignalBundle['regime'] {
  const gap = macro.mep.gap;
  const inflation = macro.inflation.expected30d;
  const carry = macro.rates.moneyMarket / 12 - macro.crawlingPeg;
  let regime: MacroRegimeX10;
  let value: number;
  let direction: TrendDirection = 'stable';
  let drivers: string[];

  if (gap > 50 || inflation > 6) {
    regime = 'CRISIS'; value = Math.max(gap / 80, inflation / 10); direction = 'accelerating';
    drivers = [`gap=${gap.toFixed(1)}%`, `IPC 30d=${inflation.toFixed(1)}%`];
  } else if (carry < 0.5 && gap > 20) {
    regime = 'GLOBAL_RISK_OFF'; value = (1 - carry) * 0.5 + gap / 100; direction = 'accelerating';
    drivers = [`net carry=${carry.toFixed(2)}%`, `gap=${gap.toFixed(1)}%`];
  } else if (gap > 25 || inflation > 3.5) {
    regime = 'WARNING'; value = Math.max(gap / 60, (inflation - 2) / 6); direction = gap > 30 ? 'accelerating' : 'stable';
    drivers = [`gap=${gap.toFixed(1)}%`, `IPC 30d=${inflation.toFixed(1)}%`];
  } else if (carry > 1 && gap < 15 && inflation < 3) {
    regime = 'CARRY_FAVORABLE'; value = carry / 3;
    drivers = [`net carry=${carry.toFixed(2)}%`, 'gap bajo', 'inflación baja'];
  } else {
    regime = 'CARRY_NEUTRAL'; value = 0.3 + Math.max(0, (3 - carry) / 5);
    drivers = [`net carry=${carry.toFixed(2)}%`];
  }

  const confidence = confidenceFrom(macro.provenance, { mepRate: 0.35, inflation: 0.25, rates: 0.25, crawlingPeg: 0.15 });
  return { regime, signal: signal(macro, value, direction, confidence, drivers) };
}

function inflationSignal(macro: MacroState): L1SignalBundle['inflation'] {
  const momentum = macro.inflation.expected30d - macro.inflation.monthly;
  const trend: TrendDirection = momentum > 0.5 ? 'accelerating' : momentum < -1 ? 'reversing' : momentum < -0.5 ? 'decelerating' : 'stable';
  const level = clamp01(macro.inflation.monthly / 8);
  const momentumStress = clamp01(Math.max(0, momentum) / 3);
  const cer = macro.cer.monthlyChange > 0 ? clamp01(macro.cer.monthlyChange / 6) : 0.5;
  const value = level * 0.5 + momentumStress * 0.3 + cer * 0.2;
  const confidence = confidenceFrom(macro.provenance, { inflation: 0.5, cer: 0.3, rates: 0.2 });
  return {
    trend,
    momentum: round(momentum),
    signal: signal(macro, value, trend, confidence, [`IPC=${macro.inflation.monthly.toFixed(1)}%`, `momentum=${momentum.toFixed(2)}pp`], macro.provenance.inflation.label),
  };
}

function carrySignal(macro: MacroState): L1SignalBundle['carry'] {
  const nominal = macro.rates.moneyMarket / 12 / 100;
  const inflation = macro.inflation.monthly / 100;
  const fisher = (1 + nominal) / (1 + inflation) - 1;
  const devaluation = macro.crawlingPeg / 100 + (macro.mep.gap > 30 ? macro.mep.gap / 100 / 12 : 0);
  const realSpread = ((1 + nominal) / (1 + devaluation) - 1) * 100;
  const value = clamp01(1 - realSpread / 3);
  const confidence = confidenceFrom(macro.provenance, { rates: 0.4, inflation: 0.3, mepRate: 0.2, crawlingPeg: 0.1 });
  return {
    realSpread: round(realSpread),
    fisherRate: round(fisher * 100, 2),
    isViable: realSpread > 0,
    signal: signal(macro, value, realSpread > 0 ? 'stable' : 'accelerating', confidence, [`real spread=${realSpread.toFixed(2)}%`, `gap=${macro.mep.gap.toFixed(1)}%`]),
  };
}

function volatilitySignal(macro: MacroState): L1SignalBundle['volatility'] {
  const fxVol = clamp01(macro.mep.gap / 60);
  const ratesVol = clamp01(Math.abs(macro.rates.bcraPolicy - macro.rates.moneyMarket) / 15);
  const inflationVol = clamp01((Math.abs(macro.inflation.expected30d - macro.inflation.expected90d / 3) + macro.inflation.monthly) / 10);
  const value = fxVol * 0.4 + ratesVol * 0.25 + inflationVol * 0.35;
  const regime: VolatilityRegime = value < 0.15 ? 'calm' : value < 0.35 ? 'normal' : value < 0.55 ? 'elevated' : value < 0.75 ? 'stressed' : 'crisis';
  const confidence = confidenceFrom(macro.provenance, { mepRate: 0.4, rates: 0.3, inflation: 0.3 });
  return {
    regime, fxVol: round(fxVol), ratesVol: round(ratesVol), inflationVol: round(inflationVol),
    signal: signal(macro, value, value > 0.5 ? 'accelerating' : 'stable', confidence, [`FX vol=${round(fxVol)}`, `rates vol=${round(ratesVol)}`, `inflation vol=${round(inflationVol)}`]),
  };
}

function liquiditySignal(macro: MacroState): L1SignalBundle['liquidity'] {
  const moneyMarketStress = clamp01(Math.abs(macro.rates.bcraPolicy - macro.rates.moneyMarket) / 10);
  const reservePressure = clamp01(clamp01(macro.crawlingPeg / 5) * 0.5 + clamp01(Math.max(0, macro.rates.moneyMarket - 5) / 40) * 0.5);
  const value = (moneyMarketStress + reservePressure) / 2;
  const condition: LiquidityCondition = value < 0.15 ? 'abundant' : value < 0.35 ? 'normal' : value < 0.55 ? 'tight' : value < 0.75 ? 'stressed' : 'frozen';
  const confidence = confidenceFrom(macro.provenance, { rates: 0.5, reserves: 0.3, crawlingPeg: 0.2 });
  return {
    condition, moneyMarketStress: round(moneyMarketStress), reservePressure: round(reservePressure),
    signal: signal(macro, value, value > 0.5 ? 'accelerating' : 'stable', confidence, [`money-market stress=${round(moneyMarketStress)}`, `reserve pressure=${round(reservePressure)}`]),
  };
}

export function computeX10ConfidenceMultiplier(confidence: number): number {
  if (confidence >= 0.7) return 1;
  if (confidence >= 0.5) return (confidence - 0.3) / 0.4;
  if (confidence >= 0.3) return (confidence - 0.2) / 1.5;
  return Math.max(0, confidence / 0.3 * 0.05);
}

export function isCapitalPreservationMode(bundle: L1SignalBundle): boolean {
  return bundle.allStale || bundle.aggregateConfidence < 0.25;
}

export function isEmergencyFreeze(bundle: L1SignalBundle): boolean {
  return bundle.hasError;
}

export function computeL1Signals(macro: MacroState): L1SignalBundle {
  const regime = regimeSignal(macro);
  const inflation = inflationSignal(macro);
  const carry = carrySignal(macro);
  const volatility = volatilitySignal(macro);
  const liquidity = liquiditySignal(macro);
  const aggregateConfidence = round(
    regime.signal.confidence * 0.3 +
    inflation.signal.confidence * 0.25 +
    carry.signal.confidence * 0.2 +
    volatility.signal.confidence * 0.15 +
    liquidity.signal.confidence * 0.1,
    2,
  );
  const provenance = Object.values(macro.provenance);
  const hasError = provenance.some((item) => item.label === 'ERROR');
  const relevant = provenance.filter((item) => !['ERROR', 'PARTIAL_FALLBACK', 'SIMULADO', 'RECONSTRUIDO'].includes(item.label));
  const allStale = !hasError && relevant.length > 0 && relevant.every((item) => item.label === 'STALE');
  return {
    regime, inflation, carry, volatility, liquidity,
    aggregateConfidence,
    hasError,
    allStale,
    timestamp: new Date().toISOString(),
    macroSource: macro.source,
    dataAgeMinutes: macro.ageMinutes,
  };
}
