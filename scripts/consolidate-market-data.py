#!/usr/bin/env python3
"""
TASK_2 — Market Data Consolidation.

Goal: ONE MARKET PIPELINE.
  proxy/macro-proxy.js (only external fetcher)
  → src/lib/live-data.ts:getMacroState() (only aggregator)
  → consumers

Steps:
1. Add proxy-backed fetchers (fetchBCRAFromProxy, fetchCERFromProxy,
   fetchINDECFromProxy) and the BCRARates/CERData/INDECInflationData types
   INLINE into src/lib/live-data.ts.
2. Replace the 4 direct-fetch calls in getMacroState() with the proxy-backed
   equivalents.
3. Remove the direct Bluelytics fallback in fetchBluelytics (proxy-only).
4. Delete src/lib/bcra-api.ts.
5. Delete src/lib/indec-api.ts.
6. Migrate src/lib/oracle-multi/mep.ts to call fetchBluelytics from live-data
   (single MEP path).
7. Migrate src/app/api/oracle/single/route.ts to consume getMacroState().
8. Simplify src/app/api/macro/route.ts (drop parallel fetchProxy calls).
9. Migrate src/app/api/mep/route.ts (drop separate fetchBluelytics call).

We do this by surgical string edits to preserve the rest of live-data.ts
(1154 LOC) untouched.
"""

from pathlib import Path
import re

ROOT = Path('/home/z/my-project')
LIVE_DATA = ROOT / 'src/lib/live-data.ts'
BCRA_API = ROOT / 'src/lib/bcra-api.ts'
INDEC_API = ROOT / 'src/lib/indec-api.ts'
ORACLE_MULTI_MEP = ROOT / 'src/lib/oracle-multi/mep.ts'
API_ORACLE_SINGLE = ROOT / 'src/app/api/oracle/single/route.ts'
API_MACRO = ROOT / 'src/app/api/macro/route.ts'
API_MEP = ROOT / 'src/app/api/mep/route.ts'

# --- 1. Read live-data.ts ---
ld_text = LIVE_DATA.read_text()

# --- 2. Replace the bcra-api + indec-api imports with inline types ---
# Existing import block (lines 10-13):
#   import { fetchBCRAData, fetchCERData, type BCRARates, type CERData } from './bcra-api';
#   import { fetchINDECInflation, type INDECInflationData } from './indec-api';
old_imports = """import { fetchBCRAData, fetchCERData, type BCRARates, type CERData } from './bcra-api';
import { fetchINDECInflation, type INDECInflationData } from './indec-api';"""

# New: type definitions + proxy fetchers inlined
new_imports = """// ─── TASK_2 CONSOLIDATION: bcra-api.ts + indec-api.ts DELETED ─────────────
// Types and proxy-backed fetchers are now INLINE in this file. There is no
// other market-data fetcher in the system — the Cloudflare proxy
// (proxy/macro-proxy.js) is the SOLE external data source.

// BCRARates — produced by adapting proxy `bcra_all` response
export interface BCRARates {
  bcraPolicyTNA: number;     // TPM (percent)
  badlarTNA: number;         // BADLAR (percent)
  lecapsTNA: number;         // Lecaps (percent, derived)
  officialRate: number;      // FX official (ARS/USD)
  reservesUSD: number;       // Reservas internacionales (USD)
  isReal: boolean;
  dataDate: string | null;
  sourceUrl: string;
}

// CERData — produced by adapting proxy `bcra_cer` response
export interface CERData {
  index: number;
  monthlyChange: number;     // percent
  dailyChange: number;       // percent
  isReal: boolean;
  dataDate: string | null;
  sourceUrl: string;
}

// INDECInflationData — produced by adapting proxy `bcra_inflacion` response
export interface INDECInflationData {
  lastMonthInflation: number;     // percent
  projected30d: number;           // percent
  projected90d: number;           // percent
  twelveMonthAccum: number;       // percent
  isReal: boolean;
  dataDate: string | null;
  sourceUrl: string;
}

// ─── Proxy client (single fetch path) ─────────────────────────────────────
// Reads NEXT_PUBLIC_PROXY_URL or PROXY_URL. Same Service Binding logic as
// /api/macro/route.ts but lives in the lib layer so all consumers go through
// this single function.

function getProxyBaseUrl(): string {
  if (typeof process !== 'undefined' && process.env) {
    return (process.env.NEXT_PUBLIC_PROXY_URL || process.env.PROXY_URL || '').replace(/\\/$/, '');
  }
  return '';
}

async function fetchProxySource<T = unknown>(source: string, timeoutMs = 8000): Promise<T | null> {
  const proxyUrl = getProxyBaseUrl();
  if (!proxyUrl) {
    console.warn(`[live-data][proxy:${source}] no PROXY_URL configured`);
    return null;
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${proxyUrl}/api/proxy?source=${source}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      console.warn(`[live-data][proxy:${source}] HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn(`[live-data][proxy:${source}] FETCH FAILED — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ─── Proxy adapters: shape proxy responses → BCRARates/CERData/INDECInflationData ──

interface ProxyBcraAllResponse {
  ok: boolean;
  data: {
    tpm: { ok: boolean; value: number | null; fecha: string | null };
    badlar: { ok: boolean; value: number | null; fecha: string | null };
    reservas: { ok: boolean; value: number | null; fecha: string | null };
  };
}

interface ProxyBcraCerResponse {
  ok: boolean;
  lastValue: number | null;
  series: { date: string; value: number }[];
}

interface ProxyBcraInflacionResponse {
  ok: boolean;
  lastMonthly: number | null;
  accumulated: number | null;
  series: { date: string; value: number }[];
}

async function fetchBCRAFromProxy(): Promise<BCRARates> {
  const resp = await fetchProxySource<ProxyBcraAllResponse>('bcra_all');
  const fallback: BCRARates = {
    bcraPolicyTNA: 20.0,
    badlarTNA: 22.0,
    lecapsTNA: 25.0,
    officialRate: 1440,
    reservesUSD: 26000,
    isReal: false,
    dataDate: null,
    sourceUrl: 'proxy:bcra_all',
  };
  if (!resp || !resp.ok || !resp.data) return fallback;
  const tpm = resp.data.tpm?.ok ? resp.data.tpm.value : null;
  const badlar = resp.data.badlar?.ok ? resp.data.badlar.value : null;
  const reservas = resp.data.reservas?.ok ? resp.data.reservas.value : null;
  if (tpm == null && badlar == null) return fallback;
  return {
    bcraPolicyTNA: tpm ?? 20.0,
    badlarTNA: badlar ?? 22.0,
    lecapsTNA: (badlar ?? 22.0) + 3,  // Lecaps typically 3pp above BADLAR
    officialRate: 1440,  // official rate comes from dolar_all, not bcra_all
    reservesUSD: reservas ?? 26000,
    isReal: tpm != null || badlar != null,
    dataDate: resp.data.tpm?.fecha ?? resp.data.badlar?.fecha ?? null,
    sourceUrl: 'proxy:bcra_all',
  };
}

async function fetchCERFromProxy(): Promise<CERData> {
  const resp = await fetchProxySource<ProxyBcraCerResponse>('bcra_cer');
  const fallback: CERData = {
    index: 786.37,
    monthlyChange: 2.2,
    dailyChange: 0.07,
    isReal: false,
    dataDate: null,
    sourceUrl: 'proxy:bcra_cer',
  };
  if (!resp || !resp.ok || !resp.lastValue || !resp.series || resp.series.length === 0) return fallback;
  const series = resp.series;
  const last = series[series.length - 1];
  // Daily change: last vs previous
  const prev = series.length >= 2 ? series[series.length - 2] : null;
  const dailyChange = prev && prev.value > 0 ? ((last.value - prev.value) / prev.value) * 100 : 0.07;
  // Monthly change: last vs ~30 days ago
  const monthAgoIdx = Math.max(0, series.length - 22);  // ~22 trading days
  const monthAgo = series[monthAgoIdx];
  const monthlyChange = monthAgo && monthAgo.value > 0 ? ((last.value - monthAgo.value) / monthAgo.value) * 100 : 2.2;
  return {
    index: last.value,
    monthlyChange: Number(monthlyChange.toFixed(2)),
    dailyChange: Number(dailyChange.toFixed(4)),
    isReal: true,
    dataDate: last.date,
    sourceUrl: 'proxy:bcra_cer',
  };
}

async function fetchINDECFromProxy(): Promise<INDECInflationData> {
  const resp = await fetchProxySource<ProxyBcraInflacionResponse>('bcra_inflacion');
  const fallback: INDECInflationData = {
    lastMonthInflation: 2.5,
    projected30d: 2.3,
    projected90d: 2.1,
    twelveMonthAccum: 30.5,
    isReal: false,
    dataDate: null,
    sourceUrl: 'proxy:bcra_inflacion',
  };
  if (!resp || !resp.ok || resp.lastMonthly == null) return fallback;
  const lastMonthly = resp.lastMonthly;
  const accumulated = resp.accumulated ?? 30.5;
  // Use last 12 months of the series to compute 12-month accumulated
  let twelveMonthAccum = accumulated;
  if (resp.series && resp.series.length > 0) {
    const last12 = resp.series.slice(-12);
    let prod = 1;
    for (const p of last12) {
      if (typeof p.value === 'number' && !Number.isNaN(p.value)) {
        prod *= (1 + p.value / 100);
      }
    }
    twelveMonthAccum = Number(((prod - 1) * 100).toFixed(2));
  }
  const dataDate = resp.series && resp.series.length > 0 ? resp.series[resp.series.length - 1].date : null;
  return {
    lastMonthInflation: lastMonthly,
    projected30d: lastMonthly,  // Use lastMonthly as projection (no separate model)
    projected90d: Number((lastMonthly * 3).toFixed(2)),
    twelveMonthAccum,
    isReal: true,
    dataDate,
    sourceUrl: 'proxy:bcra_inflacion',
  };
}"""

if old_imports not in ld_text:
    raise SystemExit("Could not find bcra-api + indec-api imports block")

ld_text = ld_text.replace(old_imports, new_imports)

# --- 3. Replace the 4 fetch calls in getMacroState() ---
old_fetches = """  // ─── Fetch all data sources in parallel ───
  const fetchStartTime = Date.now();
  const [bluelytics, bcraData, cerData, indecData] = await Promise.all([
    fetchBluelytics(),
    fetchBCRAData(),
    fetchCERData(),
    fetchINDECInflation(),
  ]);"""

new_fetches = """  // ─── TASK_2 CONSOLIDATION: ALL data sources go through the Cloudflare proxy.
  // No direct fetches to datos.gob.ar, api.bcra.gob.ar, or api.bluelytics.com.ar.
  // fetchBluelytics already uses proxy dolar_all; the other three are new
  // proxy-backed fetchers inlined in this file.
  // ─── Fetch all data sources in parallel ───
  const fetchStartTime = Date.now();
  const [bluelytics, bcraData, cerData, indecData] = await Promise.all([
    fetchBluelytics(),
    fetchBCRAFromProxy(),
    fetchCERFromProxy(),
    fetchINDECFromProxy(),
  ]);"""

if old_fetches not in ld_text:
    raise SystemExit("Could not find getMacroState() parallel fetch block")

ld_text = ld_text.replace(old_fetches, new_fetches)

# --- 4. Remove the direct Bluelytics fallback in fetchBluelytics ---
# Find the fallback block: "  // ─── Fallback: direct Bluelytics fetch ───" ... up to the closing "}"
old_bluelytics_fallback = """  // ─── Fallback: direct Bluelytics fetch ───
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
}"""

new_bluelytics_fallback = """  // ─── TASK_2 CONSOLIDATION: direct Bluelytics fetch REMOVED.
  // The proxy (proxy/macro-proxy.js) is the SOLE external data source.
  // If the proxy is unreachable, return null and let getMacroState() handle
  // the STALE degradation via getModelFallback().
  return null;
}"""

if old_bluelytics_fallback not in ld_text:
    raise SystemExit("Could not find fetchBluelytics direct fallback block")

ld_text = ld_text.replace(old_bluelytics_fallback, new_bluelytics_fallback)

LIVE_DATA.write_text(ld_text)
print(f"OK: live-data.ts updated ({len(ld_text)} chars)")

# --- 5. Delete bcra-api.ts and indec-api.ts ---
BCRA_API.unlink()
print(f"OK: deleted {BCRA_API}")
INDEC_API.unlink()
print(f"OK: deleted {INDEC_API}")

# --- 6. Rewrite oracle-multi/mep.ts to call fetchBluelytics from live-data ---
ORACLE_MULTI_MEP.write_text("""// src/lib/oracle-multi/mep.ts
// TASK_2 CONSOLIDATION: This file is now a thin adapter over fetchBluelytics
// from ../live-data. There is no longer a separate Bluelytics fetch path —
// all MEP fetching goes through the Cloudflare proxy via fetchBluelytics.

import { fetchBluelytics } from '../live-data';

export interface MepResult {
  rate: number;        // ARS per USD
  source: string;
  ok: boolean;
  error?: string;
}

/**
 * Fetch MEP rate.
 * TASK_2: delegates to fetchBluelytics (proxy-backed, single source of truth).
 */
export async function fetchMepRate(): Promise<MepResult> {
  try {
    const blue = await fetchBluelytics();
    if (blue && blue.blue && (blue.blue.value_sell || blue.blue.value_avg)) {
      const rate = blue.blue.value_sell ?? blue.blue.value_avg ?? 0;
      if (rate > 0) return { rate, source: 'proxy:dolar_all', ok: true };
    }
    return {
      rate: 1500,
      source: 'fallback_default_1500',
      ok: false,
      error: 'fetchBluelytics returned no rate',
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      rate: 1500,
      source: 'fallback_default_1500',
      ok: false,
      error: `fetchBluelytics: ${msg}`,
    };
  }
}
""")
print(f"OK: oracle-multi/mep.ts rewritten as thin adapter")

# --- 7. Migrate /api/oracle/single to consume getMacroState() ---
API_ORACLE_SINGLE.write_text("""// src/app/api/oracle/single/route.ts
// oracle_santander_v1_bloomberg_minimal — CANONICAL ENDPOINT
//
// TASK_2 CONSOLIDATION: No longer calls fetchBCRAData + fetchBluelytics
// directly. Consumes getMacroState() from @/lib/live-data — the SINGLE
// market data aggregator backed by the Cloudflare proxy.

import { NextResponse } from 'next/server';
import { runSinglePass } from '@/lib/single-pass-oracle-engine';
import { getLearningState } from '@/lib/closed-loop-learning';
import { getMacroState } from '@/lib/live-data';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

export async function GET() {
  try {
    // TASK_2: getMacroState() is the SINGLE market data aggregator.
    // It fetches BCRA + CER + INDEC + FX via the Cloudflare proxy (no direct
    // fetches to datos.gob.ar / api.bcra.gob.ar / api.bluelytics.com.ar).
    const macro = await getMacroState();

    const fx_mep = macro.mep.rate;
    const rates_tna = macro.rates.bcraPolicy / 100;  // percent → fractional
    const inflation_monthly = macro.inflation.monthly / 100;  // percent → fractional
    const reserves_usd = 26000;  // placeholder — proxy bcra_all still returns ok:false for reservas
    const reserves_usd_prev = reserves_usd;

    // FX gap (MEP vs official) — risk sentiment input
    const official = macro.mep.officialRate;
    const fx_gap_pct = macro.mep.gap;

    // Sources come from provenance — count which were REAL
    const sources: string[] = [];
    if (macro.provenance.mepRate.label === 'REAL') sources.push('BLUELYTICS_FX');
    if (macro.provenance.rates.label === 'REAL') sources.push('BCRA_API');
    if (macro.provenance.inflation.label === 'REAL') sources.push('INDEC_SERIES');
    sources.push('LOCAL_MARKET_PRICES');

    const quality: 'REAL' | 'PARTIAL_FALLBACK' | 'STALE' =
      sources.length >= 3 ? 'REAL' : sources.length >= 2 ? 'PARTIAL_FALLBACK' : 'STALE';

    // Run the single pass — deterministic
    const vector = runSinglePass({
      fx_mep,
      inflation_monthly,
      rates_tna,
      reserves_usd,
      reserves_usd_prev,
      fx_gap_pct,
      market_breadth: 0.5,  // placeholder — local market breadth would come from a market data feed
      sources,
      quality,
    });

    const learning = getLearningState();

    return NextResponse.json({
      success: true,
      vector,
      learning,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'unknown error',
      },
      { status: 500 }
    );
  }
}
""")
print(f"OK: /api/oracle/single rewritten to use getMacroState()")

# --- 8. Simplify /api/macro to drop parallel fetchProxy calls ---
# Now that getMacroState() uses the proxy internally, /api/macro just needs to
# shape the MacroState into the response. The top-level tpm/ipc/fx fields come
# directly from MacroState (mep/inflation/rates/cer fields).
API_MACRO.write_text("""// src/app/api/macro/route.ts
// TASK_2 CONSOLIDATION: /api/macro is now a THIN shaper over getMacroState().
// No more parallel fetchProxy calls — getMacroState() already sources 100%
// from the Cloudflare proxy. This file just shapes the MacroState into the
// response contract that hedge-fund-store:fetchMacro expects.

import { NextResponse } from 'next/server';
import { getMacroState, getScenariosFromMacro, applyStaleDegradation } from '@/lib/live-data';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

export async function GET() {
  try {
    const macro = await getMacroState();

    // Top-level fields derived from MacroState (no more parallel fetchProxy)
    const tpm = macro.rates.bcraPolicy;
    const badlar = macro.rates.badlar;
    const reservas = null;  // proxy bcra_all still returns ok:false for reservas (BCRA v2 deprecated)
    const ipc = macro.inflation.monthly;
    const ipcAcumulado = macro.inflation.yearly;

    const fx = {
      oficial: macro.mep.officialRate,
      mep: macro.mep.rate,
      ccl: macro.mep.rate,  // proxy dolar_all has ccl but MacroState doesn't expose it; use mep as proxy
      brecha: macro.mep.gap,
    };

    // Apply STALE degradation before returning
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
      source: freshMacro.source,
      provenance: freshMacro.provenance,
      realDataPct: freshMacro.realDataPct,

      // Top-level fields
      tpm,
      badlar,
      reservas,
      ipc,
      ipcAcumulado,
      fx,

      // SA-01: real dataDates from provenance
      proxyFechas: {
        tpm: freshMacro.provenance.rates.dataDate,
        badlar: freshMacro.provenance.rates.dataDate,
        reservas: null,
        ipc: freshMacro.provenance.inflation.dataDate,
        fxOficial: freshMacro.provenance.mepRate.dataDate,
        fxMep: freshMacro.provenance.mepRate.dataDate,
        fxCcl: freshMacro.provenance.mepRate.dataDate,
      },

      // Proxy freshness telemetry
      proxy: {
        bcra: freshMacro.provenance.rates.label === 'REAL',
        dolar: freshMacro.provenance.mepRate.label === 'REAL',
        inflacion: freshMacro.provenance.inflation.label === 'REAL',
        realCount: [
          freshMacro.provenance.rates.label === 'REAL',
          freshMacro.provenance.mepRate.label === 'REAL',
          freshMacro.provenance.inflation.label === 'REAL',
          freshMacro.provenance.cer.label === 'REAL',
        ].filter(Boolean).length,
        realPct: freshMacro.realDataPct,
      },

      // Legacy fields (kept for backward compat)
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
""")
print(f"OK: /api/macro simplified (no parallel fetchProxy)")

# --- 9. Migrate /api/mep ---
# Read current /api/mep and replace its separate fetchBluelytics call
mep_text = API_MEP.read_text()
# Simplest: just have /api/mep consume getMacroState().mep instead of fetching
API_MACRO_mep = """// src/app/api/mep/route.ts
// TASK_2 CONSOLIDATION: /api/mep is now a thin shaper over getMacroState().
// No separate fetchBluelytics call — MEP comes from MacroState.mep.

import { NextResponse } from 'next/server';
import { getMacroState } from '@/lib/live-data';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

export async function GET() {
  try {
    const macro = await getMacroState();
    return NextResponse.json({
      success: true,
      mep: macro.mep.rate,
      officialRate: macro.mep.officialRate,
      gap: macro.mep.gap,
      source: macro.source,
      timestamp: macro.lastUpdate,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'unknown error',
      },
      { status: 500 }
    );
  }
}
"""
API_MEP.write_text(API_MACRO_mep)
print(f"OK: /api/mep rewritten as thin shaper over getMacroState()")

print("\nTASK_2 market data consolidation complete.")
print("Deleted files:")
print(f"  - {BCRA_API.relative_to(ROOT)}")
print(f"  - {INDEC_API.relative_to(ROOT)}")
print("Modified files:")
print(f"  - {LIVE_DATA.relative_to(ROOT)} (proxy-backed fetchers inlined)")
print(f"  - {ORACLE_MULTI_MEP.relative_to(ROOT)} (thin adapter over fetchBluelytics)")
print(f"  - {API_ORACLE_SINGLE.relative_to(ROOT)} (consumes getMacroState)")
print(f"  - {API_MACRO.relative_to(ROOT)} (no parallel fetchProxy)")
print(f"  - {API_MEP.relative_to(ROOT)} (thin shaper over getMacroState)")
