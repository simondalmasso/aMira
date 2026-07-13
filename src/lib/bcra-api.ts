// ============================================================================
// BCRA / DATOS.GOB.AR API INTEGRATION — Real Argentine Financial Data
// Uses datos.gob.ar series API (official open data) + BCRA exchange rate API
// ============================================================================
//
// WORKING ENDPOINTS (tested 2026-06-09):
// 1. datos.gob.ar series API:
//    - BADLAR (daily):     89.2_TS_INTELAR_0_D_20
//    - Policy rate (daily): 89.2_TS_INTE_PM_0_D_16
//    - CER daily:          94.2_CD_D_0_0_10
//    - UVA daily:          94.2_UVAD_D_0_0_10
//    - IPC monthly:        148.3_INIVELNAL_DICI_M_26:percent_change
//    - IPC GBA monthly:    101.1_I2NG_2016_M_22:percent_change
//
// 2. BCRA exchange rate API:
//    - https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones
//      Returns all official exchange rates including USD
//
// 3. Bluelytics:
//    - https://api.bluelytics.com.ar/v2/latest (blue dollar / MEP)
// ============================================================================

export interface BCRARates {
  // ─── Policy rates ───
  bcraPolicyTNA: number;
  badlarTNA: number;

  // ─── Market rates ───
  moneyMarketTNA: number;       // Derived from BADLAR
  lecapsTNA: number;            // Estimated from BADLAR + spread

  // ─── FX ───
  officialRate: number;         // BCRA official USD rate
  reservesUSD: number;

  // ─── Provenance ───
  fetchTimestamp: string;
  sourceUrl: string;
  dataDate: string;
  isReal: boolean;
  error?: string;
}

const DATOS_GOB_AR_BASE = 'https://apis.datos.gob.ar/series/api/series';
const BCRA_FX_URL = 'https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones';

// Series IDs
const SERIES = {
  BADLAR: '89.2_TS_INTELAR_0_D_20',
  POLICY_RATE: '89.2_TS_INTE_PM_0_D_16',
  CER: '94.2_CD_D_0_0_10',
  UVA: '94.2_UVAD_D_0_0_10',
  IPC: '148.3_INIVELNAL_DICI_M_26:percent_change',
  IPC_GBA: '101.1_I2NG_2016_M_22:percent_change',
} as const;

// ============================================================================
// FETCH SERIES FROM DATOS.GOB.AR
// ============================================================================
async function fetchSeries(
  seriesId: string,
  last: number = 5
): Promise<{ date: string; value: number }[]> {
  try {
    const url = `${DATOS_GOB_AR_BASE}/?ids=${seriesId}&last=${last}&format=json`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timeoutId);

    if (!res.ok) return [];

    const data = await res.json();
    if (!data?.data || !Array.isArray(data.data)) return [];

    return data.data
      .map((point: (string | number)[]) => ({
        date: String(point[0]),
        value: Number(point[1]),
      }));
    // API returns data oldest-first, which is what we want
  } catch {
    return [];
  }
}

// ============================================================================
// FETCH BCRA OFFICIAL EXCHANGE RATES
// ============================================================================
interface BCRAFxResponse {
  status: number;
  results: {
    fecha: string;
    detalle: Array<{
      codigoMoneda: string;
      descripcion: string;
      tipoPase: number;
      tipoCotizacion: number;
    }>;
  };
}

async function fetchBCRAFxRate(): Promise<{
  usdOfficial: number;
  usdReference: number;
  date: string;
} | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(BCRA_FX_URL, {
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeoutId);

    if (!res.ok) return null;
    const data: BCRAFxResponse = await res.json();

    if (data.status !== 200 || !data.results?.detalle) return null;

    const usd = data.results.detalle.find(d => d.codigoMoneda === 'USD');
    const ref = data.results.detalle.find(d => d.codigoMoneda === 'REF');

    if (!usd) return null;

    return {
      usdOfficial: usd.tipoCotizacion,
      usdReference: ref?.tipoCotizacion ?? usd.tipoCotizacion,
      date: data.results.fecha,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// FETCH ALL BCRA DATA IN PARALLEL
// ============================================================================
export async function fetchBCRAData(): Promise<BCRARates> {
  const now = new Date().toISOString();
  const sourceUrl = `${DATOS_GOB_AR_BASE}/?ids=${SERIES.BADLAR},${SERIES.POLICY_RATE}`;

  try {
    const [badlarData, policyData, fxData] = await Promise.all([
      fetchSeries(SERIES.BADLAR, 5),
      fetchSeries(SERIES.POLICY_RATE, 5),
      fetchBCRAFxRate(),
    ]);

    // Get latest values
    const badlarLatest = badlarData.length > 0 ? badlarData[badlarData.length - 1] : null;
    const policyLatest = policyData.length > 0 ? policyData[policyData.length - 1] : null;

    const isReal = badlarLatest !== null || fxData !== null;

    // Money market TNA ≈ BADLAR - 2pp (FCI MM typically below bank rates)
    const badlarValue = badlarLatest?.value ?? 21.0;
    const moneyMarketTNA = Math.round((badlarValue - 2) * 100) / 100;

    // Lecaps ≈ BADLAR + 3-5pp (higher yielding, more risk)
    const lecapsTNA = Math.round((badlarValue + 4) * 100) / 100;

    // Data date = most recent across all sources
    const allDates = [
      badlarLatest?.date,
      policyLatest?.date,
      fxData?.date,
    ].filter(Boolean) as string[];
    const dataDate = allDates.length > 0
      ? allDates.sort().reverse()[0].split('T')[0]
      : now.split('T')[0];

    return {
      bcraPolicyTNA: policyLatest?.value ?? 20.0,
      badlarTNA: badlarValue,
      moneyMarketTNA,
      lecapsTNA,
      officialRate: fxData?.usdOfficial ?? 1446.5,
      reservesUSD: 26000, // Not available via API, use estimate
      fetchTimestamp: now,
      sourceUrl,
      dataDate,
      isReal,
      error: isReal ? undefined : 'No rate data available from datos.gob.ar',
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return {
      bcraPolicyTNA: 20.0,
      badlarTNA: 21.0,
      moneyMarketTNA: 19.0,
      lecapsTNA: 25.0,
      officialRate: 1446.5,
      reservesUSD: 26000,
      fetchTimestamp: now,
      sourceUrl,
      dataDate: now.split('T')[0],
      isReal: false,
      error: msg,
    };
  }
}

// ============================================================================
// FETCH CER INDEX FROM DATOS.GOB.AR
// ============================================================================
export interface CERData {
  index: number;                // Current CER index value
  monthlyChange: number;        // % change over last 30 calendar days
  dailyChange: number;          // % daily change
  dataDate: string;             // Date of the data
  fetchTimestamp: string;
  sourceUrl: string;
  isReal: boolean;
  error?: string;
}

export async function fetchCERData(): Promise<CERData> {
  const now = new Date().toISOString();
  const sourceUrl = `${DATOS_GOB_AR_BASE}/?ids=${SERIES.CER}&last=35`;

  try {
    // Fetch last 35 data points for monthly change calculation
    const data = await fetchSeries(SERIES.CER, 35);

    if (data.length < 2) {
      return {
        index: 786.37,
        monthlyChange: 2.2,
        dailyChange: 0.07,
        dataDate: now.split('T')[0],
        fetchTimestamp: now,
        sourceUrl,
        isReal: false,
        error: 'Insufficient CER data points',
      };
    }

    const currentIndex = data[data.length - 1].value;
    const currentDate = data[data.length - 1].date;

    // Calculate monthly change from available data
    // The datos.gob.ar CER series may be 1-3 months behind
    // We use the first and last available points to compute a monthly rate
    let monthlyChange: number;

    if (data.length >= 30) {
      // Enough data for 30-day comparison
      const thirtyDaysAgo = new Date(currentDate);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      let closestPastIdx = 0;
      for (let i = 0; i < data.length; i++) {
        if (new Date(data[i].date) <= thirtyDaysAgo) {
          closestPastIdx = i;
        }
      }
      const pastIndex = data[closestPastIdx].value;
      monthlyChange = ((currentIndex / pastIndex) - 1) * 100;
    } else if (data.length >= 2) {
      // Not enough for 30 days, extrapolate from available data
      const firstIndex = data[0].value;
      const lastDate = new Date(currentDate);
      const firstDate = new Date(data[0].date);
      const daysDiff = Math.max(1, (lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24));
      const dailyRate = (currentIndex / firstIndex) - 1;
      // Annualize and convert to monthly
      monthlyChange = (Math.pow(1 + dailyRate, 30) - 1) * 100;
    } else {
      monthlyChange = 2.2; // fallback
    }

    // Daily change
    const yesterdayIndex = data.length > 1 ? data[data.length - 2].value : currentIndex;
    const dailyChange = ((currentIndex / yesterdayIndex) - 1) * 100;

    return {
      index: Math.round(currentIndex * 100) / 100,
      monthlyChange: Math.round(monthlyChange * 100) / 100,
      dailyChange: Math.round(dailyChange * 10000) / 10000,
      dataDate: currentDate.split('T')[0],
      fetchTimestamp: now,
      sourceUrl,
      isReal: true,
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return {
      index: 786.37,
      monthlyChange: 2.2,
      dailyChange: 0.07,
      dataDate: now.split('T')[0],
      fetchTimestamp: now,
      sourceUrl,
      isReal: false,
      error: msg,
    };
  }
}
