// src/lib/oracle-multi/sources/yahoo-finance.ts
// Yahoo Finance v8 chart API — public, no API key needed (delayed quotes).
// Used by: ACCIONES, BONOS, CEDEARS, ETF_CEDEARS.
// Guard: never_invent_data — if Yahoo returns null/404, mark asset as missing.
// Note: Yahoo rate-limits (429) when many tickers are fetched in parallel from
// the same IP. We throttle to MAX_CONCURRENCY parallel requests with a delay
// between batches, and retry on 429 with exponential backoff.

import type { NormalizedAsset, AssetClass } from '../types';

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const TIMEOUT_MS = 10000;
const MAX_CONCURRENCY = 2;             // parallel requests at a time (low — Yahoo rate-limits)
const BATCH_DELAY_MS = 800;            // delay between batches
const RETRY_ATTEMPTS = 4;              // more retries to escape 429 penalty box
const RETRY_BACKOFF_MS = 1500;         // base backoff for 429 (longer: 1.5s, 3s, 6s, 12s)

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: {
        symbol?: string;
        currency?: string;
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        regularMarketVolume?: number;
        fiftyTwoWeekHigh?: number;
        fiftyTwoWeekLow?: number;
        longName?: string;
        shortName?: string;
        exchangeName?: string;
        instrumentType?: string;
      };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          close?: (number | null)[];
          volume?: (number | null)[];
        }>;
      };
    }>;
    error?: { code?: string; description?: string };
  };
}

export interface YahooFetchResult {
  ok: boolean;
  symbol: string;
  price: number | null;
  previous_close: number | null;
  volume: number | null;
  currency: 'ARS' | 'USD' | null;
  long_name: string | null;
  fifty_two_week_high: number | null;
  fifty_two_week_low: number | null;
  history: Array<{ date: string; close: number; volume: number | null }>;
  error?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch one ticker with retry on 429 (rate limit). */
async function fetchYahooTickerRaw(
  symbol: string,
  range: string,
  interval: string,
  attempt = 0,
): Promise<Response> {
  const url = `${YAHOO_BASE}/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  try {
    const res = await fetchWithTimeout(url, TIMEOUT_MS);
    if (res.status === 429 && attempt < RETRY_ATTEMPTS) {
      // Exponential backoff: 800ms, 1600ms, 3200ms
      const backoff = RETRY_BACKOFF_MS * Math.pow(2, attempt);
      await sleep(backoff);
      return fetchYahooTickerRaw(symbol, range, interval, attempt + 1);
    }
    return res;
  } catch (err) {
    if (attempt < RETRY_ATTEMPTS) {
      await sleep(RETRY_BACKOFF_MS * Math.pow(2, attempt));
      return fetchYahooTickerRaw(symbol, range, interval, attempt + 1);
    }
    throw err;
  }
}

/** Fetch one ticker with up to 90d history (used for momentum/volatility calc). */
export async function fetchYahooTicker(
  symbol: string,
  range = '3mo',
  interval = '1d',
): Promise<YahooFetchResult> {
  try {
    const res = await fetchYahooTickerRaw(symbol, range, interval, 0);
    if (!res.ok) {
      return {
        ok: false, symbol, price: null, previous_close: null, volume: null,
        currency: null, long_name: null, fifty_two_week_high: null, fifty_two_week_low: null,
        history: [], error: `HTTP ${res.status} ${res.statusText}`,
      };
    }
    const data = (await res.json()) as YahooChartResponse;
    const result = data.chart?.result?.[0];
    if (!result) {
      const errMsg = data.chart?.error?.description || 'No data';
      return {
        ok: false, symbol, price: null, previous_close: null, volume: null,
        currency: null, long_name: null, fifty_two_week_high: null, fifty_two_week_low: null,
        history: [], error: errMsg,
      };
    }
    const meta = result.meta || {};
    const tsArr = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const vols = result.indicators?.quote?.[0]?.volume || [];

    const history: YahooFetchResult['history'] = [];
    for (let i = 0; i < tsArr.length; i++) {
      const close = closes[i];
      if (close == null) continue;
      const d = new Date(tsArr[i] * 1000);
      const iso = d.toISOString().slice(0, 10);
      history.push({
        date: iso,
        close,
        volume: vols[i] ?? null,
      });
    }

    const currency = (meta.currency === 'ARS' || meta.currency === 'USD') ? meta.currency : null;

    return {
      ok: true,
      symbol,
      price: meta.regularMarketPrice ?? null,
      previous_close: meta.chartPreviousClose ?? null,
      volume: meta.regularMarketVolume ?? null,
      currency,
      long_name: meta.longName || meta.shortName || null,
      fifty_two_week_high: meta.fiftyTwoWeekHigh ?? null,
      fifty_two_week_low: meta.fiftyTwoWeekLow ?? null,
      history,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false, symbol, price: null, previous_close: null, volume: null,
      currency: null, long_name: null, fifty_two_week_high: null, fifty_two_week_low: null,
      history: [], error: msg,
    };
  }
}

/** Fetch many tickers with throttled concurrency (MAX_CONCURRENCY at a time). */
export async function fetchYahooBatch(
  symbols: string[],
  range = '3mo',
): Promise<{ results: YahooFetchResult[]; errors: string[] }> {
  const results: YahooFetchResult[] = [];
  const errors: string[] = [];

  // Process in chunks of MAX_CONCURRENCY
  for (let i = 0; i < symbols.length; i += MAX_CONCURRENCY) {
    const batch = symbols.slice(i, i + MAX_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((s) => fetchYahooTicker(s, range)),
    );
    for (const r of batchResults) {
      results.push(r);
      if (!r.ok && r.error) {
        errors.push(`${r.symbol}: ${r.error}`);
      }
    }
    // Delay between batches to avoid rate-limit
    if (i + MAX_CONCURRENCY < symbols.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  return { results, errors };
}

// ─── Normalize Yahoo result → NormalizedAsset ──────────────────────────────

export function yahooResultToAsset(
  r: YahooFetchResult,
  assetClass: AssetClass,
  subCategory: string | undefined,
  mepRate: number,        // ARS per USD (for USD-denominated → ARS market cap)
  issuer?: string,
): NormalizedAsset | null {
  if (!r.ok || r.price == null || r.price <= 0) return null;
  const currency = r.currency || 'USD';
  const today = r.history.length > 0 ? r.history[r.history.length - 1].date : new Date().toISOString().slice(0, 10);
  const marketCapArs =
    r.volume != null && currency === 'ARS'
      ? r.volume * r.price
      : r.volume != null && currency === 'USD'
        ? r.volume * r.price * mepRate
        : null;
  return {
    id: `${assetClass}:${r.symbol}`,
    asset_class: assetClass,
    name: r.long_name || r.symbol,
    ticker: r.symbol,
    sub_category: subCategory,
    currency,
    date: today,
    price: r.price,
    volume: r.volume,
    market_cap_ars: marketCapArs,
    issuer,
    source: 'YAHOO_FINANCE_V8',
  };
}

