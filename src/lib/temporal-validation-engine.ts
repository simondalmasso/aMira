// ============================================================================
// Ω-X10 TEMPORAL VALIDATION ENGINE — reconstructed/synthetic replay only
// ============================================================================

import { runX10Engine, type X10EngineOutput } from './x10-engine';
import { type StrategicMode } from './x10-strategy-layer';
import { type CapitalRegime, type BucketId } from './capital-buckets';
import { getSnapshotsInRange, getSurvivalTests, getHistoricalDatasetStats } from './macro-state-rebuilder';
import { PaperBroker } from './paper-broker';
import { computeAttribution, recordSignalReturn, recordRegimePrediction, type PnLAttributionEntry, resetAttribution } from './pnl-attribution';
import { runBaselineComparison, type ComparisonResult } from './baseline-comparison';
import { computeCalibration } from './backtest-engine';

export interface TemporalValidationResult {
  id: string;
  timestamp: string;
  config: TemporalValidationConfig;
  historicalDataStats: ReturnType<typeof getHistoricalDatasetStats>;
  replayResults: ReplayPeriodResult[];
  paperBrokerState: PaperBrokerState;
  pnlAttribution: PnLAttributionEntry[];
  baselineComparison: ComparisonResult;
  survivalTests: SurvivalTestResult[];
  assessment: TemporalValidationAssessment;
  verdict: string;
  durationMs: number;
}

export interface TemporalValidationConfig {
  mode: StrategicMode;
  initialCapitalUSD: number;
  dateRange: { start: string; end: string };
  includeSurvivalTests: boolean;
  paperBrokerParams: {
    baseSlippageBps: number;
    commissionRate: number;
    fillProbability: number;
  };
  seed: number | null;
}

export interface ReplayPeriodResult {
  date: string;
  label: string;
  engineOutput: X10EngineOutput;
  predictedRegime: CapitalRegime;
  actualRegime: CapitalRegime;
  regimeCorrect: boolean;
  confidence: number;
  predictedReturnUSD: number;
  actualReturnUSD: number;
  returnError: number;
  ordersExecuted: number;
  fillsExecuted: number;
  commissionsPaid: number;
  capitalPreservationActive: boolean;
  emergencyFreeze: boolean;
  computationMs: number;
}

export interface PaperBrokerState {
  finalValueUSD: number;
  initialCapitalUSD: number;
  totalReturnUSD: number;
  realizedPnL: number;
  unrealizedPnL: number;
  totalCommissions: number;
  rebalanceCount: number;
  ordersFilled: number;
  ordersRejected: number;
  maxDrawdown: number;
  monthsSimulated: number;
}

export interface SurvivalTestResult {
  testId: string;
  testName: string;
  question: string;
  survived: boolean;
  maxDrawdown: number;
  totalReturnUSD: number;
  capitalPreservationActivated: boolean;
  emergencyFreezeTriggered: boolean;
  monthsSurvived: number;
  totalMonths: number;
  verdict: string;
}

export interface TemporalValidationAssessment {
  level: 'VALIDATION_PASSED' | 'VALIDATION_MARGINAL' | 'VALIDATION_FAILED' | 'INSUFFICIENT_DATA';
  regimeAccuracy: number;
  avgReturnError: number;
  survivalRate: number;
  alphaOverBestBenchmark: number;
  maxDrawdown: number;
  calibration: 'OVERCONFIDENT' | 'UNDERCONFIDENT' | 'WELL_CALIBRATED';
  findings: string[];
  criticalIssues: string[];
}

const ATTRIBUTION_BUCKETS: readonly BucketId[] = [
  'CAPITAL_PRESERVATION',
  'INFLATION_HEDGE',
  'CARRY_OPPORTUNISTIC',
  'USD_HEDGE_GROWTH',
  'OPPORTUNISTIC_TACTICAL',
];

function bucketForIndex(index: number): BucketId {
  return ATTRIBUTION_BUCKETS[index % ATTRIBUTION_BUCKETS.length] ?? 'OPPORTUNISTIC_TACTICAL';
}

function emptyResult(config: TemporalValidationConfig, historicalDataStats: ReturnType<typeof getHistoricalDatasetStats>, startedAt: number): TemporalValidationResult {
  return {
    id: `TV-${Date.now()}`,
    timestamp: new Date().toISOString(),
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
      findings: ['No reconstructed snapshots found in the requested date range'],
      criticalIssues: ['INSUFFICIENT_DATA — cannot validate'],
    },
    verdict: 'INSUFFICIENT DATA — no reconstructed snapshots available for validation',
    durationMs: Date.now() - startedAt,
  };
}

export function runTemporalValidation(
  config: TemporalValidationConfig = {
    mode: 'MODERATE',
    initialCapitalUSD: 2000,
    dateRange: { start: '2018-01', end: '2026-06' },
    includeSurvivalTests: true,
    paperBrokerParams: { baseSlippageBps: 5, commissionRate: 0.001, fillProbability: 0.98 },
    seed: 42,
  },
): TemporalValidationResult {
  const startedAt = Date.now();
  const timestamp = new Date().toISOString();
  resetAttribution();

  const snapshots = getSnapshotsInRange(config.dateRange.start, config.dateRange.end);
  const historicalDataStats = getHistoricalDatasetStats();
  if (snapshots.length === 0) return emptyResult(config, historicalDataStats, startedAt);

  const broker = new PaperBroker(config.initialCapitalUSD, snapshots[0].mep.rate, {
    baseSlippageBps: config.paperBrokerParams.baseSlippageBps,
    commissionRate: config.paperBrokerParams.commissionRate,
    fillProbability: config.paperBrokerParams.fillProbability,
    seed: config.seed,
  });

  const replayResults: ReplayPeriodResult[] = [];
  const x10ReturnSeries: { date: string; returnUSD: number; predictedRegime: CapitalRegime; actualRegime: CapitalRegime }[] = [];
  const attributionEntries: PnLAttributionEntry[] = [];

  snapshots.forEach((snapshot, periodIndex) => {
    const periodStartedAt = Date.now();
    const engineOutput = runX10Engine(snapshot, config.mode, config.initialCapitalUSD);
    const predictedRegime = mapEngineRegimeToCapital(engineOutput.signalLayer.regime.regime);
    const actualRegime = snapshot.actualRegime;
    const regimeCorrect = predictedRegime === actualRegime;
    const periodReturn = snapshot.actualPortfolioReturnUSD;

    recordRegimePrediction(actualRegime, predictedRegime, engineOutput.confidence_score);
    const signalValues = [
      engineOutput.signalLayer.regime.signal.value,
      engineOutput.signalLayer.inflation.signal.value,
      engineOutput.signalLayer.carry.signal.value,
      engineOutput.signalLayer.volatility.signal.value,
      engineOutput.signalLayer.liquidity.signal.value,
    ];
    const signalNames = ['regime', 'inflation', 'carry', 'volatility', 'liquidity'] as const;
    signalNames.forEach((name, index) => recordSignalReturn(name, signalValues[index] ?? 0, periodReturn));

    const targetAllocations = engineOutput.portfolio_allocation.map((allocation, index) => ({
      productId: allocation.productId,
      productName: allocation.productName,
      weight: allocation.weight,
      strategySource: allocation.strategySource,
      bucketId: bucketForIndex(index),
      currentPrice: snapshot.mep.rate * (allocation.category === 'fx_hedge' ? 1 : 1000),
      currency: allocation.category === 'fx_hedge' ? 'USD' as const : 'ARS' as const,
    }));
    const orders = broker.executeRebalance(targetAllocations, predictedRegime, engineOutput.confidence_score);

    const priceMap: Record<string, number> = {};
    engineOutput.portfolio_allocation.forEach((allocation) => {
      priceMap[allocation.productId] = snapshot.mep.rate * (allocation.category === 'fx_hedge' ? 1 : 1000);
    });
    broker.updatePrices(priceMap, snapshot.mep.rate);

    const pnlEntry = computeAttribution({
      periodStart: snapshot.snapshotDate,
      periodEnd: snapshot.snapshotDate,
      totalReturn: periodReturn,
      capitalUSD: config.initialCapitalUSD,
      confidence: engineOutput.confidence_score,
      dataQuality: snapshot.source,
      currentRegime: actualRegime,
      bucketData: engineOutput.portfolio_allocation.slice(0, 5).map((allocation, index) => ({
        bucketId: bucketForIndex(index),
        bucketName: allocation.productName,
        weight: allocation.weight,
        standaloneReturn: periodReturn * (0.5 + (periodIndex % 5) * 0.2),
        isActive: allocation.weight > 0.01,
      })),
      strategyData: engineOutput.portfolio_allocation.slice(0, 1).map((allocation) => ({
        strategyName: allocation.strategySource,
        positionCount: 1,
        totalWeight: allocation.weight,
        weightedReturn: periodReturn * allocation.weight,
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
      productData: engineOutput.portfolio_allocation.map((allocation, index) => ({
        productId: allocation.productId,
        productName: allocation.productName,
        bucketId: bucketForIndex(index),
        strategySource: allocation.strategySource,
        weight: allocation.weight,
        returnPct: periodReturn * (0.5 + allocation.weight),
        expectedReturn: engineOutput.risk_metrics.expectedReturn30d,
        dataLabel: snapshot.source,
      })),
    });
    attributionEntries.push(pnlEntry);

    x10ReturnSeries.push({ date: snapshot.snapshotDate, returnUSD: periodReturn, predictedRegime, actualRegime });
    replayResults.push({
      date: snapshot.snapshotDate,
      label: snapshot.periodLabel,
      engineOutput,
      predictedRegime,
      actualRegime,
      regimeCorrect,
      confidence: engineOutput.confidence_score,
      predictedReturnUSD: Math.round(engineOutput.risk_metrics.expectedReturn30d * 100) / 100,
      actualReturnUSD: Math.round(periodReturn * 100) / 100,
      returnError: Math.round(Math.abs(engineOutput.risk_metrics.expectedReturn30d - periodReturn) * 100) / 100,
      ordersExecuted: orders.length,
      fillsExecuted: orders.filter((order) => order.status === 'FILLED' || order.status === 'PARTIALLY_FILLED').length,
      commissionsPaid: Math.round(orders.reduce((sum, order) => sum + order.commissionARS, 0)),
      capitalPreservationActive: engineOutput.x10Directives.capitalPreservationFallback.active,
      emergencyFreeze: engineOutput.x10Directives.emergencyFreeze.active,
      computationMs: Date.now() - periodStartedAt,
    });
  });

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

  const baselineComparison = runBaselineComparison(snapshots, x10ReturnSeries, config.seed);
  const survivalTests: SurvivalTestResult[] = config.includeSurvivalTests
    ? getSurvivalTests().map((test) => {
        let maxDrawdown = 0;
        let totalReturn = 0;
        let capitalPreservation = false;
        let emergencyFreeze = false;
        test.snapshots.forEach((snapshot) => {
          totalReturn += snapshot.actualPortfolioReturnUSD;
          maxDrawdown = Math.max(maxDrawdown, snapshot.actualMaxDrawdownUSD);
          const replay = replayResults.find((item) => item.date === snapshot.snapshotDate);
          capitalPreservation ||= replay?.capitalPreservationActive ?? false;
          emergencyFreeze ||= replay?.emergencyFreeze ?? false;
        });
        const survived = maxDrawdown <= 12;
        return {
          testId: test.id,
          testName: test.name,
          question: test.question,
          survived,
          maxDrawdown: Math.round(maxDrawdown * 100) / 100,
          totalReturnUSD: Math.round(totalReturn * 100) / 100,
          capitalPreservationActivated: capitalPreservation,
          emergencyFreezeTriggered: emergencyFreeze,
          monthsSurvived: survived ? test.snapshots.length : Math.max(0, test.snapshots.findIndex((snapshot) => snapshot.actualMaxDrawdownUSD > 12)),
          totalMonths: test.snapshots.length,
          verdict: survived
            ? `SURVIVED reconstructed scenario: max DD ${maxDrawdown.toFixed(1)}%`
            : `FAILED reconstructed scenario: max DD ${maxDrawdown.toFixed(1)}% exceeds 12% limit`,
        };
      })
    : [];

  const regimeAccuracy = replayResults.filter((result) => result.regimeCorrect).length / replayResults.length;
  const avgReturnError = replayResults.reduce((sum, result) => sum + result.returnError, 0) / replayResults.length;
  const survivalRate = survivalTests.length > 0 ? survivalTests.filter((test) => test.survived).length / survivalTests.length : 0;
  const calibrationResult = computeCalibration(replayResults.map((result) => ({
    scenarioId: result.date,
    scenarioLabel: result.label,
    predictedRegime: result.predictedRegime,
    actualRegime: result.actualRegime,
    regimeCorrect: result.regimeCorrect,
    confidenceScore: result.confidence,
    predictedReturn: result.predictedReturnUSD,
    actualReturn: result.actualReturnUSD,
    returnError: result.returnError,
    withinBounds: result.actualReturnUSD >= (result.engineOutput.scenario_downside?.returnMin ?? -5)
      && result.actualReturnUSD <= (result.engineOutput.scenario_upside?.returnMax ?? 5),
    capitalPreservationActive: result.capitalPreservationActive,
    emergencyFreeze: result.emergencyFreeze,
    directives: result.engineOutput.x10Directives,
    allocations: [],
    computationMs: result.computationMs,
  })));

  const findings: string[] = [];
  const criticalIssues: string[] = [];
  if (regimeAccuracy >= 0.7) findings.push(`Reconstructed regime-match ${(regimeAccuracy * 100).toFixed(0)}%`);
  else if (regimeAccuracy >= 0.5) findings.push(`Reconstructed regime-match ${(regimeAccuracy * 100).toFixed(0)}% — marginal`);
  else criticalIssues.push('Reconstructed regime-match below 50%');
  if (survivalTests.length > 0 && survivalRate < 0.75) criticalIssues.push('Reconstructed crisis survival below 75%');
  if (!baselineComparison.beatsCER) criticalIssues.push('Synthetic/reconstructed replay does not outperform CER benchmark');
  if (paperBrokerState.maxDrawdown > 12) criticalIssues.push('Synthetic/reconstructed max drawdown exceeds 12% limit');
  if (avgReturnError >= 3) criticalIssues.push('Synthetic/reconstructed return error is high');
  findings.push(`Calibration on reconstructed fixture: ${calibrationResult.bias}`);

  let level: TemporalValidationAssessment['level'];
  if (snapshots.length < 12) level = 'INSUFFICIENT_DATA';
  else if (regimeAccuracy >= 0.65 && survivalRate >= 0.75 && baselineComparison.beatsCER && paperBrokerState.maxDrawdown <= 12) level = 'VALIDATION_PASSED';
  else if (regimeAccuracy >= 0.45 && (survivalTests.length === 0 || survivalRate >= 0.5) && paperBrokerState.maxDrawdown <= 15) level = 'VALIDATION_MARGINAL';
  else level = 'VALIDATION_FAILED';

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

  const verdict = `${level}: synthetic/reconstructed temporal fixture only; ${snapshots.length} months evaluated. This is not observed historical validation and is not evidence of real returns.`;
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
    durationMs: Date.now() - startedAt,
  };
}

function mapEngineRegimeToCapital(regime: string): CapitalRegime {
  switch (regime) {
    case 'CARRY_FAVORABLE': return 'CARRY_FAVORABLE';
    case 'CARRY_NEUTRAL': return 'NORMAL';
    case 'WARNING': return 'HIGH_VOL';
    case 'CRISIS':
    case 'GLOBAL_RISK_OFF': return 'CRISIS';
    default: return 'NORMAL';
  }
}

function computeMaxDDFromReplay(results: ReplayPeriodResult[]): number {
  let peak = 0;
  let maxDrawdown = 0;
  let running = 0;
  for (const result of results) {
    running += result.actualReturnUSD;
    peak = Math.max(peak, running);
    maxDrawdown = Math.max(maxDrawdown, peak - running);
  }
  return Math.round(maxDrawdown * 100) / 100;
}
