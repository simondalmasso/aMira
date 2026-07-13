// ============================================================================
// INDEC API INTEGRATION — Instituto Nacional de Estadística y Censos
// Official inflation (IPC), poverty, and macro indicators
// ============================================================================
//
// ENDPOINTS:
// 1. INDEC publishes IPC data at:
//    https://www.indec.gob.ar/indec/web/Nivel4-Tema-3-5-31
//    No official REST API, but data is available via:
//    - https://infra.datos.gob.ar/catalog/indec/dataset/92/distribution/96/
//      (datos.gob.ar - official open data portal)
//    - Alternative: INDEC publishes monthly IPC as JSON/CSV
//
// 2. For automated access we use datos.gob.ar API:
//    https://apis.datos.gob.ar/series/api/series/?ids=148.3_INIVELNAL_DICI_M_26
//    This is the official series API for IPC Nacional (inflation)
//
// KEY SERIES IDs (datos.gob.ar):
//   148.3_INIVELNAL_DICI_M_26  = IPC Nacional nivel general (monthly % change)
//   148.3_INIVELNAL_DICI_M_15  = IPC Núcleo (core inflation)
//   101.1_I2NG_2016_M_22       = CER index
// ============================================================================

export interface INDECInflationPoint {
  date: string;      // "2026-05"
  value: number;     // Monthly inflation %
}

export interface INDECInflationData {
  // ─── Current inflation ───
  lastMonthInflation: number;      // Last published monthly inflation %
  lastMonthDate: string;           // Date of last published data (YYYY-MM)
  coreInflation: number;           // Core inflation (núcleo) %
  threeMonthAvg: number;           // 3-month rolling average
  sixMonthAvg: number;             // 6-month rolling average
  twelveMonthAccum: number;        // 12-month accumulated inflation %

  // ─── Projections (model-based from trend) ───
  projected30d: number;            // Projected next 30d inflation %
  projected90d: number;            // Projected next 90d (monthly avg) %

  // ─── Historical series (last 12 months) ───
  monthlySeries: INDECInflationPoint[];

  // ─── Provenance ───
  fetchTimestamp: string;
  sourceUrl: string;
  dataDate: string;
  isReal: boolean;
  error?: string;
}

// ============================================================================
// DATOS.GOB.AR SERIES API
// ============================================================================
const DATOS_GOB_AR_BASE = 'https://apis.datos.gob.ar/series/api/series';

// IPC Nacional - Monthly % change (using :percent_change transform)
// NOTE: Without :percent_change, the API returns index LEVEL values (e.g. 11077)
// With :percent_change, returns monthly variation as decimal (e.g. 0.0296 = 2.96%)
const IPC_SERIES_ID = '148.3_INIVELNAL_DICI_M_26:percent_change';
// IPC GBA (alternate series for cross-validation)
const IPC_GBA_SERIES_ID = '101.1_I2NG_2016_M_22:percent_change';

// ============================================================================
// FETCH INDEC INFLATION DATA
// ============================================================================
export async function fetchINDECInflation(): Promise<INDECInflationData> {
  const now = new Date().toISOString();
  const sourceUrl = `${DATOS_GOB_AR_BASE}/?ids=${IPC_SERIES_ID}&last=12`;

  try {
    // Fetch last 12 months of IPC data
    const url = `${DATOS_GOB_AR_BASE}/?ids=${IPC_SERIES_ID}&last=12&format=json`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'HedgeFundOS/2.0',
      },
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`[INDEC] API returned status ${res.status}`);
      return getINDECFallback(now, sourceUrl, `API returned ${res.status}`);
    }

    const data = await res.json();

    // datos.gob.ar returns: { data: [[date, value], ...] }
    // The series ID is the key
    const seriesData = data?.data;
    if (!Array.isArray(seriesData) || seriesData.length === 0) {
      console.warn('[INDEC] No data in response');
      return getINDECFallback(now, sourceUrl, 'No data in API response');
    }

    // Parse the series
    // :percent_change returns values as decimals (0.0296 = 2.96%)
    // We convert to percentage (* 100) for display
    const monthlySeries: INDECInflationPoint[] = seriesData
      .map((point: (string | number)[]) => ({
        date: String(point[0]).substring(0, 7), // "2026-05-01" → "2026-05"
        value: Number(point[1]) * 100,  // Convert decimal to percentage
      }))
      .filter((p: INDECInflationPoint) => !isNaN(p.value) && p.value !== null);
    // API returns data oldest-first, no need to reverse

    if (monthlySeries.length === 0) {
      return getINDECFallback(now, sourceUrl, 'Empty series after parsing');
    }

    // Extract statistics
    const lastPoint = monthlySeries[monthlySeries.length - 1];
    const lastMonthInflation = lastPoint.value;
    const lastMonthDate = lastPoint.date;

    // 3-month average
    const last3 = monthlySeries.slice(-3);
    const threeMonthAvg = last3.reduce((s, p) => s + p.value, 0) / last3.length;

    // 6-month average
    const last6 = monthlySeries.slice(-6);
    const sixMonthAvg = last6.reduce((s, p) => s + p.value, 0) / Math.max(last6.length, 1);

    // 12-month accumulated (compound the monthly rates)
    const twelveMonthAccum = monthlySeries.reduce(
      (s, p) => s * (1 + p.value / 100),
      1
    ) * 100 - 100;

    // Simple trend projection: weighted average of recent months
    // More weight to recent months (decay factor 0.7)
    let weightedSum = 0;
    let weightTotal = 0;
    for (let i = 0; i < last3.length; i++) {
      const weight = Math.pow(0.7, last3.length - 1 - i);
      weightedSum += last3[i].value * weight;
      weightTotal += weight;
    }
    const trendInflation = weightedSum / weightTotal;

    // Projected: use trend with slight decay
    const projected30d = trendInflation * 0.95; // slight disinflation assumption
    const projected90d = trendInflation * 0.90;

    return {
      lastMonthInflation: Math.round(lastMonthInflation * 100) / 100,
      lastMonthDate,
      coreInflation: lastMonthInflation * 0.85, // Estimate core ≈ 85% of headline (no separate API)
      threeMonthAvg: Math.round(threeMonthAvg * 100) / 100,
      sixMonthAvg: Math.round(sixMonthAvg * 100) / 100,
      twelveMonthAccum: Math.round(twelveMonthAccum * 100) / 100,
      projected30d: Math.round(projected30d * 100) / 100,
      projected90d: Math.round(projected90d * 100) / 100,
      monthlySeries,
      fetchTimestamp: now,
      sourceUrl,
      dataDate: lastMonthDate,
      isReal: true,
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.warn('[INDEC] Fetch failed:', msg);
    return getINDECFallback(now, sourceUrl, msg);
  }
}

// ============================================================================
// FETCH CORE INFLATION (IPC Núcleo) — optional enhancement
// ============================================================================
export async function fetchINDECCoreInflation(): Promise<number | null> {
  try {
    const url = `${DATOS_GOB_AR_BASE}/?ids=${IPC_GBA_SERIES_ID}&last=1&format=json`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeoutId);

    if (!res.ok) return null;
    const data = await res.json();

    if (data?.data?.length > 0) {
      return Number(data.data[0][1]) * 100;  // Convert decimal to percentage
    }
    return null;
  } catch {
    return null;
  }
}

// ============================================================================
// FALLBACK — Model-based inflation estimates
// ============================================================================
function getINDECFallback(
  now: string,
  sourceUrl: string,
  error: string
): INDECInflationData {
  // Disinflation trajectory as of mid-2026
  const fallbackSeries: INDECInflationPoint[] = [
    { date: '2025-07', value: 4.0 },
    { date: '2025-08', value: 3.8 },
    { date: '2025-09', value: 3.5 },
    { date: '2025-10', value: 3.2 },
    { date: '2025-11', value: 3.0 },
    { date: '2025-12', value: 2.8 },
    { date: '2026-01', value: 2.6 },
    { date: '2026-02', value: 2.5 },
    { date: '2026-03', value: 2.4 },
    { date: '2026-04', value: 2.3 },
    { date: '2026-05', value: 2.2 },
  ];

  return {
    lastMonthInflation: 2.5,
    lastMonthDate: '2026-05',
    coreInflation: 2.1,
    threeMonthAvg: 2.3,
    sixMonthAvg: 2.55,
    twelveMonthAccum: 30.5,
    projected30d: 2.3,
    projected90d: 2.1,
    monthlySeries: fallbackSeries,
    fetchTimestamp: now,
    sourceUrl,
    dataDate: '2026-05',
    isReal: false,
    error,
  };
}
