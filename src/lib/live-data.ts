// Canonical Argentina live-data layer with explicit field-level provenance.

import { fetchBCRAData, fetchCERData } from './bcra-api';
import { fetchINDECInflation } from './indec-api';
import { computeRatesFromBCRA } from './rates-api';
import { auditAPIResponse, BluelyticsSchema, BCRARatesSchema, CERDataSchema, INDECInflationSchema } from './data-integrity';

export interface BluelyticsResponse {
  oficial: { value_avg: number; value_sell: number; value_buy: number };
  blue: { value_avg: number; value_sell: number; value_buy: number };
  oficial_euro: { value_avg: number; value_sell: number; value_buy: number };
  blue_euro: { value_avg: number; value_sell: number; value_buy: number };
  last_update: string;
}

export type DataLabel = 'OBSERVADO' | 'REAL' | 'PARTIAL_FALLBACK' | 'ERROR' | 'STALE' | 'SIMULADO' | 'RECONSTRUIDO';

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
  observedAt?: string | null;
  coverage?: 'full' | 'partial' | 'none';
  limitations?: string[];
  transformations?: string[];
}

export interface MacroState {
  lastUpdate: string;
  fetchedAt: string;
  ageMinutes: number;
  lastSuccessfulFetch: string | null;
  source: 'OBSERVADO' | 'REAL' | 'PARTIAL_FALLBACK' | 'ERROR' | 'STALE';
  mep: { rate: number; officialRate: number; gap: number; sell: number; buy: number };
  inflation: { monthly: number; expected30d: number; expected90d: number; yearly: number };
  rates: {
    bcraPolicy: number; moneyMarket: number; plazoFijo: number; plazoFijoUVA: number;
    lecaps: number; badlar: number; leliq: number; tml: number;
  };
  cer: { index: number; monthlyChange: number; dailyChange: number };
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

export const STALE_THRESHOLD_MINUTES = 1080;
export const DATA_STALE_THRESHOLDS: Record<string, number> = {
  mepRate: 48,
  rates: 72,
  inflation: 2160,
  cer: 72,
  crawlingPeg: 99999,
  reserves: 72,
};

const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
const stalenessHours = (date: string): number => {
  const time = Date.parse(date);
  return Number.isFinite(time) ? Math.max(0, Math.round((Date.now() - time) / 3_600_000)) : 999;
};

export function computeAge(macro: MacroState): number {
  const time = Date.parse(macro.fetchedAt);
  return Number.isFinite(time) ? Math.max(0, Math.round((Date.now() - time) / 60_000)) : 9999;
}

export function applyStaleDegradation(macro: MacroState): MacroState {
  const ageMinutes = computeAge(macro);
  const fetchStale = ageMinutes > STALE_THRESHOLD_MINUTES;
  const provenance = { ...macro.provenance };
  for (const key of Object.keys(provenance) as (keyof MacroState['provenance'])[]) {
    const item = provenance[key];
    const stale = item.stalenessHours > (DATA_STALE_THRESHOLDS[key] ?? 72);
    if ((fetchStale || stale) && (item.label === 'REAL' || item.label === 'OBSERVADO')) {
      provenance[key] = { ...item, label: 'STALE', ageMinutes };
    } else {
      provenance[key] = { ...item, ageMinutes };
    }
  }
  return {
    ...macro,
    ageMinutes,
    source: fetchStale && macro.source !== 'ERROR' ? 'STALE' : macro.source,
    provenance,
  };
}

export async function fetchBluelytics(): Promise<BluelyticsResponse | null> {
  const proxyUrl = typeof process !== 'undefined'
    ? (process.env.NEXT_PUBLIC_PROXY_URL || process.env.PROXY_URL || '')
    : '';
  if (proxyUrl) {
    try {
      const response = await fetch(`${proxyUrl.replace(/\/$/, '')}/api/proxy?source=dolar_all`, {
        signal: AbortSignal.timeout(8000),
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (response.ok) {
        const data = await response.json();
        if (data?.ok && data.oficial?.ok && data.mep?.ok) {
          const adapted: BluelyticsResponse = {
            oficial: { value_avg: data.oficial.venta, value_sell: data.oficial.venta, value_buy: data.oficial.compra ?? data.oficial.venta },
            blue: { value_avg: data.mep.venta, value_sell: data.mep.venta, value_buy: data.mep.compra ?? data.mep.venta },
            oficial_euro: { value_avg: 0, value_sell: 0, value_buy: 0 },
            blue_euro: { value_avg: 0, value_sell: 0, value_buy: 0 },
            last_update: data.oficial.fecha || new Date().toISOString(),
          };
          (adapted as BluelyticsResponse & { _ccl?: number })._ccl = data.ccl?.ok ? data.ccl.venta : data.mep.venta;
          return adapted;
        }
      }
    } catch (error) {
      console.warn('[live-data] proxy unavailable', error);
    }
  }
  try {
    const response = await fetch('https://api.bluelytics.com.ar/v2/latest', {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    return response.ok ? await response.json() as BluelyticsResponse : null;
  } catch {
    return null;
  }
}

function provenance(input: {
  observed: boolean;
  source: string;
  url?: string;
  now: string;
  dataDate?: string;
  coverage?: 'full' | 'partial' | 'none';
  limitations?: string[];
  transformations?: string[];
  observedAt?: string | null;
}): DataProvenance {
  const dataDate = input.dataDate || input.now.split('T')[0];
  return {
    label: input.observed ? 'REAL' : 'RECONSTRUIDO',
    source: input.source,
    url: input.url ?? 'N/A',
    lastUpdate: input.now,
    dataDate,
    stalenessHours: input.observed ? stalenessHours(dataDate) : 999,
    fetchedAt: input.now,
    ageMinutes: 0,
    fetchError: !input.observed,
    observedAt: input.observed ? (input.observedAt ?? dataDate) : null,
    coverage: input.coverage ?? (input.observed ? 'full' : 'none'),
    limitations: input.limitations ?? [],
    transformations: input.transformations ?? [],
  };
}

function realPct(items: MacroState['provenance']): number {
  const values = Object.values(items);
  return round(values.filter((item) => item.label === 'REAL' || item.label === 'OBSERVADO').length / values.length * 100, 0);
}

export async function getMacroState(): Promise<MacroState> {
  const now = new Date().toISOString();
  const [fx, bcra, cer, indec] = await Promise.all([
    fetchBluelytics(),
    fetchBCRAData(),
    fetchCERData(),
    fetchINDECInflation(),
  ]);

  if (fx) auditAPIResponse('Bluelytics API v2', 'https://api.bluelytics.com.ar/v2/latest', fx, BluelyticsSchema, 'BluelyticsResponse', null, 'REAL', fx.last_update?.split('T')[0]);
  if (bcra.isReal) auditAPIResponse('BCRA API', bcra.sourceUrl, bcra, BCRARatesSchema, 'BCRARates', null, 'REAL', bcra.dataDate);
  if (cer.isReal) auditAPIResponse('BCRA CER API', cer.sourceUrl, cer, CERDataSchema, 'CERData', null, 'REAL', cer.dataDate);
  if (indec.isReal) auditAPIResponse('INDEC via datos.gob.ar', indec.sourceUrl, indec, INDECInflationSchema, 'INDECInflation', null, 'REAL', indec.dataDate);

  const derived = computeRatesFromBCRA({
    badlarTNA: bcra.badlarTNA,
    tmlTNA: bcra.badlarTNA - 2,
    leliqTNA: bcra.bcraPolicyTNA,
    lecapsTNA: bcra.lecapsTNA,
    bcraPolicyTNA: bcra.bcraPolicyTNA,
    isReal: bcra.isReal,
  });
  const mepRate = fx?.blue.value_avg ?? 1445;
  const officialRate = fx?.oficial.value_avg ?? bcra.officialRate;
  const gap = officialRate > 0 ? (mepRate - officialRate) / officialRate * 100 : 0;
  const monthly = indec.isReal ? indec.lastMonthInflation : (indec.projected30d || 2.5);
  const crawlingPeg = gap > 50 ? 1 : gap > 30 ? 0.5 : 0;

  const fields: MacroState['provenance'] = {
    mepRate: provenance({ observed: Boolean(fx), source: fx ? 'Bluelytics/DolarAPI' : 'Fallback operativo MEP', url: fx ? 'https://api.bluelytics.com.ar/v2/latest' : undefined, now, dataDate: fx?.last_update?.split('T')[0], observedAt: fx?.last_update ?? null, limitations: fx ? [] : ['Cotización MEP no observada; valor reconstruido.'] }),
    inflation: provenance({ observed: indec.isReal, source: indec.isReal ? 'INDEC via datos.gob.ar' : 'Fallback inflación', url: indec.isReal ? indec.sourceUrl : undefined, now, dataDate: indec.dataDate, limitations: indec.isReal ? [] : ['Inflación no observada en esta ejecución.'], transformations: ['Proyecciones 30d/90d derivadas de la lectura o fallback.'] }),
    rates: provenance({ observed: bcra.isReal, source: bcra.isReal ? 'BCRA API' : 'Fallback tasas', url: bcra.isReal ? bcra.sourceUrl : undefined, now, dataDate: bcra.dataDate, coverage: bcra.isReal ? 'partial' : 'none', limitations: bcra.isReal ? ['FCI MM y TML se derivan de BADLAR/política.'] : ['Tasas no observadas.'] }),
    cer: provenance({ observed: cer.isReal, source: cer.isReal ? 'BCRA CER' : 'Fallback CER', url: cer.isReal ? cer.sourceUrl : undefined, now, dataDate: cer.dataDate, limitations: cer.isReal ? [] : ['CER reconstruido desde inflación.'] }),
    crawlingPeg: provenance({ observed: false, source: 'Modelo bandas cambiarias', now, coverage: 'partial', limitations: ['Proxy derivado de brecha MEP/oficial.'], transformations: ['0%, 0.5% o 1% según brecha.'] }),
    reserves: provenance({ observed: false, source: 'Estimación fija de compatibilidad', now, limitations: ['El fetcher no consulta reservas BCRA.'], transformations: ['26.000 USD millones; nunca se presenta como observado.'] }),
  };
  const observed = [Boolean(fx), bcra.isReal, cer.isReal, indec.isReal].filter(Boolean).length;
  return {
    lastUpdate: now,
    fetchedAt: now,
    ageMinutes: 0,
    lastSuccessfulFetch: observed > 0 ? now : null,
    source: observed > 0 ? 'PARTIAL_FALLBACK' : 'ERROR',
    mep: { rate: mepRate, officialRate, gap: round(gap), sell: fx?.blue.value_sell ?? 1450, buy: fx?.blue.value_buy ?? 1440 },
    inflation: {
      monthly: round(monthly),
      expected30d: round(indec.isReal ? indec.projected30d : monthly - 0.2),
      expected90d: round(indec.isReal ? indec.projected90d : monthly - 0.4),
      yearly: round(indec.isReal ? indec.twelveMonthAccum : (Math.pow(1 + monthly / 100, 12) - 1) * 100),
    },
    rates: {
      bcraPolicy: bcra.isReal ? bcra.bcraPolicyTNA : 20,
      moneyMarket: bcra.isReal ? derived.fciMMTNA : 20,
      plazoFijo: bcra.isReal ? derived.pf30dTNA : 19,
      plazoFijoUVA: derived.pfUVAPremium,
      lecaps: bcra.isReal ? bcra.lecapsTNA : 25,
      badlar: bcra.isReal ? bcra.badlarTNA : 22,
      leliq: bcra.isReal ? bcra.bcraPolicyTNA : 20,
      tml: bcra.isReal ? bcra.badlarTNA - 2 : 20,
    },
    cer: {
      index: cer.isReal ? cer.index : 786.37,
      monthlyChange: round(cer.isReal ? cer.monthlyChange : monthly - 0.3),
      dailyChange: round(cer.isReal ? cer.dailyChange : 0.07, 4),
    },
    crawlingPeg,
    realDataPct: realPct(fields),
    provenance: fields,
  };
}

export interface SantanderProduct {
  id: string;
  name: string;
  shortName: string;
  type: 'money_market' | 'cer_bond' | 'mixed' | 'usd_fund' | 'mep' | 'plazo_fijo' | 'plazo_fijo_uva' | 'lecaps' | 'fondo_corto';
  tna: number;
  realRate30d: number;
  realRate90d: number;
  liquidity: 'T+0' | 'T+1' | 'T+2' | 'locked';
  riskScore: number;
  volatility30d: number;
  maxDrawdown30d: number;
  minInvestmentARS: number;
  currency: 'ARS' | 'USD';
  cerDuration?: number;
  description: string;
  category: 'liquidity' | 'inflation_hedge' | 'fx_hedge' | 'yield';
  dataSource: string;
  dataLabel: DataLabel;
  dataDate: string;
  simulacionError90d: number;
  simulacionError180d: number;
}

type ProductSeed = Omit<SantanderProduct, 'dataDate' | 'simulacionError90d' | 'simulacionError180d'> & {
  simulacionError90d?: number;
  simulacionError180d?: number;
};

export function getProductsFromMacro(macro: MacroState): SantanderProduct[] {
  const { rates, cer, mep, crawlingPeg } = macro;
  const usd30 = (tna: number) => ((1 + tna / 1200) / (1 + crawlingPeg / 100) - 1) * 100;
  const usd90 = (tna: number) => ((1 + tna / 100) ** 0.25 / (1 + crawlingPeg / 100) ** 3 - 1) * 100;
  const premium = rates.plazoFijoUVA / 12;
  const cer30 = ((1 + cer.monthlyChange / 100) * (1 + premium / 100) / (1 + crawlingPeg / 100) - 1) * 100;
  const cer90 = ((1 + cer.monthlyChange / 100) ** 3 * (1 + premium / 100) ** 3 / (1 + crawlingPeg / 100) ** 3 - 1) * 100;
  const rateLabel = macro.provenance.rates.label;
  const cerLabel = macro.provenance.cer.label;
  const mepLabel = macro.provenance.mepRate.label;
  const blended = round(rates.moneyMarket * 0.6 + rates.lecaps * 0.4);
  const now = new Date().toISOString();
  const seeds: ProductSeed[] = [
    { id:'super-ahorro', name:'Super Ahorro $', shortName:'Super Ahorro', type:'money_market', tna:rates.moneyMarket, realRate30d:usd30(rates.moneyMarket), realRate90d:usd90(rates.moneyMarket), liquidity:'T+0', riskScore:2, volatility30d:0.3, maxDrawdown30d:0, minInvestmentARS:1000, currency:'ARS', description:'FCI Money Market — liquidez inmediata', category:'liquidity', dataSource:macro.provenance.rates.source, dataLabel:rateLabel },
    { id:'renta-fija-cer', name:'Superfondo Renta Fija CER', shortName:'Renta Fija CER', type:'cer_bond', tna:rates.plazoFijoUVA + cer.monthlyChange * 12, realRate30d:cer30, realRate90d:cer90, liquidity:'T+1', riskScore:15, volatility30d:1.2, maxDrawdown30d:0.5, minInvestmentARS:1000, currency:'ARS', cerDuration:60, description:'FCI CER corto plazo', category:'inflation_hedge', dataSource:macro.provenance.cer.source, dataLabel:cerLabel, simulacionError90d:0.68, simulacionError180d:0.72 },
    { id:'supergestion-mix-vi', name:'Supergestión Mix VI', shortName:'Mix VI', type:'mixed', tna:blended, realRate30d:usd30(blended), realRate90d:usd90(blended), liquidity:'T+1', riskScore:35, volatility30d:3.5, maxDrawdown30d:2, minInvestmentARS:1000, currency:'ARS', description:'FCI mixto de renta fija y variable', category:'yield', dataSource:'60% money market + 40% Lecaps', dataLabel:rateLabel, simulacionError90d:0.45, simulacionError180d:0.55 },
    { id:'super-ahorro-usd', name:'Superfondo Ahorro USD', shortName:'Ahorro USD', type:'usd_fund', tna:4.5, realRate30d:0.375, realRate90d:1.125, liquidity:'T+1', riskScore:8, volatility30d:1, maxDrawdown30d:0.3, minInvestmentARS:1000, currency:'USD', description:'FCI USD de baja volatilidad', category:'fx_hedge', dataSource:'SOFR + spread reconstruido', dataLabel:'RECONSTRUIDO', simulacionError90d:0.05, simulacionError180d:0.08 },
    { id:'dolar-mep', name:'Dólar MEP', shortName:'MEP', type:'mep', tna:crawlingPeg*12, realRate30d:mep.gap > 10 ? -mep.gap*0.01 : -mep.gap*0.002, realRate90d:mep.gap > 10 ? -mep.gap*0.02 : -mep.gap*0.004, liquidity:'T+1', riskScore:25, volatility30d:4, maxDrawdown30d:3, minInvestmentARS:10000, currency:'USD', description:'Cobertura cambiaria vía bonos', category:'fx_hedge', dataSource:macro.provenance.mepRate.source, dataLabel:mepLabel, simulacionError90d:0.15, simulacionError180d:0.22 },
    { id:'plazo-fijo', name:'Plazo Fijo Tradicional', shortName:'PF Trad.', type:'plazo_fijo', tna:rates.plazoFijo, realRate30d:usd30(rates.plazoFijo), realRate90d:usd90(rates.plazoFijo), liquidity:'locked', riskScore:5, volatility30d:0, maxDrawdown30d:0, minInvestmentARS:1000, currency:'ARS', description:'Plazo fijo 30 días', category:'yield', dataSource:macro.provenance.rates.source, dataLabel:rateLabel, simulacionError90d:0.29, simulacionError180d:0.35 },
    { id:'plazo-fijo-uva', name:'Plazo Fijo UVA', shortName:'PF UVA', type:'plazo_fijo_uva', tna:rates.plazoFijoUVA + cer.monthlyChange*12, realRate30d:cer30+0.15, realRate90d:cer90+0.45, liquidity:'locked', riskScore:10, volatility30d:0.5, maxDrawdown30d:0, minInvestmentARS:1000, currency:'ARS', description:'UVA + prima', category:'inflation_hedge', dataSource:macro.provenance.cer.source, dataLabel:cerLabel, simulacionError90d:0.65, simulacionError180d:0.70 },
    { id:'lecaps', name:'Lecaps BCBA', shortName:'Lecaps', type:'lecaps', tna:rates.lecaps, realRate30d:usd30(rates.lecaps), realRate90d:usd90(rates.lecaps), liquidity:'T+1', riskScore:8, volatility30d:0.4, maxDrawdown30d:0.1, minInvestmentARS:5000, currency:'ARS', description:'Letras de corto plazo', category:'yield', dataSource:macro.provenance.rates.source, dataLabel:rateLabel, simulacionError90d:0.67, simulacionError180d:0.75 },
    { id:'fondo-corto-plazo', name:'Superfondo Corto Plazo', shortName:'Corto Plazo', type:'fondo_corto', tna:rates.moneyMarket+0.8, realRate30d:usd30(rates.moneyMarket+0.8), realRate90d:usd90(rates.moneyMarket+0.8), liquidity:'T+1', riskScore:5, volatility30d:0.5, maxDrawdown30d:0.1, minInvestmentARS:1000, currency:'ARS', description:'FCI de renta fija muy corta', category:'liquidity', dataSource:macro.provenance.rates.source, dataLabel:rateLabel, simulacionError90d:0.20, simulacionError180d:0.28 },
  ];
  return seeds.map((seed) => ({ dataDate: now, simulacionError90d: 0.12, simulacionError180d: 0.18, ...seed }));
}

export interface MarketScenario {
  id: string; name: string; emoji: string; probability: number; inflation30d: number;
  devaluation30d: number; rateChangeBps: number; mepMove: number; description: string;
}

export function getScenariosFromMacro(macro: MacroState): MarketScenario[] {
  const gap = macro.mep.gap;
  const base = macro.inflation.monthly;
  const crisis = Math.min(0.35, 0.10 + gap / 200);
  const mild = Math.min(0.45, 0.25 + gap / 150);
  return [
    { id:'stable', name:'Estabilidad', emoji:'🟢', probability:Math.max(0.25, 1-crisis-mild), inflation30d:base-0.5, devaluation30d:macro.crawlingPeg, rateChangeBps:-50, mepMove:-2, description:'Continuidad estabilizadora.' },
    { id:'mild-devaluation', name:'Devaluación Moderada', emoji:'🟡', probability:mild, inflation30d:base+1.5, devaluation30d:macro.crawlingPeg+2, rateChangeBps:200, mepMove:8, description:'Shock cambiario moderado.' },
    { id:'crisis', name:'Shock Cambiario', emoji:'🔴', probability:crisis, inflation30d:base+5, devaluation30d:macro.crawlingPeg+14, rateChangeBps:800, mepMove:25, description:'Crisis cambiaria severa.' },
  ];
}

export interface SimulacionResult {
  assetId: string; assetName: string; modelReturn30d: number; actualReturnAvg90d: number;
  actualReturnAvg180d: number; errorAbs90d: number; errorAbs180d: number;
  errorPct90d: number; errorPct180d: number; label: DataLabel;
}

export function computeSimulacion(products: SantanderProduct[]): SimulacionResult[] {
  const historical: Record<string, { avg90d: number; avg180d: number }> = {
    'super-ahorro':{avg90d:1.73,avg180d:1.78}, 'lecaps':{avg90d:2.44,avg180d:2.52},
    'plazo-fijo':{avg90d:1.73,avg180d:1.76}, 'renta-fija-cer':{avg90d:3.05,avg180d:3.12},
    'plazo-fijo-uva':{avg90d:3.20,avg180d:3.27}, 'super-ahorro-usd':{avg90d:0.38,avg180d:0.39},
    'dolar-mep':{avg90d:-0.02,avg180d:-0.01}, 'supergestion-mix-vi':{avg90d:1.55,avg180d:1.60},
    'fondo-corto-plazo':{avg90d:1.82,avg180d:1.88},
  };
  return products.map((product) => {
    const actual = historical[product.id] ?? { avg90d: product.realRate30d, avg180d: product.realRate30d };
    const error90 = Math.abs(product.realRate30d - actual.avg90d);
    const error180 = Math.abs(product.realRate30d - actual.avg180d);
    return {
      assetId: product.id,
      assetName: product.shortName,
      modelReturn30d: product.realRate30d,
      actualReturnAvg90d: actual.avg90d,
      actualReturnAvg180d: actual.avg180d,
      errorAbs90d: round(error90),
      errorAbs180d: round(error180),
      errorPct90d: actual.avg90d === 0 ? 999 : round(error90 / Math.abs(actual.avg90d) * 100),
      errorPct180d: actual.avg180d === 0 ? 999 : round(error180 / Math.abs(actual.avg180d) * 100),
      label: 'SIMULADO',
    };
  });
}

export type BacktestResult = SimulacionResult;
export const computeBacktest = computeSimulacion;

export function getOverallDataLabel(macro: MacroState | null): DataLabel {
  if (!macro) return 'ERROR';
  const values = Object.values(macro.provenance);
  const observed = values.filter((item) => item.label === 'REAL' || item.label === 'OBSERVADO').length;
  const stale = values.some((item) => item.label === 'STALE');
  const reconstructed = values.some((item) => ['RECONSTRUIDO', 'SIMULADO', 'PARTIAL_FALLBACK'].includes(item.label));
  const errors = values.some((item) => item.label === 'ERROR');
  if (observed === 0) return 'ERROR';
  if (macro.source === 'STALE' || stale) return 'STALE';
  if (!reconstructed && !errors && observed === values.length) return 'REAL';
  return 'PARTIAL_FALLBACK';
}
