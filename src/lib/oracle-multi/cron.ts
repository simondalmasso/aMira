// src/lib/oracle-multi/cron.ts
// Scheduled-job logic for V4 multi-asset Oracle.
// Cron expression: "0 20 * * 1-5" (America/Argentina/Buenos_Aires) — 20:00 ART Mon-Fri.
// Jobs per spec: refresh_fci, refresh_stocks, refresh_bonds, refresh_cedears, refresh_predictions, snapshot_archive.

import {
  runMultiOracle,
  type MultiStorage,
  resolveMultiStorage,
} from './index';
// E3_2026_07_09_GEMINI: AssetClass, ASSET_CLASS_ORDER, loadRecentSnapshots imports
// removed — were only used by the deleted snapshot_archive case.

export type CronJobName =
  | 'refresh_fci'
  | 'refresh_stocks'
  | 'refresh_bonds'
  | 'refresh_cedears'
  | 'refresh_predictions';

// E3_2026_07_09_GEMINI: removed 'snapshot_archive' from CRON_JOBS.
// Fix A (wrap-worker-with-cron.mjs) already removed it from the wrapper's
// CRON_JOBS array — without this corresponding cleanup here, runAllCronJobs()
// (invoked via POST /api/oracle/cron) would still execute the dead snapshot_archive
// case. Keeping both arrays in sync prevents out-of-sync execution paths.
export const CRON_JOBS: CronJobName[] = [
  'refresh_fci',
  'refresh_stocks',
  'refresh_bonds',
  'refresh_cedears',
  'refresh_predictions',
];

export interface CronJobResult {
  job: CronJobName;
  ok: boolean;
  duration_ms: number;
  error?: string;
  meta?: Record<string, unknown>;
}

/** Run a single cron job. Each job calls runMultiOracle() with the relevant class(es). */
async function runJob(job: CronJobName, storage: MultiStorage): Promise<CronJobResult> {
  const start = Date.now();
  try {
    switch (job) {
      case 'refresh_fci': {
        const result = await runMultiOracle({ storage, classes: ['FCI'], topN: 5 });
        return {
          job,
          ok: result.source_status !== 'ERROR',
          duration_ms: Date.now() - start,
          meta: { total_assets: result.total_assets, snapshot_date: result.snapshot_date },
        };
      }
      case 'refresh_stocks': {
        const result = await runMultiOracle({ storage, classes: ['ACCIONES'], topN: 5 });
        return {
          job,
          ok: result.source_status !== 'ERROR',
          duration_ms: Date.now() - start,
          meta: { total_assets: result.total_assets },
        };
      }
      case 'refresh_bonds': {
        const result = await runMultiOracle({ storage, classes: ['BONOS'], topN: 5 });
        return {
          job,
          ok: result.source_status !== 'ERROR',
          duration_ms: Date.now() - start,
          meta: { total_assets: result.total_assets },
        };
      }
      case 'refresh_cedears': {
        const result = await runMultiOracle({ storage, classes: ['CEDEARS', 'ETF_CEDEARS'], topN: 5 });
        return {
          job,
          ok: result.source_status !== 'ERROR',
          duration_ms: Date.now() - start,
          meta: { total_assets: result.total_assets },
        };
      }
      case 'refresh_predictions': {
        // Re-run all classes so the predictor has the latest snapshots
        const result = await runMultiOracle({ storage, topN: 5 });
        return {
          job,
          ok: result.source_status !== 'ERROR',
          duration_ms: Date.now() - start,
          meta: {
            predictions_active: result.predictions_summary.active,
            assets_with_predictions: result.predictions_summary.assets_with_predictions,
            high_conviction: result.predictions_summary.high_conviction_count,
          },
        };
      }
      // E3_2026_07_09_GEMINI: 'snapshot_archive' case removed — was a no-op KV
      // verifier that caused the cron recursion bug (Fix A). Each refresh_* job
      // already writes its own snapshot, making archive verification redundant.
      default:
        // Type narrowing ensures this is only reached if an invalid cast bypasses TS
        return { job, ok: false, duration_ms: Date.now() - start, error: 'unknown_job' };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { job, ok: false, duration_ms: Date.now() - start, error: msg };
  }
}

/** Run all 6 cron jobs sequentially (to avoid KV write contention). */
export async function runAllCronJobs(env?: {
  ORACLE_FCI_HISTORY?: KVNamespace;
  ORACLE_ASSETS_HISTORY?: KVNamespace;
  ORACLE_PREDICTIONS?: KVNamespace;
}): Promise<{ results: CronJobResult[]; started_at: string; finished_at: string; total_duration_ms: number }> {
  const started_at = new Date().toISOString();
  const start = Date.now();
  const storage = resolveMultiStorage(env);
  const results: CronJobResult[] = [];
  for (const job of CRON_JOBS) {
    const r = await runJob(job, storage);
    results.push(r);
  }
  return {
    results,
    started_at,
    finished_at: new Date().toISOString(),
    total_duration_ms: Date.now() - start,
  };
}

/** Map Cloudflare cron event.cron → job name(s). Since we use a single cron "0 20 * * 1-5",
 *  all jobs run on each invocation. (Future: split crons per job.) */
export function jobsForCronTrigger(_cronExpr: string): CronJobName[] {
  return CRON_JOBS;
}
