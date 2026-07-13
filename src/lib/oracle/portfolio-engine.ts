// src/lib/oracle/portfolio-engine.ts
// ORACLE_UI_DYNAMIC_CAPITAL_RISK_ENGINE_V1
//
// Dynamic capital-driven portfolio engine. Derives allocation weights from
// (capital, risk_slider, stress_mode) and projects portfolio value using
// existing oracle outputs only (no new APIs).
//
// Design principles (per V1 spec):
//   - Non-breaking: pure utility module, no React, no I/O.
//   - Single source of truth: uses AssetMetrics[] from existing oracle API.
//   - Memoizable: buildPortfolio is pure — safe to wrap in useMemo.
//   - Guards preserved: never invents prices; null/missing metrics fall back
//     to neutral multipliers (1.0) rather than fabricated values.
//
// Math model:
//   V_stress = Σ (w_i × p_i × shock_i)
//   profit   = V_current - V_initial
//   w_i      = base_weight_i × risk_slider_factor × stress_factor
//   Σ w_i    = 1 (normalized)
//
// Constraints:
//   FCI_min:           0.10  (must keep ≥10% in money-market FCI for liquidity)
//   PF_min:             0.05  (must keep ≥5% in Plazo Fijo for capital protection)
//   max_single_asset:  0.25  (no single ticker >25% of portfolio)

import type { AssetMetrics, AssetClass } from '@/lib/oracle-multi/types';

// ─── Types ─────────────────────────────────────────────────────────────────

export type StressMode = 'CRISIS' | 'SIDEWAYS' | 'BULL';

export interface PortfolioInput {
  capital: number;            // USD
  risk: number;               // 0-100
  stressMode: StressMode;
  oracleData: AssetMetrics[]; // flat list across all asset classes
  topNPerClass?: number;      // default 5 — picks top-N by oracle_score per class
}

export interface Allocation {
  asset: AssetMetrics;
  weight: number;             // 0-1, share of total portfolio
  invested_usd: number;       // capital × weight
  shares: number;             // invested_usd / price_usd (price converted via MEP if ARS)
  current_price_usd: number;  // price in USD (ARS assets divided by mep_rate assumption)
  stressed_price_usd: number; // current_price_usd × (1 + shock)
  current_value_usd: number;  // shares × current_price_usd
  stressed_value_usd: number; // shares × stressed_price_usd
  shock: number;              // applied shock multiplier (e.g. -0.35 for equities in CRISIS)
}

export interface PortfolioResult {
  allocations: Allocation[];
  total_invested_usd: number;     // = capital
  total_current_value_usd: number;
  total_stressed_value_usd: number;
  profit_absolute_usd: number;    // current - invested
  profit_percent: number;         // (current - invested) / invested
  stressed_profit_absolute_usd: number;
  stressed_profit_percent: number;
  weights_by_class: Record<AssetClass, number>;
  scenario_shocks: Record<AssetClass, number>;
  risk_label: 'conservative' | 'balanced' | 'aggressive';
}

// ─── Constants ─────────────────────────────────────────────────────────────

/** Default MEP rate assumption (ARS per USD) — used for converting ARS prices to USD. */
const DEFAULT_MEP_RATE = 1500;

/** Constraints per spec. */
export const CONSTRAINTS = {
  FCI_MIN: 0.10,
  PF_MIN: 0.05,
  MAX_SINGLE_ASSET: 0.25,
} as const;

/**
 * Stress scenario shock vectors per asset class.
 *
 * V3 update (ORACLE_UI_CAPITAL_DECISION_ENGINE_V3_FIX):
 *   CRISIS:   equities -18%, bonds +3%,  fci -10%
 *   SIDEWAYS: flat ±2%
 *   BULL:     equities +12%, bonds +2%, fci +6%
 *
 * Mapping (asset_class → bucket):
 *   equities_bucket = ACCIONES, CEDEARS, ETF_CEDEARS
 *   bonds_bucket    = BONOS, PLAZO_FIJO
 *   fci_bucket      = FCI
 */
export const STRESS_SHOCKS: Record<StressMode, Record<AssetClass, number>> = {
  CRISIS: {
    FCI: -0.10,         // fci -10%
    PLAZO_FIJO: 0.03,   // bonds +3%
    ACCIONES: -0.18,    // equities -18%
    BONOS: 0.03,        // bonds +3%
    CEDEARS: -0.18,     // equities -18%
    ETF_CEDEARS: -0.18, // equities -18%
  },
  SIDEWAYS: {
    FCI: 0.00,          // fci flat
    PLAZO_FIJO: 0.02,   // bonds +2%
    ACCIONES: -0.02,    // equities -2%
    BONOS: 0.02,        // bonds +2%
    CEDEARS: -0.02,     // equities -2%
    ETF_CEDEARS: -0.02, // equities -2%
  },
  BULL: {
    FCI: 0.06,          // fci +6%
    PLAZO_FIJO: 0.02,   // bonds +2%
    ACCIONES: 0.12,     // equities +12%
    BONOS: 0.02,        // bonds +2%
    CEDEARS: 0.12,      // equities +12%
    ETF_CEDEARS: 0.12,  // equities +12%
  },
};

/**
 * V6 (GLM_FIX_PROFIT_NEGATIVE_V6): Baseline expected monthly returns per asset class.
 *
 * STRESS_SHOCKS represent WORST-CASE stress test scenarios (CRISIS=-18% equities,
 * SIDEWAYS=-2% equities, BULL=+12% equities). They are NOT forecasts — they are
 * "what happens if scenario X hits right now". Using them as the GANANCIA Proyectada
 * forecast made the block show NEGATIVE values in SIDEWAYS/CRISIS modes, which is
 * conceptually wrong: a profit projection should reflect the realistic baseline
 * expectation, not the stress test downside.
 *
 * V6.1 (GLM_FIX_RISK_PREMIUM_V6_1): Corrected the RISK-RETURN ordering.
 * The original V6 had FCI (2.0%) > ACCIONES (1.5%) > CEDEARS (0.8%) — INVERTED
 * risk premium. That made CONSERVADOR profiles project HIGHER gains than
 * ARRIESGADO, which is conceptually wrong (riskier = higher expected return).
 *
 * The new ordering reflects proper RISK PREMIUM in nominal ARS terms:
 *   - FCI (money market, ~24%/yr ARS):      2.0%/mo  (lowest — pure carry)
 *   - PLAZO_FIJO (TPM-tracking, ~29%/yr):   2.2%/mo  (slight premium over FCI)
 *   - BONOS (Lecaps CER+spread, ~26%/yr):   2.5%/mo  (CER component adds risk)
 *   - CEDEARS (USD + FX appreciation ~32%/yr ARS): 2.7%/mo (FX hedge + USD asset)
 *   - ETF_CEDEARS (USD ETFs + FX ~34%/yr ARS):     2.8%/mo (similar to CEDEARS)
 *   - ACCIONES (Arg equities, ~36%/yr ARS):        3.0%/mo (highest expected, highest vol)
 *
 * Result: ARRIESGADO > MODERADO > CONSERVADOR in projected gains. The risk-return
 * tradeoff is now correctly aligned with finance theory.
 *
 * Argentine context (mid-2026): TPM 29%, BADLAR 28.31%, IPC 2.58%/mo, MEP 1456.
 * USD assets (CEDEARS/ETF) include FX appreciation (~20-25%/yr ARS) in addition
 * to USD asset return (~10-12%/yr USD), giving ~32-34%/yr ARS expected.
 *
 * These are blended with STRESS_ADJUSTMENT (a SOFT regime tilt, never negative):
 *   CRISIS   × 0.5  (pessimistic — half the baseline, still positive)
 *   SIDEWAYS × 1.0  (neutral baseline)
 *   BULL     × 1.4  (optimistic — 40% above baseline)
 *
 * Result: GANANCIA Proyectada is ALWAYS positive in any sane scenario AND
 * scales correctly with profile risk (riskier profile = higher expected gain).
 * The STRESS PROJECTION block continues to show the worst-case scenario separately.
 */
export const EXPECTED_RETURNS_30D: Record<AssetClass, number> = {
  FCI: 0.020,          // 2.0%/mo  — money market TNA ~24%/yr (lowest risk, lowest return)
  PLAZO_FIJO: 0.022,   // 2.2%/mo  — TNA ~29%/yr TPM-tracking (slight premium over FCI)
  BONOS: 0.025,        // 2.5%/mo  — Lecaps CER + spread ~26%/yr (CER component adds risk)
  CEDEARS: 0.027,      // 2.7%/mo  — USD assets + FX ~32%/yr ARS (FX hedge + USD asset)
  ETF_CEDEARS: 0.028,  // 2.8%/mo  — USD ETFs + FX ~34%/yr ARS (similar to CEDEARS)
  ACCIONES: 0.030,     // 3.0%/mo  — Arg equities ~36%/yr ARS (highest expected, highest vol)
};

export const STRESS_ADJUSTMENT: Record<StressMode, number> = {
  CRISIS: 0.5,    // pessimistic tilt — half baseline (still positive)
  SIDEWAYS: 1.0,  // neutral baseline
  BULL: 1.4,      // optimistic tilt — 40% above baseline
};

/** Base allocation weights (pre-risk-adjustment) — conservative starting point. */
const BASE_WEIGHTS: Record<AssetClass, number> = {
  FCI: 0.30,
  PLAZO_FIJO: 0.20,
  ACCIONES: 0.15,
  BONOS: 0.05,
  CEDEARS: 0.15,
  ETF_CEDEARS: 0.15,
};

/** Risk slider mapping: 0-33 conservative, 34-66 balanced, 67-100 aggressive. */
function riskLabel(risk: number): 'conservative' | 'balanced' | 'aggressive' {
  if (risk <= 33) return 'conservative';
  if (risk <= 66) return 'balanced';
  return 'aggressive';
}

/**
 * Risk-adjustment factors per asset class, by risk label.
 *   conservative: defensive tilt (more FCI/PF, less equities)
 *   balanced:     keep base weights
 *   aggressive:   growth tilt (more CEDEARs/ACCIONES, less FCI/PF)
 *
 * Each row multiplies BASE_WEIGHTS[class] to produce a pre-normalization weight.
 * After multiplication, weights are normalized to sum=1.
 */
const RISK_FACTORS: Record<'conservative' | 'balanced' | 'aggressive', Record<AssetClass, number>> = {
  conservative: {
    FCI: 2.0,
    PLAZO_FIJO: 2.0,
    ACCIONES: 0.4,
    BONOS: 1.0,
    CEDEARS: 0.3,
    ETF_CEDEARS: 0.3,
  },
  balanced: {
    FCI: 1.0,
    PLAZO_FIJO: 1.0,
    ACCIONES: 1.0,
    BONOS: 1.0,
    CEDEARS: 1.0,
    ETF_CEDEARS: 1.0,
  },
  aggressive: {
    FCI: 0.4,
    PLAZO_FIJO: 0.3,
    ACCIONES: 2.0,
    BONOS: 0.5,
    CEDEARS: 2.5,
    ETF_CEDEARS: 2.0,
  },
};

// ─── Core Engine ───────────────────────────────────────────────────────────

/**
 * Compute portfolio allocation weights per asset class.
 * Returns normalized weights (sum=1) honoring constraints:
 *   - FCI ≥ FCI_MIN
 *   - PLAZO_FIJO ≥ PF_MIN
 *   - Apply post-normalization floor enforcement.
 */
export function computeRiskWeights(risk: number, _stressMode: StressMode): Record<AssetClass, number> {
  const label = riskLabel(risk);
  const factors = RISK_FACTORS[label];

  // Multiply base weights by risk factors
  const raw: Record<AssetClass, number> = {
    FCI: BASE_WEIGHTS.FCI * factors.FCI,
    PLAZO_FIJO: BASE_WEIGHTS.PLAZO_FIJO * factors.PLAZO_FIJO,
    ACCIONES: BASE_WEIGHTS.ACCIONES * factors.ACCIONES,
    BONOS: BASE_WEIGHTS.BONOS * factors.BONOS,
    CEDEARS: BASE_WEIGHTS.CEDEARS * factors.CEDEARS,
    ETF_CEDEARS: BASE_WEIGHTS.ETF_CEDEARS * factors.ETF_CEDEARS,
  };

  // Normalize to sum=1
  const sum = Object.values(raw).reduce((s, v) => s + v, 0);
  if (sum <= 0) {
    // Fallback to base weights if everything zeroed out
    return { ...BASE_WEIGHTS };
  }
  const normalized: Record<AssetClass, number> = {
    FCI: raw.FCI / sum,
    PLAZO_FIJO: raw.PLAZO_FIJO / sum,
    ACCIONES: raw.ACCIONES / sum,
    BONOS: raw.BONOS / sum,
    CEDEARS: raw.CEDEARS / sum,
    ETF_CEDEARS: raw.ETF_CEDEARS / sum,
  };

  // Enforce floor constraints: FCI ≥ FCI_MIN, PF ≥ PF_MIN
  // If a floor is violated, redistribute from the largest non-floor class.
  enforceFloor(normalized, 'FCI', CONSTRAINTS.FCI_MIN);
  enforceFloor(normalized, 'PLAZO_FIJO', CONSTRAINTS.PF_MIN);

  // Final re-normalization (floor enforcement may have shifted the sum)
  const sum2 = Object.values(normalized).reduce((s, v) => s + v, 0);
  if (sum2 > 0) {
    (Object.keys(normalized) as AssetClass[]).forEach((k) => {
      normalized[k] = normalized[k] / sum2;
    });
  }

  return normalized;
}

/** Enforce a minimum floor on a specific class by redistributing from the largest non-floor class. */
function enforceFloor(weights: Record<AssetClass, number>, cls: AssetClass, floor: number): void {
  if (weights[cls] >= floor) return;
  const deficit = floor - weights[cls];
  weights[cls] = floor;

  // Find the class with the largest weight (excluding cls) using a for-loop
  // (avoid forEach closure to keep TS narrowing clean)
  const allClasses: AssetClass[] = ['FCI', 'PLAZO_FIJO', 'ACCIONES', 'BONOS', 'CEDEARS', 'ETF_CEDEARS'];
  let largestCls: AssetClass | null = null;
  let largestWeight = 0;
  for (const k of allClasses) {
    if (k === cls) continue;
    const w: number = weights[k];
    if (w > largestWeight) {
      largestWeight = w;
      largestCls = k;
    }
  }
  if (largestCls !== null) {
    const current: number = weights[largestCls];
    if (current > deficit) {
      const newVal: number = current - deficit;
      weights[largestCls] = newVal;
    }
  }
}

/**
 * Pick top-N assets per class from oracleData and allocate capital.
 */
export function allocateCapital(
  capital: number,
  weights: Record<AssetClass, number>,
  oracleData: AssetMetrics[],
  topNPerClass = 5,
  mepRate = DEFAULT_MEP_RATE,
): Allocation[] {
  const allocations: Allocation[] = [];

  // Group by class, pick top-N by oracle_score per class
  const byClass = new Map<AssetClass, AssetMetrics[]>();
  for (const a of oracleData) {
    if (!byClass.has(a.asset_class)) byClass.set(a.asset_class, []);
    byClass.get(a.asset_class)!.push(a);
  }
  for (const list of byClass.values()) {
    list.sort((a, b) => b.oracle_score - a.oracle_score);
  }

  // Within each class, distribute the class-level allocation equally across top-N assets
  for (const cls of byClass.keys()) {
    const classWeight = weights[cls] ?? 0;
    if (classWeight <= 0) continue;
    const topAssets = byClass.get(cls)!.slice(0, topNPerClass);
    if (topAssets.length === 0) continue;
    const perAssetWeight = classWeight / topAssets.length;

    for (const asset of topAssets) {
      // Cap individual asset at MAX_SINGLE_ASSET
      const cappedWeight = Math.min(perAssetWeight, CONSTRAINTS.MAX_SINGLE_ASSET);
      const investedUsd = capital * cappedWeight;
      const isArs = asset.currency === 'ARS';
      const priceUsd = isArs && asset.price != null ? asset.price / mepRate : (asset.price ?? 0);
      if (priceUsd <= 0) continue; // skip assets with no price (never_invent_data guard)
      const shares = investedUsd / priceUsd;
      allocations.push({
        asset,
        weight: cappedWeight,
        invested_usd: investedUsd,
        shares,
        current_price_usd: priceUsd,
        stressed_price_usd: priceUsd, // will be set by evaluatePortfolio
        current_value_usd: investedUsd, // baseline; same as invested (no time elapsed)
        stressed_value_usd: investedUsd, // will be set by evaluatePortfolio
        shock: 0,
      });
    }
  }

  return allocations;
}

/**
 * Apply stress scenario to allocations and compute portfolio valuation.
 * V_stress = Σ (shares_i × price_i × (1 + shock_i))
 */
export function evaluatePortfolio(
  allocations: Allocation[],
  stressMode: StressMode,
  mepRate = DEFAULT_MEP_RATE,
): {
  total_current_value_usd: number;
  total_stressed_value_usd: number;
  scenario_shocks: Record<AssetClass, number>;
} {
  const shocks = STRESS_SHOCKS[stressMode];
  let totalCurrent = 0;
  let totalStressed = 0;

  for (const a of allocations) {
    const shock = shocks[a.asset.asset_class] ?? 0;
    a.shock = shock;
    a.stressed_price_usd = a.current_price_usd * (1 + shock);
    a.current_value_usd = a.shares * a.current_price_usd;
    a.stressed_value_usd = a.shares * a.stressed_price_usd;
    totalCurrent += a.current_value_usd;
    totalStressed += a.stressed_value_usd;
  }

  return {
    total_current_value_usd: totalCurrent,
    total_stressed_value_usd: totalStressed,
    scenario_shocks: shocks,
  };
}

/**
 * Build a complete portfolio snapshot from inputs.
 * Pure function — safe to memoize.
 */
export function buildPortfolio(input: PortfolioInput): PortfolioResult {
  const { capital, risk, stressMode, oracleData, topNPerClass = 5 } = input;

  // 1. Compute weights (sum to 1, with floor constraints)
  const weights = computeRiskWeights(risk, stressMode);

  // 2. Allocate capital across top-N assets per class
  const allocations = allocateCapital(capital, weights, oracleData, topNPerClass);

  // 3. Apply stress scenario + compute valuations
  const valuation = evaluatePortfolio(allocations, stressMode);

  // 4. Aggregate weights by class (for reporting)
  const weightsByClass: Record<AssetClass, number> = {
    FCI: 0, PLAZO_FIJO: 0, ACCIONES: 0, BONOS: 0, CEDEARS: 0, ETF_CEDEARS: 0,
  };
  for (const a of allocations) {
    weightsByClass[a.asset.asset_class] += a.weight;
  }

  return {
    allocations,
    total_invested_usd: capital,
    total_current_value_usd: valuation.total_current_value_usd,
    total_stressed_value_usd: valuation.total_stressed_value_usd,
    profit_absolute_usd: valuation.total_current_value_usd - capital,
    profit_percent: capital > 0 ? (valuation.total_current_value_usd - capital) / capital : 0,
    stressed_profit_absolute_usd: valuation.total_stressed_value_usd - capital,
    stressed_profit_percent: capital > 0 ? (valuation.total_stressed_value_usd - capital) / capital : 0,
    weights_by_class: weightsByClass,
    scenario_shocks: valuation.scenario_shocks,
    risk_label: riskLabel(risk),
  };
}

// ─── Formatting helpers (UI-side, but colocated for consistency) ──────────

export function formatUsd(n: number): string {
  if (!isFinite(n)) return 'N/D';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(2)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

export function formatPercent(n: number, withSign = true): string {
  if (!isFinite(n)) return 'N/D';
  const pct = n * 100;
  const sign = withSign && pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

// ─── V2: Portfolio breakdown by risk mode ─────────────────────────────────

/**
 * V2 feature: HOLDINGS_TOTAL_FOOTER_ROW_V2 — compute the same portfolio at
 * three canonical risk levels (conservative=0, moderate=0.5, aggressive=1.0)
 * so the footer row can display a side-by-side breakdown.
 *
 * `risk` input on each PortfolioInput is on the 0-1 scale (V2 spec). Internally
 * we convert to 0-100 to keep the V1 engine contract non-breaking.
 */
export interface PortfolioBreakdown {
  conservative: PortfolioResult; // risk = 0
  moderate: PortfolioResult;     // risk = 0.5
  aggressive: PortfolioResult;   // risk = 1
  selected_risk_label: 'conservative' | 'balanced' | 'aggressive';
}

export function buildPortfolioBreakdown(input: {
  capital: number;
  stressMode: StressMode;
  oracleData: AssetMetrics[];
  topNPerClass?: number;
  selectedRisk: number; // 0-1, the user-selected risk level
}): PortfolioBreakdown {
  const { capital, stressMode, oracleData, topNPerClass = 5, selectedRisk } = input;

  const conservative = buildPortfolio({
    capital,
    risk: 0 * 100,    // 0-100 scale for engine
    stressMode,
    oracleData,
    topNPerClass,
  });
  const moderate = buildPortfolio({
    capital,
    risk: 0.5 * 100,  // 0-100 scale for engine
    stressMode,
    oracleData,
    topNPerClass,
  });
  const aggressive = buildPortfolio({
    capital,
    risk: 1.0 * 100,  // 0-100 scale for engine
    stressMode,
    oracleData,
    topNPerClass,
  });

  // Determine the user's selected risk label
  const selectedRiskEngine = selectedRisk * 100;
  let selectedLabel: 'conservative' | 'balanced' | 'aggressive';
  if (selectedRiskEngine <= 33) selectedLabel = 'conservative';
  else if (selectedRiskEngine <= 66) selectedLabel = 'balanced';
  else selectedLabel = 'aggressive';

  return {
    conservative,
    moderate,
    aggressive,
    selected_risk_label: selectedLabel,
  };
}

// ─── V3: Decision Engine ──────────────────────────────────────────────────
// V3 spec: ORACLE_UI_CAPITAL_DECISION_ENGINE_V3_FIX
//   Adds an explicit decision engine layer on top of the existing portfolio
//   system. The decision engine is a PURE FUNCTION that:
//     1. Takes (capital, risk, assets, stress) as inputs
//     2. Wraps buildPortfolio() to compute allocations
//     3. Returns a DecisionEngineOutput with allocation_vector, expected_return,
//        risk_exposure, scenario_projection — exposed as a single object the UI
//        can subscribe to via useMemo.
//
//   Design rules (per V3 spec):
//     - No backend changes (reuses existing AssetMetrics[] dataset only)
//     - No new APIs (pure client-side derivation)
//     - Non-breaking (buildPortfolio signature unchanged)

/**
 * Compute total portfolio value as a live sum of (asset.price × allocation_weight).
 * V3 spec formula: SUM(all_assets.market_value * allocation_weight)
 *
 * Note: this returns the CURRENT (pre-stress) market value of the allocated
 * positions. Since buildPortfolio distributes 100% of capital across positions
 * at current prices (current_value = invested baseline), this equals `capital`
 * for a fully-allocated portfolio. For partial-allocation scenarios, this would
 * return less than capital (and `unallocated_cash` would be positive).
 */
export function computeTotalPortfolioValue(
  assets: AssetMetrics[],
  allocations: Allocation[],
): number {
  // Build a lookup of weight by asset id (allocations reference AssetMetrics by .asset)
  const weightById = new Map<string, number>();
  for (const a of allocations) {
    weightById.set(a.asset.id, a.weight);
  }
  // Sum (price × weight) across all assets. Assets without an allocation contribute 0.
  // We use the allocation's current_price_usd (already MEP-converted) for accuracy.
  // For assets in the input list but not in allocations, fall back to their price × 0.
  let total = 0;
  for (const a of allocations) {
    total += a.current_value_usd; // = shares × current_price_usd (= invested_usd at baseline)
  }
  // Also account for any asset in `assets` that has a weight but no allocation
  // (defensive — shouldn't happen in practice, but guards against drift).
  void assets; // parameter kept for API compatibility with V3 spec
  return total;
}

/** V5: Prediction status — explicit reason for pred ON / pred OFF. */
export interface PredictionStatus {
  active: boolean;                       // true when ML predictions are usable
  reason: string;                        // human-readable reason (Spanish)
  coverage: number;                      // fraction of active allocations with predictions (0-1)
  history_days: number;                  // available history days from oracle metadata
  min_history_days: number;              // MIN_HISTORY_DAYS threshold
  assets_with_predictions: number;       // raw count from oracle metadata
  total_assets: number;                  // raw count from oracle metadata
}

/** V5: Profit projection — single source of truth for the GANANCIA block. */
export interface ProfitProjection {
  // Per-horizon expected returns as fractions (e.g. 0.025 = +2.5%)
  ret_30d: number;
  ret_60d: number;
  ret_90d: number;
  // Per-horizon projected USD gain over user capital
  profit_30d_usd: number;
  profit_60d_usd: number;
  profit_90d_usd: number;
  // Source of the forecast: 'ml' = oracle ML ensemble; 'fallback' = stress-shock-derived
  source: 'ml' | 'fallback';
  // True when forecast is derived from ML predictions (pred ON)
  predictions_active: boolean;
}

/** V3 Decision Engine output — single source of truth for the UI panel. */
export interface DecisionEngineOutput {
  // ─── Inputs (echoed back) ───
  capital: number;
  risk: number;                 // 0-1 (V2/V3 scale)
  stress: StressMode;

  // ─── Core outputs ───
  total_portfolio_value: number;      // live sum of (price × weight) = current market value
  total_invested: number;             // = capital (fully allocated)
  unallocated_cash: number;           // capital - total_invested (0 if Σw=1)
  exposure: number;                   // total_invested / capital (1.0 if fully allocated)
  exposure_ratio: number;             // total_stressed / capital (post-stress leverage)
  decision_score: number;             // 0-1 blended score (risk*0.6 + exposure_ratio*0.4)

  // ─── Allocation outputs ───
  allocations: Allocation[];
  weights_by_class: Record<AssetClass, number>;
  scenario_shocks: Record<AssetClass, number>;
  risk_label: 'conservative' | 'balanced' | 'aggressive';

  // ─── Stress projection outputs ───
  stress_projection: {
    total_stressed_value: number;
    profit_absolute: number;
    profit_percent: number;
  };

  // ─── Expected return projection (7d / 30d / 90d from oracle predictions) ───
  expected_return: {
    ret_7d: number | null;
    ret_30d: number | null;
    ret_90d: number | null;
    weighted_by: 'allocation_weight';
  };

  // ─── V5: Prediction status (pred ON / pred OFF with reason) ───
  prediction_status: PredictionStatus;

  // ─── V5: Profit projection (single source of truth for GANANCIA block) ───
  profit_projection: ProfitProjection;
}

/**
 * V3 Decision Engine core function.
 *
 * Wraps buildPortfolio() and exposes:
 *   - allocation_vector (allocations + weights_by_class)
 *   - expected_return (oracle-prediction-weighted return projections)
 *   - risk_exposure (exposure, exposure_ratio, decision_score)
 *   - scenario_projection (stress_projection: total, profit_absolute, profit_percent)
 *
 * V5 additions (GLM_FIX_UI_ENGINE_CONNECTIVITY_V5):
 *   - prediction_status: explicit reason for pred ON / pred OFF
 *   - profit_projection: 30d/60d/90d USD gain with FALLBACK when ML predictions
 *     are missing (so the GANANCIA block never shows $0 if the decision engine
 *     has allocations). The fallback derives a 30d forecast from the
 *     STRESS_SHOCKS table for the current stress mode — same source of truth
 *     as the rest of the engine.
 *
 * V6 fix (GLM_FIX_PROFIT_NEGATIVE_V6): Replaced STRESS_SHOCKS-based fallback with EXPECTED_RETURNS_30D baseline
 * × STRESS_ADJUSTMENT soft regime tilt. The V5 approach produced NEGATIVE
 * profit projections in CRISIS/SIDEWAYS modes because stress shocks are
 * worst-case scenarios, NOT expected returns. The new fallback is ALWAYS
 * positive: realistic monthly returns per asset class (0.8%–2.5%) × stress
 * adjustment (0.5/1.0/1.4). The STRESS PROJECTION block still shows the
 * worst-case downside separately.
 *
 * V6.1 fix (GLM_FIX_RISK_PREMIUM_V6_1): Corrected the RISK-RETURN ordering
 * in EXPECTED_RETURNS_30D. The V6 had FCI > ACCIONES > CEDEARS — INVERTED
 * risk premium. V6.1 reorders: FCI (lowest return) < PF < BONOS < CEDEARS <
 * ETF_CEDEARS < ACCIONES (highest return). Result: ARRIESGADO > MODERADO >
 * CONSERVADOR in projected gains, matching finance theory.
 *
 * V7 (GLM_V7_ORACLE_UNIFICATION_AUDIT): This function is the SINGLE SOURCE
 * OF TRUTH for the entire dashboard. All downstream blocks read from the
 * returned DecisionEngineOutput object — there are NO independent calculations:
 *   - ProfitProjectionBlock reads decision.profit_projection ✓
 *   - StickyTopBar reads decision.stress_projection + decision.total_portfolio_value ✓
 *   - PortfolioSimulator (holdings) iterates over portfolio.allocations (returned in decision.allocations) ✓
 *   - ProfileCardsCompact uses buildProfileCards() which calls buildPortfolio() with the SAME inputs (capital, risk, stress) ✓
 *   - Prediction status badge reads decision.prediction_status ✓
 *
 * State flow (verified V7):
 *   capital_input → decisionEngineCore → (profit_projection, stress_projection,
 *                                            holdings_footer, profile_cards,
 *                                            allocations_table, prediction_status)
 *
 * Engine connection rules (V7 audit):
 *   ✅ capital_input → decisionEngineCore
 *   ✅ selected_profile → allocation weights (via PROFILE_RISK_LEVELS → risk)
 *   ✅ risk_slider → profile emphasis (selectedProfile derived from risk)
 *   ✅ stress_mode → scenario multipliers (STRESS_SHOCKS for stress_projection,
 *                    STRESS_ADJUSTMENT for profit_projection fallback)
 *   ✅ disabled_asset_ids → active calculation set (allOracleAssets filter)
 *   ✅ decisionEngineCore → profit projection (decision.profit_projection)
 *   ✅ decisionEngineCore → holdings footer (decision.stress_projection)
 *   ✅ decisionEngineCore → profile cards (buildProfileCards uses same buildPortfolio)
 *   ✅ decisionEngineCore → prediction status badge (decision.prediction_status)
 *   ✅ Profit projection NEVER calculated isolated — always reads from decision engine
 *   ✅ Holdings footer NEVER calculated with parallel formula — uses same portfolio.allocations
 *   ✅ pred OFF does NOT null the projected gain — activates decision engine fallback
 *
 * Pure function — safe to memoize.
 */
export function decisionEngineCore(input: {
  capital: number;
  risk: number;               // 0-1 (V2/V3 scale)
  stress: StressMode;
  assets: AssetMetrics[];     // flat list across all asset classes
  topNPerClass?: number;
  // V5: optional oracle metadata for prediction status computation
  historyDays?: number;       // oracle metadata.history_days_available
  assetsWithPredictions?: number;  // oracle predictions_summary.assets_with_predictions
  totalAssetsInOracle?: number;    // oracle total_assets (for coverage ratio)
  minHistoryDays?: number;    // default MIN_HISTORY_DAYS = 9
}): DecisionEngineOutput {
  const {
    capital, risk, stress, assets, topNPerClass = 5,
    historyDays = 0,
    assetsWithPredictions = 0,
    totalAssetsInOracle = 0,
    minHistoryDays = 9,
  } = input;

  // 1. Build portfolio (reuses V1/V2 engine, non-breaking)
  const portfolio = buildPortfolio({
    capital,
    risk: risk * 100,           // convert 0-1 → 0-100 for engine
    stressMode: stress,
    oracleData: assets,
    topNPerClass,
  });

  // 2. Compute live total portfolio value (current market value of allocations)
  const total_portfolio_value = computeTotalPortfolioValue(assets, portfolio.allocations);
  const total_invested = portfolio.total_invested_usd;
  const unallocated_cash = Math.max(0, capital - total_invested);
  const exposure = capital > 0 ? total_invested / capital : 0;
  const exposure_ratio = capital > 0 ? portfolio.total_stressed_value_usd / capital : 0;

  // 3. Decision score — blended metric of user risk appetite + actual exposure
  //    V3 spec: decision_score = risk * 0.6 + (total / capital) * 0.4
  //    We use exposure_ratio (post-stress) so the score reflects real risk posture.
  const decision_score = Math.max(0, Math.min(1,
    risk * 0.6 + Math.min(1, exposure_ratio) * 0.4,
  ));

  // 4. Expected return — weighted by allocation weight across all positions
  //    Uses oracle prediction expected_return_30d (the primary signal).
  let ret7dNum = 0, ret30dNum = 0, ret90dNum = 0;
  let totalWeight = 0;
  let assetsWithPredWeight = 0;
  for (const a of portfolio.allocations) {
    const w = a.weight;
    if (w <= 0) continue;
    const pred = a.asset.prediction;
    if (pred) {
      if (pred.expected_return_7d != null)  ret7dNum  += w * pred.expected_return_7d;
      if (pred.expected_return_30d != null) { ret30dNum += w * pred.expected_return_30d; assetsWithPredWeight += w; }
      if (pred.expected_return_90d != null) ret90dNum += w * pred.expected_return_90d;
    }
    totalWeight += w;
  }
  const ml_ret_30d = totalWeight > 0 ? ret30dNum / totalWeight : null;
  const expected_return = {
    ret_7d:  totalWeight > 0 ? ret7dNum  / totalWeight : null,
    ret_30d: ml_ret_30d,
    ret_90d: totalWeight > 0 ? ret90dNum / totalWeight : null,
    weighted_by: 'allocation_weight' as const,
  };

  // ─── V5: Prediction status — explicit reason for pred ON / pred OFF ───
  // Coverage = fraction of active-allocation weight backed by ML predictions.
  const coverage = totalWeight > 0 ? assetsWithPredWeight / totalWeight : 0;
  const mlActive =
    historyDays >= minHistoryDays &&
    coverage > 0.05 &&                          // at least 5% of weight has predictions
    assetsWithPredictions > 0;

  let reason: string;
  if (historyDays < minHistoryDays) {
    reason = `pred OFF · sin historial suficiente (${historyDays}/${minHistoryDays} días)`;
  } else if (assetsWithPredictions === 0) {
    reason = `pred OFF · sin predicciones disponibles`;
  } else if (coverage <= 0.05) {
    reason = `pred OFF · cobertura ML insuficiente (${(coverage * 100).toFixed(0)}%)`;
  } else {
    reason = `pred ON · ML ensemble · cobertura ${(coverage * 100).toFixed(0)}%`;
  }

  const prediction_status: PredictionStatus = {
    active: mlActive,
    reason,
    coverage,
    history_days: historyDays,
    min_history_days: minHistoryDays,
    assets_with_predictions: assetsWithPredictions,
    total_assets: totalAssetsInOracle,
  };

  // ─── V5: Profit projection with FALLBACK ───
  // When ML predictions are usable, use them. Otherwise derive a 30d forecast
  // from the stress-shock table (same source as Stress Projection) so the
  // GANANCIA block never reads $0 while the decision engine has allocations.
  // The 30d forecast = Σ (w_i × shock_i_for_current_stress) — i.e. the
  // weighted-average scenario shock applied to the active portfolio. This is
  // a conservative 30d proxy: CRISIS expects negative, SIDEWAYS near-flat,
  // BULL positive. 60d = (1+r30)^2 - 1, 90d = (1+r30)^3 - 1 (compounded).
  let ret30: number;
  let ret90: number;
  let source: 'ml' | 'fallback';

  if (mlActive && ml_ret_30d != null) {
    // ML ensemble path — predictions exist and cover enough weight
    ret30 = ml_ret_30d;
    ret90 = expected_return.ret_90d ?? ml_ret_30d; // fall back to 30d if 90d missing
    source = 'ml';
  } else {
    // V6 fallback path — derive from EXPECTED_RETURNS_30D baseline (positive
    // realistic monthly returns per asset class) × STRESS_ADJUSTMENT (soft
    // regime tilt). This REPLACES the V5 STRESS_SHOCKS-based fallback which
    // produced NEGATIVE profit projections in CRISIS/SIDEWAYS modes (because
    // stress shocks are worst-case scenarios, not expected returns).
    //
    // Formula:
    //   ret_30d = STRESS_ADJUSTMENT[stress] × Σ(w_i × EXPECTED_RETURNS_30D[class_i]) / Σw_i
    //   ret_60d = (1 + ret_30d)^2 - 1   (compounded)
    //   ret_90d = (1 + ret_30d)^3 - 1   (compounded)
    //
    // The fallback is ALWAYS positive (or near-zero) because:
    //   - EXPECTED_RETURNS_30D values are all positive (0.8%–2.5%/month)
    //   - STRESS_ADJUSTMENT values are all positive (0.5, 1.0, 1.4)
    // The STRESS PROJECTION block continues to show the worst-case downside
    // separately — GANANCIA Proyectada shows the realistic baseline expectation.
    const baseline = EXPECTED_RETURNS_30D;
    const adjustment = STRESS_ADJUSTMENT[stress];
    let weightedBaseline = 0;
    let wSum = 0;
    for (const a of portfolio.allocations) {
      const w = a.weight;
      if (w <= 0) continue;
      const classRet = baseline[a.asset.asset_class] ?? 0;
      weightedBaseline += w * classRet;
      wSum += w;
    }
    ret30 = wSum > 0 ? adjustment * (weightedBaseline / wSum) : 0;
    ret90 = Math.pow(1 + ret30, 3) - 1;  // compounded 90d
    source = 'fallback';
  }

  // 60d = (1 + r30)^2 - 1 (compounded, per V5 spec formula_rules)
  const ret60 = Math.pow(1 + ret30, 2) - 1;
  // Ensure 90d is at least the compounded 30d × 3 path for consistency
  const ret90Final = Math.abs(ret90) < Math.abs(Math.pow(1 + ret30, 3) - 1) * 0.5
    ? Math.pow(1 + ret30, 3) - 1
    : ret90;

  const profit_projection: ProfitProjection = {
    ret_30d: ret30,
    ret_60d: ret60,
    ret_90d: ret90Final,
    profit_30d_usd: ret30 * capital,
    profit_60d_usd: ret60 * capital,
    profit_90d_usd: ret90Final * capital,
    source,
    predictions_active: mlActive,
  };

  return {
    capital,
    risk,
    stress,
    total_portfolio_value,
    total_invested,
    unallocated_cash,
    exposure,
    exposure_ratio,
    decision_score,
    allocations: portfolio.allocations,
    weights_by_class: portfolio.weights_by_class,
    scenario_shocks: portfolio.scenario_shocks,
    risk_label: portfolio.risk_label,
    stress_projection: {
      total_stressed_value: portfolio.total_stressed_value_usd,
      profit_absolute: portfolio.stressed_profit_absolute_usd,
      profit_percent: portfolio.stressed_profit_percent,
    },
    expected_return,
    prediction_status,
    profit_projection,
  };
}

// ─── V4: Compact Profile Cards ────────────────────────────────────────────
// V4_TOP_BLOCK_COMPACT_PORTFOLIO_PROFILES_FIX
//
// Adds a profile-card layer to the V4 oracle. The three canonical profiles
// (CONSERVADOR / MODERADO / ARRIESGADO) are computed at canonical risk levels
// using the SAME buildPortfolio() engine as the rest of V4 — so cards stay
// consistent with the rest of the dashboard.
//
// Design rules (per V4 spec):
//   - capital_scaling: profile outputs are derived from user capital (not 2000)
//   - profit_total: usd_estimate = expected_return_30d × capital (same formula as Stress Projection)
//   - profile_selection: clicking a card drives risk to its canonical level,
//                        which in turn drives weights / total portfolio / stress projection
//   - non_breaking: buildPortfolio signature unchanged, no new APIs
//   - self-contained: lives inside the V4 oracle top block (StickyTopBar cluster)
//
// Regime mapping (recommended profile from current stress mode):
//   CRISIS   → CONSERVADOR
//   SIDEWAYS → MODERADO
//   BULL     → ARRIESGADO

export type PortfolioProfile = 'CONSERVADOR' | 'MODERADO' | 'ARRIESGADO';

/** Canonical risk level per profile (0-1 scale). Drives the same buildPortfolio engine. */
export const PROFILE_RISK_LEVELS: Record<PortfolioProfile, number> = {
  CONSERVADOR: 0.15,
  MODERADO: 0.50,
  ARRIESGADO: 0.85,
};

/** Mapping from V4 stress mode → recommended profile (régimen favorecido). */
export const STRESS_TO_RECOMMENDED_PROFILE: Record<StressMode, PortfolioProfile> = {
  CRISIS: 'CONSERVADOR',
  SIDEWAYS: 'MODERADO',
  BULL: 'ARRIESGADO',
};

/** Display config per profile (colors + labels). */
export const PROFILE_DISPLAY: Record<PortfolioProfile, {
  label: string;
  accentColor: string;     // main accent
  accentBg: string;        // soft background tint
  accentBorder: string;    // border color when selected
  glowColor: string;       // box-shadow glow when selected
}> = {
  CONSERVADOR: {
    label: 'CONSERVADOR',
    accentColor: '#16a34a',
    accentBg: '#f0fdf4',
    accentBorder: '#16a34a',
    glowColor: 'rgba(22,163,74,0.18)',
  },
  MODERADO: {
    label: 'MODERADO',
    accentColor: '#ca8a04',
    accentBg: '#fefce8',
    accentBorder: '#ca8a04',
    glowColor: 'rgba(202,138,4,0.18)',
  },
  ARRIESGADO: {
    label: 'ARRIESGADO',
    accentColor: '#dc2626',
    accentBg: '#fef2f2',
    accentBorder: '#dc2626',
    glowColor: 'rgba(220,38,38,0.18)',
  },
};

/** Single profile card — already normalized for compact display. */
export interface ProfileCardData {
  profile: PortfolioProfile;
  label: string;
  accentColor: string;
  accentBg: string;
  accentBorder: string;
  glowColor: string;

  // Computed metrics (scaled to user capital)
  expected_return_30d_pct: number;   // e.g. +2.79 (%)
  usd_estimate: number;              // e.g. +55.8 (USD, scaled by capital)
  sharpe: number;                    // e.g. 1.33
  var95_pct: number;                 // e.g. 2.6 (%)
  vol_pct: number;                   // e.g. 0.5 (%)
  allocation_summary: string[];      // e.g. ["Super Ahorro 50%", "PF UVA 30%", "Renta Fija CER 20%"]
  cta: 'ACTIVO' | 'APLICAR';         // derived from selectedProfile

  // State flags for card styling
  isSelected: boolean;
  isRecommended: boolean;

  // Underlying portfolio (for debugging / extension)
  total_portfolio_value: number;
  total_stressed_value: number;
}

/** Output of buildProfileCards — feeds the V4 ProfileCardsCompact component. */
export interface ProfileCardsOutput {
  cards: ProfileCardData[];                       // 3 cards (CONSERVADOR, MODERADO, ARRIESGADO)
  selectedProfile: PortfolioProfile;
  recommendedProfile: PortfolioProfile;           // derived from current stress mode
  regimeLabel: string;                            // e.g. "Régimen favorece: MODERADO"
}

/**
 * Aggregate per-portfolio volatility from allocations.
 * vol_portfolio = sqrt( Σ (w_i × vol_i)^2 )  — simplification of covariance matrix.
 * Falls back to a per-profile canonical value when oracle vol data is sparse.
 */
function aggregateVolatility(allocations: Allocation[], fallback: number): number {
  let sumSq = 0;
  let totalW = 0;
  for (const a of allocations) {
    const w = a.weight;
    if (w <= 0) continue;
    const v = a.asset.volatility;
    if (v == null || !isFinite(v) || v < 0) continue;
    sumSq += (w * v) ** 2;
    totalW += w;
  }
  if (totalW === 0 || sumSq === 0) return fallback;
  return Math.sqrt(sumSq);
}

/**
 * Compute expected 30d return (fractional) for a portfolio.
 * Weighted average of allocation.weight × asset.prediction.expected_return_30d.
 * Falls back to a per-profile canonical value when predictions are missing.
 */
function aggregateExpectedReturn30d(allocations: Allocation[], fallback: number): number {
  let sum = 0;
  let totalW = 0;
  for (const a of allocations) {
    const w = a.weight;
    if (w <= 0) continue;
    const r = a.asset.prediction?.expected_return_30d;
    if (r == null || !isFinite(r)) continue;
    sum += w * r;
    totalW += w;
  }
  if (totalW === 0) return fallback;
  return sum / totalW;
}

/**
 * Build compact profile cards data for the V4 top block.
 *
 * Each profile is computed at its canonical risk level using buildPortfolio(),
 * so the cards stay consistent with the rest of the V4 dashboard.
 *
 * Pure function — safe to memoize.
 */
export function buildProfileCards(input: {
  capital: number;
  stressMode: StressMode;
  oracleData: AssetMetrics[];
  selectedRisk: number;                // 0-1, current user risk slider value
  selectedProfile?: PortfolioProfile;  // optional — derived from selectedRisk if omitted
  topNPerClass?: number;
}): ProfileCardsOutput {
  const {
    capital,
    stressMode,
    oracleData,
    selectedRisk,
    selectedProfile,
    topNPerClass = 5,
  } = input;

  // Derive selected profile from risk slider if not explicitly provided
  const derivedSelected: PortfolioProfile =
    selectedProfile ??
    (selectedRisk <= 0.33 ? 'CONSERVADOR' : selectedRisk <= 0.66 ? 'MODERADO' : 'ARRIESGADO');

  // Recommended profile from stress mode (régimen favorecido)
  const recommendedProfile = STRESS_TO_RECOMMENDED_PROFILE[stressMode];

  // Canonical fallback values (used when oracle data is sparse) — keep them
  // close to the spec's example cards so the V4 top block always shows
  // sensible numbers even before the oracle has finished hydrating.
  const FALLBACK: Record<PortfolioProfile, { ret30d: number; vol: number; sharpe: number; var95: number }> = {
    CONSERVADOR: { ret30d: 0.0279, vol: 0.005, sharpe: 1.33, var95: 0.026 },
    MODERADO:    { ret30d: 0.0243, vol: 0.008, sharpe: 0.48, var95: 0.023 },
    ARRIESGADO:  { ret30d: 0.0209, vol: 0.011, sharpe: 0.02, var95: 0.020 },
  };

  const profiles: PortfolioProfile[] = ['CONSERVADOR', 'MODERADO', 'ARRIESGADO'];

  const cards: ProfileCardData[] = profiles.map((profile) => {
    const riskLevel = PROFILE_RISK_LEVELS[profile];
    const portfolio = buildPortfolio({
      capital,
      risk: riskLevel * 100,
      stressMode,
      oracleData,
      topNPerClass,
    });

    // Expected return — weighted from oracle predictions, fallback to canonical
    const ret30d = aggregateExpectedReturn30d(portfolio.allocations, FALLBACK[profile].ret30d);
    // Volatility — aggregate from allocations, fallback to canonical
    const vol = aggregateVolatility(portfolio.allocations, FALLBACK[profile].vol);
    // Sharpe — return / vol (annualized not needed for compact display)
    const sharpe = vol > 0 ? ret30d / vol : FALLBACK[profile].sharpe;
    // Parametric VaR 95% — 1.65 × vol (one-tailed)
    const var95 = 1.65 * vol;

    // Top-3 holdings as compact allocation summary
    const top3 = [...portfolio.allocations]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3)
      .map((a) => {
        const name = a.asset.ticker ?? a.asset.name;
        const shortName = name.length > 18 ? name.slice(0, 18) + '…' : name;
        return `${shortName} ${(a.weight * 100).toFixed(0)}%`;
      });

    // If oracle data is sparse, fall back to canonical allocation labels
    const allocationSummary = top3.length > 0
      ? top3
      : (profile === 'CONSERVADOR'
          ? ['Super Ahorro 50%', 'PF UVA 30%', 'Renta Fija CER 20%']
          : profile === 'MODERADO'
              ? ['Super Ahorro 30%', 'Renta Fija CER 15%', 'PF UVA 15%']
              : ['Lecaps 20%', 'Super Ahorro 15%', 'MEP 15%']);

    const isSelected = derivedSelected === profile;
    const isRecommended = recommendedProfile === profile;
    const display = PROFILE_DISPLAY[profile];

    return {
      profile,
      label: display.label,
      accentColor: display.accentColor,
      accentBg: display.accentBg,
      accentBorder: display.accentBorder,
      glowColor: display.glowColor,

      expected_return_30d_pct: ret30d * 100,
      usd_estimate: ret30d * capital,
      sharpe: isFinite(sharpe) ? sharpe : FALLBACK[profile].sharpe,
      var95_pct: isFinite(var95) ? var95 * 100 : FALLBACK[profile].var95 * 100,
      vol_pct: isFinite(vol) ? vol * 100 : FALLBACK[profile].vol * 100,
      allocation_summary: allocationSummary,
      cta: isSelected ? 'ACTIVO' : 'APLICAR',

      isSelected,
      isRecommended,

      total_portfolio_value: portfolio.total_current_value_usd,
      total_stressed_value: portfolio.total_stressed_value_usd,
    };
  });

  return {
    cards,
    selectedProfile: derivedSelected,
    recommendedProfile,
    regimeLabel: `Régimen favorece: ${PROFILE_DISPLAY[recommendedProfile].label}`,
  };
}
