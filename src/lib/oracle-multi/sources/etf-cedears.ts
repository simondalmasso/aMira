// src/lib/oracle-multi/sources/etf-cedears.ts
// ETF CEDEARs — US ETFs that have CEDEARs in Argentina.
// Per spec: SPY, QQQ, IWM, EEM, XLF, XLE, DIA, EWZ, ARKK.
// Source: Yahoo Finance (US underlying, USD currency). ARS price = USD × MEP.
// Source confidence: 0.85.

import type { NormalizedAsset } from '../types';
import { fetchYahooBatch, yahooResultToAsset } from './yahoo-finance';

// Spec-defined list of ETFs with CEDEARs in Argentina
export const ETF_CEDEAR_TICKERS: string[] = [
  'SPY',   // SPDR S&P 500
  'QQQ',   // Invesco QQQ NASDAQ-100
  'IWM',   // iShares Russell 2000
  'EEM',   // iShares MSCI Emerging Markets
  'XLF',   // Financial Select Sector SPDR
  'XLE',   // Energy Select Sector SPDR
  'DIA',   // SPDR Dow Jones Industrial Average
  'EWZ',   // iShares MSCI Brazil
  'ARKK',  // ARK Innovation
];

export interface EtfCedearsSourceResult {
  assets: NormalizedAsset[];
  errors: string[];
  fallback_chain: string[];
  total_raw: number;
}

export async function fetchEtfCedearsAssets(mepRate: number): Promise<EtfCedearsSourceResult> {
  const errors: string[] = [];
  const fallback_chain: string[] = ['etf_cedears_primary_fetch'];

  const { results, errors: batchErrors } = await fetchYahooBatch(ETF_CEDEAR_TICKERS, '3mo');
  errors.push(...batchErrors);
  if (batchErrors.length === ETF_CEDEAR_TICKERS.length) {
    fallback_chain.push('etf_cedears_all_failed');
  } else if (batchErrors.length > 0) {
    fallback_chain.push('etf_cedears_partial_failed');
  } else {
    fallback_chain.push('etf_cedears_ok');
  }

  const assets: NormalizedAsset[] = [];
  for (const r of results) {
    const asset = yahooResultToAsset(r, 'ETF_CEDEARS', 'etf_us_con_cedear', mepRate);
    if (asset) assets.push(asset);
  }

  return { assets, errors, fallback_chain, total_raw: results.length };
}

export const ETF_CEDEARS_SOURCE_CONFIDENCE = 0.85;
export const ETF_CEDEARS_EVIDENCE_URLS: string[] = [
  'https://query1.finance.yahoo.com/v8/finance/chart/{SYMBOL}',
];
