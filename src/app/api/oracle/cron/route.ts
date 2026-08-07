// Canonical cron controller. POST executes one idempotent daily maintenance run;
// GET is read-only health metadata. Cloudflare scheduled() calls POST internally.

import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { runAllCronJobs, type CronJobResult } from '@/lib/oracle-multi/cron';
import { recoverLifecycle } from '@/lib/amira-prediction-lifecycle-ledger';

export const dynamic = 'force-dynamic';

const CRON_LOCK_KEY = 'cron:lock:canonical';
const CRON_LOCK_TTL_SECONDS = 15 * 60;
const CRON_RUN_PREFIX = 'cron:run:';
const CRON_RUN_TTL_SECONDS = 14 * 24 * 60 * 60;

type CronEnv = {
  ORACLE_FCI_HISTORY?: KVNamespace;
  ORACLE_ASSETS_HISTORY?: KVNamespace;
  ORACLE_PREDICTIONS?: KVNamespace;
};

type CronExecutionResponse = {
  success: boolean;
  run_id: string;
  idempotent_replay: boolean;
  jobs: Array<Pick<CronJobResult, 'job' | 'ok' | 'duration_ms' | 'persistence_ack'> & { error_code?: 'JOB_EXECUTION_FAILED' }>;
  lifecycle: Awaited<ReturnType<typeof recoverLifecycle>> | null;
  started_at: string | null;
  finished_at: string;
  error?: 'CRON_BINDINGS_UNAVAILABLE' | 'CRON_ALREADY_RUNNING' | 'CRON_EXECUTION_FAILED';
};

function getEnv(): CronEnv {
  try {
    return getCloudflareContext().env as CronEnv;
  } catch {
    return {};
  }
}

function runId(now = new Date()): string {
  return `${now.toISOString().slice(0, 10)}:canonical`;
}

async function acquireLock(kv: KVNamespace): Promise<{ acquired: boolean; ageMs?: number; failed?: boolean }> {
  try {
    const existing = await kv.get(CRON_LOCK_KEY);
    if (existing) {
      const timestamp = Number(existing);
      const ageMs = Number.isFinite(timestamp) ? Date.now() - timestamp : 0;
      if (ageMs < CRON_LOCK_TTL_SECONDS * 1000) return { acquired: false, ageMs };
    }
    await kv.put(CRON_LOCK_KEY, String(Date.now()), { expirationTtl: CRON_LOCK_TTL_SECONDS });
    return { acquired: true };
  } catch (error) {
    console.error('[cron-route] lock acquisition failed', error);
    return { acquired: false, failed: true };
  }
}

async function releaseLock(kv: KVNamespace): Promise<void> {
  try { await kv.delete(CRON_LOCK_KEY); }
  catch (error) { console.error('[cron-route] lock release failed', error); }
}

function publicJobs(results: CronJobResult[]): CronExecutionResponse['jobs'] {
  return results.map((result) => ({
    job: result.job,
    ok: result.ok,
    duration_ms: result.duration_ms,
    persistence_ack: result.persistence_ack,
    ...(result.error ? { error_code: 'JOB_EXECUTION_FAILED' as const } : {}),
  }));
}

export async function POST(): Promise<NextResponse<CronExecutionResponse>> {
  const env = getEnv();
  const id = runId();
  const finishedNow = () => new Date().toISOString();
  if (!env.ORACLE_PREDICTIONS || !env.ORACLE_FCI_HISTORY || !env.ORACLE_ASSETS_HISTORY) {
    return NextResponse.json({
      success: false, run_id: id, idempotent_replay: false, jobs: [], lifecycle: null,
      started_at: null, finished_at: finishedNow(), error: 'CRON_BINDINGS_UNAVAILABLE',
    }, { status: 503 });
  }

  const completedKey = CRON_RUN_PREFIX + id;
  try {
    const completed = await env.ORACLE_PREDICTIONS.get(completedKey);
    if (completed) {
      const prior = JSON.parse(completed) as CronExecutionResponse;
      return NextResponse.json({ ...prior, idempotent_replay: true });
    }
  } catch (error) {
    console.error('[cron-route] idempotency read failed', error);
    return NextResponse.json({
      success: false, run_id: id, idempotent_replay: false, jobs: [], lifecycle: null,
      started_at: null, finished_at: finishedNow(), error: 'CRON_EXECUTION_FAILED',
    }, { status: 503 });
  }

  const lock = await acquireLock(env.ORACLE_PREDICTIONS);
  if (!lock.acquired) {
    return NextResponse.json({
      success: false, run_id: id, idempotent_replay: false, jobs: [], lifecycle: null,
      started_at: null, finished_at: finishedNow(),
      error: lock.failed ? 'CRON_EXECUTION_FAILED' : 'CRON_ALREADY_RUNNING',
    }, { status: lock.failed ? 503 : 409 });
  }

  try {
    const result = await runAllCronJobs(env);
    const lifecycle = await recoverLifecycle();
    const jobs = publicJobs(result.results);
    const success = jobs.every((job) => job.ok && job.persistence_ack?.durable === true)
      && lifecycle.storage === 'durable';
    const response: CronExecutionResponse = {
      success,
      run_id: id,
      idempotent_replay: false,
      jobs,
      lifecycle,
      started_at: result.started_at,
      finished_at: result.finished_at,
      ...(success ? {} : { error: 'CRON_EXECUTION_FAILED' as const }),
    };
    if (success) {
      await env.ORACLE_PREDICTIONS.put(completedKey, JSON.stringify(response), { expirationTtl: CRON_RUN_TTL_SECONDS });
      const echoed = await env.ORACLE_PREDICTIONS.get(completedKey);
      if (!echoed) throw new Error('CRON_COMPLETION_ACK_MISSING');
    }
    return NextResponse.json(response, { status: success ? 200 : 503 });
  } catch (error) {
    console.error('[cron-route] canonical run failed', error);
    return NextResponse.json({
      success: false, run_id: id, idempotent_replay: false, jobs: [], lifecycle: null,
      started_at: null, finished_at: finishedNow(), error: 'CRON_EXECUTION_FAILED',
    }, { status: 500 });
  } finally {
    await releaseLock(env.ORACLE_PREDICTIONS);
  }
}

export async function GET(): Promise<NextResponse<{
  success: true;
  mode: 'READ_ONLY_HEALTH';
  schedule_utc: '0 23 * * 1-5';
  bindings: { fci: boolean; assets: boolean; predictions: boolean };
}>> {
  const env = getEnv();
  return NextResponse.json({
    success: true,
    mode: 'READ_ONLY_HEALTH',
    schedule_utc: '0 23 * * 1-5',
    bindings: {
      fci: Boolean(env.ORACLE_FCI_HISTORY),
      assets: Boolean(env.ORACLE_ASSETS_HISTORY),
      predictions: Boolean(env.ORACLE_PREDICTIONS),
    },
  });
}
