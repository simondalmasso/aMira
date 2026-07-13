// src/lib/oracle-multi/sources/acciones.ts
// Acciones argentinas (BYMA) — Yahoo Finance *.BA tickers, ARS currency.
// Source confidence: 0.85.

import type { NormalizedAsset } from '../types';
import { fetchYahooBatch, yahooResultToAsset } from './yahoo-finance';

// Curated list of liquid Argentine stocks (BYMA). All confirmed reachable 2026-06-17.
// YPF.BA returns 404 on Yahoo (delisted format), use YPFD.BA preferred share instead.
// TRIMMED 2026-06-17: 20 → 12 tickers to fit under Cloudflare's 50-subrequest-per-invocation
// cap when the /api/oracle/rankings aggregator fetches all 6 classes in parallel.
// (12 acciones + 1 bono + 10 cedears + 9 etfs + 1 mep + 1 fci + 1 pf = 35 subrequests ≤ 50)
export const ACCIONES_TICKERS: string[] = [
  'GGAL.BA',  // Grupo Financiero Galicia
  'YPFD.BA',  // YPF (preferred)
  'PAMP.BA',  // Pampa Energía
  'ERAR.BA',  // Edenor
  'CRES.BA',  // Cresud
  'MIRG.BA',  // Mirgor
  'CEPU.BA',  // Central Puerto
  'TGNO4.BA', // Ternium Argentina
  'ALUA.BA',  // Aluar
  'BBAR.BA',  // Banco BBVA Argentina
  'BMA.BA',   // Banco Macro
  'SUPV.BA',  // Grupo Supervielle
];

export interface AccionesSourceResult {
  assets: NormalizedAsset[];
  errors: string[];
  fallback_chain: string[];
  total_raw: number;
}

export async function fetchAccionesAssets(mepRate: number): Promise<AccionesSourceResult> {
  const errors: string[] = [];
  const fallback_chain: string[] = ['acciones_primary_fetch'];

  const { results, errors: batchErrors } = await fetchYahooBatch(ACCIONES_TICKERS, '3mo');
  errors.push(...batchErrors);
  if (batchErrors.length === ACCIONES_TICKERS.length) {
    fallback_chain.push('acciones_all_failed');
  } else if (batchErrors.length > 0) {
    fallback_chain.push('acciones_partial_failed');
  } else {
    fallback_chain.push('acciones_ok');
  }

  const assets: NormalizedAsset[] = [];
  for (const r of results) {
    const asset = yahooResultToAsset(r, 'ACCIONES', 'accion_byma_ars', mepRate);
    if (asset) assets.push(asset);
  }

  return { assets, errors, fallback_chain, total_raw: results.length };
}

export const ACCIONES_SOURCE_CONFIDENCE = 0.85;
export const ACCIONES_EVIDENCE_URLS: string[] = [
  'https://query1.finance.yahoo.com/v8/finance/chart/{SYMBOL}.BA',
];
