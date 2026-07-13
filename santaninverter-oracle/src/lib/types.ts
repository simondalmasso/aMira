/// <reference types="@cloudflare/workers-types" />

// ============================================================================
// Ω-MYTHOS_X10_ENGINE — Core Types for Cloudflare Worker
// Edge-compatible, no Node.js dependencies
// ============================================================================

// ============================================================================
// DATA PROVENANCE
// ============================================================================
export type DataLabel = 'OBSERVADO' | 'REAL' | 'STALE' | 'ERROR' | 'PARTIAL_FALLBACK';

export interface DataProvenance {
  label: DataLabel;
  source: string;
  url: string;
  lastUpdate: string;
  dataDate: string;
  stalenessHours: number;
  fetchedAt: string;
  ageMinutes: number;
  fetchError: boolean;
}

// ============================================================================
// MACRO STATE
// ============================================================================
export interface MacroState {
  lastUpdate: string;
  fetchedAt: string;
  ageMinutes: number;
  lastSuccessfulFetch: string | null;
  source: DataLabel;
  mep: {
    rate: number;
    officialRate: number;
    gap: number;
    sell: number;
    buy: number;
  };
  inflation: {
    monthly: number;
    expected30d: number;
    expected90d: number;
    yearly: number;
  };
  rates: {
    bcraPolicy: number;
    moneyMarket: number;
    plazoFijo: number;
    plazoFijoUVA: number;
    lecaps: number;
    badlar: number;
    leliq: number;
    tml: number;
  };
  cer: {
    index: number;
    monthlyChange: number;
    dailyChange: number;
  };
  crawlingPeg: number;
  realDataPct: number;
  provenance: {
    mepRate: DataProvenance;
    inflation: DataProvenance;
    rates: DataProvenance;
    cer: DataProvenance;
    crawlingPeg: DataProvenance;
    reserves: DataProvenance;
  };
}

// ============================================================================
// REGIME TYPES
// ============================================================================
export type MacroRegime = 'CARRY' | 'CARRY_FAVORABLE' | 'NORMAL' | 'WARNING' | 'HIGH_VOL' | 'CRISIS' | 'GLOBAL_RISK_OFF';
export type CapitalRegime = 'CRISIS' | 'HIGH_VOL' | 'NORMAL' | 'CARRY_FAVORABLE';
export type MacroRegimeX10 = 'CARRY_FAVORABLE' | 'CARRY_NEUTRAL' | 'WARNING' | 'CRISIS' | 'GLOBAL_RISK_OFF';

export interface RegimeState {
  regime: CapitalRegime;
  confidence: number;
  source: DataLabel;
  timestamp: string;
}

// ============================================================================
// SIGNAL TYPES
// ============================================================================
export type SignalStrength = 'low' | 'medium' | 'high' | 'extreme';
export type TrendDirection = 'accelerating' | 'stable' | 'decelerating' | 'reversing';
export type VolatilityRegime = 'calm' | 'normal' | 'elevated' | 'stressed' | 'crisis';
export type LiquidityCondition = 'abundant' | 'normal' | 'tight' | 'stressed' | 'frozen';

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

export interface L1SignalModule {
  name: string;
  signal: SignalOutput;
}

export interface L1SignalBundle {
  regime: { regime: MacroRegimeX10; signal: SignalOutput };
  inflation: L1SignalModule;
  carry: L1SignalModule;
  volatility: L1SignalModule;
  liquidity: L1SignalModule;
  aggregateConfidence: number;
  capitalPreservationMode: boolean;
  emergencyFreeze: boolean;
}

// ============================================================================
// STRATEGY TYPES
// ============================================================================
export type StrategicMode = 'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE';
export type StrategyModuleName = 'carry_optimization' | 'mean_reversion_micro' | 'rate_arbitrage_simulation' | 'usd_hedged_allocations';

export interface ScenarioBound {
  returnMin: number;
  returnMax: number;
  probability: number;
  label: string;
}

export interface L2StrategyOutput {
  mode: StrategicMode;
  allocations: {
    productId: string;
    productName: string;
    weight: number;
    amountUSD: number;
    category: string;
    strategySource: StrategyModuleName;
  }[];
  scenarioDownside: ScenarioBound;
  scenarioBase: ScenarioBound;
  scenarioUpside: ScenarioBound;
  confidence: number;
  riskCapUsed: number;
  warnings: string[];
}

// ============================================================================
// BUCKET TYPES
// ============================================================================
export type BucketId =
  | 'CAPITAL_PRESERVATION'
  | 'INFLATION_HEDGE'
  | 'CARRY_OPPORTUNISTIC'
  | 'USD_HEDGE_GROWTH'
  | 'OPPORTUNISTIC_TACTICAL';

// ============================================================================
// ORACLE TYPES
// ============================================================================
export interface OracleState {
  regime: MacroRegime;
  devaluationProbability: number;
  devaluationRiskBand: 'stable' | 'caution' | 'high' | 'crisis';
  confidenceScore: number;
  fxMomentum: number;
  inflationAcceleration: number;
  reservePressure: number;
  rateGapUSD: number;
  timestamp: string;
  source: DataLabel;
  signals: OracleSignal[];
  dataQualityPct: number;
}

export interface OracleSignal {
  name: string;
  value: number;
  weight: number;
  contribution: number;
  direction: 'alcista' | 'bajista' | 'neutral';
}

// ============================================================================
// X10 ENGINE OUTPUT
// ============================================================================
export interface X10EngineOutput {
  engineVersion: string;
  timestamp: string;
  durationMs: number;
  dataLayer: {
    macroSource: DataLabel;
    dataAgeMinutes: number;
    realDataPct: number;
    hasError: boolean;
    allStale: boolean;
  };
  signalLayer: {
    regime: { regime: MacroRegimeX10; signal: SignalOutput };
    inflation: L1SignalModule;
    carry: L1SignalModule;
    volatility: L1SignalModule;
    liquidity: L1SignalModule;
    aggregateConfidence: number;
    capitalPreservationMode: boolean;
    emergencyFreeze: boolean;
  };
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
  x10Directives: {
    confidenceThrottle: { active: boolean; reason: string };
    capitalPreservationFallback: { active: boolean; reason: string };
    emergencyFreeze: { active: boolean; reason: string };
    deRiskMode: { active: boolean; reason: string };
  };
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================
export interface X10Request {
  capital: number;
  mode: StrategicMode;
}

export interface MacroResponse {
  macro_state: MacroState;
  staleness_report: Record<string, { label: DataLabel; stalenessHours: number }>;
  regime: CapitalRegime;
  confidence: number;
  oracle: OracleState;
  timestamp: string;
}

export interface X10Response {
  allocation: X10EngineOutput['portfolio_allocation'];
  risk_metrics: X10EngineOutput['risk_metrics'];
  confidence: number;
  stress_scenarios: {
    downside: ScenarioBound;
    base: ScenarioBound;
    upside: ScenarioBound;
  };
  x10_directives: X10EngineOutput['x10Directives'];
  timestamp: string;
}

export interface RegimeResponse {
  current_regime: CapitalRegime;
  regime_history: { timestamp: string; regime: CapitalRegime; confidence: number }[];
  transition_probability: Record<CapitalRegime, number>;
  oracle: OracleState;
  timestamp: string;
}

// ============================================================================
// ENV BINDINGS (Cloudflare Worker)
// These types are provided by @cloudflare/workers-types at runtime
// ============================================================================
export interface Env {
  ORACLE_KV: KVNamespace;
  ORACLE_DB: D1Database;
  BCRA_API_KEY?: string;
  INDEC_API_KEY?: string;
  BLUELYTICS_API_KEY?: string;
}
