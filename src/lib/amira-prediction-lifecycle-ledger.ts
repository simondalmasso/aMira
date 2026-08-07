// Durable storage adapter for the ONE canonical server-side lifecycle core.
// This module owns Cloudflare KV I/O only; lifecycle domain truth lives in
// amira-prediction-lifecycle-core.ts and is hydrated idempotently from KV.

import { getCloudflareContext } from '@opennextjs/cloudflare';
import {
  findPrediction,
  getLifecycleSnapshot,
  getOutcomesLog,
  getPredictionsLog,
  getVerificationsLog,
  hydrateLifecycleEvents,
  lifecycleCaptureOutcome,
  lifecycleExpireStalePredictions,
  lifecycleRecordPrediction,
  lifecycleVerifyPrediction,
  type CaptureOutcomeOptions,
  type OutcomeEvent,
  type PredictionEvent,
  type RecordPredictionOptions,
  type VerificationEvent,
} from './amira-prediction-lifecycle-core';
import { rebuildLearningStateFromLifecycle } from './closed-loop-learning';

const PREFIX = {
  prediction: 'lifecycle:prediction:',
  outcome: 'lifecycle:outcome:',
  verification: 'lifecycle:verification:',
} as const;
const TTL_SECONDS = 400 * 24 * 60 * 60;
const BINDING = 'ORACLE_PREDICTIONS' as const;
const MAX_HYDRATE = 500;

type LedgerEnv = { ORACLE_PREDICTIONS?: KVNamespace };
export type LifecycleLedgerStorage = 'durable' | 'degraded-memory' | 'unavailable';

export type LifecycleLedgerRecord = PredictionEvent & {
  rejected: boolean;
  rejection_reason: string | null;
};

export interface LifecycleWriteAck {
  durable: boolean;
  key: string;
  event_id: string;
  persisted_at: string | null;
}

export interface LifecycleLedgerSnapshot {
  storage: LifecycleLedgerStorage;
  binding: typeof BINDING;
  total_predictions: number;
  pending: number;
  rejected: number;
  latest_prediction: LifecycleLedgerRecord | null;
  records: LifecycleLedgerRecord[];
  canonical: ReturnType<typeof getLifecycleSnapshot>;
  last_error: string | null;
  last_successful_read_at: string | null;
  last_successful_write_at: string | null;
}

let storage: LifecycleLedgerStorage = 'degraded-memory';
let lastError: string | null = null;
let lastSuccessfulReadAt: string | null = null;
let lastSuccessfulWriteAt: string | null = null;
let hydrationPromise: Promise<void> | null = null;

function getKv(): KVNamespace | null {
  try {
    const env = getCloudflareContext().env as LedgerEnv;
    const kv = env.ORACLE_PREDICTIONS ?? null;
    storage = kv ? (storage === 'unavailable' ? 'unavailable' : 'durable') : 'degraded-memory';
    return kv;
  } catch {
    storage = 'degraded-memory';
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function markSuccess(kind: 'read' | 'write'): void {
  const now = new Date().toISOString();
  storage = 'durable';
  lastError = null;
  if (kind === 'read') lastSuccessfulReadAt = now;
  else lastSuccessfulWriteAt = now;
}

function markFailure(error: unknown): void {
  storage = 'unavailable';
  lastError = errorMessage(error);
}

function rejectedReason(record: PredictionEvent): string | null {
  return record.verification_status === 'REJECTED' ? 'rule_5_no_data_sources' : null;
}

function toLedgerRecord(record: PredictionEvent): LifecycleLedgerRecord {
  return {
    ...record,
    data_sources: [...record.data_sources],
    rejected: record.verification_status === 'REJECTED',
    rejection_reason: rejectedReason(record),
  };
}

async function readPrefix<T>(kv: KVNamespace, prefix: string): Promise<T[]> {
  const listed = await kv.list({ prefix, limit: MAX_HYDRATE });
  const values = await Promise.all(listed.keys.map(async ({ name }) => {
    const raw = await kv.get(name);
    if (!raw) return null;
    try { return JSON.parse(raw) as T; } catch { return null; }
  }));
  return values.flatMap((value) => value === null ? [] : [value]);
}

/** Hydrates canonical lifecycle + deterministic learning state once per isolate. */
export async function hydrateLifecycleFromStorage(): Promise<void> {
  if (hydrationPromise) return hydrationPromise;
  hydrationPromise = (async () => {
    const kv = getKv();
    if (!kv) return;
    try {
      const [predictions, outcomes, verifications] = await Promise.all([
        readPrefix<PredictionEvent>(kv, PREFIX.prediction),
        readPrefix<OutcomeEvent>(kv, PREFIX.outcome),
        readPrefix<VerificationEvent>(kv, PREFIX.verification),
      ]);
      hydrateLifecycleEvents({ predictions, outcomes, verifications });
      rebuildLearningStateFromLifecycle();
      markSuccess('read');
    } catch (error) {
      markFailure(error);
      hydrationPromise = null;
    }
  })();
  return hydrationPromise;
}

async function persistEvent(kind: keyof typeof PREFIX, id: string, value: unknown): Promise<LifecycleWriteAck> {
  const kv = getKv();
  const key = PREFIX[kind] + id;
  if (!kv) return { durable: false, key, event_id: id, persisted_at: null };
  try {
    await kv.put(key, JSON.stringify(value), { expirationTtl: TTL_SECONDS });
    markSuccess('write');
    return { durable: true, key, event_id: id, persisted_at: lastSuccessfulWriteAt };
  } catch (error) {
    markFailure(error);
    throw new Error(`LIFECYCLE_PERSIST_FAILED:${kind}`);
  }
}

async function persistPredictionState(predictionId: string): Promise<LifecycleWriteAck | null> {
  const prediction = findPrediction(predictionId);
  return prediction ? persistEvent('prediction', prediction.prediction_id, prediction) : null;
}

export async function recordLifecyclePrediction(input: RecordPredictionOptions): Promise<LifecycleLedgerRecord> {
  await hydrateLifecycleFromStorage();
  const validationErrors: string[] = [];
  if (![30, 60, 90].includes(input.horizon_days)) validationErrors.push('INVALID_HORIZON');
  if (!input.asset_context.trim()) validationErrors.push('INVALID_ASSET_CONTEXT');
  if (input.data_sources.length === 0) validationErrors.push('MISSING_DATA_SOURCES');
  if (![input.expected_return, input.expected_profit_usd, input.confidence_score, input.capital, input.risk].every(Number.isFinite)) validationErrors.push('NON_FINITE_PREDICTION');
  if (input.confidence_score < 0 || input.confidence_score > 1) validationErrors.push('INVALID_CONFIDENCE');

  const safeInput: RecordPredictionOptions = {
    ...input,
    data_sources: validationErrors.length === 0 ? [...input.data_sources] : [],
  };
  lifecycleRecordPrediction(safeInput);
  const canonical = getPredictionsLog().at(-1);
  if (!canonical) throw new Error('LIFECYCLE_RECORD_FAILED');
  await persistEvent('prediction', canonical.prediction_id, canonical);
  return {
    ...toLedgerRecord(canonical),
    rejected: validationErrors.length > 0 || canonical.verification_status === 'REJECTED',
    rejection_reason: validationErrors.length > 0 ? validationErrors.join(',') : rejectedReason(canonical),
  };
}

export async function captureLifecycleOutcome(input: CaptureOutcomeOptions): Promise<{
  outcome: OutcomeEvent | null;
  write: LifecycleWriteAck | null;
  error: string | null;
}> {
  await hydrateLifecycleFromStorage();
  const result = lifecycleCaptureOutcome(input);
  if (!result.outcome_id) return { outcome: null, write: null, error: result.error };
  const outcome = getOutcomesLog().find((item) => item.outcome_id === result.outcome_id) ?? null;
  if (!outcome) return { outcome: null, write: null, error: 'OUTCOME_EVENT_MISSING' };
  const write = await persistEvent('outcome', outcome.outcome_id, outcome);
  await persistPredictionState(input.prediction_id);
  return { outcome, write, error: null };
}

export async function verifyLifecyclePrediction(predictionId: string): Promise<{
  verification: VerificationEvent | null;
  write: LifecycleWriteAck | null;
  error: string | null;
}> {
  await hydrateLifecycleFromStorage();
  const result = lifecycleVerifyPrediction(predictionId);
  if (!result.verification_id || !result.verification) return { verification: null, write: null, error: result.error };
  const write = await persistEvent('verification', result.verification_id, result.verification);
  await persistPredictionState(predictionId);
  rebuildLearningStateFromLifecycle();
  return { verification: result.verification, write, error: null };
}

export async function recoverLifecycle(now: number = Date.now()): Promise<{
  storage: LifecycleLedgerStorage;
  expired_count: number;
  expired_ids: string[];
  persisted_expirations: number;
}> {
  await hydrateLifecycleFromStorage();
  const expired = lifecycleExpireStalePredictions(now);
  let persisted = 0;
  for (const id of expired.expired_ids) {
    const ack = await persistPredictionState(id);
    if (ack?.durable) persisted += 1;
  }
  return { storage, expired_count: expired.expired_count, expired_ids: expired.expired_ids, persisted_expirations: persisted };
}

export async function getLifecycleLedgerSnapshot(limit = 100): Promise<LifecycleLedgerSnapshot> {
  await hydrateLifecycleFromStorage();
  const canonical = getLifecycleSnapshot();
  const records = getPredictionsLog()
    .slice()
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit)
    .map(toLedgerRecord);
  return {
    storage,
    binding: BINDING,
    total_predictions: canonical.counts.total_predictions,
    pending: canonical.counts.pending,
    rejected: canonical.counts.rejected,
    latest_prediction: records[0] ?? null,
    records,
    canonical,
    last_error: lastError,
    last_successful_read_at: lastSuccessfulReadAt,
    last_successful_write_at: lastSuccessfulWriteAt,
  };
}
