// src/lib/oracle-multi/mep.ts
// Fetch current MEP dollar rate (ARS per USD).
//
// Source priority (FIXED 2026-06-17):
//   1. Bluelytics API (https://api.bluelytics.com.ar/v2/latest) — public, no auth, CORS-friendly.
//      Returns blue dollar sell rate. We use this as a stable proxy for MEP since both
//      track within ~2% of each other in normal market conditions.
//   2. argentinadatos.com — verified 2026-06-17: NO /dolares endpoint exists (404).
//      Removed from chain.
//   3. macro-oracle-proxy.simondalmasso44.workers.dev — REMOVED: worker no longer deployed
//      to this Cloudflare account (returns error 1042).
//   4. Fallback: 1500 ARS/USD (conservative default; flag as degraded).
//
// Guard: never_invent_data — fallback rate is clearly tagged with source='fallback_default_1500'
// and ok=false so downstream consumers can flag degraded mode.

const BLUELYTICS_URL = 'https://api.bluelytics.com.ar/v2/latest';

export interface MepResult {
  rate: number;        // ARS per USD
  source: string;
  ok: boolean;
  error?: string;
}

/** Try Bluelytics direct (primary source). */
async function tryBluelytics(): Promise<MepResult | null> {
  try {
    const res = await fetch(BLUELYTICS_URL, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) {
      return { rate: 0, source: 'bluelytics_failed', ok: false, error: `bluelytics HTTP ${res.status}` };
    }
    const data = (await res.json()) as {
      blue?: { value_avg?: number; value_sell?: number; value_buy?: number };
      oficial?: { value_avg?: number; value_sell?: number; value_buy?: number };
    };
    // Prefer blue dollar sell rate (closest proxy to MEP dollar)
    if (data.blue && (data.blue.value_sell || data.blue.value_avg)) {
      const rate = data.blue.value_sell ?? data.blue.value_avg ?? 0;
      if (rate > 0) return { rate, source: 'bluelytics_blue', ok: true };
    }
    // Fall back to oficial sell rate if blue is missing
    if (data.oficial && data.oficial.value_sell) {
      return { rate: data.oficial.value_sell, source: 'bluelytics_oficial', ok: true };
    }
    return { rate: 0, source: 'bluelytics_empty', ok: false, error: 'bluelytics returned no rate' };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { rate: 0, source: 'bluelytics_error', ok: false, error: `bluelytics: ${msg}` };
  }
}

/**
 * Fetch MEP rate.
 * Order: Bluelytics direct → fallback 1500.
 *
 * Note: Bluelytics returns the "blue" dollar (parallel market), not the MEP
 * (mercado electrónico de pagos) rate. They typically differ by <2% under
 * normal market conditions. When a proper MEP source becomes available
 * (e.g. argentinadatos.com adds a /dolares endpoint, or the proxy worker is
 * re-deployed), this function should be extended to try MEP first, then blue.
 */
export async function fetchMepRate(): Promise<MepResult> {
  // 1. Try Bluelytics direct
  const blue = await tryBluelytics();
  if (blue && blue.ok && blue.rate > 0) return blue;

  // 2. If Bluelytics returned an error result (not null), capture the error
  const blueErr = blue && !blue.ok ? blue.error ?? 'bluelytics_failed' : 'all_mep_sources_failed';

  // 3. Fallback to 1500 ARS/USD (conservative default)
  return {
    rate: 1500,
    source: 'fallback_default_1500',
    ok: false,
    error: blueErr,
  };
}
