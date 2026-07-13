// ============================================================================
// data-client.ts
// Frontend/server client for the macro-oracle-proxy Cloudflare Worker.
//
// ENV:
//   - NEXT_PUBLIC_PROXY_URL  (browser + server, public)
//   - PROXY_URL              (server-only fallback for Worker runtime)
//
// If neither env var is set OR all proxy calls fail, fetchAll() returns a
// STALE-shaped payload so the dashboard can render [STALE] badges instead of
// crashing or showing [ERROR].
//
// Usage:
//   import { fetchAll } from '@/lib/data-client';
//   const data = await fetchAll();
//   console.log(data.realPct, data.fx.mep.venta, data.bcra.data.tpm.value);
// ============================================================================

const PROXY_URL =
  (typeof process !== 'undefined' && process.env && (process.env.NEXT_PUBLIC_PROXY_URL || process.env.PROXY_URL)) ||
  '';

export interface ProxyOk<T> {
  ok: true;
  data: T;
}
export interface ProxyErr {
  ok: false;
  error: string;
}
export type ProxyResult<T> = ProxyOk<T> | ProxyErr;

// ─── Per-source shapes ───
export interface FxQuote {
  ok: boolean;
  compra: number | null;
  venta: number | null;
  fecha: string | null;
  nombre?: string;
}
export interface DolarAllPayload {
  ok: boolean;
  oficial: FxQuote;
  mep: FxQuote;
  ccl: FxQuote;
  blue: FxQuote;
  tarjeta: FxQuote;
  cripto: FxQuote;
  mayorista: FxQuote;
  brecha_pct: number | null;
  realCount: number;
  source: string;
  timestamp: string;
}
export interface BcraVariable {
  ok: boolean;
  value: number | null;
  fecha: string | null;
  idVariable: number | null;
  descripcion: string | null;
}
export interface BcraAllPayload {
  ok: boolean;
  realCount: number;
  data: {
    tpm: BcraVariable;
    badlar: BcraVariable;
    reservas: BcraVariable;
    baseMonetaria: BcraVariable;
  };
  source: string;
  timestamp: string;
}
export interface InflacionPayload {
  ok: boolean;
  lastMonthly: number | null;
  accumulated: number | null;
  series: { date: string; value: number }[];
  source: string;
  timestamp: string;
}

// ─── Unified payload returned by fetchAll() ───
export interface MacroDataPayload {
  ok: boolean;
  fx: DolarAllPayload | null;
  bcra: BcraAllPayload | null;
  inflacion: InflacionPayload | null;
  realCount: number;
  realPct: number; // 0-100
  overallCategory: 'REAL' | 'PARTIAL_FALLBACK' | 'STALE' | 'ERROR';
  timestamp: string;
  proxyUrl: string;
}

// ============================================================================
// Internal fetch with timeout + STALE fallback
// ============================================================================
async function fetchSource<T>(source: string): Promise<T | null> {
  if (!PROXY_URL) {
    console.warn('[data-client] PROXY_URL not set — returning STALE for', source);
    return null;
  }
  try {
    const url = `${PROXY_URL.replace(/\/$/, '')}/api/proxy?source=${source}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 9000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      console.warn(`[data-client] ${source} → HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    return json as T;
  } catch (err) {
    console.warn(`[data-client] ${source} failed:`, err);
    return null;
  }
}

// ============================================================================
// fetchAll — calls all 3 sources in parallel, builds unified payload
// ============================================================================
export async function fetchAll(): Promise<MacroDataPayload> {
  const [fx, bcra, inflacion] = await Promise.all([
    fetchSource<DolarAllPayload>('dolar_all'),
    fetchSource<BcraAllPayload>('bcra_all'),
    fetchSource<InflacionPayload>('bcra_inflacion'),
  ]);

  // realCount aggregates ok sources across all 3 endpoints
  let realCount = 0;
  if (fx && fx.ok) realCount += Math.min(fx.realCount, 4); // cap fx at 4 (oficial+mep+ccl+blue)
  if (bcra && bcra.ok) realCount += bcra.realCount;
  if (inflacion && inflacion.ok) realCount += 1;

  // Maximum possible = 4 (fx) + 4 (bcra) + 1 (inflacion) = 9
  const realPct = Math.round((realCount / 9) * 100);

  let overallCategory: MacroDataPayload['overallCategory'] = 'ERROR';
  if (realCount >= 6) overallCategory = 'REAL';
  else if (realCount >= 3) overallCategory = 'PARTIAL_FALLBACK';
  else if (realCount > 0) overallCategory = 'PARTIAL_FALLBACK';
  else overallCategory = 'STALE';

  return {
    ok: realCount > 0,
    fx,
    bcra,
    inflacion,
    realCount,
    realPct,
    overallCategory,
    timestamp: new Date().toISOString(),
    proxyUrl: PROXY_URL || '(unset)',
  };
}

// ============================================================================
// Convenience: fetch a single source
// ============================================================================
export async function fetchDolarAll(): Promise<DolarAllPayload | null> {
  return fetchSource<DolarAllPayload>('dolar_all');
}
export async function fetchBcraAll(): Promise<BcraAllPayload | null> {
  return fetchSource<BcraAllPayload>('bcra_all');
}
export async function fetchInflacion(): Promise<InflacionPayload | null> {
  return fetchSource<InflacionPayload>('bcra_inflacion');
}

// Health probe — useful for status checks
export async function fetchProxyHealth(): Promise<boolean> {
  try {
    const r = await fetchSource<{ ok: boolean; service: string }>('health');
    return !!(r && r.ok);
  } catch {
    return false;
  }
}

export const PROXY_ENDPOINT = PROXY_URL || '';
