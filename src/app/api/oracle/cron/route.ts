// src/app/api/oracle/cron/route.ts
// POST /api/oracle/cron — runs all 6 cron jobs (refresh_fci, refresh_stocks,
// refresh_bonds, refresh_cedears, refresh_predictions, snapshot_archive).
// Designed to be called by Cloudflare cron trigger OR external scheduler.
//
// FIX_CRON_RECURSION_2026_07_09 (Fix B): added re-entrancy guard via KV lock.
// If called twice within 90s, second call returns HTTP 429 immediately. Prevents
// future recursive-call scenarios if architecture changes or external caller
// retries. TTL is set to 90s (cron wall clock post-Fix A is ~130s, but the lock
// is released in `finally` block on success).

import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { runAllCronJobs } from '@/lib/oracle-multi/cron';

export const dynamic = 'force-dynamic';

const CRON_LOCK_KEY = 'cron_lock';
const CRON_LOCK_TTL_SECONDS = 90; // hard cap; cron should complete in <60s post-Fix A

function getEnv() {
  // CRON_PERSISTENCE_WIRING_FIX — `process.env.ORACLE_*` is NOT populated inside
  // OpenNext Route Handlers when invoked from the scheduled() cron context, so KV
  // bindings silently resolve to `undefined` and `resolveMultiStorage()` falls back
  // to MemoryStorageAdapter (writes die with the isolate → ghost execution).
  // We must read them via `getCloudflareContext().env`, which is the same pattern
  // already proven in `/api/macro/route.ts` and `src/lib/telemetry.ts`.
  try {
    const ctx = getCloudflareContext();
    const env = ctx.env as {
      ORACLE_FCI_HISTORY?: KVNamespace;
      ORACLE_ASSETS_HISTORY?: KVNamespace;
      ORACLE_PREDICTIONS?: KVNamespace;
    };
    return {
      ORACLE_FCI_HISTORY: env.ORACLE_FCI_HISTORY,
      ORACLE_ASSETS_HISTORY: env.ORACLE_ASSETS_HISTORY,
      ORACLE_PREDICTIONS: env.ORACLE_PREDICTIONS,
    };
  } catch {
    // Outside Cloudflare Worker runtime (local dev without bindings, tests, etc.)
    return {
      ORACLE_FCI_HISTORY: undefined,
      ORACLE_ASSETS_HISTORY: undefined,
      ORACLE_PREDICTIONS: undefined,
    };
  }
}

async function acquireLock(kv: KVNamespace | undefined): Promise<{ acquired: boolean; ageMs?: number }> {
  if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') {
    // No KV available (local dev) — skip lock, allow execution
    return { acquired: true };
  }
  try {
    const existing = await kv.get(CRON_LOCK_KEY);
    if (existing) {
      const ageMs = Date.now() - parseInt(existing, 10);
      if (ageMs < CRON_LOCK_TTL_SECONDS * 1000) {
        return { acquired: false, ageMs };
      }
      // Stale lock — fall through and overwrite below
    }
    await kv.put(CRON_LOCK_KEY, Date.now().toString(), { expirationTtl: CRON_LOCK_TTL_SECONDS });
    return { acquired: true };
  } catch {
    // KV error — fail open (allow execution, log via console)
    console.error('[cron-route] lock acquire failed, executing without lock');
    return { acquired: true };
  }
}

async function releaseLock(kv: KVNamespace | undefined): Promise<void> {
  if (!kv || typeof kv.delete !== 'function') return;
  try {
    await kv.delete(CRON_LOCK_KEY);
  } catch {
    // Best-effort release — TTL will clean up if delete fails
  }
}

export async function POST(): Promise<NextResponse<{ success: boolean; results?: unknown; error?: string; lock_age_ms?: number }>> {
  const env = getEnv();
  if (!env.ORACLE_PREDICTIONS) {
    return NextResponse.json(
      { success: false, error: 'ORACLE_PREDICTIONS binding missing' },
      { status: 500 },
    );
  }

  const lockResult = await acquireLock(env.ORACLE_PREDICTIONS);
  if (!lockResult.acquired) {
    return NextResponse.json(
      { success: false, error: 'cron_already_running', lock_age_ms: lockResult.ageMs },
      { status: 429 },
    );
  }

  try {
    const result = await runAllCronJobs(env);
    return NextResponse.json({ success: true, results: result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  } finally {
    await releaseLock(env.ORACLE_PREDICTIONS);
  }
}

export async function GET(): Promise<NextResponse<{ success: boolean; results?: unknown; error?: string; lock_age_ms?: number }>> {
  // GET also allowed for manual testing / healthcheck — same lock semantics as POST
  const env = getEnv();
  if (!env.ORACLE_PREDICTIONS) {
    return NextResponse.json(
      { success: false, error: 'ORACLE_PREDICTIONS binding missing' },
      { status: 500 },
    );
  }

  const lockResult = await acquireLock(env.ORACLE_PREDICTIONS);
  if (!lockResult.acquired) {
    return NextResponse.json(
      { success: false, error: 'cron_already_running', lock_age_ms: lockResult.ageMs },
      { status: 429 },
    );
  }

  try {
    const result = await runAllCronJobs(env);
    return NextResponse.json({ success: true, results: result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  } finally {
    await releaseLock(env.ORACLE_PREDICTIONS);
  }
}
