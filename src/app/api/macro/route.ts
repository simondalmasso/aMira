import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { getMacroState, getScenariosFromMacro, applyStaleDegradation, getOverallDataLabel } from '@/lib/live-data';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

const PROXY_URL = (typeof process !== 'undefined' && process.env && (process.env.PROXY_URL || process.env.NEXT_PUBLIC_PROXY_URL)) || 'https://macro-oracle-proxy.simondalmasso44.workers.dev';
const PROXY_TIMEOUT_MS = 8000;

interface Fetcher { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> }
interface EnvWithProxy { MACRO_PROXY?: Fetcher }

function getMacroProxyBinding(): Fetcher | null {
  try {
    const env = getCloudflareContext().env as EnvWithProxy;
    return env.MACRO_PROXY && typeof env.MACRO_PROXY.fetch === 'function' ? env.MACRO_PROXY : null;
  } catch {
    return null;
  }
}

async function fetchProxy<T>(source: string): Promise<T | null> {
  const path = `/api/proxy?source=${source}`;
  const proxyBinding = getMacroProxyBinding();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
  try {
    const response = proxyBinding
      ? await proxyBinding.fetch(`https://macro-oracle-proxy.local${path}`, { signal: controller.signal, headers: { Accept: 'application/json' } })
      : await fetch(`${PROXY_URL.replace(/\/$/, '')}${path}`, { signal: controller.signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
    clearTimeout(timeoutId);
    if (!response.ok) {
      console.warn(`[macro][proxy:${source}] HTTP ${response.status} via ${proxyBinding ? 'binding' : 'url'}`);
      return null;
    }
    return await response.json() as T;
  } catch (error) {
    clearTimeout(timeoutId);
    console.warn(`[macro][proxy:${source}] fetch failed`, error);
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
interface BcraInflacionResponse { ok: boolean; lastMonthly: number | null; accumulated: number | null }

export async function GET() {
  try {
    const [rawMacro, bcraRes, fxRes, infRes] = await Promise.all([
      getMacroState(),
      fetchProxy<BcraAllResponse>('bcra_all'),
      fetchProxy<DolarAllResponse>('dolar_all'),
      fetchProxy<BcraInflacionResponse>('bcra_inflacion'),
    ]);
    const macro = applyStaleDegradation(rawMacro);

    const tpm = bcraRes?.ok && bcraRes.data?.tpm?.ok ? bcraRes.data.tpm.value : null;
    const badlar = bcraRes?.ok && bcraRes.data?.badlar?.ok ? bcraRes.data.badlar.value : null;
    const reservas = bcraRes?.ok && bcraRes.data?.reservas?.ok ? bcraRes.data.reservas.value : null;
    const ipc = infRes?.ok ? infRes.lastMonthly : null;
    const ipcAcumulado = infRes?.ok ? infRes.accumulated : null;
    const fxOficial = fxRes?.ok && fxRes.oficial?.ok ? fxRes.oficial.venta : null;
    const fxMep = fxRes?.ok && fxRes.mep?.ok ? fxRes.mep.venta : null;
    const fxCcl = fxRes?.ok && fxRes.ccl?.ok ? fxRes.ccl.venta : null;
    const fxBrecha = fxRes?.ok ? fxRes.brecha_pct : null;
    const fx = { oficial: fxOficial, mep: fxMep, ccl: fxCcl, brecha: fxBrecha };

    const proxyChecks = [tpm !== null, ipc !== null, fxOficial !== null, fxMep !== null, fxCcl !== null];
    const proxyRealCount = proxyChecks.filter(Boolean).length;
    const proxyRealPct = Math.round((proxyRealCount / proxyChecks.length) * 100);

    // Top-level source follows canonical field provenance. Proxy success never upgrades
    // reconstructed canonical fields to REAL; proxy freshness is reported separately.
    const source = getOverallDataLabel(macro);
    const realDataPct = macro.realDataPct;
    const scenarios = getScenariosFromMacro(macro);
    const carryReturn = (macro.rates.moneyMarket / 12) - macro.crawlingPeg;
    const spreadReal = macro.rates.moneyMarket - macro.inflation.yearly;

    return NextResponse.json({
      success: true,
      timestamp: macro.lastUpdate,
      fetchedAt: macro.fetchedAt,
      ageMinutes: macro.ageMinutes,
      lastSuccessfulFetch: macro.lastSuccessfulFetch,
      source,
      provenance: macro.provenance,
      realDataPct,
      tpm,
      badlar,
      reservas,
      ipc,
      ipcAcumulado,
      fx,
      proxy: {
        url: PROXY_URL,
        bcra: bcraRes?.ok === true,
        dolar: fxRes?.ok === true,
        inflacion: infRes?.ok === true,
        realCount: proxyRealCount,
        realPct: proxyRealPct,
        role: 'AUXILIARY_OBSERVED_FIELDS' as const,
      },
      mep: macro.mep,
      inflation: macro.inflation,
      rates: macro.rates,
      cer: macro.cer,
      crawlingPeg: macro.crawlingPeg,
      carry: {
        arsCarry30d: macro.rates.moneyMarket / 12,
        netCarry: carryReturn,
        viable: carryReturn > 0,
        spreadReal,
      },
      scenarios: scenarios.map((scenario) => ({
        id: scenario.id,
        name: scenario.name,
        emoji: scenario.emoji,
        probability: scenario.probability,
        inflation30d: scenario.inflation30d,
        devaluation30d: scenario.devaluation30d,
        description: scenario.description,
      })),
    });
  } catch (error) {
    console.error('[macro] endpoint failed', error);
    return NextResponse.json({ success: false, code: 'MACRO_FETCH_FAILED', error: 'Failed to fetch macro data', timestamp: new Date().toISOString() }, { status: 500 });
  }
}
