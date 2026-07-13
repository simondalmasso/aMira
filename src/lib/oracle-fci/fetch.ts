// src/lib/oracle-fci/fetch.ts
// Fetcher with retry + fallback chain. No hallucination.

import { ArgentinadatosFund, CATEGORY_ENDPOINTS, FundCategory } from './types';

const RETRY_ATTEMPTS = 5;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 15000;
const REQUEST_TIMEOUT_MS = 12000;

/** Sleep with jitter (exponential backoff + random jitter) */
function backoff(attempt: number): number {
  const base = Math.min(INITIAL_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
  return base + Math.random() * 500;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Fetch one URL with retry + exponential backoff + jitter */
async function fetchWithRetry(
  url: string,
  attempt = 0,
): Promise<ArgentinadatosFund[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'santaninverter-oracle/3.0 (+https://santaninverter-oracle.simondalmasso44.workers.dev)',
        Accept: 'application/json',
      },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as ArgentinadatosFund[];
    if (!Array.isArray(data)) {
      throw new Error('Response is not an array');
    }
    return data;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (attempt >= RETRY_ATTEMPTS - 1) {
      throw new Error(`Fetch failed after ${RETRY_ATTEMPTS} attempts: ${msg}`);
    }
    await sleep(backoff(attempt));
    return fetchWithRetry(url, attempt + 1);
  } finally {
    clearTimeout(timer);
  }
}

export interface FetchAllResult {
  data: Partial<Record<FundCategory, ArgentinadatosFund[]>>;
  errors: Partial<Record<FundCategory, string>>;
  fallbackChainUsed: string[];
  totalRecords: number;
}

/** Fetch all 4 categories in parallel. Each independent — partial failures OK. */
export async function fetchAllCategories(): Promise<FetchAllResult> {
  const categories = Object.keys(CATEGORY_ENDPOINTS) as FundCategory[];
  const fallbackChain: string[] = ['primary_fetch'];

  const results = await Promise.allSettled(
    categories.map(async (cat) => {
      try {
        const data = await fetchWithRetry(CATEGORY_ENDPOINTS[cat]);
        return { cat, data, error: null as string | null };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { cat, data: null, error: msg };
      }
    }),
  );

  const data: Partial<Record<FundCategory, ArgentinadatosFund[]>> = {};
  const errors: Partial<Record<FundCategory, string>> = {};
  let totalRecords = 0;

  for (const r of results) {
    if (r.status === 'fulfilled') {
      const { cat, data: d, error } = r.value;
      if (d) {
        data[cat] = d;
        totalRecords += d.length;
      } else if (error) {
        errors[cat] = error;
        fallbackChain.push(`retry_fetch_${cat}_failed`);
      }
    } else {
      // Should not happen — we catch inside
      fallbackChain.push('parallel_fetch_all_categories_unexpected');
    }
  }

  if (Object.keys(errors).length === categories.length) {
    fallbackChain.push('all_categories_failed');
  } else if (Object.keys(errors).length > 0) {
    fallbackChain.push('partial_categories_failed');
  } else {
    fallbackChain.push('all_categories_ok');
  }

  return { data, errors, fallbackChainUsed: fallbackChain, totalRecords };
}

/** Type guard for ArgentinadatosFund */
export function isArgentinadatosFund(x: unknown): x is ArgentinadatosFund {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.fondo === 'string' &&
    typeof o.fecha === 'string' &&
    typeof o.vcp === 'number' &&
    typeof o.ccp === 'number' &&
    typeof o.patrimonio === 'number'
  );
}
