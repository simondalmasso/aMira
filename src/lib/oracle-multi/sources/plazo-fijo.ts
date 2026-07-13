// src/lib/oracle-multi/sources/plazo-fijo.ts
// Plazo Fijo — argentinadatos.com /v1/finanzas/tasas/plazoFijo
// Returns real bank TNA rates (Banco Nación, Galicia, BBVA, Santander, etc.)
// Source confidence: 0.95 (regulatory BCRA-sourced, JSON, no-auth).

import type { NormalizedAsset } from '../types';

const ENDPOINT = 'https://api.argentinadatos.com/v1/finanzas/tasas/plazoFijo';
const TIMEOUT_MS = 12000;

interface PlazoFijoRecord {
  entidad: string;
  logo?: string | null;
  tnaClientes: number;   // e.g. 0.19 = 19% TNA
  tnaNoClientes: number; // 0 when not published
  enlace?: string | null;
}

export interface PlazoFijoSourceResult {
  assets: NormalizedAsset[];
  errors: string[];
  fallback_chain: string[];
  total_raw: number;
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      headers: {
        'User-Agent': 'santaninverter-oracle/4.0 (+https://santaninverter-oracle.simondalmasso44.workers.dev)',
        Accept: 'application/json',
      },
      signal: controller.signal,
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchPlazoFijoAssets(): Promise<PlazoFijoSourceResult> {
  const errors: string[] = [];
  const fallback_chain: string[] = ['pf_primary_fetch'];

  try {
    const res = await fetchWithTimeout(ENDPOINT, TIMEOUT_MS);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as PlazoFijoRecord[];
    if (!Array.isArray(data)) {
      throw new Error('Response is not an array');
    }

    const today = new Date().toISOString().slice(0, 10);
    const assets: NormalizedAsset[] = data
      .filter((r) => typeof r.tnaClientes === 'number' && r.tnaClientes > 0)
      .map((r) => {
        // Use the higher of clientes/no-clientes (more conservative — what most retail depositors can access)
        const tna = Math.max(r.tnaClientes, r.tnaNoClientes || 0);
        const bankSlug = r.entidad
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '')
          .slice(0, 40);
        return {
          id: `PLAZO_FIJO:${bankSlug}`,
          asset_class: 'PLAZO_FIJO' as const,
          name: r.entidad,
          ticker: bankSlug.toUpperCase(),
          sub_category: 'plazo_fijo_tradicional_30d',
          currency: 'ARS' as const,
          date: today,
          // Store TNA as fractional (0.19 = 19%)
          price: tna,
          volume: null,
          // Rough AUM proxy: not published by source — set null (guard: never_invent_data)
          market_cap_ars: null,
          issuer: r.entidad,
          source: 'ARGENTINADATOS_PLAZO_FIJO',
        } satisfies NormalizedAsset;
      });

    if (assets.length === 0) {
      fallback_chain.push('pf_no_valid_records');
    } else {
      fallback_chain.push('pf_ok');
    }

    return { assets, errors, fallback_chain, total_raw: data.length };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`pf_fetch: ${msg}`);
    fallback_chain.push('pf_fetch_failed');
    return { assets: [], errors, fallback_chain, total_raw: 0 };
  }
}

export const PLAZO_FIJO_SOURCE_CONFIDENCE = 0.95;
export const PLAZO_FIJO_EVIDENCE_URLS: string[] = [ENDPOINT];
