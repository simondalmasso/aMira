import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { getMacroState, getScenariosFromMacro, applyStaleDegradation } from '@/lib/live-data';

// ============================================================================
// /api/macro — Canonical macro endpoint
// ----------------------------------------------------------------------------
// Calls the macro-oracle-proxy Worker IN PARALLEL with getMacroState() so the
// response exposes top-level `tpm`, `ipc`, `fx`, `source`, `realDataPct`
// fields driven by REAL proxy data (instead of model fallbacks).
//
// IMPORTANT: CF Workers in the same account can NOT reliably fetch each other
// via public *.workers.dev URLs — the edge returns 404 to sibling workers.
// We use a Service Binding (env.MACRO_PROXY) instead, which routes the call
// directly to the target Worker's fetch handler, bypassing the public edge.
//
// Backward compatibility: every legacy field (mep, inflation, rates, cer,
// carry, scenarios, provenance) is still returned untouched.
// ============================================================================

export const dynamic = 'force-dynamic';
export const revalidate = 60;

const PROXY_URL =
  (typeof process !== 'undefined' && process.env && (process.env.PROXY_URL || process.env.NEXT_PUBLIC_PROXY_URL)) ||
  'https://macro-oracle-proxy.simondalmasso44.workers.dev';

const PROXY_TIMEOUT_MS = 8000;

// Service Binding shape — provided by wrangler.jsonc `services` config
interface Fetcher {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

interface EnvWithProxy {
  MACRO_PROXY?: Fetcher;
}

function getMacroProxyBinding(): Fetcher | null {
  try {
    const ctx = getCloudflareContext();
    const env = ctx.env as EnvWithProxy;
    if (env?.MACRO_PROXY && typeof env.MACRO_PROXY.fetch === 'function') {
      return env.MACRO_PROXY;
    }
  } catch {
    /* outside Worker runtime — fall back to public URL */
  }
  return null;
}

async function fetchProxy<T = unknown>(source: string): Promise<T | null> {
  const path = `/api/proxy?source=${source}`;
  const proxyBinding = getMacroProxyBinding();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

  try {
    let res: Response;
    if (proxyBinding) {
      // ─── Service Binding path (preferred) ───
      // Service bindings route by binding name, not by URL. The URL just needs
      // to be a valid absolute URL — the host is ignored by the binding.
      res = await proxyBinding.fetch(`https://macro-oracle-proxy.local${path}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
    } else {
      // ─── Fallback: public URL (works from non-Worker runtimes) ───
      res = await fetch(`${PROXY_URL.replace(/\/$/, '')}${path}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
    }
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`[macro][proxy:${source}] HTTP ${res.status} via ${proxyBinding ? 'binding' : 'url'}`);
      return null;
    }
    const json = (await res.json()) as T;
    console.log(`[macro][proxy:${source}] OK via ${proxyBinding ? 'binding' : 'url'}`);
    return json;
  } catch (err) {
    clearTimeout(timeoutId);
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.warn(`[macro][proxy:${source}] FETCH FAILED — ${msg}`);
    return null;
  }
}

interface BcraAllResponse {
  ok: boolean;
  realCount: number;
  data: {
    tpm: { ok: boolean; value: number | null; fecha: string | null };
    badlar: { ok: boolean; value: number | null; fecha: string | null };
    reservas: { ok: boolean; value: number | null; fecha: string | null };
    baseMonetaria: { ok: boolean; value: number | null; fecha: string | null };
  };
}

interface DolarAllResponse {
  ok: boolean;
  realCount: number;
  oficial: { ok: boolean; compra: number | null; venta: number | null; fecha: string | null };
  mep: { ok: boolean; compra: number | null; venta: number | null; fecha: string | null };
  ccl: { ok: boolean; compra: number | null; venta: number | null; fecha: string | null };
  blue: { ok: boolean; compra: number | null; venta: number | null; fecha: string | null };
  brecha_pct: number | null;
}

interface BcraInflacionResponse {
  ok: boolean;
  lastMonthly: number | null;
  accumulated: number | null;
}

export async function GET() {
  try {
    // ─── Parallel: legacy macro state + 3 proxy calls ───
    const [macro, bcraRes, fxRes, infRes] = await Promise.all([
      getMacroState(),
      fetchProxy<BcraAllResponse>('bcra_all'),
      fetchProxy<DolarAllResponse>('dolar_all'),
      fetchProxy<BcraInflacionResponse>('bcra_inflacion'),
    ]);

    // ─── Map proxy responses to top-level fields ───
    const tpm = bcraRes?.ok && bcraRes.data?.tpm?.ok ? bcraRes.data.tpm.value : null;
    const badlar = bcraRes?.ok && bcraRes.data?.badlar?.ok ? bcraRes.data.badlar.value : null;
    const reservas = bcraRes?.ok && bcraRes.data?.reservas?.ok ? bcraRes.data.reservas.value : null;

    const ipc = infRes?.ok ? infRes.lastMonthly : null;
    const ipcAcumulado = infRes?.ok ? infRes.accumulated : null;

    const fxOficial = fxRes?.ok && fxRes.oficial?.ok ? fxRes.oficial.venta : null;
    const fxMep = fxRes?.ok && fxRes.mep?.ok ? fxRes.mep.venta : null;
    const fxCcl = fxRes?.ok && fxRes.ccl?.ok ? fxRes.ccl.venta : null;
    const fxBrecha = fxRes?.ok ? fxRes.brecha_pct : null;

    const fx = {
      oficial: fxOficial,
      mep: fxMep,
      ccl: fxCcl,
      brecha: fxBrecha,
    };

    // ─── Compute dynamic realDataPct from proxy success count ───
    // 5 independent real data points: tpm, ipc, fx_oficial, fx_mep, fx_ccl
    const proxyChecks = [
      tpm !== null,
      ipc !== null,
      fxOficial !== null,
      fxMep !== null,
      fxCcl !== null,
    ];
    const proxyRealCount = proxyChecks.filter(Boolean).length;
    const proxyRealPct = Math.round((proxyRealCount / proxyChecks.length) * 100);

    // Determine overall source label based on proxy + legacy realDataPct
    const legacyRealPct = macro.realDataPct ?? 0;
    const realDataPct = Math.max(proxyRealPct, legacyRealPct);
    const source =
      proxyRealCount === proxyChecks.length
        ? 'REAL'
        : proxyRealCount >= 3
          ? 'REAL'
          : proxyRealCount >= 1
            ? 'PARTIAL_FALLBACK'
            : macro.source || 'STALE';

    // ─── Apply STALE degradation before returning ───
    const freshMacro = applyStaleDegradation(macro);

    const scenarios = getScenariosFromMacro(freshMacro);
    const carryReturn = (freshMacro.rates.moneyMarket / 12) - freshMacro.crawlingPeg;
    const spreadReal = freshMacro.rates.moneyMarket - freshMacro.inflation.yearly;

    return NextResponse.json({
      success: true,
      timestamp: freshMacro.lastUpdate,
      fetchedAt: freshMacro.fetchedAt,
      ageMinutes: freshMacro.ageMinutes,
      lastSuccessfulFetch: freshMacro.lastSuccessfulFetch,
      source,
      provenance: freshMacro.provenance,
      realDataPct,

      // ─── NEW top-level fields driven by proxy (the user-requested ones) ───
      tpm,
      badlar,
      reservas,
      ipc,
      ipcAcumulado,
      fx,

      // ─── Proxy freshness telemetry (for debugging) ───
      proxy: {
        url: PROXY_URL,
        bcra: bcraRes?.ok === true,
        dolar: fxRes?.ok === true,
        inflacion: infRes?.ok === true,
        realCount: proxyRealCount,
        realPct: proxyRealPct,
      },

      // ─── Legacy fields (kept for backward compat) ───
      mep: freshMacro.mep,
      inflation: freshMacro.inflation,
      rates: freshMacro.rates,
      cer: freshMacro.cer,
      crawlingPeg: freshMacro.crawlingPeg,
      carry: {
        arsCarry30d: freshMacro.rates.moneyMarket / 12,
        netCarry: carryReturn,
        viable: carryReturn > 0,
        spreadReal,
      },
      scenarios: scenarios.map((s) => ({
        id: s.id,
        name: s.name,
        emoji: s.emoji,
        probability: s.probability,
        inflation30d: s.inflation30d,
        devaluation30d: s.devaluation30d,
        description: s.description,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch macro data',
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
