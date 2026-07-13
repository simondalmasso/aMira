// src/lib/oracle-multi/sources/cedears.ts
// CEDEARs — Argentine depositary receipts for foreign stocks.
// Source: Yahoo Finance *.BA tickers. Each CEDEAR trades in ARS on BYMA.
// Source confidence: 0.85 (real market data, 15min delayed, public).

import type { NormalizedAsset } from '../types';
import { fetchYahooBatch, yahooResultToAsset, type YahooFetchResult } from './yahoo-finance';

// Curated list of liquid CEDEARs (top by trading volume on BYMA).
// All confirmed reachable on Yahoo Finance as of 2026-06-17.
// TRIMMED 2026-06-17: 20 → 10 tickers to fit under Cloudflare's 50-subrequest-per-invocation
// cap when the /api/oracle/rankings aggregator fetches all 6 classes in parallel.
// Note: DIS.BA (Disney) was removed — Yahoo delisted it. Replaced with KO.BA (Coca-Cola,
// highly liquid) which is confirmed live with price=24030 ARS as of 2026-06-17.
export const CEDEAR_TICKERS: string[] = [
  'AAPL.BA', 'MSFT.BA', 'GOOGL.BA', 'AMZN.BA', 'TSLA.BA',
  'META.BA', 'NVDA.BA', 'JPM.BA', 'BABA.BA', 'KO.BA',
];

export interface CedearsSourceResult {
  assets: NormalizedAsset[];
  errors: string[];
  fallback_chain: string[];
  total_raw: number;
}

export async function fetchCedearsAssets(mepRate: number): Promise<CedearsSourceResult> {
  const errors: string[] = [];
  const fallback_chain: string[] = ['cedears_primary_fetch'];

  const { results, errors: batchErrors } = await fetchYahooBatch(CEDEAR_TICKERS, '3mo');
  errors.push(...batchErrors);
  if (batchErrors.length === CEDEAR_TICKERS.length) {
    fallback_chain.push('cedears_all_failed');
  } else if (batchErrors.length > 0) {
    fallback_chain.push('cedears_partial_failed');
  } else {
    fallback_chain.push('cedears_ok');
  }

  const assets: NormalizedAsset[] = [];
  for (const r of results) {
    // CEDEARs trade in ARS on BYMA, so currency will be ARS from Yahoo
    const asset = yahooResultToAsset(r, 'CEDEARS', 'cedear_accion_us', mepRate);
    if (asset) assets.push(asset);
  }

  return { assets, errors, fallback_chain, total_raw: results.length };
}

export const CEDEARS_SOURCE_CONFIDENCE = 0.85;
export const CEDEARS_EVIDENCE_URLS: string[] = [
  'https://query1.finance.yahoo.com/v8/finance/chart/{SYMBOL}.BA',
];
