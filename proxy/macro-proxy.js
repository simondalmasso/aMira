// ============================================================================
// macro-oracle-proxy.js
// Cloudflare Worker — CORS-free proxy for Argentine macro data
//
// Endpoints (all under /api/proxy?source=...):
//   - source=health         → { ok, service, timestamp, endpoints }
//   - source=dolar_all      → DolarAPI.com.ar (oficial, blue, mep/bolsa, ccl, tarjeta, cripto, mayorista)
//   - source=bcra_all       → TPM + BADLAR via apis.datos.gob.ar (BCRA v2 is deprecated)
//   - source=bcra_inflacion → INDEC IPC via apis.datos.gob.ar (lastMonthly + accumulated)
//   - source=santander_funds → Santander AR public funds API (currency=ARS)
//
// All responses include per-source `ok` flags and `realCount` for quality scoring.
// ============================================================================

const DOLARAPI_URL = 'https://dolarapi.com/v1/dolares';
const DATOS_GOB_AR_BASE = 'https://apis.datos.gob.ar/series/api/series';
// TPM = 89.2_TS_INTE_PM_0_D_16  (Tasa de Política Monetaria — daily)
// BADLAR = 89.2_TS_INTELAR_0_D_20  (BADLAR private banks — daily)
const BCRA_RATES_SERIES = '89.2_TS_INTE_PM_0_D_16,89.2_TS_INTELAR_0_D_20';
// INDEC IPC national, monthly percent change
const INDEC_IPC_SERIES = '148.3_INIVELNAL_DICI_M_26:percent_change';
// Santander Argentina public funds endpoint (Akamai-fronted, requires IBM client-id)
const SANTANDER_FUNDS_URL = 'https://www.santander.com.ar/fondosInformacion/funds';
const SANTANDER_HEADERS = {
  accept: 'application/json',
  'channel-name': 'webpublic',
  'x-ibm-client-id': '6pXM5mL8Gz8hQKZAo7kpTxjVpuVtNcIl',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  origin: 'https://www.santander.com.ar',
  referer: 'https://www.santander.com.ar/',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Data-Label, X-Data-Origin',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'public, max-age=60, s-maxage=60',
};

// ============================================================================
// Helpers
// ============================================================================
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: CORS_HEADERS,
  });
}

async function fetchWithTimeout(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cf: { cacheTtl: 60, cacheEverything: true },
      headers: { Accept: 'application/json', 'User-Agent': 'macro-oracle-proxy/1.0' },
    });
    clearTimeout(timeoutId);
    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// ============================================================================
// Source: health
// ============================================================================
function handleHealth() {
  return json({
    ok: true,
    service: 'macro-oracle-proxy',
    version: '1.0.1',
    timestamp: new Date().toISOString(),
    endpoints: ['health', 'dolar_all', 'bcra_all', 'bcra_inflacion'],
  });
}

// ============================================================================
// Source: dolar_all — DolarAPI.com.ar
// Returns: { ok, oficial, mep(bolsa), ccl, blue, tarjeta, cripto, mayorista, brecha_pct, realCount, timestamp }
// ============================================================================
async function handleDolarAll() {
  let realCount = 0;
  const stamp = new Date().toISOString();

  try {
    const res = await fetchWithTimeout(DOLARAPI_URL);
    if (!res.ok) {
      return json({
        ok: false,
        error: `DolarAPI HTTP ${res.status}`,
        realCount: 0,
        timestamp: stamp,
      }, 502);
    }

    const arr = await res.json();
    if (!Array.isArray(arr)) {
      return json({
        ok: false,
        error: 'DolarAPI returned non-array',
        realCount: 0,
        timestamp: stamp,
      }, 502);
    }

    // Map by casa name
    const byCasa = {};
    for (const item of arr) {
      if (item && item.casa) byCasa[item.casa] = item;
    }

    const build = (key) => {
      const item = byCasa[key];
      if (!item || typeof item.venta !== 'number') {
        return { ok: false, compra: null, venta: null, fecha: null, nombre: key };
      }
      realCount++;
      return {
        ok: true,
        compra: item.compra,
        venta: item.venta,
        fecha: item.fechaActualizacion || item.fecha || null,
        nombre: item.nombre || key,
      };
    };

    const oficial = build('oficial');
    const mep = build('bolsa') || build('mep');
    const ccl = build('contadoconliqui') || build('ccl');
    const blue = build('blue');
    const tarjeta = build('tarjeta');
    const cripto = build('cripto');
    const mayorista = build('mayorista');

    // Brecha cambiaria MEP vs Oficial
    let brecha_pct = null;
    if (oficial.ok && mep.ok && oficial.venta > 0) {
      brecha_pct = Number((((mep.venta - oficial.venta) / oficial.venta) * 100).toFixed(2));
    }

    return json({
      ok: realCount > 0,
      oficial,
      mep,
      ccl,
      blue,
      tarjeta,
      cripto,
      mayorista,
      brecha_pct,
      realCount,
      source: 'dolarapi.com',
      timestamp: stamp,
    });
  } catch (err) {
    return json({
      ok: false,
      error: String(err && err.message ? err.message : err),
      realCount: 0,
      timestamp: stamp,
    }, 502);
  }
}

// ============================================================================
// Source: bcra_all — TPM + BADLAR via apis.datos.gob.ar (BCRA v2 endpoint is deprecated as of 2026)
// Returns: { ok, realCount, data: { tpm, badlar, reservas, baseMonetaria }, timestamp }
// ============================================================================
async function fetchSingleSeries(seriesId, last = 5) {
  const url = `${DATOS_GOB_AR_BASE}/?ids=${seriesId}&last=${last}&format=json`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) return null;
  const payload = await res.json();
  const data = Array.isArray(payload?.data) ? payload.data : [];
  // find latest non-null value
  for (let i = data.length - 1; i >= 0; i--) {
    const point = data[i];
    if (Array.isArray(point) && point.length >= 2 && point[1] != null) {
      const value = Number(point[1]);
      if (!Number.isNaN(value)) {
        return { value, fecha: String(point[0]) };
      }
    }
  }
  return null;
}

async function handleBcraAll() {
  const stamp = new Date().toISOString();
  let realCount = 0;

  try {
    // Fetch TPM and BADLAR in parallel — separate calls because datos.gob.ar's
    // multi-series format ([date, val1, val2]) is awkward to parse and masks
    // null values when one series lags the other.
    const [tpmLatest, badlarLatest] = await Promise.all([
      fetchSingleSeries('89.2_TS_INTE_PM_0_D_16', 10).catch(() => null),
      fetchSingleSeries('89.2_TS_INTELAR_0_D_20', 5).catch(() => null),
    ]);

    const tpm = tpmLatest
      ? { ok: true, value: tpmLatest.value, fecha: tpmLatest.fecha, idVariable: null, descripcion: 'Tasa de Política Monetaria (TPM)' }
      : { ok: false, value: null, fecha: null, idVariable: null, descripcion: null };
    if (tpm.ok) realCount++;

    const badlar = badlarLatest
      ? { ok: true, value: badlarLatest.value, fecha: badlarLatest.fecha, idVariable: null, descripcion: 'BADLAR bancos privados' }
      : { ok: false, value: null, fecha: null, idVariable: null, descripcion: null };
    if (badlar.ok) realCount++;

    // Reservas and Base Monetaria are not available on the deprecated BCRA v2 endpoint.
    // Mark them as not-available (ok:false) — does NOT count toward realCount.
    const reservas = { ok: false, value: null, fecha: null, idVariable: null, descripcion: 'Reservas internacionales — BCRA v2 endpoint deprecado' };
    const baseMonetaria = { ok: false, value: null, fecha: null, idVariable: null, descripcion: 'Base monetaria — BCRA v2 endpoint deprecado' };

    return json({
      ok: realCount > 0,
      realCount,
      data: { tpm, badlar, reservas, baseMonetaria },
      source: 'apis.datos.gob.ar (BCRA series)',
      timestamp: stamp,
    });
  } catch (err) {
    return json({
      ok: false,
      error: String(err && err.message ? err.message : err),
      realCount: 0,
      data: {},
      timestamp: stamp,
    }, 502);
  }
}

// ============================================================================
// Source: bcra_inflacion — INDEC IPC via apis.datos.gob.ar
// Returns: { ok, lastMonthly, accumulated, series, timestamp }
// ============================================================================
async function handleBcraInflacion() {
  const stamp = new Date().toISOString();

  try {
    const url = `${DATOS_GOB_AR_BASE}/?ids=${INDEC_IPC_SERIES}&last=6&format=json`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      return json({
        ok: false,
        error: `datos.gob.ar HTTP ${res.status}`,
        lastMonthly: null,
        accumulated: null,
        series: [],
        timestamp: stamp,
      }, 502);
    }

    const payload = await res.json();
    const data = Array.isArray(payload?.data) ? payload.data : [];

    if (data.length === 0) {
      return json({
        ok: false,
        error: 'Empty IPC series',
        lastMonthly: null,
        accumulated: null,
        series: [],
        timestamp: stamp,
      }, 502);
    }

    // datos.gob.ar :percent_change returns DECIMAL form (0.0247 = 2.47%)
    // Convert to percent values for clarity
    const series = data.map((p) => ({
      date: String(p[0]),
      value: Number(p[1]) * 100, // decimal → percent
    }));

    const last = series[series.length - 1];
    const lastMonthly = last ? Number(last.value.toFixed(2)) : null;

    // Accumulated = product of (1 + monthly_percent/100) - 1, × 100
    let acc = 1;
    for (const p of series) {
      if (typeof p.value === 'number' && !Number.isNaN(p.value)) {
        acc *= (1 + p.value / 100);
      }
    }
    const accumulated = Number(((acc - 1) * 100).toFixed(2));

    return json({
      ok: true,
      lastMonthly,
      accumulated,
      series,
      source: 'apis.datos.gob.ar (INDEC IPC)',
      timestamp: stamp,
    });
  } catch (err) {
    return json({
      ok: false,
      error: String(err && err.message ? err.message : err),
      lastMonthly: null,
      accumulated: null,
      series: [],
      timestamp: stamp,
    }, 502);
  }
}

// ============================================================================
// Source: santander_funds — Santander AR public funds (currency=ARS)
// Returns the raw Santander response, plus { ok, realCount, timestamp } envelope.
// ============================================================================
async function handleSantanderFunds(urlObj) {
  const stamp = new Date().toISOString();
  const currency = (urlObj.searchParams.get('currency') || 'ARS').toUpperCase();

  try {
    const url = `${SANTANDER_FUNDS_URL}?currency=${currency}`;
    const res = await fetchWithTimeout(url, 25000);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return json({
        ok: false,
        error: `Santander HTTP ${res.status}`,
        status: res.status,
        preview: text.slice(0, 300),
        realCount: 0,
        timestamp: stamp,
      }, 502);
    }
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = await res.text();
      return json({
        ok: false,
        error: `Santander returned non-JSON content-type: ${contentType}`,
        preview: text.slice(0, 300),
        realCount: 0,
        timestamp: stamp,
      }, 502);
    }
    const payload = await res.json();
    // Santander API may return either an array of funds or an object with a funds key
    const funds = Array.isArray(payload) ? payload : (Array.isArray(payload?.funds) ? payload.funds : (Array.isArray(payload?.data) ? payload.data : []));
    return json({
      ok: true,
      realCount: funds.length,
      currency,
      funds,
      raw: Array.isArray(payload) ? null : payload,
      source: 'www.santander.com.ar (IBM API Connect)',
      timestamp: stamp,
    });
  } catch (err) {
    return json({
      ok: false,
      error: String(err && err.message ? err.message : err),
      realCount: 0,
      timestamp: stamp,
    }, 502);
  }
}

// ============================================================================
// Router
// ============================================================================
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const source = url.searchParams.get('source') || 'health';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (path !== '/api/proxy' && path !== '/') {
      return json({ ok: false, error: `Unknown path: ${path}` }, 404);
    }

    switch (source) {
      case 'health':
        return handleHealth();
      case 'dolar_all':
        return await handleDolarAll();
      case 'bcra_all':
        return await handleBcraAll();
      case 'bcra_inflacion':
        return await handleBcraInflacion();
      case 'santander_funds':
        return await handleSantanderFunds(url);
      default:
        return json({ ok: false, error: `Unknown source: ${source}` }, 400);
    }
  },
};
