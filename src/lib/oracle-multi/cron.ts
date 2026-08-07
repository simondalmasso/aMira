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

const NO_DATA_STATUS_PREFIX = 'snap:status';
const NO_DATA_STATUS_TTL_SECONDS = 7 * 24 * 60 * 60;

export type PersistenceAckStatus = 'DURABLE' | 'DURABLE_NO_DATA' | 'FAILED';

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

type NoDataStatusSnapshot = {
  date: string;
  fetched_at: string;
  source: 'OBSERVED_UNAVAILABLE';
  asset_class: AssetClass;
  total_assets: 0;
  source_status: 'ERROR';
  data_class: 'OBSERVED_UNAVAILABLE';
  no_data: true;
  reason: 'NO_OBSERVED_SOURCE_DATA';
};

function storageForClass(storage: MultiStorage, cls: AssetClass) {
  return cls === 'FCI' ? storage.fci : storage.assets;
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
    const raw = await storageForClass(storage, cls).get(key);
    if (!raw) {
      missing_keys.push(key);
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as { asset_class?: string; date?: string; fetched_at?: string; total_assets?: number };
      if (
        parsed.asset_class === cls
        && parsed.date === snapshotDate
        && typeof parsed.fetched_at === 'string'
        && typeof parsed.total_assets === 'number'
      ) {
        verified_keys.push(key);
      } else {
        missing_keys.push(key);
      }
    } catch {
      missing_keys.push(key);
    }
  }
  const durable = missing_keys.length === 0 && keys.length > 0;
  return { durable, status: durable ? 'DURABLE' : 'FAILED', snapshot_date: snapshotDate, keys, verified_keys, missing_keys };
}

async function verifyNoDataStatusWrites(
  storage: MultiStorage,
  classes: AssetClass[],
  snapshotDate: string,
): Promise<CronPersistenceAck> {
  const keys = classes.map((cls) => `${NO_DATA_STATUS_PREFIX}:${cls}:${snapshotDate}`);
  const verified_keys: string[] = [];
  const missing_keys: string[] = [];

  for (let index = 0; index < classes.length; index += 1) {
    const cls = classes[index];
    const key = keys[index];
    const raw = await storageForClass(storage, cls).get(key);
    if (!raw) {
      missing_keys.push(key);
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<NoDataStatusSnapshot>;
      if (
        parsed.asset_class === cls
        && parsed.date === snapshotDate
        && typeof parsed.fetched_at === 'string'
        && parsed.source === 'OBSERVED_UNAVAILABLE'
        && parsed.data_class === 'OBSERVED_UNAVAILABLE'
        && parsed.no_data === true
        && parsed.total_assets === 0
        && parsed.reason === 'NO_OBSERVED_SOURCE_DATA'
      ) {
        verified_keys.push(key);
      } else {
        missing_keys.push(key);
      }
    } catch {
      missing_keys.push(key);
    }
  }

  const durable = missing_keys.length === 0 && keys.length > 0;
  return {
    durable,
    status: durable ? 'DURABLE_NO_DATA' : 'FAILED',
    snapshot_date: snapshotDate,
    keys,
    verified_keys,
    missing_keys,
    ...(durable ? { reason: 'NO_OBSERVED_SOURCE_DATA' as const } : {}),
  };
}

async function persistNoDataStatusSnapshots(
  storage: MultiStorage,
  classes: AssetClass[],
  snapshotDate: string,
): Promise<CronPersistenceAck> {
  const fetchedAt = new Date().toISOString();
  for (const cls of classes) {
    const key = `${NO_DATA_STATUS_PREFIX}:${cls}:${snapshotDate}`;
    const record: NoDataStatusSnapshot = {
      date: snapshotDate,
      fetched_at: fetchedAt,
      source: 'OBSERVED_UNAVAILABLE',
      asset_class: cls,
      total_assets: 0,
      source_status: 'ERROR',
      data_class: 'OBSERVED_UNAVAILABLE',
      no_data: true,
      reason: 'NO_OBSERVED_SOURCE_DATA',
    };
    await storageForClass(storage, cls).put(
      key,
      JSON.stringify(record),
      { expirationTtl: NO_DATA_STATUS_TTL_SECONDS },
    );
  }
  return verifyNoDataStatusWrites(storage, classes, snapshotDate);
}

function combinePersistenceAcks(
  snapshotDate: string,
  acks: CronPersistenceAck[],
): CronPersistenceAck {
  if (acks.length === 0) {
    return {
      durable: false,
      status: 'FAILED',
      snapshot_date: snapshotDate,
      keys: [],
      verified_keys: [],
      missing_keys: [],
    };
  }
  const durable = acks.every((ack) => ack.durable);
  const hasNoData = acks.some((ack) => ack.status === 'DURABLE_NO_DATA');
  return {
    durable,
    status: durable ? (hasNoData ? 'DURABLE_NO_DATA' : 'DURABLE') : 'FAILED',
    snapshot_date: snapshotDate,
    keys: acks.flatMap((ack) => ack.keys),
    verified_keys: acks.flatMap((ack) => ack.verified_keys),
    missing_keys: acks.flatMap((ack) => ack.missing_keys),
    ...(durable && hasNoData ? { reason: 'NO_OBSERVED_SOURCE_DATA' as const } : {}),
  };
}

function sourceMeta(result: MultiOracleResponse): Record<string, unknown> {
  return {
    source_status: result.source_status,
    total_assets: result.total_assets,
    classes_fetched: result.metadata.classes_fetched,
    classes_failed: result.metadata.classes_failed,
    snapshot_date: result.snapshot_date,
    error_count: result.errors.length,
  };
}

async function persistenceForResult(
  storage: MultiStorage,
  requestedClasses: AssetClass[],
  result: MultiOracleResponse,
): Promise<CronPersistenceAck> {
  const fetchedClasses = requestedClasses.filter((cls) => result.metadata.classes_fetched.includes(cls));
  const unavailableClasses = requestedClasses.filter((cls) => !fetchedClasses.includes(cls));
  const acks: CronPersistenceAck[] = [];

  if (fetchedClasses.length > 0) {
    acks.push(await verifySnapshotWrites(storage, fetchedClasses, result.snapshot_date));
  }
  if (unavailableClasses.length > 0) {
    // A no-data observation is persisted under a distinct status key. It must never
    // overwrite `snap:<class>:<date>`, which may contain the last valid observation.
    acks.push(await persistNoDataStatusSnapshots(storage, unavailableClasses, result.snapshot_date));
  }

  return combinePersistenceAcks(result.snapshot_date, acks);
}

async function classResult(
  job: CronJobName,
  storage: MultiStorage,
  classes: AssetClass[],
  start: number,
): Promise<CronJobResult> {
  const result = await runMultiOracle({ storage, classes, topN: 5 });
  const persistence_ack = await persistenceForResult(storage, classes, result);
  const degradedNoData = persistence_ack.status === 'DURABLE_NO_DATA';
  return {
    job,
    ok: persistence_ack.durable && (result.source_status !== 'ERROR' || degradedNoData),
    duration_ms: Date.now() - start,
    meta: { ...sourceMeta(result), degraded_no_data: degradedNoData },
    persistence_ack,
  };
}

/** Run a single cron job. No-source states persist truthful status snapshots without replacing valid history. */
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
        const classes: AssetClass[] = ['FCI', 'PLAZO_FIJO', 'ACCIONES', 'BONOS', 'CEDEARS', 'ETF_CEDEARS'];
        const result = await runMultiOracle({ storage, classes, topN: 5 });
        const persistence_ack = await persistenceForResult(storage, classes, result);
        const degradedNoData = persistence_ack.status === 'DURABLE_NO_DATA';
        return {
          job,
          ok: persistence_ack.durable && (result.source_status !== 'ERROR' || degradedNoData),
          duration_ms: Date.now() - start,
          meta: {
            ...sourceMeta(result),
            degraded_no_data: degradedNoData,
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
