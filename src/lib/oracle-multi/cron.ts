// src/lib/oracle-multi/cron.ts
// Scheduled-job logic for V4 multi-asset Oracle.
// Cron expression in wrangler.jsonc: "0 23 * * 1-5" UTC = 20:00 ART Mon-Fri.

import { runMultiOracle, type MultiStorage, resolveMultiStorage } from './index';
import type { AssetClass, MultiOracleResponse } from './types';

export type CronJobName =
  | 'refresh_fci'
  | 'refresh_stocks'
  | 'refresh_bonds'
  | 'refresh_cedears'
  | 'refresh_predictions';

export const CRON_JOBS: CronJobName[] = [
  'refresh_fci',
  'refresh_stocks',
  'refresh_bonds',
  'refresh_cedears',
  'refresh_predictions',
];

export type PersistenceAckStatus = 'DURABLE' | 'NOT_APPLICABLE_NO_DATA' | 'FAILED';

export interface CronPersistenceAck {
  durable: boolean;
  status: PersistenceAckStatus;
  snapshot_date: string;
  keys: string[];
  verified_keys: string[];
  missing_keys: string[];
  reason?: 'NO_OBSERVED_SOURCE_DATA';
}

export interface CronJobResult {
  job: CronJobName;
  ok: boolean;
  duration_ms: number;
  error?: string;
  meta?: Record<string, unknown>;
  persistence_ack?: CronPersistenceAck;
}

async function verifySnapshotWrites(
  storage: MultiStorage,
  classes: AssetClass[],
  snapshotDate: string,
): Promise<CronPersistenceAck> {
  const keys = classes.map((cls) => `snap:${cls}:${snapshotDate}`);
  const verified_keys: string[] = [];
  const missing_keys: string[] = [];
  for (let index = 0; index < classes.length; index += 1) {
    const cls = classes[index];
    const key = keys[index];
    const target = cls === 'FCI' ? storage.fci : storage.assets;
    const raw = await target.get(key);
    if (!raw) { missing_keys.push(key); continue; }
    try {
      const parsed = JSON.parse(raw) as { asset_class?: string; date?: string; fetched_at?: string };
      if (parsed.asset_class === cls && parsed.date === snapshotDate && typeof parsed.fetched_at === 'string') verified_keys.push(key);
      else missing_keys.push(key);
    } catch {
      missing_keys.push(key);
    }
  }
  const durable = missing_keys.length === 0 && keys.length > 0;
  return { durable, status: durable ? 'DURABLE' : 'FAILED', snapshot_date: snapshotDate, keys, verified_keys, missing_keys };
}

function noDataAck(snapshotDate: string): CronPersistenceAck {
  return {
    durable: false,
    status: 'NOT_APPLICABLE_NO_DATA',
    snapshot_date: snapshotDate,
    keys: [],
    verified_keys: [],
    missing_keys: [],
    reason: 'NO_OBSERVED_SOURCE_DATA',
  };
}

function sourceMeta(result: MultiOracleResponse): Record<string, unknown> {
  return {
    source_status: result.source_status,
    total_assets: result.total_assets,
    classes_fetched: result.metadata.classes_fetched,
    classes_failed: result.metadata.classes_failed,
    snapshot_date: result.snapshot_date,
    errors: result.errors,
  };
}

async function classResult(
  job: CronJobName,
  storage: MultiStorage,
  classes: AssetClass[],
  start: number,
): Promise<CronJobResult> {
  const result = await runMultiOracle({ storage, classes, topN: 5 });
  if (result.total_assets === 0 || result.metadata.classes_fetched.length === 0) {
    return {
      job,
      ok: true,
      duration_ms: Date.now() - start,
      meta: { ...sourceMeta(result), degraded_no_data: true },
      persistence_ack: noDataAck(result.snapshot_date),
    };
  }
  const persistedClasses = result.metadata.classes_fetched.filter((cls) => classes.includes(cls));
  const persistence_ack = await verifySnapshotWrites(storage, persistedClasses, result.snapshot_date);
  return {
    job,
    ok: result.source_status !== 'ERROR' && persistence_ack.durable,
    duration_ms: Date.now() - start,
    meta: sourceMeta(result),
    persistence_ack,
  };
}

/** Run a single cron job. Source unavailability is explicit PARTIAL state, never fabricated persistence. */
async function runJob(job: CronJobName, storage: MultiStorage): Promise<CronJobResult> {
  const start = Date.now();
  try {
    switch (job) {
      case 'refresh_fci':
        return classResult(job, storage, ['FCI'], start);
      case 'refresh_stocks':
        return classResult(job, storage, ['ACCIONES'], start);
      case 'refresh_bonds':
        return classResult(job, storage, ['BONOS'], start);
      case 'refresh_cedears':
        return classResult(job, storage, ['CEDEARS', 'ETF_CEDEARS'], start);
      case 'refresh_predictions': {
        const result = await runMultiOracle({ storage, topN: 5 });
        if (result.total_assets === 0 || result.metadata.classes_fetched.length === 0) {
          return {
            job,
            ok: true,
            duration_ms: Date.now() - start,
            meta: { ...sourceMeta(result), degraded_no_data: true },
            persistence_ack: noDataAck(result.snapshot_date),
          };
        }
        const persistence_ack = await verifySnapshotWrites(storage, result.metadata.classes_fetched, result.snapshot_date);
        return {
          job,
          ok: result.source_status !== 'ERROR' && persistence_ack.durable,
          duration_ms: Date.now() - start,
          meta: {
            ...sourceMeta(result),
            predictions_active: result.predictions_summary.active,
            assets_with_predictions: result.predictions_summary.assets_with_predictions,
            high_conviction: result.predictions_summary.high_conviction_count,
          },
          persistence_ack,
        };
      }
      default:
        return { job, ok: false, duration_ms: Date.now() - start, error: 'unknown_job' };
    }
  } catch (error: unknown) {
    console.error(`[cron] ${job} failed`, error);
    return { job, ok: false, duration_ms: Date.now() - start, error: 'JOB_EXECUTION_FAILED' };
  }
}

/** Run all cron jobs sequentially (to avoid KV write contention). */
export async function runAllCronJobs(env?: {
  ORACLE_FCI_HISTORY?: KVNamespace;
  ORACLE_ASSETS_HISTORY?: KVNamespace;
  ORACLE_PREDICTIONS?: KVNamespace;
}): Promise<{ results: CronJobResult[]; started_at: string; finished_at: string; total_duration_ms: number }> {
  const started_at = new Date().toISOString();
  const start = Date.now();
  const storage = resolveMultiStorage(env);
  const results: CronJobResult[] = [];
  for (const job of CRON_JOBS) results.push(await runJob(job, storage));
  return {
    results,
    started_at,
    finished_at: new Date().toISOString(),
    total_duration_ms: Date.now() - start,
  };
}

export function jobsForCronTrigger(_cronExpr: string): CronJobName[] {
  return CRON_JOBS;
}
