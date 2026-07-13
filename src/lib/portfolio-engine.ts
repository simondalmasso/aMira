// ============================================================================
// PORTFOLIO OPTIMIZATION ENGINE — V2 with Live Data
// Maximize real return subject to capital preservation constraints
// Cloudflare Edge compatible
// ============================================================================

import {
  type MacroState,
  type SantanderProduct,
  type MarketScenario,
  getProductsFromMacro,
  getScenariosFromMacro,
} from './live-data';

// ============================================================================
// TYPES
// ============================================================================
export interface PortfolioAllocation {
  productId: string;
  productName: string;
  weight: number;
  amountARS: number;
  amountUSD: number;
  category: string;
}

export interface PortfolioMetrics {
  expectedRealReturn30d: number;
  expectedRealReturn90d: number;
  expectedNominalReturn30d: number;
  volatility30d: number;
  maxDrawdown30d: number;
  liquidityScore: number;
  capitalSafetyScore: number;
  fxExposure: number;
  inflationExposure: number;
  rateSensitivity: number;
  sharpeRatio: number;
  carryViability: boolean;
  netCarry: number;
}

export interface ScenarioResult {
  scenarioId: string;
  scenarioName: string;
  scenarioEmoji: string;
  probability: number;
  portfolioReturn30d: number;
  maxDrawdown: number;
  capitalPreserved: boolean;
}

export interface OptimizationResult {
  allocations: PortfolioAllocation[];
  metrics: PortfolioMetrics;
  scenarioResults: ScenarioResult[];
  timestamp: string;
  dataMode: 'OBSERVADO' | 'REAL' | 'PARTIAL_FALLBACK' | 'ERROR' | 'STALE' | 'ERROR';
  mepRate: number;
}

// ============================================================================
// PROFILE TYPES — 3 simultaneous portfolios
// ============================================================================
export type PortfolioProfile = 'CONSERVADOR' | 'MODERADO' | 'ARRIESGADO';

export interface ProfileMetrics {
  profile: PortfolioProfile;
  expectedReturn30dPct: number;     // % monthly real
  expectedReturn30dUSD: number;    // USD gain
  sharpeRatio: number;
  var95: number;                   // VaR 95% — worst 5% loss (%)
  volatility30d: number;
  capitalSafetyScore: number;
  allocations: PortfolioAllocation[];
  metrics: PortfolioMetrics;       // full metrics
  scenarioResults: ScenarioResult[];
  recommendation: string;          // texto en español
}

export interface MultiProfileResult {
  profiles: Record<PortfolioProfile, ProfileMetrics>;
  timestamp: string;
  dataMode: 'OBSERVADO' | 'REAL' | 'PARTIAL_FALLBACK' | 'ERROR' | 'STALE' | 'ERROR';
  mepRate: number;
}

// ============================================================================
// PROFILE CONFIGURATION — constraints + scoring per profile
// ============================================================================
const PROFILE_CONFIG: Record<PortfolioProfile, {
  minMoneyMarket: number;
  maxMEP: number;
  maxSinglePosition: number;
  maxDrawdown: number;
  scoring: { returnW: number; safetyW: number; worstCaseW: number; ddW: number; liquidityW: number; volW: number };
  recommendation: string;
}> = {
  CONSERVADOR: {
    minMoneyMarket: 0.40,
    maxMEP: 0.10,
    maxSinglePosition: 0.60,
    maxDrawdown: 0.5,
    scoring: { returnW: 0.10, safetyW: 0.35, worstCaseW: 0.25, ddW: 0.20, liquidityW: 0.10, volW: 0.10 },
    recommendation: 'Preservar capital con baja volatilidad. Alta liquidez, cobertura inflacionaria, exposición FX mínima.',
  },
  MODERADO: {
    minMoneyMarket: 0.20,
    maxMEP: 0.18,
    maxSinglePosition: 0.45,
    maxDrawdown: 0.8,
    scoring: { returnW: 0.30, safetyW: 0.20, worstCaseW: 0.25, ddW: 0.10, liquidityW: 0.05, volW: 0.05 },
    recommendation: 'Balance riesgo/retorno optimizando Sharpe. Mix CER + Lecaps + cobertura FX parcial.',
  },
  ARRIESGADO: {
    minMoneyMarket: 0.12,
    maxMEP: 0.25,
    maxSinglePosition: 0.40,
    maxDrawdown: 1.2,
    scoring: { returnW: 0.50, safetyW: 0.05, worstCaseW: 0.15, ddW: 0.05, liquidityW: 0.02, volW: 0.02 },
    recommendation: 'Maximizar retorno esperado. Mayor peso Lecaps + carry, exposición FX elevada, menor liquidez.',
  },
};

// Profile-specific strategy pools
const CONSERVADOR_STRATEGIES: Record<string, number>[] = [
  { 'super-ahorro': 0.70, 'renta-fija-cer': 0.30 },
  { 'super-ahorro': 0.60, 'renta-fija-cer': 0.25, 'dolar-mep': 0.10 },
  { 'super-ahorro': 0.55, 'renta-fija-cer': 0.30, 'super-ahorro-usd': 0.15 },
  { 'super-ahorro': 0.50, 'plazo-fijo-uva': 0.30, 'renta-fija-cer': 0.20 },
  { 'super-ahorro': 0.80, 'renta-fija-cer': 0.20 },
  { 'super-ahorro': 0.50, 'renta-fija-cer': 0.35, 'plazo-fijo-uva': 0.15 },
  { 'super-ahorro': 0.55, 'dolar-mep': 0.10, 'renta-fija-cer': 0.25, 'plazo-fijo-uva': 0.10 },
  { 'super-ahorro': 0.60, 'renta-fija-cer': 0.25, 'supergestion-mix-vi': 0.10, 'dolar-mep': 0.05 },
  { 'super-ahorro': 0.65, 'renta-fija-cer': 0.35 },
  { 'super-ahorro': 0.55, 'plazo-fijo-uva': 0.25, 'renta-fija-cer': 0.20 },
  { 'super-ahorro': 0.50, 'plazo-fijo': 0.20, 'renta-fija-cer': 0.30 },
  { 'super-ahorro': 0.45, 'renta-fija-cer': 0.20, 'plazo-fijo-uva': 0.15, 'fondo-corto-plazo': 0.10, 'dolar-mep': 0.10 },
  { 'super-ahorro': 0.42, 'renta-fija-cer': 0.18, 'plazo-fijo-uva': 0.12, 'fondo-corto-plazo': 0.12, 'plazo-fijo': 0.08, 'dolar-mep': 0.08 },
];

const MODERADO_STRATEGIES: Record<string, number>[] = [
  { 'super-ahorro': 0.35, 'renta-fija-cer': 0.15, 'plazo-fijo-uva': 0.10, 'dolar-mep': 0.10, 'lecaps': 0.10, 'fondo-corto-plazo': 0.10, 'plazo-fijo': 0.10 },
  { 'super-ahorro': 0.30, 'renta-fija-cer': 0.15, 'plazo-fijo-uva': 0.15, 'dolar-mep': 0.08, 'lecaps': 0.12, 'fondo-corto-plazo': 0.10, 'plazo-fijo': 0.10 },
  { 'super-ahorro': 0.30, 'renta-fija-cer': 0.12, 'plazo-fijo-uva': 0.10, 'dolar-mep': 0.08, 'lecaps': 0.10, 'fondo-corto-plazo': 0.10, 'plazo-fijo': 0.10, 'super-ahorro-usd': 0.10 },
  { 'super-ahorro': 0.30, 'fondo-corto-plazo': 0.15, 'renta-fija-cer': 0.12, 'plazo-fijo-uva': 0.10, 'dolar-mep': 0.08, 'lecaps': 0.15, 'plazo-fijo': 0.10 },
  { 'super-ahorro': 0.32, 'renta-fija-cer': 0.15, 'plazo-fijo-uva': 0.10, 'lecaps': 0.13, 'fondo-corto-plazo': 0.10, 'plazo-fijo': 0.10, 'dolar-mep': 0.10 },
  { 'super-ahorro': 0.28, 'fondo-corto-plazo': 0.10, 'renta-fija-cer': 0.12, 'plazo-fijo-uva': 0.10, 'dolar-mep': 0.08, 'lecaps': 0.10, 'plazo-fijo': 0.08, 'super-ahorro-usd': 0.07, 'supergestion-mix-vi': 0.07 },
  { 'super-ahorro': 0.20, 'lecaps': 0.18, 'fondo-corto-plazo': 0.12, 'renta-fija-cer': 0.15, 'plazo-fijo-uva': 0.10, 'dolar-mep': 0.10, 'plazo-fijo': 0.08, 'super-ahorro-usd': 0.07 },
  { 'super-ahorro': 0.18, 'lecaps': 0.15, 'renta-fija-cer': 0.15, 'plazo-fijo-uva': 0.12, 'dolar-mep': 0.12, 'fondo-corto-plazo': 0.12, 'plazo-fijo': 0.08, 'super-ahorro-usd': 0.08 },
  { 'super-ahorro': 0.22, 'lecaps': 0.14, 'renta-fija-cer': 0.14, 'plazo-fijo-uva': 0.12, 'dolar-mep': 0.10, 'fondo-corto-plazo': 0.14, 'plazo-fijo': 0.14 },
];

const ARRIESGADO_STRATEGIES: Record<string, number>[] = [
  { 'super-ahorro': 0.15, 'lecaps': 0.20, 'renta-fija-cer': 0.12, 'plazo-fijo-uva': 0.10, 'dolar-mep': 0.15, 'fondo-corto-plazo': 0.12, 'plazo-fijo': 0.08, 'super-ahorro-usd': 0.08 },
  { 'super-ahorro': 0.16, 'lecaps': 0.18, 'renta-fija-cer': 0.10, 'dolar-mep': 0.18, 'fondo-corto-plazo': 0.14, 'plazo-fijo-uva': 0.10, 'plazo-fijo': 0.07, 'super-ahorro-usd': 0.07 },
  { 'super-ahorro': 0.15, 'lecaps': 0.15, 'renta-fija-cer': 0.12, 'plazo-fijo-uva': 0.10, 'dolar-mep': 0.15, 'fondo-corto-plazo': 0.12, 'plazo-fijo': 0.08, 'super-ahorro-usd': 0.08, 'supergestion-mix-vi': 0.05 },
  { 'super-ahorro': 0.12, 'lecaps': 0.22, 'dolar-mep': 0.20, 'fondo-corto-plazo': 0.15, 'renta-fija-cer': 0.10, 'plazo-fijo-uva': 0.08, 'plazo-fijo': 0.05, 'super-ahorro-usd': 0.08 },
  { 'super-ahorro': 0.14, 'lecaps': 0.20, 'dolar-mep': 0.18, 'fondo-corto-plazo': 0.14, 'renta-fija-cer': 0.08, 'plazo-fijo-uva': 0.10, 'super-ahorro-usd': 0.08, 'supergestion-mix-vi': 0.08 },
  { 'super-ahorro': 0.13, 'lecaps': 0.18, 'dolar-mep': 0.22, 'fondo-corto-plazo': 0.12, 'renta-fija-cer': 0.10, 'plazo-fijo-uva': 0.08, 'super-ahorro-usd': 0.10, 'plazo-fijo': 0.07 },
];

const PROFILE_STRATEGIES: Record<PortfolioProfile, Record<string, number>[]> = {
  CONSERVADOR: CONSERVADOR_STRATEGIES,
  MODERADO: MODERADO_STRATEGIES,
  ARRIESGADO: ARRIESGADO_STRATEGIES,
};

// ============================================================================
// CONSTRAINTS
// ============================================================================
const CONSTRAINTS = {
  maxDrawdown: 0.12,            // 12% max drawdown (REALISTIC_CAPITAL_ARCHITECTURE_v1)
  noLeverage: true,
  noEquities: true,
  minLiquidity: 'T+1' as const,
  maxSinglePosition: 0.60,
  maxMEP: 0.20,
  maxMixedFund: 0.15,
  minMoneyMarket: 0.25,
  capitalUSD: 2000,
  dailyVaRLimit: 0.02,          // 2% daily VaR limit
  lossProbabilityLimit: 0.15,   // 15% max probability of loss
};

// Adjusted constraints by return target mode
const TARGET_CONSTRAINTS = {
  CONSERVACION: { minMoneyMarket: 0.35, maxMEP: 0.10 },
  CRECIMIENTO_MODERADO: { minMoneyMarket: 0.25, maxMEP: 0.15 },
  CRECIMIENTO_AGRESIVO: { minMoneyMarket: 0.15, maxMEP: 0.20 },
};

// ============================================================================
// CALCULATE PORTFOLIO METRICS
// ============================================================================
export function calculateMetrics(
  allocations: PortfolioAllocation[],
  products: SantanderProduct[],
  macro: MacroState
): PortfolioMetrics {
  let wReal30d = 0, wReal90d = 0, wNom30d = 0, wVol = 0, wDD = 0;
  let liquidityW = 0, fxExp = 0, infExp = 0, rateSens = 0;

  const totalW = allocations.reduce((s, a) => s + a.weight, 0);

  for (const alloc of allocations) {
    const p = products.find(x => x.id === alloc.productId);
    if (!p) continue;
    const w = alloc.weight / totalW;

    wReal30d += w * p.realRate30d;
    wReal90d += w * p.realRate90d;
    wNom30d += w * (p.tna / 12);
    wVol += w * p.volatility30d;
    wDD += w * p.maxDrawdown30d;

    const liqMap: Record<string, number> = { 'T+0': 100, 'T+1': 80, 'T+2': 60, 'locked': 20 };
    liquidityW += w * (liqMap[p.liquidity] || 50);

    if (p.currency === 'USD' || p.type === 'mep') fxExp += w;
    if (p.type === 'cer_bond' || p.type === 'plazo_fijo_uva') infExp += w;
    if (p.cerDuration) rateSens += w * p.cerDuration * 0.01;
  }

  const capitalSafetyScore = Math.max(0, Math.min(100,
    100 - wVol * 10 - wDD * 20 - fxExp * 15 + infExp * 10 + liquidityW * 0.2
  ));

  const riskFreeRate = macro.rates.moneyMarket / 12;
  const excessReturn = wReal30d - riskFreeRate;
  const sharpeRatio = wVol > 0 ? excessReturn / wVol : 0;

  const netCarry = (macro.rates.moneyMarket / 12) - macro.crawlingPeg;

  return {
    expectedRealReturn30d: round2(wReal30d),
    expectedRealReturn90d: round2(wReal90d),
    expectedNominalReturn30d: round2(wNom30d),
    volatility30d: round2(wVol),
    maxDrawdown30d: round2(wDD),
    liquidityScore: Math.round(liquidityW),
    capitalSafetyScore: Math.round(capitalSafetyScore),
    fxExposure: Math.round(fxExp * 100),
    inflationExposure: Math.round(infExp * 100),
    rateSensitivity: round3(rateSens),
    sharpeRatio: round2(sharpeRatio),
    carryViability: netCarry > 0,
    netCarry: round2(netCarry),
  };
}

// ============================================================================
// SCENARIO ANALYSIS
// ============================================================================
export function runScenarios(
  allocations: PortfolioAllocation[],
  products: SantanderProduct[],
  scenarios: MarketScenario[]
): ScenarioResult[] {
  const totalW = allocations.reduce((s, a) => s + a.weight, 0);

  return scenarios.map(scenario => {
    let pReturn = 0, pDD = 0;

    for (const alloc of allocations) {
      const p = products.find(x => x.id === alloc.productId);
      if (!p) continue;
      const w = alloc.weight / totalW;

      let sReturn = p.realRate30d;
      if (p.currency === 'USD' || p.type === 'mep') {
        sReturn += scenario.devaluation30d - scenario.mepMove * 0.3;
      }
      if (p.type === 'cer_bond' || p.type === 'plazo_fijo_uva') {
        sReturn += (scenario.inflation30d - 3.0) * 0.7;
      }
      if (p.type === 'money_market' || p.type === 'plazo_fijo') {
        sReturn -= (scenario.inflation30d - 3.0) * 0.8;
      }
      if (p.type === 'mixed') {
        sReturn -= scenario.mepMove * 0.2;
      }

      pReturn += w * sReturn;
      pDD += w * p.maxDrawdown30d * (1 + scenario.mepMove / 50);
    }

    return {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      scenarioEmoji: scenario.emoji,
      probability: scenario.probability,
      portfolioReturn30d: round2(pReturn),
      maxDrawdown: round2(pDD),
      capitalPreserved: pReturn > -1,
    };
  });
}

// ============================================================================
// OPTIMIZATION ENGINE — Multi-strategy evaluation
// ============================================================================
export function optimizePortfolio(macro: MacroState, returnTarget: 'CONSERVACION' | 'CRECIMIENTO_MODERADO' | 'CRECIMIENTO_AGRESIVO' = 'CRECIMIENTO_MODERADO'): OptimizationResult {
  const products = getProductsFromMacro(macro);
  const scenarios = getScenariosFromMacro(macro);
  const capitalARS = CONSTRAINTS.capitalUSD * macro.mep.rate;

  // Adjust constraints based on return target
  const targetConstraints = TARGET_CONSTRAINTS[returnTarget];

  const strategies: Record<string, number>[] = [
    // Ultra-conservative
    { 'super-ahorro': 0.70, 'renta-fija-cer': 0.30 },
    // Conservative + USD hedge
    { 'super-ahorro': 0.60, 'renta-fija-cer': 0.25, 'dolar-mep': 0.15 },
    // Balanced CER
    { 'super-ahorro': 0.55, 'renta-fija-cer': 0.30, 'super-ahorro-usd': 0.15 },
    // UVA mix
    { 'super-ahorro': 0.50, 'plazo-fijo-uva': 0.30, 'renta-fija-cer': 0.20 },
    // Maximum liquidity
    { 'super-ahorro': 0.80, 'renta-fija-cer': 0.20 },
    // Inflation focused
    { 'super-ahorro': 0.50, 'renta-fija-cer': 0.35, 'plazo-fijo-uva': 0.15 },
    // USD defensive (adjusts with gap)
    { 'super-ahorro': 0.55, 'dolar-mep': 0.20, 'renta-fija-cer': 0.25 },
    // Small mix tilt
    { 'super-ahorro': 0.60, 'renta-fija-cer': 0.25, 'supergestion-mix-vi': 0.10, 'dolar-mep': 0.05 },
    // Pure liquidity + CER
    { 'super-ahorro': 0.65, 'renta-fija-cer': 0.35 },
    // UVA heavy
    { 'super-ahorro': 0.55, 'plazo-fijo-uva': 0.25, 'renta-fija-cer': 0.20 },
    // PF trad
    { 'super-ahorro': 0.50, 'plazo-fijo': 0.20, 'renta-fija-cer': 0.30 },
    // Aggressive USD
    { 'super-ahorro': 0.50, 'dolar-mep': 0.20, 'renta-fija-cer': 0.30 },
    // ── 7+ ASSET DIVERSIFIED STRATEGIES ──
    // 7-asset diversified conservative
    { 'super-ahorro': 0.35, 'renta-fija-cer': 0.15, 'plazo-fijo-uva': 0.10, 'dolar-mep': 0.10, 'lecaps': 0.10, 'fondo-corto-plazo': 0.10, 'plazo-fijo': 0.10 },
    // 7-asset with more CER/UVA
    { 'super-ahorro': 0.30, 'renta-fija-cer': 0.15, 'plazo-fijo-uva': 0.15, 'dolar-mep': 0.08, 'lecaps': 0.12, 'fondo-corto-plazo': 0.10, 'plazo-fijo': 0.10 },
    // 8-asset max diversity
    { 'super-ahorro': 0.30, 'renta-fija-cer': 0.12, 'plazo-fijo-uva': 0.10, 'dolar-mep': 0.08, 'lecaps': 0.10, 'fondo-corto-plazo': 0.10, 'plazo-fijo': 0.10, 'super-ahorro-usd': 0.10 },
    // 7-asset liquidity tilt
    { 'super-ahorro': 0.30, 'fondo-corto-plazo': 0.15, 'renta-fija-cer': 0.12, 'plazo-fijo-uva': 0.10, 'dolar-mep': 0.08, 'lecaps': 0.15, 'plazo-fijo': 0.10 },
    // 7-asset yield tilt
    { 'super-ahorro': 0.32, 'renta-fija-cer': 0.15, 'plazo-fijo-uva': 0.10, 'lecaps': 0.13, 'fondo-corto-plazo': 0.10, 'plazo-fijo': 0.10, 'dolar-mep': 0.10 },
    // 9-asset full universe
    { 'super-ahorro': 0.28, 'fondo-corto-plazo': 0.10, 'renta-fija-cer': 0.12, 'plazo-fijo-uva': 0.10, 'dolar-mep': 0.08, 'lecaps': 0.10, 'plazo-fijo': 0.08, 'super-ahorro-usd': 0.07, 'supergestion-mix-vi': 0.07 },
    // ── CRECIMIENTO MODERADO STRATEGIES ──
    // Reduced cash, more Lecaps + short-term yield, light MEP hedge
    { 'super-ahorro': 0.20, 'lecaps': 0.18, 'fondo-corto-plazo': 0.12, 'renta-fija-cer': 0.15, 'plazo-fijo-uva': 0.10, 'dolar-mep': 0.10, 'plazo-fijo': 0.08, 'super-ahorro-usd': 0.07 },
    // Growth tilt — Lecaps heavy + CER
    { 'super-ahorro': 0.18, 'lecaps': 0.15, 'renta-fija-cer': 0.15, 'plazo-fijo-uva': 0.12, 'dolar-mep': 0.12, 'fondo-corto-plazo': 0.12, 'plazo-fijo': 0.08, 'super-ahorro-usd': 0.08 },
    // Balanced growth 7-asset
    { 'super-ahorro': 0.22, 'lecaps': 0.14, 'renta-fija-cer': 0.14, 'plazo-fijo-uva': 0.12, 'dolar-mep': 0.10, 'fondo-corto-plazo': 0.14, 'plazo-fijo': 0.14 },
    // ── CRECIMIENTO AGRESIVO STRATEGIES ──
    // Minimal cash, max yield + MEP
    { 'super-ahorro': 0.15, 'lecaps': 0.20, 'renta-fija-cer': 0.12, 'plazo-fijo-uva': 0.10, 'dolar-mep': 0.15, 'fondo-corto-plazo': 0.12, 'plazo-fijo': 0.08, 'super-ahorro-usd': 0.08 },
    // Aggressive yield + full USD hedge
    { 'super-ahorro': 0.16, 'lecaps': 0.18, 'renta-fija-cer': 0.10, 'dolar-mep': 0.18, 'fondo-corto-plazo': 0.14, 'plazo-fijo-uva': 0.10, 'plazo-fijo': 0.07, 'super-ahorro-usd': 0.07 },
    // Max diversification aggressive
    { 'super-ahorro': 0.15, 'lecaps': 0.15, 'renta-fija-cer': 0.12, 'plazo-fijo-uva': 0.10, 'dolar-mep': 0.15, 'fondo-corto-plazo': 0.12, 'plazo-fijo': 0.08, 'super-ahorro-usd': 0.08, 'supergestion-mix-vi': 0.05 },
  ];

  let bestScore = -Infinity;
  let bestAllocations: PortfolioAllocation[] = [];
  let bestMetrics: PortfolioMetrics | null = null;
  let bestScenarios: ScenarioResult[] = [];

  for (const strategy of strategies) {
    // Validate constraints
    let valid = true;
    for (const [id, weight] of Object.entries(strategy)) {
      if (weight > CONSTRAINTS.maxSinglePosition + 0.01) { valid = false; break; }
      if (id === 'dolar-mep' && weight > targetConstraints.maxMEP + 0.01) { valid = false; break; }
      if (id === 'supergestion-mix-vi' && weight > CONSTRAINTS.maxMixedFund + 0.01) { valid = false; break; }
    }
    const mmWeight = strategy['super-ahorro'] || 0;
    if (mmWeight < targetConstraints.minMoneyMarket - 0.01) valid = false;
    if (!valid) continue;

    const allocations: PortfolioAllocation[] = Object.entries(strategy).map(([id, weight]) => {
      const product = products.find(p => p.id === id)!;
      const amountARS = capitalARS * weight;
      const amountUSD = amountARS / macro.mep.rate;
      return {
        productId: id,
        productName: product.shortName,
        weight,
        amountARS: Math.round(amountARS),
        amountUSD: Math.round(amountUSD * 100) / 100,
        category: product.category,
      };
    });

    const metrics = calculateMetrics(allocations, products, macro);
    const scenarioResults = runScenarios(allocations, products, scenarios);

    // Reject if max drawdown exceeds constraint
    if (metrics.maxDrawdown30d > CONSTRAINTS.maxDrawdown) continue;

    // Composite score
    const worstCase = Math.min(...scenarioResults.map(s => s.portfolioReturn30d));
    const diversificationBonus = allocations.length * 0.02;
    const score =
      metrics.expectedRealReturn30d * 0.30
      + (metrics.capitalSafetyScore / 100) * 0.25
      + Math.max(0, worstCase) * 0.30
      - metrics.maxDrawdown30d * 0.15
      + (metrics.liquidityScore / 100) * 0.05
      - metrics.volatility30d * 0.05
      + diversificationBonus;

    if (score > bestScore) {
      bestScore = score;
      bestAllocations = allocations;
      bestMetrics = metrics;
      bestScenarios = scenarioResults;
    }
  }

  return {
    allocations: bestAllocations,
    metrics: bestMetrics!,
    scenarioResults: bestScenarios,
    timestamp: new Date().toISOString(),
    dataMode: macro.source,
    mepRate: macro.mep.rate,
  };
}

// ============================================================================
// MULTI-PROFILE OPTIMIZER — 3 simultaneous portfolios
// ============================================================================
export function optimizePortfolioMulti(macro: MacroState): MultiProfileResult {
  const products = getProductsFromMacro(macro);
  const scenarios = getScenariosFromMacro(macro);
  const capitalARS = CONSTRAINTS.capitalUSD * macro.mep.rate;
  const timestamp = new Date().toISOString();

  const profiles: Record<PortfolioProfile, ProfileMetrics> = {
    CONSERVADOR: optimizeForProfile('CONSERVADOR', products, scenarios, macro, capitalARS),
    MODERADO: optimizeForProfile('MODERADO', products, scenarios, macro, capitalARS),
    ARRIESGADO: optimizeForProfile('ARRIESGADO', products, scenarios, macro, capitalARS),
  };

  return {
    profiles,
    timestamp,
    dataMode: macro.source,
    mepRate: macro.mep.rate,
  };
}

function optimizeForProfile(
  profile: PortfolioProfile,
  products: SantanderProduct[],
  scenarios: MarketScenario[],
  macro: MacroState,
  capitalARS: number
): ProfileMetrics {
  const config = PROFILE_CONFIG[profile];
  const strategies = PROFILE_STRATEGIES[profile];
  const sc = config.scoring;

  let bestScore = -Infinity;
  let bestAllocations: PortfolioAllocation[] = [];
  let bestMetrics: PortfolioMetrics | null = null;
  let bestScenarios: ScenarioResult[] = [];

  for (const strategy of strategies) {
    // Validate profile-specific constraints
    let valid = true;
    for (const [id, weight] of Object.entries(strategy)) {
      if (weight > config.maxSinglePosition + 0.01) { valid = false; break; }
      if (id === 'dolar-mep' && weight > config.maxMEP + 0.01) { valid = false; break; }
      if (id === 'supergestion-mix-vi' && weight > CONSTRAINTS.maxMixedFund + 0.01) { valid = false; break; }
    }
    const mmWeight = strategy['super-ahorro'] || 0;
    if (mmWeight < config.minMoneyMarket - 0.01) valid = false;
    if (!valid) continue;

    const allocations: PortfolioAllocation[] = Object.entries(strategy).map(([id, weight]) => {
      const product = products.find(p => p.id === id)!;
      const amountARS = capitalARS * weight;
      const amountUSD = amountARS / macro.mep.rate;
      return {
        productId: id,
        productName: product.shortName,
        weight,
        amountARS: Math.round(amountARS),
        amountUSD: Math.round(amountUSD * 100) / 100,
        category: product.category,
      };
    });

    const metrics = calculateMetrics(allocations, products, macro);
    const scenarioResults = runScenarios(allocations, products, scenarios);

    // Reject if max drawdown exceeds profile constraint
    if (metrics.maxDrawdown30d > config.maxDrawdown) continue;

    // Profile-specific composite score
    const worstCase = Math.min(...scenarioResults.map(s => s.portfolioReturn30d));
    const diversificationBonus = allocations.length * 0.02;
    const score =
      metrics.expectedRealReturn30d * sc.returnW
      + (metrics.capitalSafetyScore / 100) * sc.safetyW
      + Math.max(0, worstCase) * sc.worstCaseW
      - metrics.maxDrawdown30d * sc.ddW
      + (metrics.liquidityScore / 100) * sc.liquidityW
      - metrics.volatility30d * sc.volW
      + diversificationBonus;

    if (score > bestScore) {
      bestScore = score;
      bestAllocations = allocations;
      bestMetrics = metrics;
      bestScenarios = scenarioResults;
    }
  }

  // Fallback if no valid strategy found
  if (!bestMetrics) {
    const fallbackStrategy = profile === 'CONSERVADOR'
      ? { 'super-ahorro': 0.80, 'renta-fija-cer': 0.20 }
      : profile === 'MODERADO'
      ? { 'super-ahorro': 0.35, 'renta-fija-cer': 0.15, 'lecaps': 0.10, 'dolar-mep': 0.10, 'fondo-corto-plazo': 0.10, 'plazo-fijo-uva': 0.10, 'plazo-fijo': 0.10 }
      : { 'super-ahorro': 0.15, 'lecaps': 0.20, 'dolar-mep': 0.18, 'fondo-corto-plazo': 0.14, 'renta-fija-cer': 0.10, 'plazo-fijo-uva': 0.10, 'super-ahorro-usd': 0.08, 'plazo-fijo': 0.05 };

    bestAllocations = Object.entries(fallbackStrategy).map(([id, weight]) => {
      const product = products.find(p => p.id === id)!;
      const amountARS = capitalARS * weight;
      const amountUSD = amountARS / macro.mep.rate;
      return {
        productId: id,
        productName: product.shortName,
        weight,
        amountARS: Math.round(amountARS),
        amountUSD: Math.round(amountUSD * 100) / 100,
        category: product.category,
      };
    });
    bestMetrics = calculateMetrics(bestAllocations, products, macro);
    bestScenarios = runScenarios(bestAllocations, products, scenarios);
  }

  const totalUSD = bestAllocations.reduce((s, a) => s + a.amountUSD, 0);
  const var95 = calculateVaR95(bestScenarios);

  return {
    profile,
    expectedReturn30dPct: bestMetrics.expectedRealReturn30d,
    expectedReturn30dUSD: round2(totalUSD * bestMetrics.expectedRealReturn30d / 100),
    sharpeRatio: bestMetrics.sharpeRatio,
    var95,
    volatility30d: bestMetrics.volatility30d,
    capitalSafetyScore: bestMetrics.capitalSafetyScore,
    allocations: bestAllocations,
    metrics: bestMetrics,
    scenarioResults: bestScenarios,
    recommendation: config.recommendation,
  };
}

// ============================================================================
// VaR 95% — Worst 5% scenario loss
// ============================================================================
export function calculateVaR95(scenarioResults: ScenarioResult[]): number {
  // Sort returns ascending (worst first)
  const sortedReturns = scenarioResults
    .map(s => s.portfolioReturn30d)
    .sort((a, b) => a - b);

  if (sortedReturns.length === 0) return 0;

  // 5th percentile index
  const idx = Math.max(0, Math.floor(sortedReturns.length * 0.05));
  // VaR is the worst 5th percentile return (negative = loss)
  return round2(Math.abs(sortedReturns[idx]));
}

// ============================================================================
// REGIME → FAVORED PROFILE MAPPING
// ============================================================================
export function getRegimeFavoredProfile(regime: string): PortfolioProfile {
  switch (regime) {
    case 'CARRY':
    case 'CARRY_FAVORABLE': return 'ARRIESGADO';
    case 'NORMAL': return 'MODERADO';
    case 'WARNING': return 'MODERADO';
    case 'HIGH_VOL': return 'CONSERVADOR';
    case 'CRISIS': return 'CONSERVADOR';
    case 'GLOBAL_RISK_OFF': return 'CONSERVADOR';
    default: return 'MODERADO';
  }
}

// ============================================================================
// GENERATE EQUITY CURVE (for charts)
// ============================================================================
export function generateEquityCurve(
  initialCapitalUSD: number,
  allocations: PortfolioAllocation[],
  products: SantanderProduct[],
  macro: MacroState,
  days: number = 90
): { date: string; day: number; valueUSD: number; valueARS: number; realReturn: number }[] {
  const capitalARS = initialCapitalUSD * macro.mep.rate;
  const initialARS = capitalARS;
  const dailyInflation = macro.inflation.expected30d / 30 / 100;

  const weights: Record<string, number> = {};
  allocations.forEach(a => { weights[a.productId] = a.weight; });

  const data: { date: string; day: number; valueUSD: number; valueARS: number; realReturn: number }[] = [];
  let currentARS = capitalARS;

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Use deterministic seed for consistent charts
  let seed = 42;
  const pseudoRandom = () => {
    seed = (seed * 16807 + 0) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let i = 0; i <= days; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);

    let dayReturn = 0;
    for (const [productId, weight] of Object.entries(weights)) {
      const product = products.find(p => p.id === productId);
      if (product) {
        const dailyNominal = product.tna / 365 / 100;
        const noise = 1 + (pseudoRandom() - 0.5) * product.volatility30d / 100 / 10;
        dayReturn += weight * dailyNominal * noise;
      }
    }

    currentARS *= (1 + dayReturn - dailyInflation);
    const mepRate = macro.mep.rate * (1 + macro.crawlingPeg / 100 / 30 * i);
    const valueUSD = currentARS / mepRate;
    const realReturn = ((currentARS / initialARS) / Math.pow(1 + dailyInflation, i) - 1) * 100;

    data.push({
      date: date.toISOString().split('T')[0],
      day: i,
      valueUSD: Math.round(valueUSD * 100) / 100,
      valueARS: Math.round(currentARS * 100) / 100,
      realReturn: Math.round(realReturn * 100) / 100,
    });
  }

  return data;
}

// ============================================================================
// HELPERS
// ============================================================================
function round2(n: number): number { return Math.round(n * 100) / 100; }
function round3(n: number): number { return Math.round(n * 1000) / 1000; }
