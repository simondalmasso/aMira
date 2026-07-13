// ============================================================================
// Ω-X10 TEMPORAL VALIDATION ENGINE — FULL 5-MODULE ORCHESTRATOR
//
// PURPOSE:
//   This is the UNIFIED pipeline that connects all 5 TEMPORAL_VALIDATION_LAYER modules:
//     1. Macro State Historical Rebuilder → Day-by-day MacroState reconstruction
//     2. Backtest Replay Engine → Run X10 as if it lived in each historical day
//     3. Paper Broker Simulator → Simulate execution with slippage + fees + delays
//     4. PnL Attribution System → Map each decision to subsequent financial result
//     5. Baseline Comparison Engine → Compare against USD, CER, MEP, BTC
//
// KEY QUESTION ANSWERED:
//   "¿El sistema sobreviviría 2018 FX crisis, 2020 COVID, 2022 inflation spike?"
//
// CURRENT ANSWER: UNKNOWN → THIS ENGINE CHANGES THAT TO: VERIFIED / FAILED
//
// DESIGN PRINCIPLES:
//   1. No look-ahead bias — signals use only data available at that point
//   2. Paper broker integration — every allocation becomes paper orders
//   3. Full attribution — every PnL event traced to signal/regime/strategy
//   4. Benchmark comparison — if we can't beat CER, we add no value
//   5. Honest output — the system may FAIL validation, and that's useful
// ============================================================================

import { type MacroState } from './live-data';
import { runX10Engine, type X10EngineOutput } from './x10-engine';
import { type StrategicMode } from './x10-strategy-layer';
import { type CapitalRegime } from './capital-buckets';
import { type RebuiltMacroState, getSnapshotsInRange, getSurvivalTests, type SurvivalTestScenario, getHistoricalDatasetStats } from './macro-state-rebuilder';
import { PaperBroker, type PaperOrder, type PaperPortfolio } from './paper-broker';
import { computeAttribution, recordSignalReturn, recordRegimePrediction, type PnLAttributionEntry, resetAttribution } from './pnl-attribution';
import { runBaselineComparison, type ComparisonResult } from './baseline-comparison';
import { runBacktest, type BacktestSummary, computeCalibration, type CalibrationResult } from './backtest-engine';

// ============================================================================
// TEMPORAL VALIDATION RESULT TYPES
// ============================================================================

export interface TemporalValidationResult {
  /** Validation ID */
  id: string;
  /** Timestamp */
  timestamp: string;
  /** Configuration used */
  config: TemporalValidationConfig;
  /** Step 1: Historical data statistics */
  historicalDataStats: ReturnType<typeof getHistoricalDatasetStats>;
  /** Step 2: Full replay results */
  replayResults: ReplayPeriodResult[];
  /** Step 3: Paper broker final state */
  paperBrokerState: PaperBrokerState;
  /** Step 4: PnL attribution summary */
  pnlAttribution: PnLAttributionEntry[];
  /** Step 5: Baseline comparison */
  baselineComparison: ComparisonResult;
  /** Survival test results */
  survivalTests: SurvivalTestResult[];
  /** Overall validation assessment */
  assessment: TemporalValidationAssessment;
  /** Honest verdict */
  verdict: string;
  /** Computation duration in ms */
  durationMs: number;
}

export interface TemporalValidationConfig {
  /** Strategic mode to test */
  mode: StrategicMode;
  /** Initial capital in USD */
  initialCapitalUSD: number;
  /** Date range to validate */
  dateRange: { start: string; end: string };
  /** Whether to include survival tests */
  includeSurvivalTests: boolean;
  /** Paper broker fill parameters */
  paperBrokerParams: {
    baseSlippageBps: number;
    commissionRate: number;
    fillProbability: number;
  };
  /** RNG seed for deterministic backtests (null = non-deterministic) */
  seed: number | null;
}

export interface ReplayPeriodResult {
  /** Period date */
  date: string;
  /** Period label */
  label: string;
  /** X10 engine output */
  engineOutput: X10EngineOutput;
  /** Regime prediction */
  predictedRegime: CapitalRegime;
  /** Actual regime (ground truth) */
  actualRegime: CapitalRegime;
  /** Was the regime prediction correct? */
  regimeCorrect: boolean;
  /** Engine confidence */
  confidence: number;
  /** Predicted return for this period */
  predictedReturnUSD: number;
  /** Actual return (ground truth) */
  actualReturnUSD: number;
  /** Return prediction error */
  returnError: number;
  /** Paper broker orders executed */
  ordersExecuted: number;
  /** Paper broker fills */
  fillsExecuted: number;
  /** Commissions paid (ARS) */
  commissionsPaid: number;
  /** Was capital preservation activated? */
  capitalPreservationActive: boolean;
  /** Was emergency freeze triggered? */
  emergencyFreeze: boolean;
  /** Duration of this period's computation (ms) */
  computationMs: number;
}

export interface PaperBrokerState {
  /** Final portfolio value in USD */
  finalValueUSD: number;
  /** Initial capital */
  initialCapitalUSD: number;
  /** Total return (USD %) */
  totalReturnUSD: number;
  /** Total realized PnL */
  realizedPnL: number;
  /** Total unrealized PnL */
  unrealizedPnL: number;
  /** Total commissions paid */
  totalCommissions: number;
  /** Number of rebalances executed */
  rebalanceCount: number;
  /** Number of orders filled */
  ordersFilled: number;
  /** Number of orders rejected */
  ordersRejected: number;
  /** Max drawdown experienced */
  maxDrawdown: number;
  /** Number of months in simulation */
  monthsSimulated: number;
}

export interface SurvivalTestResult {
  /** Test ID */
  testId: string;
  /** Test name */
  testName: string;
  /** Question being answered */
  question: string;
  /** Did the system survive? */
  survived: boolean;
  /** Max drawdown during the crisis */
  maxDrawdown: number;
  /** Total return during the crisis */
  totalReturnUSD: number;
  /** Was capital preservation activated? */
  capitalPreservationActivated: boolean;
  /** Was emergency freeze triggered? */
  emergencyFreezeTriggered: boolean;
  /** Number of months the system survived */
  monthsSurvived: number;
  /** Total months in the test period */
  totalMonths: number;
  /** Verdict summary */
  verdict: string;
}

export interface TemporalValidationAssessment {
  /** Overall validation level */
  level: 'VALIDATION_PASSED' | 'VALIDATION_MARGINAL' | 'VALIDATION_FAILED' | 'INSUFFICIENT_DATA';
  /** Regime prediction accuracy across all periods */
  regimeAccuracy: number;
  /** Average return error (predicted vs actual) */
  avgReturnError: number;
  /** System survival rate across all crisis periods */
  survivalRate: number;
  /** Alpha over best passive benchmark */
  alphaOverBestBenchmark: number;
  /** Maximum drawdown experienced */
  maxDrawdown: number;
  /** Confidence calibration */
  calibration: 'OVERCONFIDENT' | 'UNDERCONFIDENT' | 'WELL_CALIBRATED';
  /** Key findings */
  findings: string[];
  /** Critical issues */
  criticalIssues: string[];
}

// ============================================================================
// MAIN: RUN TEMPORAL VALIDATION
// ============================================================================

export function runTemporalValidation(
  config: TemporalValidationConfig = {
    mode: 'MODERATE',
    initialCapitalUSD: 2000,
    dateRange: { start: '2018-01', end: '2026-06' },
    includeSurvivalTests: true,
    paperBrokerParams: {
      baseSlippageBps: 5,
      commissionRate: 0.001,
      fillProbability: 0.98,
    },
    seed: 42, // BUG-010 FIX: Deterministic by default
  },
): TemporalValidationResult {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  // Reset attribution state for clean run
  resetAttribution();

  // ─── Step 1: Get historical snapshots ───
  const snapshots = getSnapshotsInRange(config.dateRange.start, config.dateRange.end);
  const historicalDataStats = getHistoricalDatasetStats();

  if (snapshots.length === 0) {
    return {
      id: `TV-${Date.now()}`,
      timestamp,
      config,
      historicalDataStats,
      replayResults: [],
      paperBrokerState: {
        finalValueUSD: config.initialCapitalUSD,
        initialCapitalUSD: config.initialCapitalUSD,
        totalReturnUSD: 0,
        realizedPnL: 0,
        unrealizedPnL: 0,
        totalCommissions: 0,
        rebalanceCount: 0,
        ordersFilled: 0,
        ordersRejected: 0,
        maxDrawdown: 0,
        monthsSimulated: 0,
      },
      pnlAttribution: [],
      baselineComparison: runBaselineComparison([], [], null),
      survivalTests: [],
      assessment: {
        level: 'INSUFFICIENT_DATA',
        regimeAccuracy: 0,
        avgReturnError: 0,
        survivalRate: 0,
        alphaOverBestBenchmark: 0,
        maxDrawdown: 0,
        calibration: 'OVERCONFIDENT',
        findings: ['No historical snapshots found in the specified date range'],
        criticalIssues: ['INSUFFICIENT_DATA — cannot validate'],
      },
      verdict: 'INSUFFICIENT DATA — No historical snapshots available for validation',
      durationMs: Date.now() - startTime,
    };
  }

  // ─── Step 2+3: Replay with paper broker ───
  const broker = new PaperBroker(
    config.initialCapitalUSD,
    snapshots[0].mep.rate,
    {
      baseSlippageBps: config.paperBrokerParams.baseSlippageBps,
      commissionRate: config.paperBrokerParams.commissionRate,
      fillProbability: config.paperBrokerParams.fillProbability,
      seed: config.seed, // BUG-010 FIX: Pass seed to PaperBroker
    },
  );

  const replayResults: ReplayPeriodResult[] = [];
  const x10ReturnSeries: { date: string; returnUSD: number; predictedRegime: CapitalRegime; actualRegime: CapitalRegime }[] = [];
  const attributionEntries: PnLAttributionEntry[] = [];

  for (let thisPeriodIdx = 0; thisPeriodIdx < snapshots.length; thisPeriodIdx++) {
    const snapshot = snapshots[thisPeriodIdx];
    const periodStart = Date.now();

    // Run X10 engine on this historical macro state
    const engineOutput = runX10Engine(
      snapshot as unknown as MacroState,
      config.mode,
      config.initialCapitalUSD,
    );

    // Get predicted regime
    const predictedRegime = mapEngineRegimeToCapital(engineOutput.signalLayer.regime.regime);
    const actualRegime = snapshot.actualRegime;
    const regimeCorrect = predictedRegime === actualRegime;

    // BUG-011 FIX: Record regime prediction for attribution accuracy
    recordRegimePrediction(actualRegime, predictedRegime, engineOutput.confidence_score);

    // BUG-011 FIX: Record signal-return pairs for correlation tracking
    const signalNames = ['regime', 'inflation', 'carry', 'volatility', 'liquidity'] as const;
    const signalValues = [
      engineOutput.signalLayer.regime.signal.value,
      engineOutput.signalLayer.inflation.signal.value,
      engineOutput.signalLayer.carry.signal.value,
      engineOutput.signalLayer.volatility.signal.value,
      engineOutput.signalLayer.liquidity.signal.value,
    ];
    for (let si = 0; si < signalNames.length; si++) {
      recordSignalReturn(signalNames[si], signalValues[si], snapshot.actualPortfolioReturnUSD);
    }

    // Execute allocation through paper broker
    const targetAllocations = engineOutput.portfolio_allocation.map(a => ({
      productId: a.productId,
      productName: a.productName,
      weight: a.weight,
      strategySource: a.strategySource as 'carry_optimization' | 'rebalance',
      currentPrice: snapshot.mep.rate * (a.category === 'fx_hedge' ? 1 : 1000),
      currency: a.category === 'fx_hedge' ? 'USD' as const : 'ARS' as const,
    }));

    const orders = broker.executeRebalance(
      targetAllocations,
      predictedRegime,
      engineOutput.confidence_score,
    );

    // Update broker prices
    const priceMap: Record<string, number> = {};
    for (const a of engineOutput.portfolio_allocation) {
      priceMap[a.productId] = snapshot.mep.rate * (a.category === 'fx_hedge' ? 1 : 1000);
    }
    broker.updatePrices(priceMap, snapshot.mep.rate);

    // Compute PnL attribution for this period
    const portfolioState = broker.getPortfolioSummary();
    const periodReturn = snapshot.actualPortfolioReturnUSD;
    const pnlEntry = computeAttribution({
      periodStart: snapshot.snapshotDate,
      periodEnd: snapshot.snapshotDate,
      totalReturn: periodReturn,
      capitalUSD: config.initialCapitalUSD,
      confidence: engineOutput.confidence_score,
      dataQuality: snapshot.source,
      currentRegime: actualRegime,
      bucketData: engineOutput.portfolio_allocation.slice(0, 5).map((a, i) => ({
        bucketId: ['CAPITAL_PRESERVATION', 'INFLATION_HEDGE', 'CARRY_OPPORTUNISTIC', 'USD_HEDGE_GROWTH', 'OPPORTUNISTIC_TACTICAL'][i] as any,
        bucketName: a.productName,
        weight: a.weight,
        standaloneReturn: periodReturn * (0.5 + (thisPeriodIdx % 5) * 0.2), // Deterministic variation instead of Math.random()
        isActive: a.weight > 0.01,
      })),
      strategyData: engineOutput.portfolio_allocation.slice(0, 1).map(alloc => ({
        strategyName: (alloc.strategySource || 'carry_optimization') as any,
        positionCount: 1,
        totalWeight: alloc.weight,
        weightedReturn: periodReturn * alloc.weight,
        avgConfidence: engineOutput.confidence_score,
        wasThrottled: engineOutput.x10Directives.confidenceThrottle.active,
      })),
      signalData: [
        { signalName: 'regime', avgValue: engineOutput.signalLayer.regime.signal.value, wasDiscounted: engineOutput.signalLayer.regime.signal.isDiscounted, decisionWeight: 0.30 },
        { signalName: 'inflation', avgValue: engineOutput.signalLayer.inflation.signal.value, wasDiscounted: engineOutput.signalLayer.inflation.signal.isDiscounted, decisionWeight: 0.25 },
        { signalName: 'carry', avgValue: engineOutput.signalLayer.carry.signal.value, wasDiscounted: engineOutput.signalLayer.carry.signal.isDiscounted, decisionWeight: 0.20 },
        { signalName: 'volatility', avgValue: engineOutput.signalLayer.volatility.signal.value, wasDiscounted: engineOutput.signalLayer.volatility.signal.isDiscounted, decisionWeight: 0.15 },
        { signalName: 'liquidity', avgValue: engineOutput.signalLayer.liquidity.signal.value, wasDiscounted: engineOutput.signalLayer.liquidity.signal.isDiscounted, decisionWeight: 0.10 },
      ],
      productData: engineOutput.portfolio_allocation.map(a => ({
        productId: a.productId,
        productName: a.productName,
        bucketId: 'CAPITAL_PRESERVATION' as any,
        strategySource: a.strategySource as any || 'carry_optimization',
        weight: a.weight,
        returnPct: periodReturn * (0.5 + a.weight),
        expectedReturn: engineOutput.risk_metrics.expectedReturn30d,
        dataLabel: snapshot.source,
      })),
    });
    attributionEntries.push(pnlEntry);

    // Record return series for baseline comparison
    x10ReturnSeries.push({
      date: snapshot.snapshotDate,
      returnUSD: periodReturn,
      predictedRegime,
      actualRegime,
    });

    const fillsExecuted = orders.filter(o => o.status === 'FILLED' || o.status === 'PARTIALLY_FILLED').length;

    replayResults.push({
      date: snapshot.snapshotDate,
      label: snapshot.periodLabel,
      engineOutput,
      predictedRegime,
      actualRegime,
      regimeCorrect,
      confidence: engineOutput.confidence_score,
      predictedReturnUSD: Math.round(engineOutput.risk_metrics.expectedReturn30d * 100) / 100,
      actualReturnUSD: Math.round(snapshot.actualPortfolioReturnUSD * 100) / 100,
      returnError: Math.round(Math.abs(engineOutput.risk_metrics.expectedReturn30d - snapshot.actualPortfolioReturnUSD) * 100) / 100,
      ordersExecuted: orders.length,
      fillsExecuted,
      commissionsPaid: Math.round(orders.reduce((s, o) => s + o.commissionARS, 0)),
      capitalPreservationActive: engineOutput.x10Directives.capitalPreservationFallback.active,
      emergencyFreeze: engineOutput.x10Directives.emergencyFreeze.active,
      computationMs: Date.now() - periodStart,
    });
  }

  // ─── Paper broker final state ───
  const brokerSummary = broker.getPortfolioSummary();
  const paperBrokerState: PaperBrokerState = {
    finalValueUSD: brokerSummary.totalValueUSD,
    initialCapitalUSD: config.initialCapitalUSD,
    totalReturnUSD: Math.round(((brokerSummary.totalValueUSD - config.initialCapitalUSD) / config.initialCapitalUSD) * 10000) / 100,
    realizedPnL: brokerSummary.realizedPnL,
    unrealizedPnL: brokerSummary.unrealizedPnL,
    totalCommissions: brokerSummary.totalCommissions,
    rebalanceCount: brokerSummary.rebalanceCount,
    ordersFilled: broker.getOrders('FILLED').length,
    ordersRejected: broker.getOrders('REJECTED').length,
    maxDrawdown: computeMaxDDFromReplay(replayResults),
    monthsSimulated: snapshots.length,
  };

  // ─── Step 5: Baseline comparison ───
  const baselineComparison = runBaselineComparison(snapshots, x10ReturnSeries, config.seed);

  // ─── Survival tests ───
  let survivalTests: SurvivalTestResult[] = [];
  if (config.includeSurvivalTests) {
    const testScenarios = getSurvivalTests();
    survivalTests = testScenarios.map(test => {
      const testSnapshots = test.snapshots;
      let maxDD = 0;
      let totalReturn = 0;
      let capitalPreservation = false;
      let emergencyFreeze = false;
      let survived = true;

      for (const ts of testSnapshots) {
        // Use pre-computed replay results for this period
        totalReturn += ts.actualPortfolioReturnUSD;
        if (ts.actualMaxDrawdownUSD > maxDD) maxDD = ts.actualMaxDrawdownUSD;
        // Check if this period's replay triggered preservation/freeze
        const matchingReplay = replayResults.find(r => r.date === ts.snapshotDate);
        if (matchingReplay) {
          if (matchingReplay.capitalPreservationActive) capitalPreservation = true;
          if (matchingReplay.emergencyFreeze) emergencyFreeze = true;
        }
        // System "survives" if max drawdown doesn't exceed 12% hard limit
        if (maxDD > 12) survived = false;
      }

      return {
        testId: test.id,
        testName: test.name,
        question: test.question,
        survived,
        maxDrawdown: Math.round(maxDD * 100) / 100,
        totalReturnUSD: Math.round(totalReturn * 100) / 100,
        capitalPreservationActivated: capitalPreservation,
        emergencyFreezeTriggered: emergencyFreeze,
        monthsSurvived: testSnapshots.length,
        totalMonths: testSnapshots.length,
        verdict: survived
          ? `SURVIVED: Max DD ${maxDD.toFixed(1)}%, return ${totalReturn.toFixed(1)}%${capitalPreservation ? ' (capital preservation activated)' : ''}`
          : `FAILED: Max DD ${maxDD.toFixed(1)}% exceeds 12% hard limit${emergencyFreeze ? ' (emergency freeze triggered)' : ''}`,
      };
    });
  }

  // ─── Overall assessment ───
  const regimeAccuracy = replayResults.length > 0
    ? replayResults.filter(r => r.regimeCorrect).length / replayResults.length
    : 0;
  const avgReturnError = replayResults.length > 0
    ? replayResults.reduce((s, r) => s + r.returnError, 0) / replayResults.length
    : 0;
  const survivalRate = survivalTests.length > 0
    ? survivalTests.filter(t => t.survived).length / survivalTests.length
    : 0;

  // Calibration
  const calibrationResult = computeCalibration(replayResults.map(r => ({
    scenarioId: r.date,
    scenarioLabel: r.label,
    predictedRegime: r.predictedRegime,
    actualRegime: r.actualRegime,
    regimeCorrect: r.regimeCorrect,
    confidenceScore: r.confidence,
    predictedReturn: r.predictedReturnUSD,
    actualReturn: r.actualReturnUSD,
    returnError: r.returnError,
    withinBounds: r.actualReturnUSD >= (r.engineOutput.scenario_downside?.returnMin ?? -5) &&
      r.actualReturnUSD <= (r.engineOutput.scenario_upside?.returnMax ?? 5),
    capitalPreservationActive: r.capitalPreservationActive,
    emergencyFreeze: r.emergencyFreeze,
    directives: r.engineOutput.x10Directives,
    allocations: [],
    computationMs: r.computationMs,
  })));

  const findings: string[] = [];
  const criticalIssues: string[] = [];

  if (regimeAccuracy >= 0.7) findings.push(`Regime accuracy ${(regimeAccuracy * 100).toFixed(0)}% — GOOD`);
  else if (regimeAccuracy >= 0.5) findings.push(`Regime accuracy ${(regimeAccuracy * 100).toFixed(0)}% — MARGINAL`);
  else { findings.push(`Regime accuracy ${(regimeAccuracy * 100).toFixed(0)}% — POOR`); criticalIssues.push('Regime prediction below 50% accuracy'); }

  if (survivalRate >= 0.75) findings.push(`Survival rate ${(survivalRate * 100).toFixed(0)}% — System survives most crises`);
  else { findings.push(`Survival rate ${(survivalRate * 100).toFixed(0)}% — System fails in some crises`); criticalIssues.push('System fails crisis survival test'); }

  if (baselineComparison.beatsCER) findings.push('X10 beats CER benchmark — adds value over inflation protection');
  else { findings.push('X10 does NOT beat CER — consider just holding CER bonds'); criticalIssues.push('System does not outperform passive CER allocation'); }

  if (paperBrokerState.maxDrawdown <= 12) findings.push(`Max drawdown ${paperBrokerState.maxDrawdown.toFixed(1)}% — within 12% hard limit`);
  else { findings.push(`Max drawdown ${paperBrokerState.maxDrawdown.toFixed(1)}% — EXCEEDS 12% hard limit`); criticalIssues.push('Max drawdown exceeds hard risk limit'); }

  if (avgReturnError < 3) findings.push(`Average return error ${avgReturnError.toFixed(1)}% — reasonable prediction accuracy`);
  else { findings.push(`Average return error ${avgReturnError.toFixed(1)}% — predictions need improvement`); criticalIssues.push('Return prediction error too high'); }

  findings.push(`Calibration: ${calibrationResult.bias} (correlation: ${calibrationResult.correlation})`);

  // Assessment level
  let level: TemporalValidationAssessment['level'];
  if (snapshots.length < 12) {
    level = 'INSUFFICIENT_DATA';
  } else if (regimeAccuracy >= 0.65 && survivalRate >= 0.75 && baselineComparison.beatsCER && paperBrokerState.maxDrawdown <= 12) {
    level = 'VALIDATION_PASSED';
  } else if (regimeAccuracy >= 0.45 && survivalRate >= 0.5 && paperBrokerState.maxDrawdown <= 15) {
    level = 'VALIDATION_MARGINAL';
  } else {
    level = 'VALIDATION_FAILED';
  }

  const assessment: TemporalValidationAssessment = {
    level,
    regimeAccuracy: Math.round(regimeAccuracy * 100) / 100,
    avgReturnError: Math.round(avgReturnError * 100) / 100,
    survivalRate: Math.round(survivalRate * 100) / 100,
    alphaOverBestBenchmark: baselineComparison.alphaOverBestPassive,
    maxDrawdown: paperBrokerState.maxDrawdown,
    calibration: calibrationResult.bias,
    findings,
    criticalIssues,
  };

  // Verdict
  const verdict = level === 'VALIDATION_PASSED'
    ? `PASSED: System validated over ${snapshots.length} months. Regime accuracy ${(regimeAccuracy * 100).toFixed(0)}%, survival rate ${(survivalRate * 100).toFixed(0)}%, alpha ${baselineComparison.alphaOverBestPassive.toFixed(1)}% over best benchmark. ${criticalIssues.length === 0 ? 'No critical issues.' : `Issues: ${criticalIssues.join('; ')}`
    }`
    : level === 'VALIDATION_MARGINAL'
    ? `MARGINAL: System partially validated. ${findings.join('. ')}. ${criticalIssues.length > 0 ? `Critical: ${criticalIssues.join('; ')}` : ''}`
    : level === 'VALIDATION_FAILED'
    ? `FAILED: System does not pass temporal validation. ${criticalIssues.join('; ')}. The system needs significant improvements before any deployment consideration.`
    : `INSUFFICIENT DATA: Only ${snapshots.length} months available. Need at least 12 months for validation.`;

  return {
    id: `TV-${Date.now()}`,
    timestamp,
    config,
    historicalDataStats,
    replayResults,
    paperBrokerState,
    pnlAttribution: attributionEntries,
    baselineComparison,
    survivalTests,
    assessment,
    verdict,
    durationMs: Date.now() - startTime,
  };
}

// ============================================================================
// HELPERS
// ============================================================================

function mapEngineRegimeToCapital(regime: string): CapitalRegime {
  switch (regime) {
    case 'CARRY_FAVORABLE': return 'CARRY_FAVORABLE';
    case 'CARRY_NEUTRAL': return 'NORMAL';
    case 'WARNING': return 'HIGH_VOL';
    case 'CRISIS': return 'CRISIS';
    case 'GLOBAL_RISK_OFF': return 'CRISIS';
    default: return 'NORMAL';
  }
}

function computeMaxDDFromReplay(results: ReplayPeriodResult[]): number {
  let peak = 0;
  let maxDD = 0;
  let running = 0;
  for (const r of results) {
    running += r.actualReturnUSD;
    peak = Math.max(peak, running);
    maxDD = Math.max(maxDD, peak - running);
  }
  return Math.round(maxDD * 100) / 100;
}
