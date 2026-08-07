// ============================================================================
// Ω-X10 BACKTESTING ENGINE — L0 Historical Replay Simulator
//
// DATA ORIGIN: TRAINING_MEMORY_ESTIMATE
// All historical snapshots in this module are LLM-constructed estimates,
// NOT observed data fetched from real APIs (BCRA, INDEC, Bluelytics).
// All derived metrics (regimeAccuracy, sharpe, drawdown) MUST be labeled [SIMULADO].
//
// PURPOSE:
//   This is the CRITICAL MISSING PIECE identified in the reality audit.
//   Without historical validation, the X10 engine is an unvalidated theory.
//   This engine replays historical macro states through the full L0→L3 pipeline
//   to evaluate how the system WOULD HAVE performed.
//
// KEY PRINCIPLES:
//   1. No look-ahead bias — signals use only data available at that point in time
//   2. No survivorship bias — include periods of crisis and stress
//   3. No overfitting — evaluate across multiple regime types
//   4. Results are probabilistic, not deterministic
//   5. Past performance does NOT guarantee future results
//
// OUTPUT:
//   - Per-period allocation decisions with regime classification
//   - Cumulative PnL with attribution (bucket + strategy + regime)
//   - Drawdown series and max drawdown
//   - Sharpe/Sortino ratios (if sufficient data)
//   - Regime transition accuracy
//   - Confidence calibration (predicted vs actual)
// ============================================================================

import {
  type MacroState,
  type DataLabel,
  type SantanderProduct,
  getProductsFromMacro,
} from './live-data';
import { recordSignalReturn } from './pnl-attribution';
import {
  type MacroRegimeX10,
  type L1SignalBundle,
  computeL1Signals,
} from './x10-signal-layer';
import {
  type StrategicMode,
  type L2StrategyOutput,
  type ScenarioBound,
  computeL2Strategy,
  STRATEGIC_MODES,
} from './x10-strategy-layer';
import { runX10Engine, type X10EngineOutput } from './x10-engine';

// Re-export StrategicMode for API routes
export type { StrategicMode };
import {
  type CapitalRegime,
  type BucketAllocationResult,
  computeBucketAllocations,
} from './capital-buckets';
import {
  type OracleState,
  computeOracle,
} from './macroOracle';

// ============================================================================
// HISTORICAL MACRO STATE ARCHIVE
// ============================================================================
// These are constructed macro states representing key periods in Argentina's
// recent financial history. Each is labeled with:
//   - The actual regime that occurred (ground truth)
//   - The macro conditions at that point
//   - What actually happened in the following 30 days
//
// IMPORTANT: These are model-constructed, not observed tick data.
// They represent the BEST AVAILABLE reconstruction for backtesting.
// ============================================================================

// BE-04: Constante explícita que deja claro el origen de los datos en todo el módulo
export const BACKTEST_DATA_ORIGIN = 'TRAINING_MEMORY_ESTIMATE' as const;
// Todos los snapshots históricos son estimaciones del LLM, no datos observados de APIs reales.

export interface HistoricalMacroState {
  /** Unique identifier for this historical period */
  id: string;
  /** Period label (human-readable) */
  label: string;
  /** Start date of the period */
  startDate: string;
  /** End date of the period */
  endDate: string;
  /** The macro state at the START of this period */
  macroState: MacroState;
  /** Ground truth: what regime actually occurred */
  actualRegime: CapitalRegime;
  /** Ground truth: what the portfolio return was (USD, monthly %) */
  actualReturnUSD: number;
  /** Ground truth: max drawdown during this period (USD, %) */
  actualMaxDrawdown: number;
  /** Key events during this period */
  events: string[];
  /** Data quality note */
  dataQuality: 'SIMULADO' | 'RECONSTRUIDO' | 'OBSERVED';
  /** BE-02: Explicit data origin label */
  dataLabel?: 'SIMULADO' | 'RECONSTRUIDO';
  /** BE-02: Reconstruction note for transparency */
  reconstructionNote?: string;
}

// ============================================================================
// HISTORICAL MACRO SCENARIOS — Argentina 2023-2026
// ============================================================================

function makeHistoricalMacro(
  overrides: Partial<MacroState> & Pick<MacroState, 'mep' | 'inflation' | 'rates' | 'cer' | 'source'>
): MacroState {
  const now = new Date().toISOString();
  return {
    lastUpdate: now,
    fetchedAt: now,
    ageMinutes: 0,
    lastSuccessfulFetch: null, // FIX MR-03: sin fetch real ejecutado
    crawlingPeg: 0,
    realDataPct: 0, // FIX MR-03: era 50, pero no hubo fetch real. 0 hasta integrar BCRA/INDEC histórico via API.
    provenance: {
      mepRate: { label: 'RECONSTRUIDO' as DataLabel, dataClass: 'RECONSTRUCTED', source: 'TRAINING_MEMORY_ESTIMATE — no API fetch', url: 'N/A', lastUpdate: now, dataDate: now.split('T')[0], stalenessHours: 999, fetchedAt: now, ageMinutes: 0, fetchError: false },
      inflation: { label: 'RECONSTRUIDO' as DataLabel, dataClass: 'RECONSTRUCTED', source: 'TRAINING_MEMORY_ESTIMATE — no API fetch', url: 'N/A', lastUpdate: now, dataDate: now.split('T')[0], stalenessHours: 999, fetchedAt: now, ageMinutes: 0, fetchError: false },
      rates: { label: 'RECONSTRUIDO' as DataLabel, dataClass: 'RECONSTRUCTED', source: 'TRAINING_MEMORY_ESTIMATE — no API fetch', url: 'N/A', lastUpdate: now, dataDate: now.split('T')[0], stalenessHours: 999, fetchedAt: now, ageMinutes: 0, fetchError: false },
      cer: { label: 'RECONSTRUIDO' as DataLabel, dataClass: 'RECONSTRUCTED', source: 'TRAINING_MEMORY_ESTIMATE — no API fetch', url: 'N/A', lastUpdate: now, dataDate: now.split('T')[0], stalenessHours: 999, fetchedAt: now, ageMinutes: 0, fetchError: false },
      crawlingPeg: { label: 'RECONSTRUIDO' as DataLabel, dataClass: 'RECONSTRUCTED', source: 'TRAINING_MEMORY_ESTIMATE — no API fetch', url: 'N/A', lastUpdate: now, dataDate: now.split('T')[0], stalenessHours: 999, fetchedAt: now, ageMinutes: 0, fetchError: false },
      reserves: { label: 'RECONSTRUIDO' as DataLabel, dataClass: 'RECONSTRUCTED', source: 'TRAINING_MEMORY_ESTIMATE — no API fetch', url: 'N/A', lastUpdate: now, dataDate: now.split('T')[0], stalenessHours: 999, fetchedAt: now, ageMinutes: 0, fetchError: false },
    },
    ...overrides,
  };
}

export const HISTORICAL_SCENARIOS: HistoricalMacroState[] = [
  // ─── PRE-ELECTION CRISIS (Aug 2023) ───
  {
    id: 'paso-2023-crisis',
    label: 'PASO Elections 2023 — Crisis cambiaria',
    startDate: '2023-08-01',
    endDate: '2023-09-15',
    macroState: makeHistoricalMacro({
      source: 'PARTIAL_FALLBACK',
      mep: { rate: 750, officialRate: 350, gap: 114, sell: 780, buy: 720 },
      inflation: { monthly: 12.4, expected30d: 15.0, expected90d: 45.0, yearly: 125.0 },
      rates: { bcraPolicy: 118, moneyMarket: 115, plazoFijo: 97, plazoFijoUVA: 5.5, lecaps: 120, badlar: 100, leliq: 118, tml: 98 },
      cer: { index: 340, monthlyChange: 12.0, dailyChange: 0.38 },
      crawlingPeg: 5.0,
      realDataPct: 0, // FIX: sin fetch real
    }),
    actualRegime: 'CRISIS',
    actualReturnUSD: -8.5,
    actualMaxDrawdown: 15.2,
    events: ['PASO elections shock', 'MEP gap widened to 120%+', 'Inflation spike', 'Capital controls tightened'],
    dataQuality: 'RECONSTRUIDO',
    dataLabel: 'RECONSTRUIDO',
    reconstructionNote: 'Escenario construido manualmente. No derivado de fetch real. Usar solo como referencia cualitativa.',
  },

  // ─── POST-ELECTION TRANSITION (Nov-Dec 2023) ───
  {
    id: 'milei-transition-2023',
    label: 'Transicion Milei — Shock ajuste',
    startDate: '2023-11-20',
    endDate: '2024-01-15',
    macroState: makeHistoricalMacro({
      source: 'PARTIAL_FALLBACK',
      mep: { rate: 1000, officialRate: 800, gap: 25, sell: 1020, buy: 980 },
      inflation: { monthly: 25.0, expected30d: 20.0, expected90d: 40.0, yearly: 280.0 },
      rates: { bcraPolicy: 133, moneyMarket: 130, plazoFijo: 110, plazoFijoUVA: 3.0, lecaps: 135, badlar: 120, leliq: 133, tml: 118 },
      cer: { index: 420, monthlyChange: 25.0, dailyChange: 0.75 },
      crawlingPeg: 2.0,
      realDataPct: 0, // FIX: sin fetch real
    }),
    actualRegime: 'HIGH_VOL',
    actualReturnUSD: -3.2,
    actualMaxDrawdown: 8.5,
    events: ['Devaluation 54% official rate', 'Inflation 25%+ monthly', 'Rate hikes to 133%', 'CER outperformed nominal'],
    dataQuality: 'RECONSTRUIDO',
    dataLabel: 'RECONSTRUIDO',
    reconstructionNote: 'Escenario construido manualmente. No derivado de fetch real. Usar solo como referencia cualitativa.',
  },

  // ─── STABILIZATION PHASE (Apr-May 2024) ───
  {
    id: 'stabilization-2024',
    label: 'Estabilizacion — Crawling peg + inflacion bajando',
    startDate: '2024-04-01',
    endDate: '2024-06-01',
    macroState: makeHistoricalMacro({
      source: 'PARTIAL_FALLBACK',
      mep: { rate: 1100, officialRate: 870, gap: 26, sell: 1110, buy: 1090 },
      inflation: { monthly: 8.8, expected30d: 6.0, expected90d: 12.0, yearly: 140.0 },
      rates: { bcraPolicy: 40, moneyMarket: 38, plazoFijo: 35, plazoFijoUVA: 3.5, lecaps: 42, badlar: 36, leliq: 40, tml: 34 },
      cer: { index: 530, monthlyChange: 8.5, dailyChange: 0.28 },
      crawlingPeg: 2.0,
      realDataPct: 0, // FIX: sin fetch real
    }),
    actualRegime: 'NORMAL',
    actualReturnUSD: 0.8,
    actualMaxDrawdown: 2.1,
    events: ['Crawling peg at 2%/month', 'Inflation declining from 25% to 4%', 'Carry trade viable', 'CER maintained purchasing power'],
    dataQuality: 'RECONSTRUIDO',
    dataLabel: 'RECONSTRUIDO',
    reconstructionNote: 'Escenario construido manualmente. No derivado de fetch real. Usar solo como referencia cualitativa.',
  },

  // ─── CARRY FAVORABLE (Oct-Nov 2024) ───
  {
    id: 'carry-favorable-2024',
    label: 'Carry favorable — Tasas altas, inflacion baja, gap estable',
    startDate: '2024-10-01',
    endDate: '2024-12-01',
    macroState: makeHistoricalMacro({
      source: 'PARTIAL_FALLBACK',
      mep: { rate: 1200, officialRate: 1010, gap: 19, sell: 1210, buy: 1190 },
      inflation: { monthly: 2.7, expected30d: 2.5, expected90d: 7.5, yearly: 55.0 },
      rates: { bcraPolicy: 32, moneyMarket: 30, plazoFijo: 28, plazoFijoUVA: 4.0, lecaps: 35, badlar: 29, leliq: 32, tml: 27 },
      cer: { index: 620, monthlyChange: 2.5, dailyChange: 0.08 },
      crawlingPeg: 1.0,
      realDataPct: 0, // FIX: sin fetch real
    }),
    actualRegime: 'CARRY_FAVORABLE',
    actualReturnUSD: 1.4,
    actualMaxDrawdown: 1.5,
    events: ['Strong ARS carry with declining inflation', 'MEP gap stable around 20%', 'CER + UVA outperformed nominal', 'Lecaps spread provided alpha'],
    dataQuality: 'RECONSTRUIDO',
    dataLabel: 'RECONSTRUIDO',
    reconstructionNote: 'Escenario construido manualmente. No derivado de fetch real. Usar solo como referencia cualitativa.',
  },

  // ─── BANDAS CAMBIARIAS ERA (Jan-Mar 2026) ───
  {
    id: 'bandas-2026-q1',
    label: 'Bandas cambiarias — Nueva era post-cesacion',
    startDate: '2026-01-01',
    endDate: '2026-03-31',
    macroState: makeHistoricalMacro({
      source: 'PARTIAL_FALLBACK',
      mep: { rate: 1445, officialRate: 1440, gap: 0.35, sell: 1450, buy: 1440 },
      inflation: { monthly: 2.5, expected30d: 2.3, expected90d: 6.9, yearly: 30.5 },
      rates: { bcraPolicy: 20, moneyMarket: 20, plazoFijo: 19, plazoFijoUVA: 4.5, lecaps: 25, badlar: 22, leliq: 20, tml: 20 },
      cer: { index: 786, monthlyChange: 2.2, dailyChange: 0.07 },
      crawlingPeg: 0.0,
      realDataPct: 0, // FIX: sin fetch real
    }),
    actualRegime: 'NORMAL',
    actualReturnUSD: 0.7,
    actualMaxDrawdown: 1.8,
    events: ['Bandas cambiarias implemented', 'No crawling peg', 'Inflation near 2.5%/month', 'Carry marginal with low rates'],
    dataQuality: 'SIMULADO',
    dataLabel: 'SIMULADO',
    reconstructionNote: 'Escenario hipotético construido manualmente. No derivado de fetch real. Usar solo como referencia cualitativa.',
  },

  // ─── STRESS TEST: SUDDEN DEVALUATION (Hypothetical) ───
  {
    id: 'stress-sudden-deval',
    label: 'Stress Test — Devaluacion sorpresa 30%',
    startDate: '2026-04-01',
    endDate: '2026-05-01',
    macroState: makeHistoricalMacro({
      source: 'ERROR',
      mep: { rate: 1878, officialRate: 1440, gap: 30.4, sell: 1900, buy: 1850 },
      inflation: { monthly: 8.0, expected30d: 10.0, expected90d: 25.0, yearly: 80.0 },
      rates: { bcraPolicy: 45, moneyMarket: 42, plazoFijo: 38, plazoFijoUVA: 5.0, lecaps: 48, badlar: 40, leliq: 45, tml: 38 },
      cer: { index: 830, monthlyChange: 7.5, dailyChange: 0.24 },
      crawlingPeg: 0.0,
      realDataPct: 0, // FIX: sin fetch real
    }),
    actualRegime: 'CRISIS',
    actualReturnUSD: -6.0,
    actualMaxDrawdown: 12.0,
    events: ['Sudden 30% devaluation within bandas', 'Inflation spike', 'Rate hike response', 'USD hedge critical'],
    dataQuality: 'SIMULADO',
    dataLabel: 'SIMULADO',
    reconstructionNote: 'Escenario de stress test hipotético. No derivado de fetch real. Usar solo como referencia cualitativa.',
  },

  // ─── STRESS TEST: PROLONGED RECESSION (Hypothetical) ───
  {
    id: 'stress-recession-6m',
    label: 'Stress Test — Recesion prolongada 6 meses',
    startDate: '2026-06-01',
    endDate: '2026-12-01',
    macroState: makeHistoricalMacro({
      source: 'ERROR',
      mep: { rate: 1500, officialRate: 1460, gap: 2.7, sell: 1510, buy: 1490 },
      inflation: { monthly: 1.8, expected30d: 1.5, expected90d: 4.5, yearly: 22.0 },
      rates: { bcraPolicy: 15, moneyMarket: 14, plazoFijo: 12, plazoFijoUVA: 3.0, lecaps: 18, badlar: 13, leliq: 15, tml: 12 },
      cer: { index: 810, monthlyChange: 1.6, dailyChange: 0.05 },
      crawlingPeg: 0.0,
      realDataPct: 0, //
    }),
    actualRegime: 'NORMAL',
    actualReturnUSD: 0.3,
    actualMaxDrawdown: 3.0,
    events: ['Low inflation, low rates', 'Minimal carry', 'Recession environment', 'Capital preservation critical'],
    dataQuality: 'SIMULADO',
    dataLabel: 'SIMULADO',
    reconstructionNote: 'Escenario de stress test hipotético. No derivado de fetch real. Usar solo como referencia cualitativa.',
  },

  // ─── STRESS TEST: INFLATION RESURGENCE ───
  {
    id: 'stress-inflation-return',
    label: 'Stress Test — Retorno inflacionario',
    startDate: '2026-07-01',
    endDate: '2026-09-01',
    macroState: makeHistoricalMacro({
      source: 'ERROR',
      mep: { rate: 1550, officialRate: 1450, gap: 6.9, sell: 1560, buy: 1540 },
      inflation: { monthly: 5.0, expected30d: 6.0, expected90d: 18.0, yearly: 60.0 },
      rates: { bcraPolicy: 30, moneyMarket: 28, plazoFijo: 25, plazoFijoUVA: 5.5, lecaps: 33, badlar: 26, leliq: 30, tml: 24 },
      cer: { index: 850, monthlyChange: 4.8, dailyChange: 0.16 },
      crawlingPeg: 0.5,
      realDataPct: 0, //
    }),
    actualRegime: 'HIGH_VOL',
    actualReturnUSD: -1.5,
    actualMaxDrawdown: 5.5,
    events: ['Inflation returns to 5%+', 'BCRA responds with rate hikes', 'CER outperforms nominal again', 'Carry becomes marginal'],
    dataQuality: 'SIMULADO',
    dataLabel: 'SIMULADO',
    reconstructionNote: 'Escenario de stress test hipotético. No derivado de fetch real. Usar solo como referencia cualitativa.',
  },
];

// ============================================================================
// BACKTEST RESULT TYPES
// ============================================================================

export interface BacktestPeriodResult {
  /** The historical scenario being tested */
  scenarioId: string;
  scenarioLabel: string;
  /** What regime the engine classified */
  predictedRegime: CapitalRegime;
  /** What regime actually occurred */
  actualRegime: CapitalRegime;
  /** Whether regime prediction was correct */
  regimeCorrect: boolean;
  /** Engine confidence score */
  confidenceScore: number;
  /** What the engine predicted as return */
  predictedReturn: number;
  /** What actually happened */
  actualReturn: number;
  /** Prediction error */
  returnError: number;
  /** Whether predicted return fell within scenario bounds */
  withinBounds: boolean;
  /** Capital preservation mode was activated */
  capitalPreservationActive: boolean;
  /** Emergency freeze was triggered */
  emergencyFreeze: boolean;
  /** X10 directives status */
  directives: X10EngineOutput['x10Directives'];
  /** Full allocation snapshot */
  allocations: { productId: string; weight: number; strategySource: string }[];
  /** Duration of computation in ms */
  computationMs: number;
}

export interface BacktestSummary {
  /** Total scenarios tested */
  totalScenarios: number;
  /** Period covered */
  periodStart: string;
  periodEnd: string;
  /** Regime prediction accuracy */
  regimeAccuracy: number; // 0-1
  /** BE-03: Label for regimeAccuracy — ALWAYS 'SIMULADO' for this engine */
  regimeAccuracyLabel: 'SIMULADO';
  /** BE-03: Note explaining the data origin of regimeAccuracy */
  regimeAccuracyNote: string;
  /** Regime confusion matrix */
  regimeConfusionMatrix: Record<string, Record<string, number>>;
  /** Return prediction accuracy */
  avgReturnError: number;
  /** Max return error */
  maxReturnError: number;
  /** % of periods where prediction was within bounds */
  withinBoundsRate: number;
  /** Average confidence when correct vs incorrect */
  avgConfidenceCorrect: number;
  avgConfidenceIncorrect: number;
  /** Capital preservation activation rate */
  capitalPreservationRate: number;
  /** Emergency freeze rate */
  emergencyFreezeRate: number;
  /** Simulated cumulative PnL */
  cumulativePnL: number;
  /** Simulated max drawdown */
  maxDrawdown: number;
  /** Simulated Sharpe estimate (if enough periods) */
  sharpeEstimate: number | null;
  /** Overall assessment */
  assessment: BacktestAssessment;
  /** Per-period results */
  periodResults: BacktestPeriodResult[];
  /** Timestamp */
  timestamp: string;
  /** Data quality disclaimer */
  disclaimer: string;
  /** BE-03: All metrics derived from snapshots sinteticos → label obligatorio */
  dataLabel: 'SIMULADO';
  /** BE-03: Explicit data origin */
  dataOrigin: 'TRAINING_MEMORY_ESTIMATE';
  /** BE-03: Whether real data has been integrated */
  realDataIntegrated: false;
}

export type BacktestAssessment =
  | 'VALIDATION_PASSED'      // System performs within expected bounds
  | 'VALIDATION_MARGINAL'    // System mostly works but with notable gaps
  | 'VALIDATION_FAILED'      // System has critical issues that need fixing
  | 'INSUFFICIENT_DATA';     // Not enough historical data to validate

// ============================================================================
// BACKTEST ENGINE — Run historical replay
// ============================================================================

export function runBacktest(
  mode: StrategicMode = 'MODERATE',
  initialCapitalUSD: number = 2000,
  scenarios: HistoricalMacroState[] = HISTORICAL_SCENARIOS,
): BacktestSummary {
  const timestamp = new Date().toISOString();
  const periodResults: BacktestPeriodResult[] = [];

  for (const scenario of scenarios) {
    const startTime = Date.now();

    // Run the FULL X10 pipeline on the historical macro state
    const engineOutput = runX10Engine(
      scenario.macroState,
      mode,
      initialCapitalUSD,
    );

    // Also compute capital bucket allocations for regime comparison
    const oracle = computeOracle(scenario.macroState);
    const bucketResult = computeBucketAllocations(
      scenario.macroState,
      oracle,
      initialCapitalUSD,
    );

    const predictedRegime = bucketResult.regime.regime;
    const actualRegime = scenario.actualRegime;
    const regimeCorrect = predictedRegime === actualRegime;

    // Compare predicted return vs actual
    const predictedReturn = engineOutput.risk_metrics.expectedReturn30d;
    const actualReturn = scenario.actualReturnUSD;
    const returnError = Math.abs(predictedReturn - actualReturn);

    // Check if actual return fell within scenario bounds
    const withinBounds = actualReturn >= engineOutput.scenario_downside.returnMin &&
      actualReturn <= engineOutput.scenario_upside.returnMax;

    const computationMs = Date.now() - startTime;

    periodResults.push({
      scenarioId: scenario.id,
      scenarioLabel: scenario.label,
      predictedRegime,
      actualRegime,
      regimeCorrect,
      confidenceScore: engineOutput.confidence_score,
      predictedReturn: Math.round(predictedReturn * 100) / 100,
      actualReturn: Math.round(actualReturn * 100) / 100,
      returnError: Math.round(returnError * 100) / 100,
      withinBounds,
      capitalPreservationActive: engineOutput.x10Directives.capitalPreservationFallback.active,
      emergencyFreeze: engineOutput.x10Directives.emergencyFreeze.active,
      directives: engineOutput.x10Directives,
      allocations: engineOutput.portfolio_allocation.map(a => ({
        productId: a.productId,
        weight: a.weight,
        strategySource: a.strategySource,
      })),
      computationMs,
    });

    // ATTRIBUTION PIPELINE: Record signal-return pairs for each backtest period
    recordSignalReturn('regime', engineOutput.confidence_score, actualReturn);
    recordSignalReturn('inflation', scenario.macroState.inflation.expected30d / 10, actualReturn);
    recordSignalReturn('carry', ((1 + scenario.macroState.rates.moneyMarket / 12) / (1 + scenario.macroState.inflation.monthly / 100)) - 1, actualReturn);
    recordSignalReturn('volatility', scenario.macroState.mep.gap / 80, actualReturn);
    recordSignalReturn('liquidity', scenario.macroState.rates.bcraPolicy / 50, actualReturn);
  }

  // ─── Compute summary statistics ───

  const totalScenarios = periodResults.length;
  const regimeCorrectCount = periodResults.filter(r => r.regimeCorrect).length;
  const regimeAccuracy = totalScenarios > 0 ? regimeCorrectCount / totalScenarios : 0;

  // Regime confusion matrix
  const regimeConfusionMatrix: Record<string, Record<string, number>> = {};
  for (const result of periodResults) {
    if (!regimeConfusionMatrix[result.actualRegime]) {
      regimeConfusionMatrix[result.actualRegime] = {};
    }
    regimeConfusionMatrix[result.actualRegime][result.predictedRegime] =
      (regimeConfusionMatrix[result.actualRegime][result.predictedRegime] || 0) + 1;
  }

  // Return prediction statistics
  const returnErrors = periodResults.map(r => r.returnError);
  const avgReturnError = returnErrors.length > 0
    ? returnErrors.reduce((s, e) => s + e, 0) / returnErrors.length
    : 0;
  const maxReturnError = returnErrors.length > 0 ? Math.max(...returnErrors) : 0;

  // Within bounds rate
  const withinBoundsCount = periodResults.filter(r => r.withinBounds).length;
  const withinBoundsRate = totalScenarios > 0 ? withinBoundsCount / totalScenarios : 0;

  // Confidence analysis
  const correctResults = periodResults.filter(r => r.regimeCorrect);
  const incorrectResults = periodResults.filter(r => !r.regimeCorrect);
  const avgConfidenceCorrect = correctResults.length > 0
    ? correctResults.reduce((s, r) => s + r.confidenceScore, 0) / correctResults.length
    : 0;
  const avgConfidenceIncorrect = incorrectResults.length > 0
    ? incorrectResults.reduce((s, r) => s + r.confidenceScore, 0) / incorrectResults.length
    : 0;

  // Capital preservation / freeze rates
  const capitalPreservationRate = totalScenarios > 0
    ? periodResults.filter(r => r.capitalPreservationActive).length / totalScenarios
    : 0;
  const emergencyFreezeRate = totalScenarios > 0
    ? periodResults.filter(r => r.emergencyFreeze).length / totalScenarios
    : 0;

  // Simulated cumulative PnL
  const returns = periodResults.map(r => r.actualReturn);
  let cumulativePnL = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const ret of returns) {
    cumulativePnL += ret;
    peak = Math.max(peak, cumulativePnL);
    const drawdown = peak - cumulativePnL;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
  }

  // Sharpe estimate (if we have enough data points)
  let sharpeEstimate: number | null = null;
  if (returns.length >= 6) {
    const meanReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + Math.pow(r - meanReturn, 2), 0) / (returns.length - 1);
    const stdDev = Math.sqrt(variance);
    if (stdDev > 0) {
      sharpeEstimate = Math.round((meanReturn / stdDev) * 100) / 100;
    }
  }

  // Assessment
  let assessment: BacktestAssessment;
  if (totalScenarios < 6) {
    assessment = 'INSUFFICIENT_DATA';
  } else if (regimeAccuracy >= 0.7 && withinBoundsRate >= 0.6 && maxDrawdown <= 12) {
    assessment = 'VALIDATION_PASSED';
  } else if (regimeAccuracy >= 0.5 && withinBoundsRate >= 0.4) {
    assessment = 'VALIDATION_MARGINAL';
  } else {
    assessment = 'VALIDATION_FAILED';
  }

  // Period covered
  const periodStart = scenarios.length > 0 ? scenarios[0].startDate : '';
  const periodEnd = scenarios.length > 0 ? scenarios[scenarios.length - 1].endDate : '';

  return {
    totalScenarios,
    periodStart,
    periodEnd,
    regimeAccuracy: Math.round(regimeAccuracy * 100) / 100,
    regimeAccuracyLabel: 'SIMULADO' as const,
    regimeAccuracyNote: 'Calculado contra snapshots sintéticos (TRAINING_MEMORY_ESTIMATE). No válido como métrica de confianza real hasta integrar serie histórica de APIs (BCRA/INDEC/Bluelytics).',
    regimeConfusionMatrix,
    avgReturnError: Math.round(avgReturnError * 100) / 100,
    maxReturnError: Math.round(maxReturnError * 100) / 100,
    withinBoundsRate: Math.round(withinBoundsRate * 100) / 100,
    avgConfidenceCorrect: Math.round(avgConfidenceCorrect * 100) / 100,
    avgConfidenceIncorrect: Math.round(avgConfidenceIncorrect * 100) / 100,
    capitalPreservationRate: Math.round(capitalPreservationRate * 100) / 100,
    emergencyFreezeRate: Math.round(emergencyFreezeRate * 100) / 100,
    cumulativePnL: Math.round(cumulativePnL * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    sharpeEstimate,
    assessment,
    periodResults,
    timestamp,
    disclaimer: 'BACKTEST RESULTS ARE HYPOTHETICAL. Historical macro states are model-constructed, not observed tick data. Past performance does not guarantee future results. This is a validation tool, not a prediction engine.',
    dataLabel: 'SIMULADO' as const,
    dataOrigin: BACKTEST_DATA_ORIGIN,
    realDataIntegrated: false as const,
  };
}

// ============================================================================
// REGIME PREDICTION CALIBRATION
// ============================================================================

export interface CalibrationResult {
  /** For each confidence bucket, what % of predictions were correct */
  calibrationBuckets: {
    confidenceRange: string;
    totalPredictions: number;
    correctPredictions: number;
    accuracy: number;
  }[];
  /** Is the system overconfident or underconfident? */
  bias: 'OVERCONFIDENT' | 'UNDERCONFIDENT' | 'WELL_CALIBRATED';
  /** Correlation between confidence and accuracy */
  correlation: number;
}

export function computeCalibration(backtestResults: BacktestPeriodResult[]): CalibrationResult {
  // Bucket predictions by confidence ranges
  const buckets = [
    { range: '0-0.3', min: 0, max: 0.3 },
    { range: '0.3-0.5', min: 0.3, max: 0.5 },
    { range: '0.5-0.7', min: 0.5, max: 0.7 },
    { range: '0.7-0.85', min: 0.7, max: 0.85 },
    { range: '0.85-1.0', min: 0.85, max: 1.0 },
  ];

  const calibrationBuckets = buckets.map(bucket => {
    const inBucket = backtestResults.filter(r =>
      r.confidenceScore >= bucket.min && r.confidenceScore < bucket.max
    );
    const correct = inBucket.filter(r => r.regimeCorrect).length;
    return {
      confidenceRange: bucket.range,
      totalPredictions: inBucket.length,
      correctPredictions: correct,
      accuracy: inBucket.length > 0 ? correct / inBucket.length : 0,
    };
  });

  // Determine bias
  const highConfResults = backtestResults.filter(r => r.confidenceScore >= 0.7);
  const highConfAccuracy = highConfResults.length > 0
    ? highConfResults.filter(r => r.regimeCorrect).length / highConfResults.length
    : 0;

  let bias: CalibrationResult['bias'];
  if (highConfAccuracy >= 0.6) {
    bias = 'WELL_CALIBRATED';
  } else if (highConfAccuracy < 0.4 && highConfResults.length > 2) {
    bias = 'OVERCONFIDENT';
  } else {
    bias = 'UNDERCONFIDENT';
  }

  // Simple correlation between confidence and correctness
  const n = backtestResults.length;
  if (n < 3) {
    return { calibrationBuckets, bias, correlation: 0 };
  }

  const meanConf = backtestResults.reduce((s, r) => s + r.confidenceScore, 0) / n;
  const meanCorrect = backtestResults.filter(r => r.regimeCorrect).length / n;

  let num = 0, den1 = 0, den2 = 0;
  for (const r of backtestResults) {
    const confDiff = r.confidenceScore - meanConf;
    const correctDiff = (r.regimeCorrect ? 1 : 0) - meanCorrect;
    num += confDiff * correctDiff;
    den1 += confDiff * confDiff;
    den2 += correctDiff * correctDiff;
  }

  const correlation = (den1 > 0 && den2 > 0) ? num / Math.sqrt(den1 * den2) : 0;

  return {
    calibrationBuckets,
    bias,
    correlation: Math.round(correlation * 100) / 100,
  };
}
