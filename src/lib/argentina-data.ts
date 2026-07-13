// ============================================================================
// ARGENTINA FINANCIAL DATA LAYER
// Model-driven estimates for Santander Argentina products
// ============================================================================

export interface MacroData {
  date: string;
  inflationMonthly: number;      // % monthly
  inflationExpected30d: number;   // % expected next 30d
  inflationExpected90d: number;   // % expected next 90d (annualized)
  bcraPolicyRate: number;         // % TNA
  crawlingPeg: number;            // % monthly devaluation
  mepRate: number;                // ARS/USD MEP
  officialRate: number;           // ARS/USD official
  gapMEPvsOfficial: number;       // % gap
  cerIndex: number;               // CER index base 100
  cerMonthlyChange: number;       // % monthly
  uvaValue: number;               // UVA units
  plazoFijoTNA: number;           // % TNA plazo fijo
  plazoFijoUVATNA: number;        // % TNA + UVA
  moneyMarketTNA: number;         // % TNA money market funds
}

export interface SantanderProduct {
  id: string;
  name: string;
  shortName: string;
  type: 'money_market' | 'cer_bond' | 'mixed' | 'usd_fund' | 'mep' | 'plazo_fijo' | 'plazo_fijo_uva';
  tna: number;                    // Nominal annual rate %
  realRate30d: number;            // Real return 30d estimate %
  realRate90d: number;            // Real return 90d estimate %
  liquidity: 'T+0' | 'T+1' | 'T+2' | 'locked';
  riskScore: number;              // 0-100 (0=safest)
  volatility30d: number;          // % 30d volatility
  maxDrawdown30d: number;         // % max drawdown 30d
  minInvestmentARS: number;       // ARS minimum
  currency: 'ARS' | 'USD';
  cerDuration?: number;           // CER duration in days (if applicable)
  description: string;
}

export interface MarketScenario {
  id: string;
  name: string;
  probability: number;            // 0-1
  inflation30d: number;
  devaluation30d: number;
  rateChange: number;             // bps change
  mepMove: number;                // % move
  description: string;
}

// ============================================================================
// CURRENT MACRO DATA (Model-driven estimates - June 2026)
// Based on: BCRA policy, INDEC inflation trajectory, market expectations
// ============================================================================
export function getCurrentMacroData(): MacroData {
  return {
    date: new Date().toISOString().split('T')[0],
    inflationMonthly: 3.2,           // Monthly inflation ~3.2%
    inflationExpected30d: 3.0,       // Expected next 30d
    inflationExpected90d: 2.8,       // Trending down
    bcraPolicyRate: 32.0,            // BCRA policy rate TNA
    crawlingPeg: 1.0,                // 1% monthly crawling peg
    mepRate: 1285,                   // ARS per USD MEP
    officialRate: 1155,              // ARS per USD official
    gapMEPvsOfficial: 11.3,          // % gap
    cerIndex: 385.42,                // CER index
    cerMonthlyChange: 3.1,           // CER monthly change
    uvaValue: 2103.45,               // UVA value
    plazoFijoTNA: 29.5,              // Traditional PF TNA
    plazoFijoUVATNA: 3.5,            // UVA PF additional TNA (over CER)
    moneyMarketTNA: 31.5,            // Money market fund TNA
  };
}

// ============================================================================
// SANTANDER ARGENTINA PRODUCT UNIVERSE
// ============================================================================
export function getSantanderProducts(macro: MacroData): SantanderProduct[] {
  const inflation30d = macro.inflationExpected30d;
  const inflation90d = macro.inflationExpected90d;

  // Real rate = (1 + nominal/12) / (1 + inflation/100) - 1
  const calcReal30d = (tna: number) => {
    const nominal30d = tna / 12;
    return ((1 + nominal30d / 100) / (1 + inflation30d / 100) - 1) * 100;
  };
  const calcReal90d = (tna: number) => {
    const nominal90d = (1 + tna / 100) ** 0.25 - 1;
    const infl90d = (1 + inflation90d / 100) ** 3 - 1;
    return ((1 + nominal90d) / (1 + infl90d) - 1) * 100;
  };

  // CER real return = UVA premium + CER appreciation
  const cerReal30d = macro.plazoFijoUVATNA / 12 + 0.05; // small excess over inflation
  const cerReal90d = macro.plazoFijoUVATNA / 4 + 0.15;

  // MEP: return depends on devaluation expectations
  const mepReturn30d = macro.crawlingPeg - (macro.gapMEPvsOfficial * 0.1); // risk of gap compression
  const mepReturn90d = macro.crawlingPeg * 3 - (macro.gapMEPvsOfficial * 0.15);

  return [
    {
      id: 'super-ahorro',
      name: 'Super Ahorro $',
      shortName: 'Super Ahorro',
      type: 'money_market',
      tna: macro.moneyMarketTNA,
      realRate30d: calcReal30d(macro.moneyMarketTNA),
      realRate90d: calcReal90d(macro.moneyMarketTNA),
      liquidity: 'T+0',
      riskScore: 2,
      volatility30d: 0.3,
      maxDrawdown30d: 0.0,
      minInvestmentARS: 1000,
      currency: 'ARS',
      description: 'FCI Money Market - Liquidez inmediata, capital preservado',
    },
    {
      id: 'renta-fija-cer',
      name: 'Superfondo Renta Fija CER',
      shortName: 'Renta Fija CER',
      type: 'cer_bond',
      tna: (1 + macro.plazoFijoUVATNA / 100) * (1 + macro.cerMonthlyChange / 100) ** 12 - 1 < 1
        ? macro.plazoFijoUVATNA + macro.cerMonthlyChange * 12
        : 40,
      realRate30d: cerReal30d,
      realRate90d: cerReal90d,
      liquidity: 'T+1',
      riskScore: 15,
      volatility30d: 1.2,
      maxDrawdown30d: 0.5,
      minInvestmentARS: 1000,
      currency: 'ARS',
      cerDuration: 60,
      description: 'FCI CER corto plazo - Ajustado por inflación, duration corta',
    },
    {
      id: 'supergestion-mix-vi',
      name: 'Supergestión Mix VI',
      shortName: 'Mix VI',
      type: 'mixed',
      tna: 25.0,
      realRate30d: calcReal30d(25.0),
      realRate90d: calcReal90d(25.0),
      liquidity: 'T+1',
      riskScore: 35,
      volatility30d: 3.5,
      maxDrawdown30d: 2.0,
      minInvestmentARS: 1000,
      currency: 'ARS',
      description: 'FCI Mixto - Renta fija + variable, mayor riesgo/retorno',
    },
    {
      id: 'super-ahorro-usd',
      name: 'Superfondo Ahorro USD',
      shortName: 'Ahorro USD',
      type: 'usd_fund',
      tna: 4.5,
      realRate30d: 4.5 / 12, // in USD terms
      realRate90d: 4.5 / 4,
      liquidity: 'T+1',
      riskScore: 8,
      volatility30d: 1.0,
      maxDrawdown30d: 0.3,
      minInvestmentARS: 1000,
      currency: 'USD',
      description: 'FCI USD - Dólares con rendimiento, baja volatilidad',
    },
    {
      id: 'dolar-mep',
      name: 'Dólar MEP',
      shortName: 'MEP',
      type: 'mep',
      tna: macro.crawlingPeg * 12,
      realRate30d: mepReturn30d,
      realRate90d: mepReturn90d,
      liquidity: 'T+1',
      riskScore: 25,
      volatility30d: 4.0,
      maxDrawdown30d: 3.0,
      minInvestmentARS: 10000,
      currency: 'USD',
      description: 'Compra venta USD MEP - Cobertura cambiaria',
    },
    {
      id: 'plazo-fijo',
      name: 'Plazo Fijo Tradicional',
      shortName: 'PF Tradicional',
      type: 'plazo_fijo',
      tna: macro.plazoFijoTNA,
      realRate30d: calcReal30d(macro.plazoFijoTNA),
      realRate90d: calcReal90d(macro.plazoFijoTNA),
      liquidity: 'locked',
      riskScore: 5,
      volatility30d: 0.0,
      maxDrawdown30d: 0.0,
      minInvestmentARS: 1000,
      currency: 'ARS',
      description: 'Plazo fijo 30d - Tasa fija garantizada',
    },
    {
      id: 'plazo-fijo-uva',
      name: 'Plazo Fijo UVA',
      shortName: 'PF UVA',
      type: 'plazo_fijo_uva',
      tna: macro.plazoFijoUVATNA + macro.cerMonthlyChange * 12,
      realRate30d: cerReal30d,
      realRate90d: cerReal90d,
      liquidity: 'locked',
      riskScore: 10,
      volatility30d: 0.8,
      maxDrawdown30d: 0.0,
      minInvestmentARS: 1000,
      currency: 'ARS',
      description: 'Plazo fijo UVA - Ajustado por inflación + tasa premium',
    },
  ];
}

// ============================================================================
// MACRO SCENARIOS
// ============================================================================
export function getMacroScenarios(): MarketScenario[] {
  return [
    {
      id: 'stable',
      name: '🟢 Estabilidad',
      probability: 0.45,
      inflation30d: 2.5,
      devaluation30d: 1.0,
      rateChange: -50,
      mepMove: -2,
      description: 'Continúa el plan estabilizador. Inflación baja, crawling peg predecible.',
    },
    {
      id: 'mild-devaluation',
      name: '🟡 Devaluación Moderada',
      probability: 0.35,
      inflation30d: 4.5,
      devaluation30d: 3.0,
      rateChange: 200,
      mepMove: 8,
      description: 'Shock cambiario moderado. Aceleración inflacionaria temporal.',
    },
    {
      id: 'crisis',
      name: '🔴 Shock Cambiario',
      probability: 0.20,
      inflation30d: 8.0,
      devaluation30d: 15.0,
      rateChange: 800,
      mepMove: 25,
      description: 'Crisis cambiaria severa. Brecha se amplifica, inflación se dispara.',
    },
  ];
}

// ============================================================================
// HISTORICAL SIMULATION DATA
// ============================================================================
export function generateEquityCurve(
  initialCapital: number,
  weights: Record<string, number>,
  days: number = 90
): { date: string; valueARS: number; valueUSD: number; realReturn: number }[] {
  const macro = getCurrentMacroData();
  const products = getSantanderProducts(macro);
  const data: { date: string; valueARS: number; valueUSD: number; realReturn: number }[] = [];

  let capitalARS = initialCapital * macro.mepRate; // Convert USD to ARS
  const initialARS = capitalARS;
  const dailyInflation = macro.inflationExpected30d / 30 / 100;

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  for (let i = 0; i <= days; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);

    let dayReturn = 0;
    for (const [productId, weight] of Object.entries(weights)) {
      const product = products.find(p => p.id === productId);
      if (product) {
        const dailyNominal = product.tna / 365 / 100;
        // Add small random variation
        const noise = 1 + (Math.random() - 0.5) * product.volatility30d / 100 / 10;
        dayReturn += weight * dailyNominal * noise;
      }
    }

    capitalARS *= (1 + dayReturn - dailyInflation);

    const mepRate = macro.mepRate * (1 + macro.crawlingPeg / 100 / 30 * i);
    const valueUSD = capitalARS / mepRate;
    const realReturn = ((capitalARS / initialARS) / (1 + dailyInflation) ** i - 1) * 100;

    data.push({
      date: date.toISOString().split('T')[0],
      valueARS: Math.round(capitalARS * 100) / 100,
      valueUSD: Math.round(valueUSD * 100) / 100,
      realReturn: Math.round(realReturn * 100) / 100,
    });
  }

  return data;
}
