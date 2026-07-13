// src/lib/oracle-multi/sources/bonds.ts
// Bonos soberanos argentinos — Yahoo Finance *.BA tickers.
//
// DATA COVERAGE WARNING (verified 2026-06-17):
// Yahoo Finance has effectively ZERO live AR sovereign bond coverage.
// All 2024-swap bond tickers (BAA30/35/38/41.BA, DICP.BA, etc.) and legacy
// tickers (AL30.BA, GD30.BA, GD38D.BA, etc.) return HTTP 404.
// PAR.BA returns HTTP 200 but with stale 2019 data and no price/volume.
//
// Until a free, no-auth AR bond source is integrated (BYMA API requires auth,
// Rava.com.ar requires CSRF token), this class degrades to 0 assets with a
// clear DEGRADED flag. This is HONEST behavior (never_invent_data guard) —
// we do not fabricate bond prices.
//
// Future enhancement: integrate INDECAR (BYMA public CSV) or scrape
// cronista.com/ambito.com bond tables.
// Source confidence: 0.85 (when fetched), DEGRADED flag when most fail.

import type { NormalizedAsset } from '../types';
import { fetchYahooBatch, yahooResultToAsset } from './yahoo-finance';

// Curated list — only confirmed Yahoo-reachable tickers.
// PAR.BA is Yahoo's only AR bond entry (stale 2019 data, will be filtered).
// We keep the list so that IF Yahoo re-enables bond coverage, the class
// will automatically start populating again.
export const BONOS_TICKERS: string[] = [
  'PAR.BA',     // Par bond (Yahoo stale 2019 entry; filtered out by null-price guard)
];

export interface BonosSourceResult {
  assets: NormalizedAsset[];
  errors: string[];
  fallback_chain: string[];
  total_raw: number;
  degraded: boolean;  // true if most tickers fail
}

export async function fetchBonosAssets(mepRate: number): Promise<BonosSourceResult> {
  const errors: string[] = [];
  const fallback_chain: string[] = ['bonos_primary_fetch'];

  const { results, errors: batchErrors } = await fetchYahooBatch(BONOS_TICKERS, '3mo');
  errors.push(...batchErrors);
  const failedCount = batchErrors.length;
  const totalCount = BONOS_TICKERS.length;

  if (failedCount === totalCount) {
    fallback_chain.push('bonos_all_failed_yahoo_no_ar_bond_coverage');
  } else if (failedCount > totalCount / 2) {
    // Most bonds failed — flag as DEGRADED (must_flag_degraded_mode guard)
    fallback_chain.push('bonos_majority_failed_degraded');
  } else if (failedCount > 0) {
    fallback_chain.push('bonos_partial_failed');
  } else {
    fallback_chain.push('bonos_ok');
  }

  const assets: NormalizedAsset[] = [];
  for (const r of results) {
    const asset = yahooResultToAsset(r, 'BONOS', 'bono_soberano_ar', mepRate);
    if (asset) assets.push(asset);
  }

  return {
    assets,
    errors,
    fallback_chain,
    total_raw: results.length,
    degraded: failedCount > totalCount / 2,
  };
}

export const BONOS_SOURCE_CONFIDENCE = 0.85;
export const BONOS_EVIDENCE_URLS: string[] = [
  'https://query1.finance.yahoo.com/v8/finance/chart/{SYMBOL}.BA',
];
