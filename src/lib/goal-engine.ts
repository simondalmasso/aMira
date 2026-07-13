// ============================================================================
// GOAL ENGINE — Objetivo de Ganancia
// Dado capital, horizonte y meta USD, calcula:
// - Retorno requerido
// - Probabilidad de alcanzar la meta
// - Cartera necesaria
// - Escenarios pesimista/base/optimista
// - Riesgo asociado + VaR + Drawdown
// - Acciones sugeridas
// ============================================================================

import {
  type MacroState,
  type SantanderProduct,
  getProductsFromMacro,
  getScenariosFromMacro,
} from './live-data';
import {
  type PortfolioAllocation,
  type PortfolioMetrics,
  type ScenarioResult,
  type PortfolioProfile,
  type ProfileMetrics,
  calculateMetrics,
  runScenarios,
  calculateVaR95,
  optimizePortfolioMulti,
} from './portfolio-engine';
import {
  type OracleState,
  computeOracle,
} from './macroOracle';

// ============================================================================
// TYPES
// ============================================================================
export type GoalHorizon = 30 | 60 | 90;

export interface GoalInput {
  capitalUSD: number;
  horizon: GoalHorizon;
  targetUSD: number;
}

export interface GoalResult {
  // Inputs
  capitalUSD: number;
  horizon: GoalHorizon;
  targetUSD: number;

  // Core calculations
  requiredReturnPct: number;           // % total return needed over horizon
  requiredMonthlyPct: number;          // % monthly return needed
  bestProfile: PortfolioProfile;        // which profile gets closest
  bestProfileReturnPct: number;        // what the best profile can deliver (monthly)
  bestProfileReturnTotalPct: number;   // total over horizon

  // Assessment
  isRealistic: boolean;               // SI / NO
  successProbability: number;          // 0–100%
  realismDetail: 'alcanzable' | 'dificil' | 'irrealista';

  // Scenarios (in USD)
  pessimisticUSD: number;              // worst case USD gain
  baseUSD: number;                     // base case USD gain
  optimisticUSD: number;               // best case USD gain

  // Risk metrics
  var95: number;                       // VaR 95% (% loss)
  maxDrawdown: number;                 // expected max drawdown (%)
  riskLevel: 'bajo' | 'medio' | 'alto' | 'muy_alto';

  // Suggested actions
  actions: GoalAction[];

  // Profile details for the best-fit portfolio
  profileMetrics: ProfileMetrics;
}

export interface GoalAction {
  action: string;
  detail: string;
  impact: 'bajo' | 'medio' | 'alto';
}

// ============================================================================
// GOAL ENGINE — Compute goal feasibility
// ============================================================================
export function computeGoal(
  input: GoalInput,
  macro: MacroState
): GoalResult {
  const { capitalUSD, horizon, targetUSD } = input;
  const months = horizon / 30;

  // 1. Required return
  const requiredReturnPct = (targetUSD / capitalUSD) * 100;
  const requiredMonthlyPct = (Math.pow(1 + targetUSD / capitalUSD, 1 / months) - 1) * 100;

  // 2. Get all 3 profiles
  const multiResult = optimizePortfolioMulti(macro);

  // 3. Find which profile gets closest to the target
  const profiles: PortfolioProfile[] = ['CONSERVADOR', 'MODERADO', 'ARRIESGADO'];
  let bestProfile: PortfolioProfile = 'MODERADO';
  let bestReturnPct = 0;

  for (const profile of profiles) {
    const pm = multiResult.profiles[profile];
    const totalReturn = computeTotalReturn(pm.expectedReturn30dPct, months);
    if (totalReturn > bestReturnPct) {
      bestReturnPct = totalReturn;
      bestProfile = profile;
    }
  }

  const bestPM = multiResult.profiles[bestProfile];
  const bestProfileReturnPct = bestPM.expectedReturn30dPct;
  const bestProfileReturnTotalPct = bestReturnPct;

  // 4. Compute probability of reaching target
  // Use scenario analysis: count scenarios where portfolio beats target
  const products = getProductsFromMacro(macro);
  const scenarios = getScenariosFromMacro(macro);
  const scenarioResults = runScenarios(bestPM.allocations, products, scenarios);

  // Extend scenarios with probability-weighted Monte Carlo approximation
  const successProb = computeSuccessProbability(
    bestProfileReturnPct,
    requiredMonthlyPct,
    bestPM.volatility30d,
    months
  );

  // 5. Compute scenarios in USD
  const pessimisticReturn = bestProfileReturnPct - bestPM.volatility30d * 2;
  const baseReturn = bestProfileReturnPct;
  const optimisticReturn = bestProfileReturnPct + bestPM.volatility30d * 0.8;

  const pessimisticUSD = capitalUSD * (pessimisticReturn / 100) * months;
  const baseUSD = capitalUSD * (baseReturn / 100) * months;
  const optimisticUSD = capitalUSD * (optimisticReturn / 100) * months;

  // 6. Is it realistic?
  const isRealistic = successProb >= 30;
  const realismDetail: GoalResult['realismDetail'] =
    successProb >= 50 ? 'alcanzable' :
    successProb >= 25 ? 'dificil' :
    'irrealista';

  // 7. Risk metrics
  const var95 = bestPM.var95;
  const maxDrawdown = bestPM.metrics.maxDrawdown30d * Math.sqrt(months);
  const riskLevel: GoalResult['riskLevel'] =
    maxDrawdown <= 0.5 ? 'bajo' :
    maxDrawdown <= 2.0 ? 'medio' :
    maxDrawdown <= 5.0 ? 'alto' :
    'muy_alto';

  // 8. Suggested actions
  const actions = computeActions(input, bestPM, macro);

  return {
    capitalUSD,
    horizon,
    targetUSD,
    requiredReturnPct: round2(requiredReturnPct),
    requiredMonthlyPct: round2(requiredMonthlyPct),
    bestProfile,
    bestProfileReturnPct: round2(bestProfileReturnPct),
    bestProfileReturnTotalPct: round2(bestProfileReturnTotalPct),
    isRealistic,
    successProbability: round1(successProb),
    realismDetail,
    pessimisticUSD: round2(pessimisticUSD),
    baseUSD: round2(baseUSD),
    optimisticUSD: round2(optimisticUSD),
    var95: round2(var95),
    maxDrawdown: round2(maxDrawdown),
    riskLevel,
    actions,
    profileMetrics: bestPM,
  };
}

// ============================================================================
// SUCCESS PROBABILITY — Approximation using log-normal distribution
// ============================================================================
function computeSuccessProbability(
  expectedMonthly: number,
  requiredMonthly: number,
  volatilityMonthly: number,
  months: number
): number {
  // For a portfolio with expected monthly return μ and volatility σ,
  // over N months, the total return is approximately:
  //   E[total] = μ * N
  //   Var[total] = σ² * N
  // P(R > R_target) ≈ Φ((μ*N - R_target*N) / (σ*√N))
  // where Φ is the standard normal CDF

  const mu = expectedMonthly;
  const rTarget = requiredMonthly;
  const sigma = Math.max(volatilityMonthly, 0.1); // floor to avoid division by zero

  // Z-score for the probability calculation
  const z = ((mu - rTarget) * Math.sqrt(months)) / sigma;

  // Approximate CDF of standard normal (Abramowitz & Stegun)
  const prob = normalCDF(z) * 100;

  return Math.max(0, Math.min(100, prob));
}

// Standard normal CDF approximation
function normalCDF(z: number): number {
  // Approximation using error function
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

// ============================================================================
// COMPUTE TOTAL RETURN over N months
// ============================================================================
function computeTotalReturn(monthlyPct: number, months: number): number {
  return ((1 + monthlyPct / 100) ** months - 1) * 100;
}

// ============================================================================
// SUGGESTED ACTIONS — Based on gap analysis
// ============================================================================
function computeActions(
  input: GoalInput,
  bestPM: ProfileMetrics,
  macro: MacroState
): GoalAction[] {
  const actions: GoalAction[] = [];
  const { targetUSD, capitalUSD, horizon } = input;
  const months = horizon / 30;
  const requiredMonthly = (Math.pow(1 + targetUSD / capitalUSD, 1 / months) - 1) * 100;
  const gap = requiredMonthly - bestPM.expectedReturn30dPct;

  // If gap is large, suggest specific rotations
  if (gap > 0.5) {
    // Need more return → suggest yield-enhancing rotations
    const currentMM = bestPM.allocations.find(a => a.productId === 'super-ahorro');
    if (currentMM && currentMM.weight > 0.25) {
      actions.push({
        action: 'Reducir money market',
        detail: `Rotar ${(Math.min(currentMM.weight - 0.15, 0.15) * 100).toFixed(0)}% de Super Ahorro a Lecaps para mejorar yield. Carry actual no alcanza el objetivo.`,
        impact: 'medio',
      });
    }

    const currentMEP = bestPM.allocations.find(a => a.productId === 'dolar-mep');
    if ((!currentMEP || currentMEP.weight < 0.10) && macro.mep.gap < 30) {
      actions.push({
        action: 'Aumentar cobertura USD (MEP)',
        detail: 'Brecha MEP baja: agregar posición MEP captura crawling peg con bajo riesgo de gap.',
        impact: 'medio',
      });
    }

    const currentCER = bestPM.allocations.filter(a => a.category === 'inflation_hedge');
    const cerWeight = currentCER.reduce((s, a) => s + a.weight, 0);
    if (cerWeight < 0.25) {
      actions.push({
        action: 'Aumentar CER / UVA',
        detail: `Cobertura inflacionaria baja (${(cerWeight * 100).toFixed(0)}%). Aumentar Renta Fija CER y PF UVA mejora retorno real en USD.`,
        impact: 'alto',
      });
    }

    const currentLecaps = bestPM.allocations.find(a => a.productId === 'lecaps');
    if (!currentLecaps || currentLecaps.weight < 0.12) {
      actions.push({
        action: 'Aumentar Lecaps',
        detail: `Lecaps ofrece el mejor yield en ARS con baja volatilidad. TNA ${macro.rates.bcraPolicy + 1.5}% — retorno USD ~${(((1 + (macro.rates.bcraPolicy + 1.5) / 12 / 100) / (1 + macro.crawlingPeg / 100) - 1) * 100).toFixed(2)}%/mes.`,
        impact: 'alto',
      });
    }

    if (gap > 2.0) {
      actions.push({
        action: 'Incrementar capital o extender horizonte',
        detail: `La meta requiere +${requiredMonthly.toFixed(2)}%/mes pero la cartera entrega ~${bestPM.expectedReturn30dPct.toFixed(2)}%/mes. Considere aumentar capital a $${Math.round(targetUSD / (bestPM.expectedReturn30dPct / 100 * months * 0.8)).toLocaleString()} USD o extender a ${Math.ceil(gap / bestPM.expectedReturn30dPct * months + months) * 30} días.`,
        impact: 'alto',
      });
    }
  } else if (gap < -0.3) {
    // Target easily achievable → suggest risk reduction
    actions.push({
      action: 'Reducir riesgo — objetivo superado',
      detail: `La cartera entrega +${bestPM.expectedReturn30dPct.toFixed(2)}%/mes vs objetivo +${requiredMonthly.toFixed(2)}%/mes. Considere mover a perfil más conservador para proteger ganancia.`,
      impact: 'bajo',
    });
  } else {
    // Close to target
    actions.push({
      action: 'Mantener cartera actual',
      detail: `La cartera está alineada con el objetivo. Retorno proyectado +${bestPM.expectedReturn30dPct.toFixed(2)}%/mes vs requerido +${requiredMonthly.toFixed(2)}%/mes.`,
      impact: 'bajo',
    });
  }

  // Regime-based advice
  const carry = macro.rates.moneyMarket / 12 - macro.crawlingPeg;
  if (carry > 1.5) {
    actions.push({
      action: 'Aprovechar régimen de carry',
      detail: `Carry neto positivo (${carry.toFixed(2)}%/mes). Instrumentos ARS rinden bien en USD. Favorecer Lecaps y Corto Plazo.`,
      impact: 'medio',
    });
  } else if (carry < 0.5) {
    actions.push({
      action: 'Cubrir riesgo cambiario',
      detail: `Carry bajo (${carry.toFixed(2)}%/mes). Mayor peso en USD (MEP, Ahorro USD) reduce riesgo de devaluación.`,
      impact: 'alto',
    });
  }

  return actions;
}

// ============================================================================
// HELPERS
// ============================================================================
function round1(n: number): number { return Math.round(n * 10) / 10; }
function round2(n: number): number { return Math.round(n * 100) / 100; }
