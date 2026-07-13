// ============================================================================
// Ω-MYTHOS X10 ENGINE — FULL PIPELINE ORCHESTRATOR
// L0_DATA → L1_SIGNALS → L2_STRATEGY → L3_EXECUTION (paper-first)
//
// This is the main entry point for the X10 probabilistic decision engine.
// It wires all layers together and enforces the X10 directives:
//
//   1. If data confidence < 0.7, reduce allocation aggressiveness automatically
//   2. If all macro inputs STALE → revert to capital preservation mode
//   3. If ERROR state detected → freeze strategy updates
//   4. If probability_of_loss > 15% → trigger de-risk mode
//   5. Kill switch: data integrity loss, unmodeled volatility, consecutive loss
//
// CONSTRAINTS (REALISTIC_CAPITAL_ARCHITECTURE_v1):
//   - Capital is a SCALE problem, not an alpha problem
//   - NO leverage (paper-first, always 1.0x)
//   - 12% max drawdown (hard limit)
//   - 0.8%-1.2% monthly blended return (realistic band)
//   - $500/month requires ~$50K at 1%/month
//   - Self-auditing macro allocator, NOT a trading machine
//   - Capital amplifier: income = capital * real_return_rate
//
// OUTPUT (mandatory):
//   - portfolio_allocation
//   - risk_metrics
//   - confidence_score
//   - scenario_downside / scenario_base / scenario_upside
//
// FORBIDDEN OUTPUT:
//   - guaranteed returns
//   - deterministic predictions
// ============================================================================

import { type MacroState, applyStaleDegradation, getProductsFromMacro } from './live-data';
import { computeL1Signals, type L1SignalBundle, computeX10ConfidenceMultiplier, isCapitalPreservationMode, isEmergencyFreeze } from './x10-signal-layer';
import { computeL2Strategy, type L2StrategyOutput, type StrategicMode, STRATEGIC_MODES, type ScenarioBound } from './x10-strategy-layer';
import { logDecision, logEvent, recordMetricsSnapshot } from './telemetry';
import { type CapitalRegime } from './capital-buckets';

// ============================================================================
// FULL ENGINE OUTPUT TYPE
// ============================================================================
export interface X10EngineOutput {
  /** Engine version identifier */
  engineVersion: string;
  /** Pipeline execution timestamp */
  timestamp: string;
  /** Execution duration in ms */
  durationMs: number;

  // ─── L0: Data Layer ───
  dataLayer: {
    macroSource: MacroState['source'];
    dataAgeMinutes: number;
    realDataPct: number;
    hasError: boolean;
    allStale: boolean;
    provenance: MacroState['provenance'];
  };

  // ─── L1: Signal Layer ───
  signalLayer: L1SignalBundle;

  // ─── L2: Strategy Layer ───
  strategyLayer: L2StrategyOutput;

  // ─── L3: Execution Layer (paper-first) ───
  executionLayer: {
    isPaperFirst: boolean;
    isLive: boolean;
    frozenReason: string | null;
    executionMode: 'PAPER' | 'PAPER_LIVE' | 'FROZEN';
  };

  // ─── Mandatory X10 Output ───
  portfolio_allocation: {
    productId: string;
    productName: string;
    weight: number;
    amountUSD: number;
    category: string;
    strategySource: string;
  }[];
  risk_metrics: {
    expectedReturn30d: number;
    expectedReturn90d: number;
    probabilityOfLoss: number;
    maxDrawdownEstimate: number;
    capitalAtRisk: number;
    sharpeEstimate: number;
    fisherRealRate: number;
    volatilityRegime: string;
    liquidityCondition: string;
    capitalPreservationPct: number;
  };
  confidence_score: number;
  scenario_downside: ScenarioBound;
  scenario_base: ScenarioBound;
  scenario_upside: ScenarioBound;

  // ─── X10 Directives Status ───
  x10Directives: {
    confidenceThrottle: {
      active: boolean;
      aggregateConfidence: number;
      multiplier: number;
    };
    capitalPreservationFallback: {
      active: boolean;
    };
    emergencyFreeze: {
      active: boolean;
      reason: string | null;
    };
    killSwitch: {
      active: boolean;
      reason: string | null;
    };
    deRiskMode: {
      active: boolean;
      probabilityOfLoss: number;
    };
  };
}

// ============================================================================
// MAIN: RUN FULL X10 ENGINE
// ============================================================================
export function runX10Engine(
  rawMacro: MacroState,
  mode: StrategicMode = 'MODERATE',
  initialCapitalUSD: number = 2000,
  monthlyOptimizationAnchor: number = 500
): X10EngineOutput {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  // ─── L0: Data Layer — Apply stale degradation ───
  const macro = applyStaleDegradation(rawMacro);

  const dataLayer = {
    macroSource: macro.source,
    dataAgeMinutes: macro.ageMinutes,
    realDataPct: macro.realDataPct,
    hasError: Object.values(macro.provenance).some(p => p.label === 'ERROR'),
    allStale: !Object.values(macro.provenance).some(p => p.label === 'ERROR') &&
      Object.values(macro.provenance)
        .filter(p => p.label !== 'ERROR' && p.label !== 'PARTIAL_FALLBACK')
        .every(p => p.label === 'STALE'),
    provenance: macro.provenance,
  };

  // ─── L1: Signal Layer ───
  const signalLayer = computeL1Signals(macro);

  // ─── L2: Strategy Layer ───
  const strategyLayer = computeL2Strategy(macro, signalLayer, mode, initialCapitalUSD, monthlyOptimizationAnchor);

  // ─── L3: Execution Layer — Paper-first ───
  const isFrozen = strategyLayer.isEmergencyFreeze || strategyLayer.killSwitchActive;
  const isLive = !isFrozen && macro.source === 'REAL' && signalLayer.aggregateConfidence >= 0.7;
  const executionMode = isFrozen ? 'FROZEN' as const : isLive ? 'PAPER_LIVE' as const : 'PAPER' as const;

  const executionLayer = {
    isPaperFirst: true,
    isLive,
    frozenReason: isFrozen
      ? strategyLayer.killSwitchReason ?? (strategyLayer.isEmergencyFreeze ? 'ERROR state — data integrity compromised' : null)
      : null,
    executionMode,
  };

  // ─── Mandatory X10 Output Formatting ───
  const portfolio_allocation = strategyLayer.allocations.map(a => ({
    productId: a.productId,
    productName: a.productName,
    weight: a.weight,
    amountUSD: a.amountUSD,
    category: a.category,
    strategySource: a.strategySource,
  }));

  const safeAllocations = strategyLayer.allocations.length > 0 ? strategyLayer.allocations : [];
  const mmWeight = safeAllocations.find(a => a.productId === 'super-ahorro')?.weight ?? 0;
  const cerWeight = safeAllocations.filter(a => a.category === 'inflation_hedge').reduce((s, a) => s + a.weight, 0);
  const capitalPreservationPct = Math.round((mmWeight + cerWeight) * 100);

  // Sharpe estimate: (expected - risk_free) / volatility_proxy
  const riskFree30d = macro.rates.moneyMarket / 12;
  const volProxy = signalLayer.volatility.signal.value * 5 || 1;
  const sharpeEstimate = (strategyLayer.expectedReturn30d - riskFree30d) / volProxy;

  const risk_metrics = {
    expectedReturn30d: strategyLayer.expectedReturn30d,
    expectedReturn90d: strategyLayer.expectedReturn90d,
    probabilityOfLoss: strategyLayer.probabilityOfLoss,
    maxDrawdownEstimate: strategyLayer.maxDrawdownEstimate,
    capitalAtRisk: strategyLayer.capitalAtRisk,
    sharpeEstimate: Math.round(sharpeEstimate * 100) / 100,
    fisherRealRate: strategyLayer.fisherRealRate,
    volatilityRegime: signalLayer.volatility.regime,
    liquidityCondition: signalLayer.liquidity.condition,
    capitalPreservationPct,
  };

  // Scenario bounds (mandatory)
  const scenarios = strategyLayer.scenarios;
  const scenario_downside = scenarios.find(s => s.label === 'downside') ?? {
    probability: 0.25, returnMin: -3, returnMax: -1, returnExpected: -2, label: 'downside' as const,
  };
  const scenario_base = scenarios.find(s => s.label === 'base') ?? {
    probability: 0.50, returnMin: 0, returnMax: 1, returnExpected: 0.5, label: 'base' as const,
  };
  const scenario_upside = scenarios.find(s => s.label === 'upside') ?? {
    probability: 0.25, returnMin: 0.5, returnMax: 2, returnExpected: 1.2, label: 'upside' as const,
  };

  // X10 Directives status
  const confidenceMultiplier = computeX10ConfidenceMultiplier(signalLayer.aggregateConfidence);
  const x10Directives = {
    confidenceThrottle: {
      active: confidenceMultiplier < 1.0,
      aggregateConfidence: signalLayer.aggregateConfidence,
      multiplier: confidenceMultiplier,
    },
    capitalPreservationFallback: {
      active: isCapitalPreservationMode(signalLayer),
    },
    emergencyFreeze: {
      active: isEmergencyFreeze(signalLayer),
      reason: signalLayer.hasError ? 'ERROR state detected — data integrity compromised' : null,
    },
    killSwitch: {
      active: strategyLayer.killSwitchActive,
      reason: strategyLayer.killSwitchReason,
    },
    deRiskMode: {
      active: strategyLayer.probabilityOfLoss > 0.15,
      probabilityOfLoss: strategyLayer.probabilityOfLoss,
    },
  };

  const durationMs = Date.now() - startTime;

  // ─── Telemetry: Log pipeline execution ───
  logEvent({
    eventType: 'PIPELINE_EXECUTION',
    source: 'x10-engine',
    data: {
      mode,
      capital: initialCapitalUSD,
      confidence: signalLayer.aggregateConfidence,
      regime: signalLayer.regime.regime,
      executionMode: executionLayer.executionMode,
    },
    durationMs,
    success: true,
  });

  // ─── Telemetry: Log allocation decision ───
  const decisionType = isFrozen ? 'EMERGENCY_FREEZE'
    : strategyLayer.isCapitalPreservation ? 'CAPITAL_PRESERVATION_MODE'
    : strategyLayer.killSwitchActive ? 'KILL_SWITCH_ACTIVATED'
    : x10Directives.deRiskMode.active ? 'DE_RISK_MODE'
    : x10Directives.confidenceThrottle.active ? 'CONFIDENCE_THROTTLE'
    : 'ALLOCATION_COMPUTED';

  const regimeFromSignal = signalLayer.regime.regime;
  const capitalRegime: CapitalRegime = regimeFromSignal === 'CARRY_FAVORABLE' ? 'CARRY_FAVORABLE'
    : regimeFromSignal === 'CARRY_NEUTRAL' ? 'NORMAL'
    : regimeFromSignal === 'WARNING' ? 'HIGH_VOL'
    : 'CRISIS';

  logDecision({
    decisionType,
    severity: decisionType === 'EMERGENCY_FREEZE' || decisionType === 'KILL_SWITCH_ACTIVATED' ? 'critical'
      : decisionType === 'DE_RISK_MODE' || decisionType === 'CAPITAL_PRESERVATION_MODE' ? 'warning'
      : 'info',
    summary: `X10 ${decisionType}: regime=${signalLayer.regime.regime}, confidence=${(signalLayer.aggregateConfidence * 100).toFixed(0)}%, mode=${mode}`,
    context: {
      capitalUSD: initialCapitalUSD,
      portfolioValueUSD: initialCapitalUSD,
      allocations: portfolio_allocation.map(a => ({ productId: a.productId, weight: a.weight })),
      signals: {
        regime: signalLayer.regime.regime,
        aggregateConfidence: signalLayer.aggregateConfidence,
        volatilityRegime: signalLayer.volatility.regime,
        liquidityCondition: signalLayer.liquidity.condition,
      },
      macroSource: macro.source,
      dataAgeMinutes: macro.ageMinutes,
      realDataPct: macro.realDataPct,
      strategicMode: mode,
      scalingPhase: initialCapitalUSD < 5000 ? 'SURVIVAL' : initialCapitalUSD < 25000 ? 'COMPOUNDING' : 'INCOME',
    },
    action: `Computed ${portfolio_allocation.length} allocations with ${(signalLayer.aggregateConfidence * 100).toFixed(0)}% confidence`,
    reasoning: [
      `Regime: ${signalLayer.regime.regime}`,
      `Confidence: ${(signalLayer.aggregateConfidence * 100).toFixed(0)}%`,
      `Data quality: ${macro.source} (${macro.realDataPct}% real)`,
      `Volatility: ${signalLayer.volatility.regime}`,
      `Liquidity: ${signalLayer.liquidity.condition}`,
      ...(x10Directives.confidenceThrottle.active ? ['Confidence throttle active'] : []),
      ...(x10Directives.capitalPreservationFallback.active ? ['Capital preservation fallback active'] : []),
      ...(x10Directives.emergencyFreeze.active ? ['EMERGENCY FREEZE'] : []),
      ...(x10Directives.killSwitch.active ? [`Kill switch: ${x10Directives.killSwitch.reason}`] : []),
      ...(x10Directives.deRiskMode.active ? ['De-risk mode active'] : []),
    ],
    alternatives: isFrozen ? ['Await data recovery', 'Manual override'] : [],
  });

  // ─── Telemetry: Record metrics snapshot ───
  recordMetricsSnapshot(
    signalLayer.aggregateConfidence,
    strategyLayer.expectedReturn30d,
    { CRISIS: capitalRegime === 'CRISIS' ? 1 : 0, HIGH_VOL: capitalRegime === 'HIGH_VOL' ? 1 : 0, NORMAL: capitalRegime === 'NORMAL' ? 1 : 0, CARRY_FAVORABLE: capitalRegime === 'CARRY_FAVORABLE' ? 1 : 0 },
  );

  return {
    engineVersion: 'Ω-MYTHOS_X10_V1.0',
    timestamp,
    durationMs,
    dataLayer,
    signalLayer,
    strategyLayer,
    executionLayer,
    portfolio_allocation,
    risk_metrics,
    confidence_score: signalLayer.aggregateConfidence,
    scenario_downside,
    scenario_base,
    scenario_upside,
    x10Directives,
  };
}

// ============================================================================
// REGIME → STRATEGIC MODE MAPPING
// Auto-select mode based on L1 regime + confidence
// ============================================================================
export function autoSelectStrategicMode(signalBundle: L1SignalBundle): StrategicMode {
  const { regime } = signalBundle.regime;
  const confidence = signalBundle.aggregateConfidence;

  // Low confidence → always conservative regardless of regime
  if (confidence < 0.4) return 'CONSERVATIVE';

  switch (regime) {
    case 'CARRY_FAVORABLE':
      return confidence > 0.7 ? 'AGGRESSIVE' : 'MODERATE';
    case 'CARRY_NEUTRAL':
      return 'MODERATE';
    case 'WARNING':
      return 'CONSERVATIVE';
    case 'CRISIS':
    case 'GLOBAL_RISK_OFF':
      return 'CONSERVATIVE';
    default:
      return 'MODERATE';
  }
}
