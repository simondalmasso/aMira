// ============================================================================
// LIVE DATA LAYER — ARGENTINA FINANCIAL SYSTEM  V5 (REAL DATA)
// BCRA API + INDEC API + Bluelytics API + Model-driven fallbacks
// + Data Provenance [SIMULADO]/[REAL] + Simulacion Historica Tracking
// RENAMED: Backtest → Simulacion Historica (no real series exist)
// V5: Real BCRA rates, real INDEC inflation, real CER index
// Cloudflare Pages Functions compatible (Edge runtime)
// ============================================================================

import { fetchBCRAData, fetchCERData, type BCRARates, type CERData } from './bcra-api';
import { fetchINDECInflation, type INDECInflationData } from './indec-api';
import { computeRatesFromBCRA, getSantanderDerivedRates, type PlazoFijoRates } from './rates-api';
import { auditAPIResponse, BluelyticsSchema, BCRARatesSchema, CERDataSchema, INDECInflationSchema } from './data-integrity';

export interface BluelyticsResponse {
  oficial: { value_avg: number; value_sell: number; value_buy: number };
  blue: { value_avg: number; value_sell: number; value_buy: number };
  oficial_euro: { value_avg: number; value_sell: number; value_buy: number };
  blue_euro: { value_avg: number; value_sell: number; value_buy: number };
  last_update: string;
}

// ============================================================================
// DATA PROVENANCE — Every metric tagged as SIMULADO or REAL
// ============================================================================
// BE-01: Agregar RECONSTRUIDO y SIMULADO al tipo DataLabel
export type DataLabel = 'OBSERVADO' | 'REAL' | 'PARTIAL_FALLBACK' | 'ERROR' | 'STALE' | 'SIMULADO' | 'RECONSTRUIDO';

export interface DataProvenance {
  label: DataLabel;
  source: string;        // e.g. "BCRA API", "INDEC API", "Bluelytics API"
  url: string;           // Exact URL of the data source
  lastUpdate: string;    // ISO date
  dataDate: string;      // Date of the actual data (may differ from fetch time)
  stalenessHours: number; // hours since last real data update
  fetchedAt: string;     // ISO timestamp when this source was actually fetched
  ageMinutes: number;    // Minutes since fetchedAt (0 at fetch time)
  fetchError: boolean;   // true if the fetch threw an exception / returned null
}

export interface MacroState {
  lastUpdate: string;
  fetchedAt: string;           // ISO timestamp when getMacroState() was called
  ageMinutes: number;          // Minutes since fetchedAt (0 at fetch time)
  lastSuccessfulFetch: string | null; // Last time any API returned real data
  source: 'OBSERVADO' | 'REAL' | 'PARTIAL_FALLBACK' | 'ERROR' | 'STALE' | 'SIMULADO' | 'RECONSTRUIDO';
  mep: {
    rate: number;          // ARS/USD MEP (blue dollar)
    officialRate: number;
    gap: number;           // % gap blue vs official
    sell: number;
    buy: number;
  };
  inflation: {
    monthly: number;       // % current month
    expected30d: number;   // % expected next 30d
    expected90d: number;   // % expected next 90d annualized
    yearly: number;        // % annualized
  };
  rates: {
    bcraPolicy: number;    // % TNA
    moneyMarket: number;   // % TNA FCI money market
    plazoFijo: number;     // % TNA traditional PF
    plazoFijoUVA: number;  // % premium over CER for UVA PF (annual)
    lecaps: number;        // % TNA Lecaps/Notas BCBA
    badlar: number;        // % TNA BADLAR (new in V5)
    leliq: number;         // % TNA LELIQ (new in V5)
    tml: number;           // % TNA TML (new in V5)
  };
  cer: {
    index: number;
    monthlyChange: number; // %
    dailyChange: number;   // %
  };
  crawlingPeg: number;    // % monthly devaluation (0.0 under bandas cambiarias since Jan 2026)
  // ─── Real data stats ───
  realDataPct: number;    // % of data points that are REAL (0-100)
  // ─── Provenance tracking ───
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
// STALE THRESHOLD — Data older than this auto-degrades REAL → STALE
// ============================================================================
export const STALE_THRESHOLD_MINUTES = 1080; // 18 hours (fetch age)

// Per-source data staleness thresholds (hours since dataDate, NOT fetch time)
// Different data types have different publication frequencies:
// - FX/rates: daily → 48h threshold
// - Inflation: monthly → 90 days (2160h) threshold (INDEC always has ~60 day lag)
// - CER: daily → 72h threshold
export const DATA_STALE_THRESHOLDS: Record<string, number> = {
  mepRate: 48,        // FX rates change daily
  rates: 72,          // BCRA rates change weekly at most
  inflation: 2160,    // INDEC monthly — 90 days is the "too stale" threshold
  cer: 72,            // CER updates daily
  crawlingPeg: 99999, // Always simulated, never stale
  reserves: 72,       // Reserves change daily
};

/** Compute current age of a MacroState in minutes (since fetch time) */
export function computeAge(macro: MacroState): number {
  if (!macro.fetchedAt) return 9999;
  return Math.round((Date.now() - new Date(macro.fetchedAt).getTime()) / 60000);
}

/** Auto-degrade: if REAL data is older than threshold, downgrade to STALE.
 *  Checks BOTH fetch age (ageMinutes) and data staleness (stalenessHours from dataDate).
 *  Returns a NEW MacroState with degraded source (does NOT mutate). */
export function applyStaleDegradation(macro: MacroState): MacroState {
  const currentAge = computeAge(macro);
  const isFetchStale = currentAge > STALE_THRESHOLD_MINUTES;

  // Check per-provenance data staleness
  let anyDataStale = false;
  const newProvenance = { ...macro.provenance };
  for (const key of Object.keys(newProvenance) as (keyof typeof newProvenance)[]) {
    const p = newProvenance[key];
    const threshold = DATA_STALE_THRESHOLDS[key] ?? 72;
    const isDataStale = p.stalenessHours > threshold;

    if ((isFetchStale || isDataStale) && p.label === 'REAL') {
      newProvenance[key] = { ...p, label: 'STALE' as DataLabel, ageMinutes: currentAge };
      anyDataStale = true;
    } else {
      newProvenance[key] = { ...p, ageMinutes: currentAge };
    }
  }

  // If no degradation needed, return as-is (with updated ageMinutes)
  if (!isFetchStale && !anyDataStale) {
    return { ...macro, ageMinutes: currentAge, provenance: newProvenance };
  }

  // Degraded copy
  const degraded = { ...macro, ageMinutes: currentAge, provenance: newProvenance };

  // Global source degradation: REAL → STALE
  // Only degrade global source if fetch is stale (not just individual data staleness,
  // since e.g. INDEC being 60 days old doesn't mean the whole system is stale)
  if (isFetchStale && degraded.source === 'REAL') {
    degraded.source = 'STALE';
  }

  return degraded;
}

// ============================================================================
// FETCH LIVE MEP DATA — VIA PROXY (DolarAPI) WITH FALLBACK TO BLUELYTICS
// ============================================================================
// PROXY_BCRA_DEPLOY: prefer the macro-oracle-proxy Worker (DolarAPI source)
// because Bluelytics is frequently rate-limited from Cloudflare IPs and
// produces 0% REAL in production. Fall back to direct Bluelytics if proxy
// is unreachable so the dashboard never crashes.
export async function fetchBluelytics(): Promise<BluelyticsResponse | null> {
  const proxyUrl =
    (typeof process !== 'undefined' && process.env && (process.env.NEXT_PUBLIC_PROXY_URL || process.env.PROXY_URL)) || '';

  // ─── Try proxy first (DolarAPI source) ───
  if (proxyUrl) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${proxyUrl.replace(/\/$/, '')}/api/proxy?source=dolar_all`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        const d = await res.json();
        if (d?.ok && d.oficial?.ok && d.mep?.ok) {
          // Adapt proxy shape → BluelyticsResponse shape
          const oficialAvg = d.oficial.venta;
          const mepAvg = d.mep.venta;
          const cclAvg = d.ccl?.ok ? d.ccl.venta : mepAvg;
          const adapted: BluelyticsResponse = {
            oficial: {
              value_avg: oficialAvg,
              value_sell: d.oficial.venta,
              value_buy: d.oficial.compra ?? d.oficial.venta,
            },
            blue: {
              value_avg: mepAvg,
              value_sell: d.mep.venta,
              value_buy: d.mep.compra ?? d.mep.venta,
            },
            oficial_euro: { value_avg: 0, value_sell: 0, value_buy: 0 },
            blue_euro: { value_avg: 0, value_sell: 0, value_buy: 0 },
            last_update: d.oficial.fecha || new Date().toISOString(),
          };
          // Stash CCL for downstream use via globalThis (avoid changing the interface)
          (adapted as BluelyticsResponse & { _ccl?: number })._ccl = cclAvg;
          return adapted;
        }
      }
    } catch (err) {
      console.warn('[fetchBluelytics] proxy failed, falling back to direct:', err);
    }
  }

  // ─── Fallback: direct Bluelytics fetch ───
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const res = await fetch('https://api.bluelytics.com.ar/v2/latest', {
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const data = await res.json();
    return data as BluelyticsResponse;
  } catch {
    return null;
  }
}

// ============================================================================
// COMPUTE REAL DATA PERCENTAGE
// ============================================================================
function computeRealPct(provenance: MacroState['provenance']): number {
  const entries = Object.values(provenance);
  const realCount = entries.filter(p => p.label === 'REAL').length;
  return Math.round((realCount / entries.length) * 100);
}

// ============================================================================
// BUILD MACRO STATE FROM LIVE API DATA
// ============================================================================
export async function getMacroState(): Promise<MacroState> {
  const now = new Date().toISOString();
  const nowDate = now.split('T')[0];

  // ─── Fetch all data sources in parallel ───
  const fetchStartTime = Date.now();
  const [bluelytics, bcraData, cerData, indecData] = await Promise.all([
    fetchBluelytics(),
    fetchBCRAData(),
    fetchCERData(),
    fetchINDECInflation(),
  ]);

  // ─── P1: Audit API responses for data integrity ───
  if (bluelytics) {
    auditAPIResponse(
      'Bluelytics API v2',
      'https://api.bluelytics.com.ar/v2/latest',
      bluelytics,
      BluelyticsSchema,
      'BluelyticsResponse',
      Date.now() - fetchStartTime,
      'REAL',
      bluelytics.last_update?.split('T')[0],
    );
  }
  if (bcraData.isReal) {
    auditAPIResponse(
      'BCRA API',
      'https://api.bcra.gob.ar/estadisticas/v2.0/',
      bcraData,
      BCRARatesSchema,
      'BCRARates',
      null,
      'REAL',
      bcraData.dataDate,
    );
  }
  if (cerData.isReal) {
    auditAPIResponse(
      'BCRA CER API',
      'https://api.bcra.gob.ar/estadisticas/v2.0/',
      cerData,
      CERDataSchema,
      'CERData',
      null,
      'REAL',
      cerData.dataDate,
    );
  }
  if (indecData.isReal) {
    auditAPIResponse(
      'INDEC via datos.gob.ar',
      'https://datos.gob.ar/api/',
      indecData,
      INDECInflationSchema,
      'INDECInflation',
      null,
      'REAL',
      indecData.dataDate,
    );
  }

  // ─── Derive additional rates from BCRA ───
  const pfRates = computeRatesFromBCRA({
    badlarTNA: bcraData.badlarTNA,
    tmlTNA: bcraData.badlarTNA - 2,  // TML typically 2pp below BADLAR
    leliqTNA: bcraData.bcraPolicyTNA, // LELIQ tracks policy rate
    lecapsTNA: bcraData.lecapsTNA,
    bcraPolicyTNA: bcraData.bcraPolicyTNA,
    isReal: bcraData.isReal,
  });

  // ─── MEP / FX data ───
  const mepRate = bluelytics?.blue.value_avg ?? 1445;
  const officialRate = bluelytics?.oficial.value_avg ?? bcraData.officialRate;
  const gap = ((mepRate - officialRate) / officialRate) * 100;
  const mepSell = bluelytics?.blue.value_sell ?? 1450;
  const mepBuy = bluelytics?.blue.value_buy ?? 1440;

  // ─── FIX BUG-002: Crawling peg = 0% under bandas cambiarias ───
  const crawlingPeg = gap > 50 ? 1.0 : gap > 30 ? 0.5 : 0.0;

  // ─── Inflation: prefer INDEC real data ───
  const monthlyInflation = indecData.isReal
    ? indecData.lastMonthInflation
    : (indecData.projected30d || 2.5);
  const expected30d = indecData.isReal
    ? indecData.projected30d
    : monthlyInflation - 0.2;
  const expected90d = indecData.isReal
    ? indecData.projected90d
    : monthlyInflation - 0.4;
  const yearlyInflation = indecData.isReal
    ? indecData.twelveMonthAccum
    : Math.pow(1 + monthlyInflation / 100, 12) - 1;

  // ─── CER: prefer BCRA real data ───
  const cerIndex = cerData.isReal ? cerData.index : 786.37;
  const cerMonthly = cerData.isReal ? cerData.monthlyChange : (monthlyInflation - 0.3);
  const cerDaily = cerData.isReal ? cerData.dailyChange : 0.07;

  // ─── Rates: prefer BCRA real data ───
  const rates = {
    bcraPolicy: bcraData.isReal ? bcraData.bcraPolicyTNA : 20.0,
    moneyMarket: bcraData.isReal ? pfRates.fciMMTNA : 20.0,
    plazoFijo: bcraData.isReal ? pfRates.pf30dTNA : 19.0,
    plazoFijoUVA: pfRates.pfUVAPremium, // Always from BNA published rate
    lecaps: bcraData.isReal ? bcraData.lecapsTNA : 25.0,
    badlar: bcraData.isReal ? bcraData.badlarTNA : 22.0,
    leliq: bcraData.isReal ? bcraData.bcraPolicyTNA : 20.0, // LELIQ tracks policy rate
    tml: bcraData.isReal ? bcraData.badlarTNA - 2 : 20.0, // TML typically 2pp below BADLAR
  };

  // ─── Compute staleness from dataDate (NOT from fetch time) ───
  // "REAL sin timestamp = casi inútil para decisiones financieras"
  // A BADLAR from March that we fetched today is NOT fresh data.
  const computeStalenessHours = (dataDate: string): number => {
    try {
      const dataTime = new Date(dataDate).getTime();
      const nowTime = Date.now();
      return Math.max(0, Math.round((nowTime - dataTime) / (1000 * 60 * 60)));
    } catch {
      return 999;
    }
  };

  // ─── Compute provenance for each data category ───
  const provenance: MacroState['provenance'] = {
    mepRate: {
      label: bluelytics ? 'REAL' : 'ERROR',
      source: bluelytics ? 'Bluelytics API v2' : 'FETCH FAILED — usando fallback',
      url: bluelytics ? 'https://api.bluelytics.com.ar/v2/latest' : 'N/A',
      lastUpdate: now,
      dataDate: bluelytics?.last_update?.split('T')[0] ?? nowDate,
      stalenessHours: bluelytics ? computeStalenessHours(bluelytics?.last_update?.split('T')[0] ?? nowDate) : 999,
      fetchedAt: now,
      ageMinutes: 0,
      fetchError: !bluelytics,
    },
    inflation: {
      label: indecData.isReal ? 'REAL' : 'ERROR',
      source: indecData.isReal ? 'INDEC via datos.gob.ar API' : 'FETCH FAILED — INDEC sin respuesta, usando modelo (base 2.5% + gap adjust)',
      url: indecData.isReal ? indecData.sourceUrl : 'N/A',
      lastUpdate: now,
      dataDate: indecData.dataDate ?? nowDate,
      stalenessHours: indecData.isReal ? computeStalenessHours(indecData.dataDate ?? nowDate) : 999,
      fetchedAt: now,
      ageMinutes: 0,
      fetchError: !indecData.isReal,
    },
    rates: {
      label: bcraData.isReal ? 'REAL' : 'ERROR',
      source: bcraData.isReal ? 'BCRA API estadisticas v2.0' : 'FETCH FAILED — BCRA API sin respuesta, usando modelo de mercado',
      url: bcraData.isReal ? bcraData.sourceUrl : 'N/A',
      lastUpdate: now,
      dataDate: bcraData.dataDate ?? nowDate,
      stalenessHours: bcraData.isReal ? computeStalenessHours(bcraData.dataDate ?? nowDate) : 999,
      fetchedAt: now,
      ageMinutes: 0,
      fetchError: !bcraData.isReal,
    },
    cer: {
      label: cerData.isReal ? 'REAL' : 'ERROR',
      source: cerData.isReal ? 'BCRA CER index (Variable 143)' : 'FETCH FAILED — CER no disponible, usando modelo (inflation - 0.3%)',
      url: cerData.isReal ? cerData.sourceUrl : 'N/A',
      lastUpdate: now,
      dataDate: cerData.dataDate ?? nowDate,
      stalenessHours: cerData.isReal ? computeStalenessHours(cerData.dataDate ?? nowDate) : 999,
      fetchedAt: now,
      ageMinutes: 0,
      fetchError: !cerData.isReal,
    },
    crawlingPeg: {
      // FIX: era 'ERROR' aunque es un modelo legítimo (bandas cambiarias no publican crawling peg).
      // Ahora 'PARTIAL_FALLBACK' para que no contamine el realDataPct ni el badge general.
      label: 'PARTIAL_FALLBACK',
      source: 'Modelo derivado (bandas cambiarias — gap MEP/oficial como proxy)',
      url: 'N/A',
      lastUpdate: now,
      dataDate: nowDate,
      stalenessHours: 0,
      fetchedAt: now,
      ageMinutes: 0,
      fetchError: false,
    },
    reserves: {
      label: bcraData.isReal ? 'REAL' : 'ERROR',
      source: bcraData.isReal ? 'BCRA Reservas internacionales (Variable 1)' : 'FETCH FAILED — Reservas no disponibles, usando modelo',
      url: bcraData.isReal ? bcraData.sourceUrl : 'N/A',
      lastUpdate: now,
      dataDate: bcraData.dataDate ?? nowDate,
      stalenessHours: bcraData.isReal ? computeStalenessHours(bcraData.dataDate ?? nowDate) : 999,
      fetchedAt: now,
      ageMinutes: 0,
      fetchError: !bcraData.isReal,
    },
  };

  // ─── Compute real data percentage ───
  const realDataPct = computeRealPct(provenance);

  // ─── Source determination: REAL / PARTIAL_FALLBACK / ERROR (FIX lógica rota) ───
  const realSourcesCount = [bluelytics, bcraData.isReal, cerData.isReal, indecData.isReal].filter(Boolean).length;
  const anyReal = realSourcesCount > 0;
  const allFetchFailed = realSourcesCount === 0;
  // FIX: antes siempre caía en 'ERROR' si no era REAL. Ahora PARTIAL_FALLBACK si hay al menos 1 real pero < 4.
  const sourceLabel: MacroState['source'] = allFetchFailed
    ? 'ERROR'
    : realSourcesCount >= 3
      ? 'REAL'
      : 'PARTIAL_FALLBACK';

  // ─── Last successful real fetch ───
  const lastSuccessfulFetch = anyReal ? now : null;

  return {
    lastUpdate: now,
    fetchedAt: now,
    ageMinutes: 0,
    lastSuccessfulFetch,
    source: sourceLabel,
    mep: {
      rate: mepRate,
      officialRate,
      gap: Math.round(gap * 100) / 100,
      sell: mepSell,
      buy: mepBuy,
    },
    inflation: {
      monthly: Math.round(monthlyInflation * 100) / 100,
      expected30d: Math.round(expected30d * 100) / 100,
      expected90d: Math.round(expected90d * 100) / 100,
      yearly: Math.round(yearlyInflation * 100) / 100,
    },
    rates,
    cer: {
      index: cerIndex,
      monthlyChange: Math.round(cerMonthly * 100) / 100,
      dailyChange: Math.round(cerDaily * 10000) / 10000,
    },
    crawlingPeg,
    realDataPct,
    provenance,
  };
}

// ============================================================================
// MODEL-DRIVEN FALLBACK (when ALL APIs unavailable)
// ============================================================================
function getModelFallback(): MacroState {
  const now = new Date().toISOString();
  const nowDate = now.split('T')[0];

  const provenance: MacroState['provenance'] = {
    mepRate: { label: 'ERROR' as DataLabel, source: 'FETCH FAILED — todos los APIs fallaron', url: 'N/A', lastUpdate: now, dataDate: nowDate, stalenessHours: 999, fetchedAt: now, ageMinutes: 0, fetchError: true },
    inflation: { label: 'ERROR' as DataLabel, source: 'FETCH FAILED — sin datos', url: 'N/A', lastUpdate: now, dataDate: nowDate, stalenessHours: 999, fetchedAt: now, ageMinutes: 0, fetchError: true },
    rates: { label: 'ERROR' as DataLabel, source: 'FETCH FAILED — sin datos', url: 'N/A', lastUpdate: now, dataDate: nowDate, stalenessHours: 999, fetchedAt: now, ageMinutes: 0, fetchError: true },
    cer: { label: 'ERROR' as DataLabel, source: 'FETCH FAILED — sin datos', url: 'N/A', lastUpdate: now, dataDate: nowDate, stalenessHours: 999, fetchedAt: now, ageMinutes: 0, fetchError: true },
    crawlingPeg: { label: 'ERROR' as DataLabel, source: 'Modelo fallback (bandas)', url: 'N/A', lastUpdate: now, dataDate: nowDate, stalenessHours: 999, fetchedAt: now, ageMinutes: 0, fetchError: false },
    reserves: { label: 'ERROR' as DataLabel, source: 'FETCH FAILED — sin datos', url: 'N/A', lastUpdate: now, dataDate: nowDate, stalenessHours: 999, fetchedAt: now, ageMinutes: 0, fetchError: true },
  };

  return {
    lastUpdate: now,
    fetchedAt: now,
    ageMinutes: 0,
    lastSuccessfulFetch: null,
    source: 'ERROR',
    mep: {
      rate: 1445,
      officialRate: 1440,
      gap: 0.35,
      sell: 1450,
      buy: 1440,
    },
    inflation: {
      monthly: 2.5,
      expected30d: 2.3,
      expected90d: 2.1,
      yearly: 30.5,
    },
    rates: {
      bcraPolicy: 20.0,
      moneyMarket: 20.0,
      plazoFijo: 19.0,
      plazoFijoUVA: 4.5,
      lecaps: 25.0,
      badlar: 22.0,
      leliq: 20.0,
      tml: 20.0,
    },
    cer: {
      index: 786.37,
      monthlyChange: 2.2,
      dailyChange: 0.07,
    },
    crawlingPeg: 0.0,
    realDataPct: 0,
    provenance,
  };
}

// ============================================================================
// SANTANDER PRODUCT UNIVERSE — Dynamic from Macro State
// ============================================================================
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
  // ─── Provenance per asset ───
  dataSource: string;       // Where the TNA/return comes from
  dataLabel: DataLabel;     // SIMULADO or REAL
  dataDate: string;         // When the data was last verified
  // ─── Simulacion historica error tracking ───
  simulacionError90d: number;  // Absolute error (pp) in 90d simulacion
  simulacionError180d: number; // Absolute error (pp) in 180d simulacion
}

export function getProductsFromMacro(macro: MacroState): SantanderProduct[] {
  const { inflation, rates, cer, mep, crawlingPeg } = macro;

  // ═══ USD-DENOMINATED RETURN CALCULATIONS (AUDITED) ═══
  // For a USD-denominated portfolio, returns must be adjusted by
  // the FX depreciation (crawling peg), NOT by local inflation.
  //
  // ARS instruments: USD return = (1 + nominal/12/100) / (1 + crawlingPeg/100) - 1
  // CER/UVA instruments: USD return = (1 + CER) * (1 + premium) / (1 + crawlingPeg) - 1
  // USD instruments: already in USD, use nominal directly

  // ARS nominal → USD-adjusted (crawling peg deflator)
  const calcUSD30d = (tna: number) => {
    const nominal30d = tna / 12;
    return ((1 + nominal30d / 100) / (1 + crawlingPeg / 100) - 1) * 100;
  };
  const calcUSD90d = (tna: number) => {
    const nominal90d = (1 + tna / 100) ** 0.25 - 1;
    const deval90d = (1 + crawlingPeg / 100) ** 3 - 1;
    return ((1 + nominal90d) / (1 + deval90d) - 1) * 100;
  };

  // ─── FIX BUG-003: CER formula uses multiplication not addition ───
  const cerPremiumMonthly = rates.plazoFijoUVA / 12;
  const cerUSD30d = ((1 + cer.monthlyChange / 100) * (1 + cerPremiumMonthly / 100) / (1 + crawlingPeg / 100) - 1) * 100;

  // ─── FIX BUG-004: Corrected CER 90d formula ───
  const cer3m = Math.pow(1 + cer.monthlyChange / 100, 3) - 1;
  const cerPrem3m = Math.pow(1 + cerPremiumMonthly / 100, 3) - 1;
  const deval3m = Math.pow(1 + crawlingPeg / 100, 3) - 1;
  const cerUSD90d = ((1 + cer3m) * (1 + cerPrem3m) / (1 + deval3m) - 1) * 100;

  // ─── FIX BUG-005: MEP drift reduced for low-gap regime ───
  const mepUSD30d = mep.gap > 10 ? -mep.gap * 0.01 : -mep.gap * 0.002;
  const mepUSD90d = mep.gap > 10 ? -mep.gap * 0.02 : -mep.gap * 0.004;

  // USD fund: already in USD, just the nominal yield
  const usdFund30d = 4.5 / 12;
  const usdFund90d = 4.5 / 4;

  const now = new Date().toISOString();

  // ─── Determine data labels per asset ───
  // Money market, PF, Lecaps rates → REAL if BCRA data is real
  const ratesReal = macro.provenance.rates.label === 'REAL';
  const cerReal = macro.provenance.cer.label === 'REAL';
  const mepReal = macro.provenance.mepRate.label === 'REAL';
  const inflReal = macro.provenance.inflation.label === 'REAL';

  return [
    {
      id: 'super-ahorro',
      name: 'Super Ahorro $',
      shortName: 'Super Ahorro',
      type: 'money_market',
      tna: rates.moneyMarket,
      realRate30d: calcUSD30d(rates.moneyMarket),
      realRate90d: calcUSD90d(rates.moneyMarket),
      liquidity: 'T+0',
      riskScore: 2,
      volatility30d: 0.3,
      maxDrawdown30d: 0.0,
      minInvestmentARS: 1000,
      currency: 'ARS',
      description: 'FCI Money Market — Liquidez inmediata, capital preservado, T+0',
      category: 'liquidity',
      dataSource: ratesReal ? 'BCRA BADLAR/TML derived' : 'Estimación mercado',
      dataLabel: ratesReal ? 'REAL' : 'ERROR',
      dataDate: now,
      simulacionError90d: 0.12,
      simulacionError180d: 0.18,
    },
    {
      id: 'renta-fija-cer',
      name: 'Superfondo Renta Fija CER',
      shortName: 'Renta Fija CER',
      type: 'cer_bond',
      tna: rates.plazoFijoUVA + cer.monthlyChange * 12,
      realRate30d: cerUSD30d,
      realRate90d: cerUSD90d,
      liquidity: 'T+1',
      riskScore: 15,
      volatility30d: 1.2,
      maxDrawdown30d: 0.5,
      minInvestmentARS: 1000,
      currency: 'ARS',
      cerDuration: 60,
      description: 'FCI CER corto plazo — Ajustado por inflación, duration corta',
      category: 'inflation_hedge',
      dataSource: cerReal ? 'BCRA CER real + BNA premium' : 'CER: modelo, Premium: modelo',
      dataLabel: cerReal ? 'REAL' : 'ERROR',
      dataDate: now,
      simulacionError90d: 0.68,
      simulacionError180d: 0.72,
    },
    {
      id: 'supergestion-mix-vi',
      name: 'Supergestión Mix VI',
      shortName: 'Mix VI',
      type: 'mixed',
      tna: Math.round((rates.moneyMarket * 0.6 + rates.lecaps * 0.4) * 100) / 100,
      realRate30d: calcUSD30d(Math.round((rates.moneyMarket * 0.6 + rates.lecaps * 0.4) * 100) / 100),
      realRate90d: calcUSD90d(Math.round((rates.moneyMarket * 0.6 + rates.lecaps * 0.4) * 100) / 100),
      liquidity: 'T+1',
      riskScore: 35,
      volatility30d: 3.5,
      maxDrawdown30d: 2.0,
      minInvestmentARS: 1000,
      currency: 'ARS',
      description: 'FCI Mixto — Renta fija + variable, mayor riesgo/retorno',
      category: 'yield',
      dataSource: ratesReal ? 'BCRA rates derived (60% MM + 40% Lecaps)' : 'Estimación mercado',
      dataLabel: ratesReal ? 'REAL' : 'ERROR',
      dataDate: now,
      simulacionError90d: 0.45,
      simulacionError180d: 0.55,
    },
    {
      id: 'super-ahorro-usd',
      name: 'Superfondo Ahorro USD',
      shortName: 'Ahorro USD',
      type: 'usd_fund',
      tna: 4.5,
      realRate30d: usdFund30d,
      realRate90d: usdFund90d,
      liquidity: 'T+1',
      riskScore: 8,
      volatility30d: 1.0,
      maxDrawdown30d: 0.3,
      minInvestmentARS: 1000,
      currency: 'USD',
      description: 'FCI USD — Dólares con rendimiento, baja volatilidad',
      category: 'fx_hedge',
      dataSource: 'SOFR + spread (global USD MM rate)',
      dataLabel: 'ERROR' as DataLabel, // No Argentine API for USD fund yields
      dataDate: now,
      simulacionError90d: 0.05,
      simulacionError180d: 0.08,
    },
    {
      id: 'dolar-mep',
      name: 'Dólar MEP',
      shortName: 'MEP',
      type: 'mep',
      tna: crawlingPeg * 12,
      realRate30d: mepUSD30d,
      realRate90d: mepUSD90d,
      liquidity: 'T+1',
      riskScore: 25,
      volatility30d: 4.0,
      maxDrawdown30d: 3.0,
      minInvestmentARS: 10000,
      currency: 'USD',
      description: 'Compra venta USD MEP — Cobertura cambiaria via bonos',
      category: 'fx_hedge',
      dataSource: mepReal ? 'Bluelytics API (blue dollar rate)' : 'Bluelytics + gap risk model',
      dataLabel: mepReal ? 'REAL' : 'ERROR',
      dataDate: now,
      simulacionError90d: 0.15,
      simulacionError180d: 0.22,
    },
    {
      id: 'plazo-fijo',
      name: 'Plazo Fijo Tradicional',
      shortName: 'PF Trad.',
      type: 'plazo_fijo',
      tna: rates.plazoFijo,
      realRate30d: calcUSD30d(rates.plazoFijo),
      realRate90d: calcUSD90d(rates.plazoFijo),
      liquidity: 'locked',
      riskScore: 5,
      volatility30d: 0.0,
      maxDrawdown30d: 0.0,
      minInvestmentARS: 1000,
      currency: 'ARS',
      description: 'Plazo fijo 30d — Tasa fija garantizada por banco',
      category: 'yield',
      dataSource: ratesReal ? 'BCRA BADLAR + Policy rate derived' : 'BNA published rate (est.)',
      dataLabel: ratesReal ? 'REAL' : 'ERROR',
      dataDate: now,
      simulacionError90d: 0.29,
      simulacionError180d: 0.35,
    },
    {
      id: 'plazo-fijo-uva',
      name: 'Plazo Fijo UVA',
      shortName: 'PF UVA',
      type: 'plazo_fijo_uva',
      tna: rates.plazoFijoUVA + cer.monthlyChange * 12,
      realRate30d: cerUSD30d + 0.15,
      realRate90d: cerUSD90d + 0.45,
      liquidity: 'locked',
      riskScore: 10,
      volatility30d: 0.5,
      maxDrawdown30d: 0.0,
      minInvestmentARS: 1000,
      currency: 'ARS',
      description: 'Plazo fijo UVA — Ajustado por inflación + tasa premium',
      category: 'inflation_hedge',
      dataSource: cerReal ? 'BCRA CER real + BNA UVA premium' : 'CER: modelo, Premium: BNA (UVA+4.5%)',
      dataLabel: cerReal ? 'REAL' : 'ERROR',
      dataDate: now,
      simulacionError90d: 0.65,
      simulacionError180d: 0.70,
    },
    {
      id: 'lecaps',
      name: 'Lecaps BCBA',
      shortName: 'Lecaps',
      type: 'lecaps',
      tna: rates.lecaps,
      realRate30d: calcUSD30d(rates.lecaps),
      realRate90d: calcUSD90d(rates.lecaps),
      liquidity: 'T+1',
      riskScore: 8,
      volatility30d: 0.4,
      maxDrawdown30d: 0.1,
      minInvestmentARS: 5000,
      currency: 'ARS',
      description: 'Letras BCBA — Tasa Fija corta plazo, bajo riesgo soberano',
      category: 'yield',
      dataSource: ratesReal ? 'BCRA Lecaps rate (Variable 178)' : 'Boston AM / Rava (estimación)',
      dataLabel: ratesReal ? 'REAL' : 'ERROR',
      dataDate: now,
      simulacionError90d: 0.67,
      simulacionError180d: 0.75,
    },
    {
      id: 'fondo-corto-plazo',
      name: 'Superfondo Corto Plazo',
      shortName: 'Corto Plazo',
      type: 'fondo_corto',
      tna: rates.moneyMarket + 0.8,
      realRate30d: calcUSD30d(rates.moneyMarket + 0.8),
      realRate90d: calcUSD90d(rates.moneyMarket + 0.8),
      liquidity: 'T+1',
      riskScore: 5,
      volatility30d: 0.5,
      maxDrawdown30d: 0.1,
      minInvestmentARS: 1000,
      currency: 'ARS',
      description: 'FCI Corto Plazo — Renta fija muy corta, bajo riesgo',
      category: 'liquidity',
      dataSource: ratesReal ? 'BCRA MM rate + 0.8pp spread' : 'Estimación mercado (MM + 0.8pp)',
      dataLabel: ratesReal ? 'REAL' : 'ERROR',
      dataDate: now,
      simulacionError90d: 0.20,
      simulacionError180d: 0.28,
    },
  ];
}

// ============================================================================
// MARKET SCENARIOS — Dynamic from MEP gap + real inflation data
// ============================================================================
export interface MarketScenario {
  id: string;
  name: string;
  emoji: string;
  probability: number;
  inflation30d: number;
  devaluation30d: number;
  rateChangeBps: number;
  mepMove: number;
  description: string;
}

export function getScenariosFromMacro(macro: MacroState): MarketScenario[] {
  const gap = macro.mep.gap;
  const baseInflation = macro.inflation.monthly;

  // Wider gap = higher crisis probability
  const crisisProb = Math.min(0.35, 0.10 + gap / 200);
  const mildProb = Math.min(0.45, 0.25 + gap / 150);
  const stableProb = 1 - crisisProb - mildProb;

  return [
    {
      id: 'stable',
      name: 'Estabilidad',
      emoji: '🟢',
      probability: Math.max(0.25, stableProb),
      inflation30d: baseInflation - 0.5,
      devaluation30d: macro.crawlingPeg,
      rateChangeBps: -50,
      mepMove: -2,
      description: 'Continúa el plan estabilizador. Inflación baja, crawling peg predecible.',
    },
    {
      id: 'mild-devaluation',
      name: 'Devaluación Moderada',
      emoji: '🟡',
      probability: Math.min(0.45, mildProb),
      inflation30d: baseInflation + 1.5,
      devaluation30d: macro.crawlingPeg + 2,
      rateChangeBps: 200,
      mepMove: 8,
      description: 'Shock cambiario moderado. Aceleración inflacionaria temporal.',
    },
    {
      id: 'crisis',
      name: 'Shock Cambiario',
      emoji: '🔴',
      probability: Math.min(0.35, crisisProb),
      inflation30d: baseInflation + 5,
      devaluation30d: macro.crawlingPeg + 14,
      rateChangeBps: 800,
      mepMove: 25,
      description: 'Crisis cambiaria severa. Brecha se amplifica, inflación se dispara.',
    },
  ];
}

// ============================================================================
// SIMULACION HISTORICA ENGINE — Error tracking (renamed from Backtest)
// NOTE: This is NOT a real backtest — no observed historical series exist.
// All data is model-constructed. Label is always [SIMULADO].
// ============================================================================
export interface SimulacionResult {
  assetId: string;
  assetName: string;
  modelReturn30d: number;
  actualReturnAvg90d: number;
  actualReturnAvg180d: number;
  errorAbs90d: number;
  errorAbs180d: number;
  errorPct90d: number;
  errorPct180d: number;
  label: DataLabel;  // Always SIMULADO until real historical series are integrated
}

export function computeSimulacion(products: SantanderProduct[]): SimulacionResult[] {
  // Simulacion historica data (Dec 2025 - May 2026)
  // These are CONSTRUCTED from model estimates, NOT observed series.
  const historicalActualReturns: Record<string, { avg90d: number; avg180d: number }> = {
    'super-ahorro':     { avg90d: 1.73, avg180d: 1.78 },
    'lecaps':           { avg90d: 2.44, avg180d: 2.52 },
    'plazo-fijo':       { avg90d: 1.73, avg180d: 1.76 },
    'renta-fija-cer':   { avg90d: 3.05, avg180d: 3.12 },
    'plazo-fijo-uva':   { avg90d: 3.20, avg180d: 3.27 },
    'super-ahorro-usd': { avg90d: 0.38, avg180d: 0.39 },
    'dolar-mep':        { avg90d: -0.02, avg180d: -0.01 },
    'supergestion-mix-vi': { avg90d: 1.55, avg180d: 1.60 },
    'fondo-corto-plazo': { avg90d: 1.82, avg180d: 1.88 },
  };

  return products.map(p => {
    const historical = historicalActualReturns[p.id] || { avg90d: p.realRate30d, avg180d: p.realRate30d };
    const err90d = Math.abs(p.realRate30d - historical.avg90d);
    const err180d = Math.abs(p.realRate30d - historical.avg180d);

    return {
      assetId: p.id,
      assetName: p.shortName,
      modelReturn30d: p.realRate30d,
      actualReturnAvg90d: historical.avg90d,
      actualReturnAvg180d: historical.avg180d,
      errorAbs90d: Math.round(err90d * 100) / 100,
      errorAbs180d: Math.round(err180d * 100) / 100,
      errorPct90d: historical.avg90d !== 0 ? Math.round(err90d / Math.abs(historical.avg90d) * 10000) / 100 : 999,
      errorPct180d: historical.avg180d !== 0 ? Math.round(err180d / Math.abs(historical.avg180d) * 10000) / 100 : 999,
      label: 'ERROR' as DataLabel,
    };
  });
}

// Keep backward-compatible alias
export type BacktestResult = SimulacionResult;
export const computeBacktest = computeSimulacion;

// ============================================================================
// HELPER: Determine overall data quality label for the dashboard
// ============================================================================
export function getOverallDataLabel(macro: MacroState | null): DataLabel {
  if (!macro) return 'ERROR';
  if (macro.source === 'ERROR') return 'ERROR';
  if (macro.source === 'ERROR') return 'ERROR';

  const prov = macro.provenance;

  // If any source had an error, label ERROR
  const anyError = Object.values(prov).some(p => p.label === 'ERROR');
  if (anyError) return 'ERROR';

  // If any REAL data is stale beyond its type-specific threshold, consider STALE
  // Use the same thresholds as applyStaleDegradation for consistency
  const anyRealStale = Object.entries(prov).some(([key, p]) => {
    if (p.label !== 'REAL') return false;
    const threshold = DATA_STALE_THRESHOLDS[key] ?? 72;
    return p.stalenessHours > threshold;
  });
  if (anyRealStale) return 'STALE';

  // If provenance already shows STALE (from applyStaleDegradation), label STALE
  const anyProvenanceStale = Object.values(prov).some(p => p.label === 'STALE');
  if (anyProvenanceStale) return 'STALE';

  // If all are real, label REAL
  const allReal = Object.values(prov).every(p => p.label === 'REAL' || p.label === 'OBSERVADO');
  if (allReal) return 'REAL';

  // If majority real (>50%), show as REAL with caveat
  const realCount = Object.values(prov).filter(p => p.label === 'REAL' || p.label === 'OBSERVADO').length;
  const totalCount = Object.values(prov).length;
  if (realCount / totalCount > 0.5) return 'REAL';

  // FAIL HARD: If any API fetch failed, label the whole state as PARTIAL_FALLBACK
  // instead of hiding the failure under 'PARTIAL_FALLBACK'
  const errorCount = Object.values(prov).filter(p => p.fetchError).length;
  if (errorCount > 0 && realCount > 0) return 'PARTIAL_FALLBACK';
  if (errorCount > 0) return 'ERROR';
  // If some real inputs exist with NO fetch errors, it's PARTIAL_FALLBACK (calculated from real inputs)
  if (realCount > 0) return 'PARTIAL_FALLBACK';

  return 'ERROR';
}
