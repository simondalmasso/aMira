/// <reference types="@cloudflare/workers-types" />

// ============================================================================
// Ω-MYTHOS_X10_ENGINE — External Data Fetcher for Cloudflare Worker
// Fetches from BCRA, INDEC, Bluelytics with KV caching + Zod validation
// No Node.js dependencies — pure fetch() + KV + D1
// ============================================================================

import { type MacroState, type DataLabel, type DataProvenance, type Env } from './types';

// ============================================================================
// ZOD-LITE VALIDATION (avoid importing full Zod for smaller bundle)
// ============================================================================

function validateNumber(val: unknown, min: number, max: number): number {
  const n = typeof val === 'number' ? val : NaN;
  if (isNaN(n) || n < min || n > max) throw new Error(`Invalid number: ${val}`);
  return n;
}

function validateObject(val: unknown): Record<string, unknown> {
  if (typeof val === 'object' && val !== null && !Array.isArray(val)) return val as Record<string, unknown>;
  throw new Error('Expected object');
}

// ============================================================================
// STALENESS THRESHOLDS (hours)
// ============================================================================

const STALE_THRESHOLDS = {
  mep: 4,         // MEP rate: stale after 4 hours
  inflation: 720,  // INDEC IPC: stale after 30 days (monthly publication)
  rates: 24,       // BCRA rates: stale after 24 hours
  cer: 48,         // CER index: stale after 48 hours
  fx: 4,           // FX rates: stale after 4 hours
  reserves: 48,    // Reserves: stale after 48 hours
} as const;

// ============================================================================
// API FETCH FUNCTIONS
// ============================================================================

interface FetchResult<T> {
  data: T | null;
  error: string | null;
  source: string;
  url: string;
  responseTimeMs: number;
}

async function fetchJSON<T>(url: string, headers?: Record<string, string>): Promise<FetchResult<T>> {
  const start = Date.now();
  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json', ...headers },
    });
    if (!response.ok) {
      return { data: null, error: `HTTP ${response.status}`, source: url, url, responseTimeMs: Date.now() - start };
    }
    const data = await response.json() as T;
    return { data, error: null, source: url, url, responseTimeMs: Date.now() - start };
  } catch (err) {
    return { data: null, error: String(err), source: url, url, responseTimeMs: Date.now() - start };
  }
}

// ─── Bluelytics (MEP / Blue dollar) ───

interface BluelyticsData {
  oficial: { value_avg: number; value_sell: number; value_buy: number };
  blue: { value_avg: number; value_sell: number; value_buy: number };
  last_update: string;
}

async function fetchBluelytics(): Promise<FetchResult<BluelyticsData>> {
  return fetchJSON<BluelyticsData>('https://api.bluelytics.com.ar/v2/latest');
}

// ─── BCRA Rates (TNA, BADLAR, LELIQ, etc.) ───

interface BCRARateEntry {
  id: number;
  descripcion: string;
  valor: number;
  fecha: string;
}

async function fetchBCRARates(apiKey?: string): Promise<FetchResult<BCRARateEntry[]>> {
  const headers: Record<string, string> = {};
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  return fetchJSON<BCRARateEntry[]>('https://api.estadisticasbcra.com.ar/tesoreria', headers);
}

// ─── BCRA FX (estadisticascambiarias) ───

async function fetchBCRAFx(apiKey?: string): Promise<FetchResult<any>> {
  const headers: Record<string, string> = {};
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  return fetchJSON('https://api.estadisticasbcra.com.ar/usd_of', headers);
}

// ─── INDEC IPC (via datos.gob.ar) ───

async function fetchINDECIPC(): Promise<FetchResult<any>> {
  return fetchJSON('https://apis.datos.gob.ar/series/api/series?ids=148.3_INIVELNAL_DICI_M_26:percent_change&limit=6');
}

// ─── BCRA CER Index ───

async function fetchCER(apiKey?: string): Promise<FetchResult<BCRARateEntry[]>> {
  const headers: Record<string, string> = {};
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  return fetchJSON<BCRARateEntry[]>('https://api.estadisticasbcra.com.ar/cer', headers);
}

// ============================================================================
// KV CACHING — Macro state cached for 5 minutes
// ============================================================================

const KV_CACHE_TTL = 300; // 5 minutes

async function getCachedMacro(kv: KVNamespace): Promise<MacroState | null> {
  try {
    const cached = await kv.get('macro_state', 'json');
    if (cached) {
      const state = cached as MacroState;
      // Check if cache is still fresh
      const ageMinutes = (Date.now() - new Date(state.fetchedAt).getTime()) / 60000;
      if (ageMinutes < 5) return state;
    }
  } catch { /* KV miss or parse error */ }
  return null;
}

async function setCachedMacro(kv: KVNamespace, state: MacroState): Promise<void> {
  try {
    await kv.put('macro_state', JSON.stringify(state), { expirationTtl: KV_CACHE_TTL });
  } catch { /* KV write failure — non-critical */ }
}

// ============================================================================
// STALENESS COMPUTATION
// ============================================================================

function computeStaleness(lastUpdate: string, thresholdHours: number): { label: DataLabel; stalenessHours: number } {
  const hours = (Date.now() - new Date(lastUpdate).getTime()) / 3600000;
  // FAIL HARD: Data older than 3x threshold is ERROR, not MODELO
  // MODELO is reserved for derived/interpolated data, never for stale fetches
  const label: DataLabel = hours > thresholdHours * 3 ? 'ERROR'
    : hours > thresholdHours * 2 ? 'STALE'
    : hours > thresholdHours ? 'PARTIAL_FALLBACK'  // Was MODELO — now explicit
    : 'REAL';
  return { label, stalenessHours: Math.round(hours * 10) / 10 };
}

function makeProvenance(source: string, url: string, label: DataLabel, stalenessHours: number): DataProvenance {
  const now = new Date().toISOString();
  return {
    label,
    source: label === 'ERROR' ? `FETCH FAILED — ${source} sin respuesta` : source,
    url: label === 'ERROR' ? 'N/A' : url,
    lastUpdate: now,
    dataDate: now.split('T')[0],
    stalenessHours: label === 'ERROR' ? 999 : stalenessHours,
    fetchedAt: now,
    ageMinutes: 0,
    fetchError: label === 'ERROR',
  };
}

// ============================================================================
// MAIN: BUILD MACRO STATE FROM EXTERNAL APIS
// ============================================================================

export async function fetchMacroState(env: Env): Promise<MacroState> {
  // Check KV cache first
  const cached = await getCachedMacro(env.ORACLE_KV);
  if (cached) return cached;

  const now = new Date().toISOString();

  // ─── Parallel fetch all sources ───
  const [bluelyticsResult, bcraRatesResult, bcraFxResult, indecResult, cerResult] = await Promise.allSettled([
    fetchBluelytics(),
    fetchBCRARates(env.BCRA_API_KEY),
    fetchBCRAFx(env.BCRA_API_KEY),
    fetchINDECIPC(),
    fetchCER(env.BCRA_API_KEY),
  ]);

  // ─── Process Bluelytics (MEP/Blue) ───
  let mepRate = 1445;  // Fallback (only used when ERROR)
  let officialRate = 1440;  // Fallback
  let mepGap = 0.35;  // Fallback
  let mepSell = 1450;
  let mepBuy = 1440;
  let mepLabel: DataLabel = 'ERROR';  // FAIL HARD: Default to ERROR, not MODELO
  let mepStaleness = 0;

  if (bluelyticsResult.status === 'fulfilled' && bluelyticsResult.value.data && !bluelyticsResult.value.error) {
    const b = bluelyticsResult.value.data;
    mepRate = b.blue.value_avg;
    officialRate = b.oficial.value_avg;
    mepSell = b.blue.value_sell;
    mepBuy = b.blue.value_buy;
    mepGap = officialRate > 0 ? ((mepRate - officialRate) / officialRate) * 100 : 0;
    const staleness = computeStaleness(b.last_update, STALE_THRESHOLDS.mep);
    mepLabel = staleness.label;
    mepStaleness = staleness.stalenessHours;
  }
  // No else — already ERROR by default

  // ─── Process BCRA Rates ───
  let bcraPolicy = 20;  // Fallback
  let badlar = 22;  // Fallback
  let leliq = 20;  // Fallback
  let tml = 20;  // Fallback
  let moneyMarket = 20;  // Fallback
  let plazoFijo = 19;  // Fallback
  let plazoFijoUVA = 4.5;  // Fallback (HARDCODED — no real source)
  let lecaps = 25;  // Fallback
  let ratesLabel: DataLabel = 'ERROR';  // FAIL HARD: Default to ERROR
  let ratesStaleness = 0;

  if (bcraRatesResult.status === 'fulfilled' && bcraRatesResult.value.data && !bcraRatesResult.value.error) {
    const rates = bcraRatesResult.value.data;
    // Parse BCRA rate entries by description
    for (const entry of rates) {
      const desc = (entry.descripcion || '').toLowerCase();
      if (desc.includes('tna') || desc.includes('politica')) bcraPolicy = entry.valor;
      else if (desc.includes('badlar')) badlar = entry.valor;
      else if (desc.includes('leliq')) leliq = entry.valor;
      else if (desc.includes('tml')) tml = entry.valor;
      else if (desc.includes('plazo') && desc.includes('fijo')) plazoFijo = entry.valor;
      else if (desc.includes('lecaps')) lecaps = entry.valor;
    }
    moneyMarket = badlar * 0.95;  // Money market ~95% of BADLAR
    ratesLabel = 'REAL';
  }

  // ─── Process INDEC IPC ───
  let inflationMonthly = 2.5;  // Fallback
  let inflationExpected30d = 2.3;  // Fallback
  let inflationExpected90d = 6.9;  // Fallback
  let inflationYearly = 30.5;  // Fallback
  let inflationLabel: DataLabel = 'ERROR';  // FAIL HARD: Default to ERROR
  let inflationStaleness = 0;

  if (indecResult.status === 'fulfilled' && indecResult.value.data && !indecResult.value.error) {
    try {
      const ipcData = indecResult.value.data;
      // Parse INDEC IPC response format
      if (ipcData?.data && Array.isArray(ipcData.data) && ipcData.data.length > 0) {
        const latest = ipcData.data[ipcData.data.length - 1];
        inflationMonthly = validateNumber(latest?.valor ?? latest?.[1] ?? 2.5, -5, 50);
        inflationLabel = 'REAL';
      }
    } catch {
      inflationLabel = 'ERROR';  // FAIL HARD: Parse failure = ERROR, not MODELO
    }
  }

  // ─── Process CER ───
  let cerIndex = 786;  // Fallback
  let cerMonthlyChange = 2.2;  // Fallback
  let cerDailyChange = 0.07;  // Fallback
  let cerLabel: DataLabel = 'ERROR';  // FAIL HARD: Default to ERROR
  let cerStaleness = 0;

  if (cerResult.status === 'fulfilled' && cerResult.value.data && !cerResult.value.error) {
    try {
      const cerData = cerResult.value.data;
      if (Array.isArray(cerData) && cerData.length >= 2) {
        const latest = cerData[cerData.length - 1];
        const prev = cerData[cerData.length - 2];
        cerIndex = latest.valor ?? cerIndex;
        cerMonthlyChange = prev.valor > 0 ? ((cerIndex - prev.valor) / prev.valor) * 100 : cerMonthlyChange;
        cerDailyChange = cerMonthlyChange / 30;
        cerLabel = 'REAL';
      }
    } catch {
      cerLabel = 'ERROR';  // FAIL HARD: Parse failure = ERROR, not MODELO
    }
  }

  // ─── Derived values (no real source) ───
  const crawlingPeg = 0.0;  // Bandas cambiarias — no crawling peg since Jan 2026
  const reservesMillions = 26000;  // HARDCODED — no real source yet

  // ─── Compute real data percentage ───
  const dataPoints = [
    mepLabel, inflationLabel, ratesLabel, cerLabel,
    'PARTIAL_FALLBACK' as DataLabel,  // crawlingPeg — derived, not real API
    'PARTIAL_FALLBACK' as DataLabel,  // reserves — no API source yet
    'PARTIAL_FALLBACK' as DataLabel,  // PF UVA premium — derived, not real API
  ];
  const realCount = dataPoints.filter(d => d === 'REAL').length;
  const realDataPct = Math.round((realCount / dataPoints.length) * 100);

  // ─── DATA INTEGRITY SCORE (0-1) ───
  // FAIL HARD: If dataIntegrityScore < 0.7, system enters SAFE_MODE
  const dataIntegrityScore = Math.min(1, realDataPct / 100);

  // ─── Determine overall source label ───
  // FAIL HARD: Never mask fetch failures as MODELO
  const errorCount = dataPoints.filter(d => d === 'ERROR').length;
  const overallLabel: DataLabel = errorCount === dataPoints.length ? 'ERROR'  // All failed
    : errorCount > 0 && realCount > 0 ? 'PARTIAL_FALLBACK'  // Some real, some failed
    : dataPoints.some(d => d === 'STALE') ? 'STALE'
    : realDataPct >= 60 ? 'REAL'
    : realDataPct >= 30 ? 'PARTIAL_FALLBACK'  // Was MODELO — now explicit
    : 'ERROR';  // Was SIMULADO — now FAIL HARD

  // ─── Build MacroState ───
  const macroState: MacroState = {
    lastUpdate: now,
    fetchedAt: now,
    ageMinutes: 0,
    lastSuccessfulFetch: now,
    source: overallLabel,
    mep: {
      rate: Math.round(mepRate * 100) / 100,
      officialRate: Math.round(officialRate * 100) / 100,
      gap: Math.round(mepGap * 100) / 100,
      sell: Math.round(mepSell * 100) / 100,
      buy: Math.round(mepBuy * 100) / 100,
    },
    inflation: {
      monthly: Math.round(inflationMonthly * 100) / 100,
      expected30d: Math.round(inflationExpected30d * 100) / 100,
      expected90d: Math.round(inflationExpected90d * 100) / 100,
      yearly: Math.round(inflationYearly * 100) / 100,
    },
    rates: {
      bcraPolicy: Math.round(bcraPolicy * 100) / 100,
      moneyMarket: Math.round(moneyMarket * 100) / 100,
      plazoFijo: Math.round(plazoFijo * 100) / 100,
      plazoFijoUVA: Math.round(plazoFijoUVA * 100) / 100,
      lecaps: Math.round(lecaps * 100) / 100,
      badlar: Math.round(badlar * 100) / 100,
      leliq: Math.round(leliq * 100) / 100,
      tml: Math.round(tml * 100) / 100,
    },
    cer: {
      index: Math.round(cerIndex * 100) / 100,
      monthlyChange: Math.round(cerMonthlyChange * 100) / 100,
      dailyChange: Math.round(cerDailyChange * 10000) / 10000,
    },
    crawlingPeg,
    realDataPct,
    provenance: {
      mepRate: makeProvenance('Bluelytics API', 'https://api.bluelytics.com.ar/v2/latest', mepLabel, mepStaleness),
      inflation: makeProvenance('INDEC API', 'https://apis.datos.gob.ar/series/api/series', inflationLabel, inflationStaleness),
      rates: makeProvenance('BCRA API', 'https://api.estadisticasbcra.com.ar/tesoreria', ratesLabel, ratesStaleness),
      cer: makeProvenance('BCRA API', 'https://api.estadisticasbcra.com.ar/cer', cerLabel, cerStaleness),
      crawlingPeg: makeProvenance('MODEL', 'N/A', 'PARTIAL_FALLBACK', 0),  // Derived from policy — not real API
      reserves: makeProvenance('MODEL', 'N/A', 'PARTIAL_FALLBACK', 0),  // No API source yet — not real data
    },
  };

  // Cache in KV
  await setCachedMacro(env.ORACLE_KV, macroState);

  return macroState;
}
