// ============================================================================
// Ω-MYTHOS X10 ENGINE — L2 STRATEGY LAYER
// Probabilistic strategy allocation driven by L1 signals
// NO guaranteed returns, NO deterministic predictions
// All outputs are scenario-bounded with confidence scores
// ============================================================================
//
// ARCHITECTURE:
//   L1_SIGNAL_LAYER → THIS FILE → L3_EXECUTION_LAYER (paper-first)
//
// STRATEGY MODULES:
//   1. carry_optimization          — ARS carry trade (short horizon)
//   2. mean_reversion_micro        — mean-reversion micro strategies
//   3. rate_arbitrage_simulation   — rate arbitrage across instruments
//   4. usd_hedged_allocations      — USD hedge positioning
//
// STRATEGIC MODES:
//   CONSERVATIVE: risk_cap=0.15, leverage=1.0, target=+0.8%/month (realistic)
//   MODERATE:     risk_cap=0.30, leverage=1.0, target=+1.0%/month (realistic)
//   AGGRESSIVE:   risk_cap=0.45, leverage=1.0, target=+1.2%/month (realistic ceiling)
//
// CONSTRAINTS (REALISTIC_CAPITAL_ARCHITECTURE_v1):
//   Capital is a SCALE problem, not an alpha problem
//   NO leverage (paper-first, always 1.0x)
//   12% max drawdown (hard limit)
//   0.8%-1.2% monthly blended return (realistic band)
//   Capital preservation priority > return maximization
//   $500/month requires ~$50K at 1%/month (capital amplifier)
//   Self-auditing macro allocator, NOT a trading machine
// ============================================================================

import {
  type MacroState,
  type SantanderProduct,
  type DataLabel,
  getProductsFromMacro,
} from './live-data';
import {
  type L1SignalBundle,
  type MacroRegimeX10,
  type VolatilityRegime,
  type LiquidityCondition,
  computeX10ConfidenceMultiplier,
  isCapitalPreservationMode,
  isEmergencyFreeze,
} from './x10-signal-layer';

// ============================================================================
// STRATEGIC MODE TYPES
// ============================================================================
export type StrategicMode = 'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE';

export interface StrategicModeConfig {
  riskCap: number;              // Max % of capital at risk
  leverage: number;             // Leverage multiplier (1.0 = no leverage)
  targetMonthlyReturn: number;  // Target monthly return (%)
  maxDrawdown: number;          // Max allowed drawdown (%)
  capitalPreservation: number;  // Minimum % capital to preserve
  minMoneyMarket: number;       // Minimum allocation to money market
  maxMEP: number;               // Maximum allocation to USD/FX
  maxSinglePosition: number;    // Maximum single position weight
  minLiquidityScore: number;    // Minimum portfolio liquidity score
}

export const STRATEGIC_MODES: Record<StrategicMode, StrategicModeConfig> = {
  CONSERVATIVE: {
    riskCap: 0.15,
    leverage: 1.0,                // NO leverage ever — paper-first
    targetMonthlyReturn: 0.008,   // 0.8%/month (realistic)
    maxDrawdown: 0.05,            // 5% max DD
    capitalPreservation: 0.70,    // 70% capital preservation priority
    minMoneyMarket: 0.40,
    maxMEP: 0.10,
    maxSinglePosition: 0.50,
    minLiquidityScore: 70,
  },
  MODERATE: {
    riskCap: 0.30,
    leverage: 1.0,                // NO leverage ever — paper-first
    targetMonthlyReturn: 0.010,   // 1.0%/month (realistic base)
    maxDrawdown: 0.08,            // 8% max DD
    capitalPreservation: 0.60,
    minMoneyMarket: 0.25,
    maxMEP: 0.18,
    maxSinglePosition: 0.40,
    minLiquidityScore: 55,
  },
  AGGRESSIVE: {
    riskCap: 0.45,
    leverage: 1.0,                // NO leverage ever — paper-first
    targetMonthlyReturn: 0.012,   // 1.2%/month (realistic ceiling)
    maxDrawdown: 0.12,            // 12% max DD (HARD LIMIT from REALISTIC_CAPITAL_ARCHITECTURE_v1)
    capitalPreservation: 0.50,    // 50% min preservation
    minMoneyMarket: 0.15,
    maxMEP: 0.25,
    maxSinglePosition: 0.35,
    minLiquidityScore: 40,
  },
};

// ============================================================================
// STRATEGY OUTPUT TYPES
// ============================================================================
export interface StrategyAllocation {
  productId: string;
  productName: string;
  weight: number;               // [0, 1] portfolio weight
  amountARS: number;
  amountUSD: number;
  category: string;
  strategySource: StrategyModuleName;  // Which strategy module generated this
  confidence: number;           // Signal confidence for this allocation
  isThrottled: boolean;         // Was this reduced by X10 confidence throttle?
}

export type StrategyModuleName = 'carry_optimization' | 'mean_reversion_micro' | 'rate_arbitrage_simulation' | 'usd_hedged_allocations' | 'capital_preservation';

export interface ScenarioBound {
  probability: number;
  returnMin: number;
  returnMax: number;
  returnExpected: number;
  label: 'downside' | 'base' | 'upside';
}

export interface L2StrategyOutput {
  allocations: StrategyAllocation[];
  mode: StrategicMode;
  modeConfig: StrategicModeConfig;
  confidenceMultiplier: number;  // X10 confidence throttle [0, 1]
  isCapitalPreservation: boolean; // true if all STALE → capital preservation
  isEmergencyFreeze: boolean;    // true if ERROR → no strategy updates
  scenarios: ScenarioBound[];
  expectedReturn30d: number;
  expectedReturn90d: number;
  probabilityOfLoss: number;     // P(portfolio return < 0) estimate
  maxDrawdownEstimate: number;
  capitalAtRisk: number;         // % of capital at risk
  fisherRealRate: number;        // Fisher-adjusted real rate
  dataQuality: DataLabel;
  timestamp: string;
  /** Kill switch: if any condition triggered, strategy returns to preservation */
  killSwitchActive: boolean;
  killSwitchReason: string | null;
}

// ============================================================================
// STRATEGY 1: CARRY OPTIMIZATION
// Allocate to ARS carry instruments when carry is positive and regime supports it
// ============================================================================
function carryOptimization(
  products: SantanderProduct[],
  macro: MacroState,
  signals: L1SignalBundle,
  maxWeight: number,
  confidenceMultiplier: number,
  initialCapitalUSD: number = 2000,
): StrategyAllocation[] {
  if (!signals.carry.isViable) return [];
  if (signals.regime.regime === 'CRISIS' || signals.regime.regime === 'GLOBAL_RISK_OFF') return [];

  const allocations: StrategyAllocation[] = [];
  const carryProducts = products.filter(p =>
    p.type === 'money_market' || p.type === 'plazo_fijo' || p.type === 'fondo_corto'
  );

  if (carryProducts.length === 0) return [];

  // Base weights: money market gets most, then short-term fund, then PF
  const weightDistribution: Record<string, number> = {
    'super-ahorro': 0.50,
    'fondo-corto-plazo': 0.25,
    'plazo-fijo': 0.25,
  };

  for (const product of carryProducts) {
    const baseWeight = weightDistribution[product.id] ?? 0;
    if (baseWeight === 0) continue;

    // Regime adjustment: more carry in CARRY_FAVORABLE
    const regimeMultiplier = signals.regime.regime === 'CARRY_FAVORABLE' ? 1.2
      : signals.regime.regime === 'CARRY_NEUTRAL' ? 1.0
      : 0.6; // WARNING

    // X10 confidence throttle
    const throttledWeight = Math.min(maxWeight, baseWeight * regimeMultiplier * confidenceMultiplier);

    if (throttledWeight < 0.01) continue;

    const capitalARS = initialCapitalUSD * macro.mep.rate;
    allocations.push({
      productId: product.id,
      productName: product.shortName,
      weight: Math.round(throttledWeight * 1000) / 1000,
      amountARS: Math.round(capitalARS * throttledWeight),
      amountUSD: Math.round((capitalARS * throttledWeight / macro.mep.rate) * 100) / 100,
      category: product.category,
      strategySource: 'carry_optimization',
      confidence: signals.carry.signal.confidence,
      isThrottled: throttledWeight < baseWeight * regimeMultiplier,
    });
  }

  return allocations;
}

// ============================================================================
// STRATEGY 2: MEAN REVERSION MICRO
// Short-term mean-reversion on FX gap and CER basis
// Only active in WARNING/CRISIS when gap is mean-reverting from extremes
// ============================================================================
function meanReversionMicro(
  products: SantanderProduct[],
  macro: MacroState,
  signals: L1SignalBundle,
  maxWeight: number,
  confidenceMultiplier: number,
  initialCapitalUSD: number = 2000,
): StrategyAllocation[] {
  const allocations: StrategyAllocation[] = [];
  const gap = macro.mep.gap;

  // Mean-reversion only when gap is at extremes (>40% or <5%)
  const isGapExtreme = gap > 40 || gap < 5;
  if (!isGapExtreme) return [];

  // When gap is very wide: reduce USD exposure (expect gap compression)
  // When gap is very narrow: add USD exposure (expect gap expansion)
  if (gap > 40) {
    // Gap compression expected → favor CER over USD
    const cerProduct = products.find(p => p.type === 'cer_bond');
    if (cerProduct) {
      const weight = Math.min(maxWeight, 0.15 * confidenceMultiplier);
      const capitalARS = initialCapitalUSD * macro.mep.rate;
      allocations.push({
        productId: cerProduct.id,
        productName: cerProduct.shortName,
        weight: Math.round(weight * 1000) / 1000,
        amountARS: Math.round(capitalARS * weight),
        amountUSD: Math.round((capitalARS * weight / macro.mep.rate) * 100) / 100,
        category: cerProduct.category,
        strategySource: 'mean_reversion_micro',
        confidence: signals.volatility.signal.confidence * 0.7, // Lower confidence for MR
        isThrottled: weight < 0.15,
      });
    }
  } else if (gap < 5) {
    // Gap expansion expected → add USD hedge
    const mepProduct = products.find(p => p.type === 'mep');
    if (mepProduct) {
      const weight = Math.min(maxWeight, 0.10 * confidenceMultiplier);
      const capitalARS = initialCapitalUSD * macro.mep.rate;
      allocations.push({
        productId: mepProduct.id,
        productName: mepProduct.shortName,
        weight: Math.round(weight * 1000) / 1000,
        amountARS: Math.round(capitalARS * weight),
        amountUSD: Math.round((capitalARS * weight / macro.mep.rate) * 100) / 100,
        category: mepProduct.category,
        strategySource: 'mean_reversion_micro',
        confidence: signals.volatility.signal.confidence * 0.7,
        isThrottled: weight < 0.10,
      });
    }
  }

  return allocations;
}

// ============================================================================
// STRATEGY 3: RATE ARBITRAGE SIMULATION
// Exploit rate differentials: BADLAR vs policy, Lecaps vs MM, UVA premium
// ============================================================================
function rateArbitrageSimulation(
  products: SantanderProduct[],
  macro: MacroState,
  signals: L1SignalBundle,
  maxWeight: number,
  confidenceMultiplier: number,
  initialCapitalUSD: number = 2000,
): StrategyAllocation[] {
  const allocations: StrategyAllocation[] = [];

  // Identify rate arbitrage opportunities
  const lecapsSpread = macro.rates.lecaps - macro.rates.moneyMarket;
  const pfUVAPremium = macro.rates.plazoFijoUVA;
  const badlarVsPolicy = macro.rates.badlar - macro.rates.bcraPolicy;

  // Lecaps arbitrage: if Lecaps yield > MM by >2pp, rotate
  if (lecapsSpread > 2 && signals.liquidity.condition !== 'stressed' && signals.liquidity.condition !== 'frozen') {
    const lecapsProduct = products.find(p => p.type === 'lecaps');
    if (lecapsProduct) {
      const spreadBonus = Math.min(0.15, lecapsSpread / 20);
      const weight = Math.min(maxWeight, (0.12 + spreadBonus) * confidenceMultiplier);
      const capitalARS = initialCapitalUSD * macro.mep.rate;
      allocations.push({
        productId: lecapsProduct.id,
        productName: lecapsProduct.shortName,
        weight: Math.round(weight * 1000) / 1000,
        amountARS: Math.round(capitalARS * weight),
        amountUSD: Math.round((capitalARS * weight / macro.mep.rate) * 100) / 100,
        category: lecapsProduct.category,
        strategySource: 'rate_arbitrage_simulation',
        confidence: signals.carry.signal.confidence,
        isThrottled: weight < 0.12 + spreadBonus,
      });
    }
  }

  // UVA premium arbitrage: if inflation expectations > PF UVA premium, favor CER
  if (pfUVAPremium > 2 && signals.inflation.trend !== 'decelerating') {
    const uvaProduct = products.find(p => p.type === 'plazo_fijo_uva');
    if (uvaProduct) {
      const weight = Math.min(maxWeight, 0.12 * confidenceMultiplier);
      const capitalARS = initialCapitalUSD * macro.mep.rate;
      allocations.push({
        productId: uvaProduct.id,
        productName: uvaProduct.shortName,
        weight: Math.round(weight * 1000) / 1000,
        amountARS: Math.round(capitalARS * weight),
        amountUSD: Math.round((capitalARS * weight / macro.mep.rate) * 100) / 100,
        category: uvaProduct.category,
        strategySource: 'rate_arbitrage_simulation',
        confidence: signals.inflation.signal.confidence * 0.8,
        isThrottled: weight < 0.12,
      });
    }
  }

  return allocations;
}

// ============================================================================
// STRATEGY 4: USD HEDGED ALLOCATIONS
// FX hedge positioning — increase when devaluation risk rises
// ============================================================================
function usdHedgedAllocations(
  products: SantanderProduct[],
  macro: MacroState,
  signals: L1SignalBundle,
  maxWeight: number,
  confidenceMultiplier: number,
  initialCapitalUSD: number = 2000,
): StrategyAllocation[] {
  const allocations: StrategyAllocation[] = [];
  const devalProb = signals.regime.signal.value; // Already normalized [0, 1]

  // USD allocation scales with devaluation probability
  // But capped by mode constraints
  const mepProduct = products.find(p => p.type === 'mep');
  const usdFundProduct = products.find(p => p.type === 'usd_fund');

  // MEP allocation: scales with devaluation risk
  if (mepProduct && devalProb > 0.3) {
    const riskScaledWeight = Math.min(maxWeight, devalProb * 0.20 * confidenceMultiplier);
    if (riskScaledWeight > 0.01) {
      const capitalARS = initialCapitalUSD * macro.mep.rate;
      allocations.push({
        productId: mepProduct.id,
        productName: mepProduct.shortName,
        weight: Math.round(riskScaledWeight * 1000) / 1000,
        amountARS: Math.round(capitalARS * riskScaledWeight),
        amountUSD: Math.round((capitalARS * riskScaledWeight / macro.mep.rate) * 100) / 100,
        category: mepProduct.category,
        strategySource: 'usd_hedged_allocations',
        confidence: signals.regime.signal.confidence,
        isThrottled: riskScaledWeight < devalProb * 0.20,
      });
    }
  }

  // USD fund: always small allocation as hedge
  if (usdFundProduct) {
    const baseUSDWeight = signals.regime.regime === 'CRISIS' ? 0.10
      : signals.regime.regime === 'GLOBAL_RISK_OFF' ? 0.08
      : signals.regime.regime === 'WARNING' ? 0.05
      : 0.03;
    const weight = Math.min(maxWeight, baseUSDWeight * confidenceMultiplier);
    if (weight > 0.01) {
      const capitalARS = initialCapitalUSD * macro.mep.rate;
      allocations.push({
        productId: usdFundProduct.id,
        productName: usdFundProduct.shortName,
        weight: Math.round(weight * 1000) / 1000,
        amountARS: Math.round(capitalARS * weight),
        amountUSD: Math.round((capitalARS * weight / macro.mep.rate) * 100) / 100,
        category: usdFundProduct.category,
        strategySource: 'usd_hedged_allocations',
        confidence: signals.regime.signal.confidence * 0.9,
        isThrottled: weight < baseUSDWeight,
      });
    }
  }

  return allocations;
}

// ============================================================================
// CAPITAL PRESERVATION MODE
// 70% money market + 30% CER — zero risk, maximum safety
// ============================================================================
function capitalPreservationAllocation(
  products: SantanderProduct[],
  macro: MacroState,
  initialCapitalUSD: number = 2000,
): StrategyAllocation[] {
  const allocations: StrategyAllocation[] = [];
  const capitalARS = initialCapitalUSD * macro.mep.rate;

  const preservationWeights: Record<string, number> = {
    'super-ahorro': 0.70,
    'renta-fija-cer': 0.30,
  };

  for (const [productId, weight] of Object.entries(preservationWeights)) {
    const product = products.find(p => p.id === productId);
    if (!product) continue;
    allocations.push({
      productId: product.id,
      productName: product.shortName,
      weight,
      amountARS: Math.round(capitalARS * weight),
      amountUSD: Math.round((capitalARS * weight / macro.mep.rate) * 100) / 100,
      category: product.category,
      strategySource: 'capital_preservation',
      confidence: 0.5, // Low confidence = conservative
      isThrottled: false,
    });
  }

  return allocations;
}

// ============================================================================
// SCENARIO BOUNDS — Probabilistic output ranges
// ============================================================================
function computeScenarioBounds(
  signals: L1SignalBundle,
  allocations: StrategyAllocation[],
  products: SantanderProduct[],
  macro: MacroState
): ScenarioBound[] {
  // Calculate expected portfolio return
  const totalWeight = allocations.reduce((s, a) => s + a.weight, 0) || 1;
  let expectedReturn = 0;
  for (const alloc of allocations) {
    const product = products.find(p => p.id === alloc.productId);
    if (!product) continue;
    expectedReturn += (alloc.weight / totalWeight) * product.realRate30d;
  }

  // Volatility proxy from signals
  const volMultiplier = signals.volatility.regime === 'crisis' ? 3.0
    : signals.volatility.regime === 'stressed' ? 2.5
    : signals.volatility.regime === 'elevated' ? 2.0
    : signals.volatility.regime === 'normal' ? 1.5
    : 1.0;

  // Scenario bounds
  const downside: ScenarioBound = {
    probability: 0.25,
    returnMin: expectedReturn - 2 * volMultiplier,
    returnMax: expectedReturn - 0.5 * volMultiplier,
    returnExpected: expectedReturn - 1.2 * volMultiplier,
    label: 'downside',
  };

  const base: ScenarioBound = {
    probability: 0.50,
    returnMin: expectedReturn - 0.5 * volMultiplier,
    returnMax: expectedReturn + 0.5 * volMultiplier,
    returnExpected: expectedReturn,
    label: 'base',
  };

  const upside: ScenarioBound = {
    probability: 0.25,
    returnMin: expectedReturn + 0.3 * volMultiplier,
    returnMax: expectedReturn + 1.5 * volMultiplier,
    returnExpected: expectedReturn + 0.8 * volMultiplier,
    label: 'upside',
  };

  return [downside, base, upside];
}

// ============================================================================
// KILL SWITCH — Freeze strategy if any critical condition met
// ============================================================================
interface KillSwitchCheck {
  active: boolean;
  reason: string | null;
}

function checkKillSwitch(
  macro: MacroState,
  signals: L1SignalBundle,
  mode: StrategicMode
): KillSwitchCheck {
  // Condition 1: Data integrity loss (ERROR state)
  if (signals.hasError) {
    return { active: true, reason: 'KILL: ERROR state detected — data integrity compromised' };
  }

  // Condition 2: Unmodeled volatility (volatility regime crisis with low confidence)
  if (signals.volatility.regime === 'crisis' && signals.aggregateConfidence < 0.4) {
    return { active: true, reason: 'KILL: Unmodeled volatility — crisis regime with low data confidence' };
  }

  // Condition 3: Consecutive loss streak would exceed mode drawdown limit
  // (estimated from scenario bounds)
  const modeConfig = STRATEGIC_MODES[mode];
  const modeMaxDD = modeConfig.maxDrawdown * 100; // Use the mode's max drawdown config
  const currentMaxDD = Math.abs(signals.volatility.signal.value * 15); // estimate
  if (currentMaxDD > modeMaxDD) {
    return { active: true, reason: `KILL: Max drawdown estimate ${currentMaxDD.toFixed(1)}% exceeds ${mode} limit` };
  }

  // Condition 4: Probability of loss > 15% triggers de-risk (not full kill, but throttle)
  // This is handled by X10 confidence multiplier, not kill switch

  return { active: false, reason: null };
}

// ============================================================================
// MAIN: COMPUTE L2 STRATEGY OUTPUT
// ============================================================================
export function computeL2Strategy(
  macro: MacroState,
  signals: L1SignalBundle,
  mode: StrategicMode = 'MODERATE',
  initialCapitalUSD: number = 2000,
  monthlyOptimizationAnchor: number = 500
): L2StrategyOutput {
  const config = STRATEGIC_MODES[mode];
  const products = getProductsFromMacro(macro);
  const timestamp = new Date().toISOString();

  // ─── X10 DIRECTIVES ───
  const confidenceMultiplier = computeX10ConfidenceMultiplier(signals.aggregateConfidence);
  const isPreservationMode = isCapitalPreservationMode(signals);
  const isEmergencyFreezeActive = isEmergencyFreeze(signals);

  // ─── KILL SWITCH ───
  const killSwitch = checkKillSwitch(macro, signals, mode);

  // ─── EMERGENCY FREEZE: Return last-known-good or capital preservation ───
  if (isEmergencyFreezeActive || killSwitch.active) {
    const preservationAllocs = capitalPreservationAllocation(products, macro, initialCapitalUSD);
    return {
      allocations: preservationAllocs,
      mode,
      modeConfig: config,
      confidenceMultiplier: 0,
      isCapitalPreservation: true,
      isEmergencyFreeze: true,
      scenarios: computeScenarioBounds(signals, preservationAllocs, products, macro),
      expectedReturn30d: 0,
      expectedReturn90d: 0,
      probabilityOfLoss: 0.05,
      maxDrawdownEstimate: 0,
      capitalAtRisk: 0,
      fisherRealRate: signals.carry.fisherRate,
      dataQuality: signals.hasError ? 'ERROR' : signals.macroSource,
      timestamp,
      killSwitchActive: killSwitch.active,
      killSwitchReason: killSwitch.reason,
    };
  }

  // ─── CAPITAL PRESERVATION MODE: All STALE ───
  if (isPreservationMode) {
    const preservationAllocs = capitalPreservationAllocation(products, macro, initialCapitalUSD);
    return {
      allocations: preservationAllocs,
      mode,
      modeConfig: config,
      confidenceMultiplier,
      isCapitalPreservation: true,
      isEmergencyFreeze: false,
      scenarios: computeScenarioBounds(signals, preservationAllocs, products, macro),
      expectedReturn30d: 0.2,
      expectedReturn90d: 0.6,
      probabilityOfLoss: 0.05,
      maxDrawdownEstimate: 0.5,
      capitalAtRisk: 0.15,
      fisherRealRate: signals.carry.fisherRate,
      dataQuality: signals.macroSource,
      timestamp,
      killSwitchActive: false,
      killSwitchReason: null,
    };
  }

  // ─── NORMAL OPERATION: Strategy allocation ───
  const allAllocations: StrategyAllocation[] = [];
  const maxSingleWeight = config.maxSinglePosition;

  // Run all 4 strategy modules
  const carryAllocs = carryOptimization(products, macro, signals, maxSingleWeight, confidenceMultiplier, initialCapitalUSD);
  const mrAllocs = meanReversionMicro(products, macro, signals, maxSingleWeight, confidenceMultiplier, initialCapitalUSD);
  const arbAllocs = rateArbitrageSimulation(products, macro, signals, maxSingleWeight, confidenceMultiplier, initialCapitalUSD);
  const usdAllocs = usdHedgedAllocations(products, macro, signals, config.maxMEP, confidenceMultiplier, initialCapitalUSD);

  // Merge allocations by productId (sum weights from different strategies)
  const mergedWeights: Record<string, { total: number; alloc: StrategyAllocation }> = {};

  for (const alloc of [...carryAllocs, ...mrAllocs, ...arbAllocs, ...usdAllocs]) {
    if (!mergedWeights[alloc.productId]) {
      mergedWeights[alloc.productId] = { total: 0, alloc };
    }
    mergedWeights[alloc.productId].total += alloc.weight;
    // Keep the highest-confidence strategy source
    if (alloc.confidence > mergedWeights[alloc.productId].alloc.confidence) {
      mergedWeights[alloc.productId].alloc = alloc;
    }
  }

  // Add CER product if not already allocated (inflation hedge default)
  const cerProduct = products.find(p => p.type === 'cer_bond');
  if (cerProduct && !mergedWeights[cerProduct.id]) {
    const cerWeight = Math.min(maxSingleWeight, 0.15 * confidenceMultiplier);
    const capitalARS = initialCapitalUSD * macro.mep.rate;
    mergedWeights[cerProduct.id] = {
      total: cerWeight,
      alloc: {
        productId: cerProduct.id,
        productName: cerProduct.shortName,
        weight: cerWeight,
        amountARS: Math.round(capitalARS * cerWeight),
        amountUSD: Math.round((capitalARS * cerWeight / macro.mep.rate) * 100) / 100,
        category: cerProduct.category,
        strategySource: 'carry_optimization',
        confidence: signals.inflation.signal.confidence,
        isThrottled: cerWeight < 0.15,
      },
    };
  }

  // Normalize: ensure weights sum to 1.0 and respect mode constraints
  let totalRawWeight = 0;
  for (const entry of Object.values(mergedWeights)) {
    totalRawWeight += entry.total;
  }

  // Ensure money market minimum
  const mmProduct = products.find(p => p.type === 'money_market');
  const mmId = mmProduct?.id ?? 'super-ahorro';
  if (!mergedWeights[mmId] || mergedWeights[mmId].total / totalRawWeight < config.minMoneyMarket) {
    const minMMWeight = config.minMoneyMarket;
    if (mergedWeights[mmId]) {
      mergedWeights[mmId].total = minMMWeight;
    } else if (mmProduct) {
      const capitalARS = initialCapitalUSD * macro.mep.rate;
      mergedWeights[mmId] = {
        total: minMMWeight,
        alloc: {
          productId: mmProduct.id,
          productName: mmProduct.shortName,
          weight: minMMWeight,
          amountARS: Math.round(capitalARS * minMMWeight),
          amountUSD: Math.round((capitalARS * minMMWeight / macro.mep.rate) * 100) / 100,
          category: mmProduct.category,
          strategySource: 'carry_optimization',
          confidence: signals.carry.signal.confidence,
          isThrottled: false,
        },
      };
    }
  }

  // Re-normalize to sum = 1.0
  const newTotal = Object.values(mergedWeights).reduce((s, e) => s + e.total, 0);
  for (const entry of Object.values(mergedWeights)) {
    const normalizedWeight = Math.round((entry.total / newTotal) * 1000) / 1000;
    entry.alloc.weight = normalizedWeight;
    const capitalARS = initialCapitalUSD * macro.mep.rate;
    entry.alloc.amountARS = Math.round(capitalARS * normalizedWeight);
    entry.alloc.amountUSD = Math.round((capitalARS * normalizedWeight / macro.mep.rate) * 100) / 100;
  }

  // Build final allocation list
  for (const entry of Object.values(mergedWeights)) {
    allAllocations.push(entry.alloc);
  }

  // Sort by weight descending
  allAllocations.sort((a, b) => b.weight - a.weight);

  // Compute scenarios
  const scenarios = computeScenarioBounds(signals, allAllocations, products, macro);

  // Compute expected returns
  const totalW = allAllocations.reduce((s, a) => s + a.weight, 0) || 1;
  let expectedReturn30d = 0;
  for (const alloc of allAllocations) {
    const product = products.find(p => p.id === alloc.productId);
    if (!product) continue;
    expectedReturn30d += (alloc.weight / totalW) * product.realRate30d;
  }
  const expectedReturn90d = expectedReturn30d * 2.8; // Simple extrapolation

  // Probability of loss: based on downside scenario
  const downReturn = scenarios.find(s => s.label === 'downside')?.returnExpected ?? -2;
  const probabilityOfLoss = downReturn < 0 ? Math.min(0.50, 0.15 + Math.abs(downReturn) / 10) : 0.05;

  // Max drawdown estimate
  const maxDrawdownEstimate = Math.abs(scenarios.find(s => s.label === 'downside')?.returnMin ?? -3);

  // Capital at risk
  const riskAssets = allAllocations.filter(a =>
    a.category === 'yield' || a.category === 'fx_hedge'
  );
  const capitalAtRisk = riskAssets.reduce((s, a) => s + a.weight, 0);

  // Fisher real rate
  const fisherRealRate = signals.carry.fisherRate;

  // De-risk if probability of loss > 15%
  const finalAllocations = probabilityOfLoss > 0.15
    ? applyDeRiskMode(allAllocations, products, macro, config, initialCapitalUSD)
    : allAllocations;

  return {
    allocations: finalAllocations,
    mode,
    modeConfig: config,
    confidenceMultiplier,
    isCapitalPreservation: false,
    isEmergencyFreeze: false,
    scenarios,
    expectedReturn30d: Math.round(expectedReturn30d * 100) / 100,
    expectedReturn90d: Math.round(expectedReturn90d * 100) / 100,
    probabilityOfLoss: Math.round(probabilityOfLoss * 100) / 100,
    maxDrawdownEstimate: Math.round(maxDrawdownEstimate * 100) / 100,
    capitalAtRisk: Math.round(capitalAtRisk * 100) / 100,
    fisherRealRate,
    dataQuality: signals.macroSource,
    timestamp,
    killSwitchActive: false,
    killSwitchReason: null,
  };
}

// ============================================================================
// DE-RISK MODE — Automatically reduce aggressiveness when P(loss) > 15%
// ============================================================================
function applyDeRiskMode(
  allocations: StrategyAllocation[],
  products: SantanderProduct[],
  macro: MacroState,
  config: StrategicModeConfig,
  initialCapitalUSD: number = 2000,
): StrategyAllocation[] {
  // Increase money market weight by 15%, reduce risk assets proportionally
  const mmId = 'super-ahorro';
  const riskCategories = new Set(['yield', 'fx_hedge']);

  const mmAlloc = allocations.find(a => a.productId === mmId);
  const riskAllocs = allocations.filter(a => riskCategories.has(a.category));
  const safeAllocs = allocations.filter(a => !riskCategories.has(a.category) && a.productId !== mmId);

  // Increase MM by 15 percentage points
  const newMMWeight = mmAlloc ? Math.min(config.maxSinglePosition, mmAlloc.weight + 0.15) : config.minMoneyMarket;

  // Reduce risk assets proportionally
  const riskReduction = 0.15;
  const reducedRiskAllocs = riskAllocs.map(a => ({
    ...a,
    weight: Math.max(0.01, a.weight * (1 - riskReduction)),
    isThrottled: true,
  }));

  // Re-normalize
  const allNew = [
    { ...mmAlloc, weight: newMMWeight } as StrategyAllocation,
    ...safeAllocs,
    ...reducedRiskAllocs,
  ];

  const totalWeight = allNew.reduce((s, a) => s + a.weight, 0) || 1;
  const capitalARS = initialCapitalUSD * macro.mep.rate;

  return allNew.map(a => ({
    ...a,
    weight: Math.round((a.weight / totalWeight) * 1000) / 1000,
    amountARS: Math.round(capitalARS * a.weight / totalWeight),
    amountUSD: Math.round((capitalARS * a.weight / totalWeight / macro.mep.rate) * 100) / 100,
  }));
}
