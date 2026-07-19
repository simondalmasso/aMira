// ============================================================================
// MACRO ORACLE ENGINE — Mapa Climático Económico
// Determina régimen macro, probabilidad de devaluación, confianza
// Usa datos live Bluelytics + proxies derivados
// ============================================================================

import { type DataLabel, type MacroState } from './live-data';

// ============================================================================
// TYPES
// ============================================================================
export type MacroRegime = 'CARRY' | 'CARRY_FAVORABLE' | 'NORMAL' | 'WARNING' | 'HIGH_VOL' | 'CRISIS' | 'GLOBAL_RISK_OFF';

export interface OracleState {
  regime: MacroRegime;
  devaluationProbability: number;     // 0–100
  devaluationRiskBand: 'stable' | 'caution' | 'high' | 'crisis';
  confidenceScore: number;            // 0–100
  fxMomentum: number;                 // 0–100 normalized
  inflationAcceleration: number;      // 0–100 normalized
  reservePressure: number;            // 0–100 normalized (proxy)
  rateGapUSD: number;                 // 0–100 normalized
  timestamp: string;
  source: DataLabel;
  signals: OracleSignal[];
  dataQualityPct: number;       // % of oracle inputs from real data (0-100)
}

export interface OracleSignal {
  name: string;
  value: number;
  weight: number;
  contribution: number;
  direction: 'alcista' | 'bajista' | 'neutral';
}

// ============================================================================
// PROJECTION TYPES
// ============================================================================
export type RiskAppetite = 'CONSERVADOR' | 'BALANCEADO' | 'AGRESIVO_CONTROLADO';
export type ReturnTargetMode = 'CONSERVACION' | 'CRECIMIENTO_MODERADO' | 'CRECIMIENTO_AGRESIVO';

export interface ProjectionScenario {
  id: string;
  name: string;
  probability: number;
  returnRange30d: { min: number; max: number };
  returnRange60d: { min: number; max: number };
  returnRange90d: { min: number; max: number };
  usdRange30d: { min: number; max: number };
  usdRange60d: { min: number; max: number };
  usdRange90d: { min: number; max: number };
  label: 'OBSERVADO' | 'REAL' | 'PARTIAL_FALLBACK' | 'ERROR' | 'STALE' | 'ERROR' | 'PROYECCIÓN';
}

export interface ProjectionOutput {
  scenarios: ProjectionScenario[];
  baseReturn30d: number;
  baseReturn60d: number;
  baseReturn90d: number;
  riskAppetite: RiskAppetite;
  returnTarget: ReturnTargetMode;
  targetMonthlyMin: number;
  targetMonthlyMax: number;
  timestamp: string;
}

// ============================================================================
// RETURN TARGETS — Objetivos de retorno por modo
// ============================================================================
export const RETURN_TARGETS: Record<ReturnTargetMode, { monthlyMin: number; monthlyMax: number; label: string }> = {
  CONSERVACION: { monthlyMin: 0.0, monthlyMax: 0.3, label: 'Conservación' },
  CRECIMIENTO_MODERADO: { monthlyMin: 0.3, monthlyMax: 1.2, label: 'Crecimiento moderado' },
  CRECIMIENTO_AGRESIVO: { monthlyMin: 0.8, monthlyMax: 2.5, label: 'Crecimiento agresivo' },
};
export const REGIME_LABELS: Record<MacroRegime, string> = {
  CARRY: 'Régimen de tasa alta',
  CARRY_FAVORABLE: 'Carry favorable',
  NORMAL: 'Régimen normal',
  WARNING: 'Zona de alerta',
  HIGH_VOL: 'Alta volatilidad',
  CRISIS: 'Crisis / Devaluación',
  GLOBAL_RISK_OFF: 'Estrés global',
};

export const REGIME_ICONS: Record<MacroRegime, string> = {
  CARRY: '🟢',
  CARRY_FAVORABLE: '💚',
  NORMAL: '⚪',
  WARNING: '🟡',
  HIGH_VOL: '🟠',
  CRISIS: '🔴',
  GLOBAL_RISK_OFF: '🔵',
};

export const REGIME_COLORS: Record<MacroRegime, { accent: string; bg: string; border: string }> = {
  CARRY: { accent: '#16a34a', bg: 'rgba(22,163,74,0.06)', border: 'rgba(22,163,74,0.2)' },
  CARRY_FAVORABLE: { accent: '#059669', bg: 'rgba(5,150,105,0.06)', border: 'rgba(5,150,105,0.2)' },
  NORMAL: { accent: '#6b7280', bg: 'rgba(107,114,128,0.06)', border: 'rgba(107,114,128,0.2)' },
  WARNING: { accent: '#ca8a04', bg: 'rgba(202,138,4,0.06)', border: 'rgba(202,138,4,0.2)' },
  HIGH_VOL: { accent: '#ea580c', bg: 'rgba(234,88,12,0.06)', border: 'rgba(234,88,12,0.2)' },
  CRISIS: { accent: '#dc2626', bg: 'rgba(220,38,38,0.06)', border: 'rgba(220,38,38,0.2)' },
  GLOBAL_RISK_OFF: { accent: '#2563eb', bg: 'rgba(37,99,235,0.06)', border: 'rgba(37,99,235,0.2)' },
};

// ============================================================================
// MACRO ORACLE — Compute regime + devaluation probability
// ============================================================================
export function computeOracle(macro: MacroState): OracleState {
  // ─── 1. MOMENTO TC (0–100) ───
  // Mayor brecha MEP = más presión cambiaria = mayor momentum hacia devaluación
  const gap = macro.mep.gap;
  const fxMomentum = clamp01(gap / 60) * 100;

  // ─── 2. ACELERACIÓN INFLACIONARIA (0–100) ───
  // Comparar inflación esperada 30d vs baseline estable de 2%/mes
  const inflBaseline = 2.0;
  const inflationAccel = clamp01((macro.inflation.expected30d - inflBaseline) / 8) * 100;

  // ─── 3. PRESIÓN RESERVAS (0–100) ───
  // Proxy: spread tasa BCRA vs money market + velocidad crawling peg
  const rateSpread = Math.abs(macro.rates.bcraPolicy - macro.rates.moneyMarket);
  const crawlingIntensity = clamp01(macro.crawlingPeg / 5) * 100;
  const reservePressure = clamp01((rateSpread * 5 + crawlingIntensity) / 150) * 100;

  // ─── 4. BRECHA TASAS USD (0–100) ───
  // Gap entre tasas ARS y tasa "USD-neutral" (aprox 5% para activos USD)
  const usdNeutralRate = 5.0;
  const rateGapRaw = macro.rates.moneyMarket - usdNeutralRate;
  const rateGapUSD = clamp01(rateGapRaw / 40) * 100;

  // ─── SCORE DEVALUACIÓN ───
  const devalScore =
    (fxMomentum * 0.35) +
    (inflationAccel * 0.25) +
    (reservePressure * 0.20) +
    (rateGapUSD * 0.20);

  const devaluationProbability = clamp01(devalScore / 100) * 100;

  // ─── BANDA DE RIESGO ───
  const devaluationRiskBand = devaluationProbability < 25 ? 'stable'
    : devaluationProbability < 50 ? 'caution'
    : devaluationProbability < 75 ? 'high'
    : 'crisis';

  // ─── DETERMINACIÓN DE RÉGIMEN ───
  const regime = determineRegime(macro, devaluationProbability);

  // ─── CONFIANZA ───
  const signalAgreement = computeSignalAgreement(fxMomentum, inflationAccel, reservePressure, rateGapUSD);
  // Data quality: factor in actual real data percentage from provenance
  const realPct = 'realDataPct' in macro ? (macro as { realDataPct: number }).realDataPct : 0;
  const dataQuality = macro.source === 'OBSERVADO'
    ? 95
    : macro.source === 'REAL'
    ? Math.min(90, 40 + realPct * 0.55)
    : macro.source === 'STALE' ? 25
    : macro.source === 'ERROR' ? 10
    : 40;
  const confidenceScore = Math.round(signalAgreement * 0.6 + dataQuality * 0.4);

  // ─── SEÑALES INDIVIDUALES ───
  const signals: OracleSignal[] = [
    {
      name: 'Tipo de cambio',
      value: fxMomentum,
      weight: 0.35,
      contribution: fxMomentum * 0.35,
      direction: fxMomentum > 50 ? 'bajista' : fxMomentum > 25 ? 'neutral' : 'alcista',
    },
    {
      name: 'Inflación',
      value: inflationAccel,
      weight: 0.25,
      contribution: inflationAccel * 0.25,
      direction: inflationAccel > 50 ? 'bajista' : inflationAccel > 25 ? 'neutral' : 'alcista',
    },
    {
      name: 'Reservas',
      value: reservePressure,
      weight: 0.20,
      contribution: reservePressure * 0.20,
      direction: reservePressure > 50 ? 'bajista' : reservePressure > 25 ? 'neutral' : 'alcista',
    },
    {
      name: 'Tasas',
      value: rateGapUSD,
      weight: 0.20,
      contribution: rateGapUSD * 0.20,
      direction: rateGapUSD > 70 ? 'bajista' : rateGapUSD > 40 ? 'neutral' : 'alcista',
    },
  ];

  return {
    regime,
    devaluationProbability: Math.round(devaluationProbability * 10) / 10,
    devaluationRiskBand,
    confidenceScore,
    fxMomentum: Math.round(fxMomentum * 10) / 10,
    inflationAcceleration: Math.round(inflationAccel * 10) / 10,
    reservePressure: Math.round(reservePressure * 10) / 10,
    rateGapUSD: Math.round(rateGapUSD * 10) / 10,
    timestamp: new Date().toISOString(),
    source: macro.source,
    signals,
    dataQualityPct: Math.round(dataQuality),
  };
}

// ============================================================================
// PROJECTION ENGINE — 30d/60d/90d con escenarios
// ============================================================================
export function computeProjections(
  oracle: OracleState,
  metrics: { expectedRealReturn30d: number; expectedRealReturn90d: number; volatility30d: number } | null,
  totalUSD: number,
  riskAppetite: RiskAppetite,
  returnTarget: ReturnTargetMode,
  macroSource: DataLabel
): ProjectionOutput {
  const base30d = metrics?.expectedRealReturn30d ?? 0;
  const base90d = metrics?.expectedRealReturn90d ?? 0;
  const vol = metrics?.volatility30d ?? 1.5;

  // Extrapolate 60d as geometric mean of 30d and 90d
  const base60d = base30d !== 0 && base90d !== 0
    ? ((1 + base30d / 100) * (1 + base90d / 100)) ** 0.5 * 100 - 100
    : (base30d + base90d) / 2;

  // Risk appetite adjustment: affects width of projection ranges
  const riskMultiplier = riskAppetite === 'CONSERVADOR' ? 0.6
    : riskAppetite === 'BALANCEADO' ? 1.0
    : 1.5;

  // Regime-based scenario adjustments
  const regime = oracle.regime;

  // BASE scenario — continuation of current conditions
  const baseScenario: ProjectionScenario = {
    id: 'base',
    name: 'Base',
    probability: regime === 'CARRY' ? 0.50 : regime === 'WARNING' ? 0.35 : 0.20,
    returnRange30d: { min: base30d - vol * riskMultiplier, max: base30d + vol * riskMultiplier * 0.5 },
    returnRange60d: { min: base60d - vol * 1.5 * riskMultiplier, max: base60d + vol * riskMultiplier },
    returnRange90d: { min: base90d - vol * 2 * riskMultiplier, max: base90d + vol * 1.5 * riskMultiplier },
    usdRange30d: { min: totalUSD * (1 + (base30d - vol * riskMultiplier) / 100), max: totalUSD * (1 + (base30d + vol * riskMultiplier * 0.5) / 100) },
    usdRange60d: { min: totalUSD * (1 + (base60d - vol * 1.5 * riskMultiplier) / 100), max: totalUSD * (1 + (base60d + vol * riskMultiplier) / 100) },
    usdRange90d: { min: totalUSD * (1 + (base90d - vol * 2 * riskMultiplier) / 100), max: totalUSD * (1 + (base90d + vol * 1.5 * riskMultiplier) / 100) },
    label: 'PARTIAL_FALLBACK',
  };

  // CARRY ESTABLE scenario — favorable carry continues
  const carryScenario: ProjectionScenario = {
    id: 'carry-estable',
    name: 'Carry estable',
    probability: regime === 'CARRY' ? 0.30 : 0.15,
    returnRange30d: { min: base30d + 0.1, max: base30d + vol * 1.2 },
    returnRange60d: { min: base60d + 0.2, max: base60d + vol * 1.8 },
    returnRange90d: { min: base90d + 0.3, max: base90d + vol * 2.5 },
    usdRange30d: { min: totalUSD * (1 + (base30d + 0.1) / 100), max: totalUSD * (1 + (base30d + vol * 1.2) / 100) },
    usdRange60d: { min: totalUSD * (1 + (base60d + 0.2) / 100), max: totalUSD * (1 + (base60d + vol * 1.8) / 100) },
    usdRange90d: { min: totalUSD * (1 + (base90d + 0.3) / 100), max: totalUSD * (1 + (base90d + vol * 2.5) / 100) },
  label: 'PROYECCIÓN',
  };

  // ESTRÉS FX scenario — moderate devaluation
  const fxStressScenario: ProjectionScenario = {
    id: 'estres-fx',
    name: 'Estrés cambiario',
    probability: regime === 'CRISIS' ? 0.40 : regime === 'WARNING' ? 0.30 : 0.15,
    returnRange30d: { min: base30d - vol * 3 * riskMultiplier, max: base30d - vol * riskMultiplier },
    returnRange60d: { min: base30d - vol * 5 * riskMultiplier, max: base30d - vol * 2 * riskMultiplier },
    returnRange90d: { min: base90d - vol * 7 * riskMultiplier, max: base90d - vol * 3 * riskMultiplier },
    usdRange30d: { min: totalUSD * (1 + (base30d - vol * 3 * riskMultiplier) / 100), max: totalUSD * (1 + (base30d - vol * riskMultiplier) / 100) },
    usdRange60d: { min: totalUSD * (1 + (base30d - vol * 5 * riskMultiplier) / 100), max: totalUSD * (1 + (base30d - vol * 2 * riskMultiplier) / 100) },
    usdRange90d: { min: totalUSD * (1 + (base90d - vol * 7 * riskMultiplier) / 100), max: totalUSD * (1 + (base90d - vol * 3 * riskMultiplier) / 100) },
  label: 'PROYECCIÓN',
  };

  // CRISIS scenario — severe devaluation
  const crisisScenario: ProjectionScenario = {
    id: 'crisis',
    name: 'Crisis cambiaria',
    probability: regime === 'CRISIS' ? 0.25 : regime === 'WARNING' ? 0.15 : 0.05,
    returnRange30d: { min: -8 * riskMultiplier, max: -2 * riskMultiplier },
    returnRange60d: { min: -12 * riskMultiplier, max: -3 * riskMultiplier },
    returnRange90d: { min: -15 * riskMultiplier, max: -4 * riskMultiplier },
    usdRange30d: { min: totalUSD * (1 - 8 * riskMultiplier / 100), max: totalUSD * (1 - 2 * riskMultiplier / 100) },
    usdRange60d: { min: totalUSD * (1 - 12 * riskMultiplier / 100), max: totalUSD * (1 - 3 * riskMultiplier / 100) },
    usdRange90d: { min: totalUSD * (1 - 15 * riskMultiplier / 100), max: totalUSD * (1 - 4 * riskMultiplier / 100) },
  label: 'PROYECCIÓN',
  };

  // RIESGO GLOBAL scenario — USD strength, EM outflow
  const globalRiskScenario: ProjectionScenario = {
    id: 'riesgo-global',
    name: 'Riesgo global',
    probability: regime === 'GLOBAL_RISK_OFF' ? 0.35 : 0.10,
    returnRange30d: { min: base30d - vol * 2 * riskMultiplier, max: base30d * 0.5 },
    returnRange60d: { min: base60d - vol * 3.5 * riskMultiplier, max: base60d * 0.4 },
    returnRange90d: { min: base90d - vol * 5 * riskMultiplier, max: base90d * 0.3 },
    usdRange30d: { min: totalUSD * (1 + (base30d - vol * 2 * riskMultiplier) / 100), max: totalUSD * (1 + base30d * 0.5 / 100) },
    usdRange60d: { min: totalUSD * (1 + (base60d - vol * 3.5 * riskMultiplier) / 100), max: totalUSD * (1 + base60d * 0.4 / 100) },
    usdRange90d: { min: totalUSD * (1 + (base90d - vol * 5 * riskMultiplier) / 100), max: totalUSD * (1 + base90d * 0.3 / 100) },
  label: 'PROYECCIÓN',
  };

  // Mark base scenario with REAL if data source is live
  if (macroSource === 'OBSERVADO') {
    baseScenario.label = 'OBSERVADO';
  } else if (macroSource === 'REAL') {
    baseScenario.label = 'REAL';
  } else if (macroSource === 'STALE') {
    baseScenario.label = 'STALE';
  } else if (macroSource === 'ERROR') {
    baseScenario.label = 'ERROR';
  }

  return {
    scenarios: [baseScenario, carryScenario, fxStressScenario, crisisScenario, globalRiskScenario],
    baseReturn30d: base30d,
    baseReturn60d: Math.round(base60d * 100) / 100,
    baseReturn90d: base90d,
    riskAppetite,
    returnTarget,
    targetMonthlyMin: RETURN_TARGETS[returnTarget].monthlyMin,
    targetMonthlyMax: RETURN_TARGETS[returnTarget].monthlyMax,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// REGIME DETERMINATION
// ============================================================================
function determineRegime(macro: MacroState, devalProb: number): MacroRegime {
  const gap = macro.mep.gap;
  const inflation = macro.inflation.expected30d;
  const carry = macro.rates.moneyMarket / 12 - macro.crawlingPeg;

  // ─── CRISIS RECALL BOOST ───
  // If volatility spike + FX gap, CRISIS probability floor +0.25
  const volSpike = gap > 30;
  const fxGap = gap > 25;
  const crisisRecallBoost = (volSpike && fxGap) ? 0.25 : 0;
  const adjDevalProb = Math.min(100, devalProb + crisisRecallBoost * 100);

  // ─── HARD RULES ───
  if (macro.source === 'ERROR') return 'CRISIS';
  if (macro.source === 'PARTIAL_FALLBACK' && adjDevalProb > 50) return 'CRISIS';
  if (adjDevalProb >= 60 || gap > 50 || inflation > 6) return 'CRISIS';

  // HIGH_VOL: Alta volatilidad sin llegar a crisis
  if ((adjDevalProb >= 45 && adjDevalProb < 60) || (gap > 35 && gap <= 50) || (inflation > 4.5 && inflation <= 6)) return 'HIGH_VOL';

  // WARNING: Probabilidad moderada de devaluación
  if (adjDevalProb >= 30 || gap > 25 || inflation > 3.5) return 'WARNING';

  // ─── LOWERED CARRY PRIORITY ───
  // Before: carry > 1.0 triggered CARRY_FAVORABLE too easily
  // Now: require carry > 1.5 AND gap < 12 AND inflation < 2.5
  if (carry > 1.5 && gap < 12 && inflation < 2.5) return 'CARRY_FAVORABLE';

  // NORMAL: baseline state (statistically dominant)
  if (carry > 0 && gap < 20 && inflation < 3.5) return 'NORMAL';

  // ─── ENTROPY CHECK ───
  // If all signals are flat, force NORMAL
  const signalSum = adjDevalProb + gap;
  if (signalSum < 10) return 'NORMAL';

  return 'CARRY';
}

// ============================================================================
// SIGNAL AGREEMENT — Cuánto concuerdan las señales
// ============================================================================
function computeSignalAgreement(
  fx: number,
  infl: number,
  reserve: number,
  rateGap: number
): number {
  const values = [fx, infl, reserve, rateGap];
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
  const maxVariance = 2500; // 50^2
  return Math.round(Math.max(0, 100 - (variance / maxVariance) * 100));
}

// ============================================================================
// HELPERS
// ============================================================================
function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
