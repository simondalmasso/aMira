// ============================================================================
// Ω-MYTHOS CAPITAL BUCKET ENGINE — REALISTIC_CAPITAL_ARCHITECTURE_v1
// Multi-layer capital allocator with 5 buckets, regime-dependent rules,
// hard risk limits, and scaling path awareness.
//
// ARCHITECTURE: L0_DATA → L1_REGIME → L2_BUCKETS → L3_RISK → L4_EXECUTION
//
// FUNDAMENTAL INSIGHT:
//   $500/month is structurally a CAPITAL SCALE problem, not an alpha problem.
//   At 1%/month realistic returns, you need $50,000 capital.
//   Returns are non-linear and regime-dependent.
//   Higher returns require higher capital, NOT higher leverage.
//
// FORBIDDEN OUTPUT:
//   - guaranteed returns
//   - deterministic predictions
//   - fixed return promises
// ============================================================================

import {
  type MacroState,
  type SantanderProduct,
  type DataLabel,
  getProductsFromMacro,
} from './live-data';
import {
  type MacroRegime,
  type OracleState,
  computeOracle,
} from './macroOracle';

// ============================================================================
// REGIME TYPES — Extended from REALISTIC_CAPITAL_ARCHITECTURE_v1
// ============================================================================
export type CapitalRegime = 'CRISIS' | 'HIGH_VOL' | 'NORMAL' | 'CARRY_FAVORABLE';

export interface RegimeState {
  regime: CapitalRegime;
  confidence: number;           // 0-1
  source: DataLabel;
  timestamp: string;
}

// ============================================================================
// CAPITAL BUCKET TYPES
// ============================================================================
export type BucketId =
  | 'CAPITAL_PRESERVATION'
  | 'INFLATION_HEDGE'
  | 'CARRY_OPPORTUNISTIC'
  | 'USD_HEDGE_GROWTH'
  | 'OPPORTUNISTIC_TACTICAL';

export interface CapitalBucket {
  id: BucketId;
  name: string;
  allocation: number;            // current weight [0, 1]
  baseAllocation: number;        // base (NORMAL regime) weight
  instruments: string[];         // SantanderProduct IDs mapped to this bucket
  role: string;
  expectedReturnMonthly: number; // realistic monthly return estimate
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  activationCondition: string;   // when this bucket is active
  isActive: boolean;             // currently active based on regime
}

// ============================================================================
// SCALING PATH — Capital-dependent behavior
// ============================================================================
export type ScalingPhase = 'SURVIVAL' | 'COMPOUNDING' | 'INCOME';

export interface ScalingPhaseConfig {
  phase: ScalingPhase;
  capitalRangeMin: number;       // USD
  capitalRangeMax: number;       // USD
  goal: string;
  incomeTargetMin: number;       // USD/month
  incomeTargetMax: number;       // USD/month
  maxRiskCap: number;            // Maximum risk_cap allowed in this phase
  minPreservation: number;       // Minimum capital preservation bucket weight
}

export const SCALING_PATHS: Record<ScalingPhase, ScalingPhaseConfig> = {
  SURVIVAL: {
    phase: 'SURVIVAL',
    capitalRangeMin: 0,
    capitalRangeMax: 5000,
    goal: 'Supervivencia + consistencia',
    incomeTargetMin: 0,
    incomeTargetMax: 30,
    maxRiskCap: 0.15,
    minPreservation: 0.50,
  },
  COMPOUNDING: {
    phase: 'COMPOUNDING',
    capitalRangeMin: 5000,
    capitalRangeMax: 25000,
    goal: 'Interés compuesto estable',
    incomeTargetMin: 30,
    incomeTargetMax: 250,
    maxRiskCap: 0.30,
    minPreservation: 0.35,
  },
  INCOME: {
    phase: 'INCOME',
    capitalRangeMin: 25000,
    capitalRangeMax: 60000,
    goal: 'Generación de ingresos',
    incomeTargetMin: 250,
    incomeTargetMax: 600,
    maxRiskCap: 0.45,
    minPreservation: 0.25,
  },
};

// ============================================================================
// HARD RISK LIMITS — Non-negotiable
// ============================================================================
export const HARD_RISK_LIMITS = {
  maxDrawdown: 0.12,            // 12% maximum drawdown (was 100% — UNREALISTIC)
  dailyVaRLimit: 0.02,          // 2% daily VaR
  lossProbabilityLimit: 0.15,   // 15% max probability of loss
  maxLeverage: 1.0,             // No leverage (paper-first execution)
  capitalPreservationPriority: 0.70, // 70% capital preservation priority
  staleDataDeRiskRatio: 0.30,   // Reduce risk if >30% data is stale
} as const;

// ============================================================================
// BASE BUCKET ALLOCATIONS (NORMAL regime)
// ============================================================================
const BASE_ALLOCATIONS: Record<BucketId, number> = {
  CAPITAL_PRESERVATION: 0.40,
  INFLATION_HEDGE: 0.25,
  CARRY_OPPORTUNISTIC: 0.15,
  USD_HEDGE_GROWTH: 0.15,
  OPPORTUNISTIC_TACTICAL: 0.05,
};

// ============================================================================
// REGIME → BUCKET ADJUSTMENT RULES
// ============================================================================
export const REGIME_BUCKET_RULES: Record<CapitalRegime, {
  label: string;
  bucketAdjustments: Partial<Record<BucketId, number>>;
  description: string;
}> = {
  CRISIS: {
    label: 'Crisis — Preservación máxima',
    bucketAdjustments: {
      CAPITAL_PRESERVATION: 0.80,   // Increase preservation to 80%
      INFLATION_HEDGE: 0.15,       // Reduce inflation hedge
      CARRY_OPPORTUNISTIC: 0.00,   // Disable carry
      USD_HEDGE_GROWTH: 0.05,      // Minimal USD hedge
      OPPORTUNISTIC_TACTICAL: 0.00, // Disable tactical
    },
    description: 'Aumentar preservación a 80%. Desactivar carry y táctico. USD hedge mínimo.',
  },
  HIGH_VOL: {
    label: 'Alta volatilidad — Reducir carry',
    bucketAdjustments: {
      CAPITAL_PRESERVATION: 0.55,
      INFLATION_HEDGE: 0.20,
      CARRY_OPPORTUNISTIC: 0.00,   // Disable carry
      USD_HEDGE_GROWTH: 0.20,      // Increase USD hedge
      OPPORTUNISTIC_TACTICAL: 0.05,
    },
    description: 'Desactivar bucket carry. Aumentar cobertura USD. Preservación elevada.',
  },
  NORMAL: {
    label: 'Normal — Asignación base',
    bucketAdjustments: BASE_ALLOCATIONS,
    description: 'Asignación base: 40% preservación, 25% inflación, 15% carry, 15% USD, 5% táctico.',
  },
  CARRY_FAVORABLE: {
    label: 'Carry favorable — Aumentar carry',
    bucketAdjustments: {
      CAPITAL_PRESERVATION: 0.30,
      INFLATION_HEDGE: 0.20,
      CARRY_OPPORTUNISTIC: 0.25,   // Increase carry to 25%
      USD_HEDGE_GROWTH: 0.15,
      OPPORTUNISTIC_TACTICAL: 0.10,
    },
    description: 'Aumentar carry a 25%. Táctico ampliado a 10%. Preservación reducida.',
  },
};

// ============================================================================
// PRODUCT → BUCKET MAPPING
// Maps SantanderProduct IDs to capital buckets
// ============================================================================
export const PRODUCT_BUCKET_MAP: Record<string, BucketId> = {
  'super-ahorro': 'CAPITAL_PRESERVATION',
  'fondo-corto-plazo': 'CAPITAL_PRESERVATION',
  'renta-fija-cer': 'INFLATION_HEDGE',
  'plazo-fijo-uva': 'INFLATION_HEDGE',
  'plazo-fijo': 'CARRY_OPPORTUNISTIC',
  'lecaps': 'CARRY_OPPORTUNISTIC',
  'super-ahorro-usd': 'USD_HEDGE_GROWTH',
  'dolar-mep': 'USD_HEDGE_GROWTH',
  'supergestion-mix-vi': 'OPPORTUNISTIC_TACTICAL',
};

// ============================================================================
// BUCKET METADATA
// ============================================================================
export const BUCKET_METADATA: Record<BucketId, {
  name: string;
  role: string;
  expectedReturnMonthly: number;
  riskLevel: CapitalBucket['riskLevel'];
  instruments: string[];
  activationCondition: string;
  color: string;             // For UI display
  bgColor: string;           // For UI background
}> = {
  CAPITAL_PRESERVATION: {
    name: 'Preservación de Capital',
    role: 'Ancla de estabilidad — Liquidez inmediata, capital protegido',
    expectedReturnMonthly: 0.006,
    riskLevel: 'LOW',
    instruments: ['money_market_funds', 'short_term_bills'],
    activationCondition: 'Siempre activo — mínimo 25%',
    color: '#16a34a',
    bgColor: 'rgba(22,163,74,0.06)',
  },
  INFLATION_HEDGE: {
    name: 'Cobertura Inflacionaria',
    role: 'Protección del poder adquisitivo — CER + UVA',
    expectedReturnMonthly: 0.009,
    riskLevel: 'MEDIUM',
    instruments: ['CER_indexed_assets', 'inflation_linked_funds'],
    activationCondition: 'Siempre activo — mínimo 15%',
    color: '#2563eb',
    bgColor: 'rgba(37,99,235,0.06)',
  },
  CARRY_OPPORTUNISTIC: {
    name: 'Carry Oportunista',
    role: 'Captura carry ARS cuando el régimen lo permite',
    expectedReturnMonthly: 0.015,
    riskLevel: 'HIGH',
    instruments: ['ARS_carry', 'rates_spreads'],
    activationCondition: 'Solo si macro_regime == STABLE y FX_volatility < threshold',
    color: '#ca8a04',
    bgColor: 'rgba(202,138,4,0.06)',
  },
  USD_HEDGE_GROWTH: {
    name: 'Cobertura USD + Crecimiento',
    role: 'Crecimiento con cobertura cambiaria',
    expectedReturnMonthly: 0.008,
    riskLevel: 'MEDIUM',
    instruments: ['CEDEARs', 'USD_ETFs'],
    activationCondition: 'Siempre activo — mínimo 10%',
    color: '#7c3aed',
    bgColor: 'rgba(124,58,237,0.06)',
  },
  OPPORTUNISTIC_TACTICAL: {
    name: 'Táctico Oportunista',
    role: 'Dislocaciones macro, posiciones event-driven',
    expectedReturnMonthly: 0.020,
    riskLevel: 'VERY_HIGH',
    instruments: ['macro_dislocations', 'event_driven_positions'],
    activationCondition: 'Solo si confidence > 0.75',
    color: '#dc2626',
    bgColor: 'rgba(220,38,38,0.06)',
  },
};

// ============================================================================
// REGIME DETECTION — Map from OracleState to CapitalRegime
// ============================================================================
export function detectCapitalRegime(oracle: OracleState | null, macro: MacroState): RegimeState {
  if (!oracle) {
    return {
      regime: 'NORMAL',
      confidence: 0.3,
      source: macro.source,
      timestamp: new Date().toISOString(),
    };
  }

  const devalProb = oracle.devaluationProbability;
  const gap = macro.mep.gap;
  const carry = macro.rates.moneyMarket / 12 - macro.crawlingPeg;
  const inflation = macro.inflation.expected30d;
  const volRegime = oracle.devaluationRiskBand;

  // CRISIS: High devaluation probability, extreme gap, severe inflation
  if (devalProb >= 60 || gap > 50 || inflation > 6) {
    return {
      regime: 'CRISIS',
      confidence: oracle.confidenceScore / 100,
      source: oracle.source,
      timestamp: oracle.timestamp,
    };
  }

  // HIGH_VOL: Moderate-high devaluation risk, elevated gap, carry under pressure
  if (devalProb >= 30 || gap > 25 || inflation > 3.5 || volRegime === 'high') {
    return {
      regime: 'HIGH_VOL',
      confidence: oracle.confidenceScore / 100,
      source: oracle.source,
      timestamp: oracle.timestamp,
    };
  }

  // CARRY_FAVORABLE: Low devaluation risk, positive carry, stable FX, low inflation
  if (carry > 1.0 && gap < 15 && inflation < 3.0 && volRegime === 'stable') {
    return {
      regime: 'CARRY_FAVORABLE',
      confidence: oracle.confidenceScore / 100,
      source: oracle.source,
      timestamp: oracle.timestamp,
    };
  }

  // NORMAL: Default — moderate conditions
  return {
    regime: 'NORMAL',
    confidence: oracle.confidenceScore / 100,
    source: oracle.source,
    timestamp: oracle.timestamp,
  };
}

// ============================================================================
// SCALING PHASE DETECTION — Capital-dependent phase
// ============================================================================
export function detectScalingPhase(capitalUSD: number): ScalingPhaseConfig {
  if (capitalUSD < SCALING_PATHS.COMPOUNDING.capitalRangeMin) {
    return SCALING_PATHS.SURVIVAL;
  }
  if (capitalUSD < SCALING_PATHS.INCOME.capitalRangeMin) {
    return SCALING_PATHS.COMPOUNDING;
  }
  return SCALING_PATHS.INCOME;
}

// ============================================================================
// BUCKET ALLOCATION ENGINE
// Compute bucket weights based on regime + scaling phase + hard limits
// ============================================================================
export interface BucketAllocationResult {
  buckets: CapitalBucket[];
  regime: RegimeState;
  scalingPhase: ScalingPhaseConfig;
  blendedExpectedReturn: number;  // Monthly blended expected return
  maxDrawdownEstimate: number;    // Estimated max drawdown
  capitalAtRisk: number;          // % of capital at risk
  riskViolations: string[];       // Any hard risk limit violations
  productAllocations: {
    productId: string;
    productName: string;
    weight: number;
    bucketId: BucketId;
    bucketName: string;
    amountUSD: number;
    amountARS: number;
    category: string;
  }[];
  timestamp: string;
  dataMode: DataLabel;
}

export function computeBucketAllocations(
  macro: MacroState,
  oracle: OracleState | null,
  capitalUSD: number = 2000,
): BucketAllocationResult {
  const timestamp = new Date().toISOString();
  const products = getProductsFromMacro(macro);

  // 1. Detect regime
  const regime = detectCapitalRegime(oracle, macro);

  // 2. Detect scaling phase
  const scalingPhase = detectScalingPhase(capitalUSD);

  // 3. Get regime bucket rules
  const rules = REGIME_BUCKET_RULES[regime.regime];
  const riskViolations: string[] = [];

  // 4. Apply regime adjustments with scaling phase constraints
  // Start with base allocations, then overlay regime adjustments
  const bucketAllocations: Record<BucketId, number> = {
    CAPITAL_PRESERVATION: rules.bucketAdjustments.CAPITAL_PRESERVATION ?? BASE_ALLOCATIONS.CAPITAL_PRESERVATION,
    INFLATION_HEDGE: rules.bucketAdjustments.INFLATION_HEDGE ?? BASE_ALLOCATIONS.INFLATION_HEDGE,
    CARRY_OPPORTUNISTIC: rules.bucketAdjustments.CARRY_OPPORTUNISTIC ?? BASE_ALLOCATIONS.CARRY_OPPORTUNISTIC,
    USD_HEDGE_GROWTH: rules.bucketAdjustments.USD_HEDGE_GROWTH ?? BASE_ALLOCATIONS.USD_HEDGE_GROWTH,
    OPPORTUNISTIC_TACTICAL: rules.bucketAdjustments.OPPORTUNISTIC_TACTICAL ?? BASE_ALLOCATIONS.OPPORTUNISTIC_TACTICAL,
  };

  // 5. Enforce scaling phase minimum preservation
  if (bucketAllocations.CAPITAL_PRESERVATION < scalingPhase.minPreservation) {
    bucketAllocations.CAPITAL_PRESERVATION = scalingPhase.minPreservation;
  }

  // 6. Enforce scaling phase max risk cap
  const riskBuckets: BucketId[] = ['CARRY_OPPORTUNISTIC', 'OPPORTUNISTIC_TACTICAL'];
  const totalRiskWeight = riskBuckets.reduce((s, id) => s + (bucketAllocations[id] || 0), 0);
  if (totalRiskWeight > scalingPhase.maxRiskCap) {
    const scale = scalingPhase.maxRiskCap / totalRiskWeight;
    for (const id of riskBuckets) {
      bucketAllocations[id] = (bucketAllocations[id] || 0) * scale;
    }
  }

  // 7. Disable CARRY_OPPORTUNISTIC if regime is CRISIS or HIGH_VOL
  //    (already handled by bucketAdjustments, but enforce explicitly)
  if (regime.regime === 'CRISIS' || regime.regime === 'HIGH_VOL') {
    if (bucketAllocations.CARRY_OPPORTUNISTIC > 0) {
      bucketAllocations.CARRY_OPPORTUNISTIC = 0;
    }
  }

  // 8. Disable OPPORTUNISTIC_TACTICAL if confidence < 0.75
  if (regime.confidence < 0.75) {
    if (bucketAllocations.OPPORTUNISTIC_TACTICAL > 0) {
      // Redistribute to preservation
      bucketAllocations.CAPITAL_PRESERVATION += bucketAllocations.OPPORTUNISTIC_TACTICAL;
      bucketAllocations.OPPORTUNISTIC_TACTICAL = 0;
    }
  }

  // 9. Stale data de-risk: if stale data ratio > 30%, reduce risk
  const staleRatio = 1 - (macro.realDataPct / 100);
  if (staleRatio > HARD_RISK_LIMITS.staleDataDeRiskRatio) {
    const riskReduction = 0.5; // Cut risk bucket weights in half
    for (const id of riskBuckets) {
      const reduced = (bucketAllocations[id] || 0) * riskReduction;
      bucketAllocations.CAPITAL_PRESERVATION += (bucketAllocations[id] || 0) - reduced;
      bucketAllocations[id] = reduced;
    }
    riskViolations.push(`Stale data ratio ${(staleRatio * 100).toFixed(0)}% > ${(HARD_RISK_LIMITS.staleDataDeRiskRatio * 100).toFixed(0)}% — risk reduced`);
  }

  // 10. ERROR state → capital preservation only
  if (macro.source === 'ERROR') {
    bucketAllocations.CAPITAL_PRESERVATION = 1.0;
    bucketAllocations.INFLATION_HEDGE = 0;
    bucketAllocations.CARRY_OPPORTUNISTIC = 0;
    bucketAllocations.USD_HEDGE_GROWTH = 0;
    bucketAllocations.OPPORTUNISTIC_TACTICAL = 0;
    riskViolations.push('ERROR state — ALL capital in preservation bucket');
  }

  // 11. Normalize to ensure weights sum to 1.0
  const totalWeight = Object.values(bucketAllocations).reduce((s, w) => s + w, 0);
  if (totalWeight > 0 && Math.abs(totalWeight - 1.0) > 0.001) {
    const scale = 1.0 / totalWeight;
    for (const id of Object.keys(bucketAllocations) as BucketId[]) {
      bucketAllocations[id] = bucketAllocations[id] * scale;
    }
  }

  // 12. Build bucket objects
  const buckets: CapitalBucket[] = (Object.keys(BUCKET_METADATA) as BucketId[]).map(id => {
    const meta = BUCKET_METADATA[id];
    const allocation = Math.round((bucketAllocations[id] || 0) * 1000) / 1000;
    return {
      id,
      name: meta.name,
      allocation,
      baseAllocation: BASE_ALLOCATIONS[id],
      instruments: meta.instruments,
      role: meta.role,
      expectedReturnMonthly: meta.expectedReturnMonthly,
      riskLevel: meta.riskLevel,
      activationCondition: meta.activationCondition,
      isActive: allocation > 0.01,
    };
  });

  // 13. Compute blended expected return
  const blendedReturn = buckets.reduce(
    (s, b) => s + b.allocation * b.expectedReturnMonthly, 0
  );

  // 14. Compute risk metrics
  const capitalAtRisk = riskBuckets.reduce(
    (s, id) => s + (bucketAllocations[id] || 0), 0
  );
  const maxDrawdownEstimate = computeMaxDrawdownEstimate(buckets, regime.regime);

  // 15. Check hard risk limits
  if (maxDrawdownEstimate > HARD_RISK_LIMITS.maxDrawdown) {
    riskViolations.push(
      `Max drawdown ${(maxDrawdownEstimate * 100).toFixed(1)}% exceeds limit ${(HARD_RISK_LIMITS.maxDrawdown * 100).toFixed(0)}%`
    );
  }

  // 16. Distribute bucket weights to individual products
  const productAllocations = distributeToProducts(buckets, products, macro, capitalUSD);

  return {
    buckets,
    regime,
    scalingPhase,
    blendedExpectedReturn: Math.round(blendedReturn * 10000) / 100, // as percentage
    maxDrawdownEstimate: Math.round(maxDrawdownEstimate * 1000) / 1000,
    capitalAtRisk: Math.round(capitalAtRisk * 1000) / 1000,
    riskViolations,
    productAllocations,
    timestamp,
    dataMode: macro.source,
  };
}

// ============================================================================
// MAX DRAWDOWN ESTIMATE — Regime-dependent
// ============================================================================
function computeMaxDrawdownEstimate(buckets: CapitalBucket[], regime: CapitalRegime): number {
  // Base drawdown estimates per bucket (in worst-case scenario)
  const bucketDD: Record<BucketId, number> = {
    CAPITAL_PRESERVATION: 0.01,
    INFLATION_HEDGE: 0.03,
    CARRY_OPPORTUNISTIC: 0.08,
    USD_HEDGE_GROWTH: 0.05,
    OPPORTUNISTIC_TACTICAL: 0.12,
  };

  // Regime multipliers
  const regimeMultiplier: Record<CapitalRegime, number> = {
    CRISIS: 2.0,
    HIGH_VOL: 1.5,
    NORMAL: 1.0,
    CARRY_FAVORABLE: 0.8,
  };

  const multiplier = regimeMultiplier[regime];
  let weightedDD = 0;
  for (const bucket of buckets) {
    weightedDD += bucket.allocation * bucketDD[bucket.id] * multiplier;
  }

  return Math.min(weightedDD, 0.30); // Cap at 30% absolute worst case
}

// ============================================================================
// DISTRIBUTE BUCKET WEIGHTS TO INDIVIDUAL PRODUCTS
// Maps each bucket's weight to the Santander products it contains
// ============================================================================
function distributeToProducts(
  buckets: CapitalBucket[],
  products: SantanderProduct[],
  macro: MacroState,
  capitalUSD: number,
): BucketAllocationResult['productAllocations'] {
  const allocations: BucketAllocationResult['productAllocations'] = [];
  const capitalARS = capitalUSD * macro.mep.rate;

  for (const bucket of buckets) {
    if (bucket.allocation < 0.001) continue;

    // Find products that belong to this bucket
    const bucketProductIds = Object.entries(PRODUCT_BUCKET_MAP)
      .filter(([, bId]) => bId === bucket.id)
      .map(([pId]) => pId);

    const bucketProducts = products.filter(p => bucketProductIds.includes(p.id));

    if (bucketProducts.length === 0) continue;

    // Distribute weight equally among products in this bucket
    // (could be made smarter with scoring later)
    const weightPerProduct = bucket.allocation / bucketProducts.length;

    for (const product of bucketProducts) {
      const amountUSD = Math.round(capitalUSD * weightPerProduct * 100) / 100;
      const amountARS = Math.round(capitalARS * weightPerProduct);

      allocations.push({
        productId: product.id,
        productName: product.shortName,
        weight: Math.round(weightPerProduct * 1000) / 1000,
        bucketId: bucket.id,
        bucketName: bucket.name,
        amountUSD,
        amountARS,
        category: product.category,
      });
    }
  }

  // Normalize to ensure weights sum to 1.0
  const totalWeight = allocations.reduce((s, a) => s + a.weight, 0);
  if (totalWeight > 0 && Math.abs(totalWeight - 1.0) > 0.001) {
    const scale = 1.0 / totalWeight;
    for (const alloc of allocations) {
      alloc.weight = Math.round(alloc.weight * scale * 1000) / 1000;
      alloc.amountUSD = Math.round(capitalUSD * alloc.weight * 100) / 100;
      alloc.amountARS = Math.round(capitalARS * alloc.weight);
    }
  }

  // Sort by weight descending
  allocations.sort((a, b) => b.weight - a.weight);

  return allocations;
}

// ============================================================================
// RETURN EXPECTATIONS — Realistic, regime-dependent
// ============================================================================
export interface ReturnExpectation {
  monthlyBlended: number;        // Expected monthly blended return (%)
  monthlyRange: { min: number; max: number }; // ±2% dispersion band
  annualized: number;            // Annualized estimate
  note: string;
}

export function computeRealisticReturns(
  buckets: CapitalBucket[],
  regime: CapitalRegime,
): ReturnExpectation {
  const blended = buckets.reduce(
    (s, b) => s + b.allocation * b.expectedReturnMonthly, 0
  );

  // Volatility band: ±2% monthly dispersion
  const dispersion = 0.02;
  const minReturn = blended - dispersion;
  const maxReturn = blended + dispersion;

  // Annualized: compound monthly returns (geometric)
  const annualized = (Math.pow(1 + blended, 12) - 1);

  const regimeNote: Record<CapitalRegime, string> = {
    CRISIS: 'Régimen de crisis — retornos bajos, preservación prioritaria',
    HIGH_VOL: 'Alta volatilidad — carry desactivado, mayor dispersión',
    NORMAL: 'Régimen normal — retornos moderados, carry activo parcial',
    CARRY_FAVORABLE: 'Carry favorable — oportunidad de mayor retorno',
  };

  return {
    monthlyBlended: Math.round(blended * 10000) / 100, // as percentage
    monthlyRange: {
      min: Math.round(minReturn * 10000) / 100,
      max: Math.round(maxReturn * 10000) / 100,
    },
    annualized: Math.round(annualized * 10000) / 100,
    note: regimeNote[regime],
  };
}

// ============================================================================
// CAPITAL ADEQUACY — What capital is needed for a given income target?
// ============================================================================
export interface CapitalAdequacyResult {
  targetMonthlyIncome: number;     // USD
  requiredCapitalConservative: number; // At 0.5%/month
  requiredCapitalBase: number;     // At 1.0%/month
  requiredCapitalAggressive: number; // At 1.5%/month
  currentCapital: number;
  currentPhase: ScalingPhaseConfig;
  gapToBase: number;               // USD gap to reach base target
  feasibilityNote: string;
}

export function computeCapitalAdequacy(
  targetMonthlyIncome: number,
  currentCapital: number,
): CapitalAdequacyResult {
  const returnConservative = 0.005; // 0.5%/month
  const returnBase = 0.01;         // 1.0%/month
  const returnAggressive = 0.015;  // 1.5%/month

  const requiredConservative = targetMonthlyIncome / returnConservative;
  const requiredBase = targetMonthlyIncome / returnBase;
  const requiredAggressive = targetMonthlyIncome / returnAggressive;

  const currentPhase = detectScalingPhase(currentCapital);
  const gapToBase = Math.max(0, requiredBase - currentCapital);

  let feasibilityNote: string;
  if (currentCapital >= requiredBase) {
    feasibilityNote = `Capital actual suficiente para generar ~$${(currentCapital * returnBase).toFixed(0)}/mes al retorno base.`;
  } else if (currentCapital >= requiredAggressive) {
    feasibilityNote = `Capital actual requiere retornos agresivos (${(returnAggressive * 100).toFixed(1)}%/mes) para alcanzar el objetivo. No realista sin mayor capital.`;
  } else {
    feasibilityNote = `Capital insuficiente. Se necesitan $${requiredBase.toLocaleString()} USD al retorno base de ${(returnBase * 100).toFixed(1)}%/mes. Brecha: $${gapToBase.toLocaleString()} USD. $${targetMonthlyIncome}/mes es un problema de escala de capital, no de alpha.`;
  }

  return {
    targetMonthlyIncome,
    requiredCapitalConservative: Math.round(requiredConservative),
    requiredCapitalBase: Math.round(requiredBase),
    requiredCapitalAggressive: Math.round(requiredAggressive),
    currentCapital,
    currentPhase,
    gapToBase: Math.round(gapToBase),
    feasibilityNote,
  };
}
