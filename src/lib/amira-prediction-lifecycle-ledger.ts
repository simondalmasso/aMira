// Server-safe append-only prediction ledger. No React dependency.

import { getCloudflareContext } from '@opennextjs/cloudflare';

const PREFIX = 'lifecycle:prediction:';
const TTL_SECONDS = 400 * 24 * 60 * 60;
const BINDING = 'ORACLE_PREDICTIONS' as const;

type LedgerEnv = { ORACLE_PREDICTIONS?: KVNamespace };
export type LifecycleLedgerStorage = 'durable' | 'degraded-memory' | 'unavailable';

export interface LifecycleLedgerRecord {
  prediction_id: string;
  timestamp: string;
  horizon_days: 30 | 60 | 90;
  asset_context: string;
  expected_return: number;
  expected_profit_usd: number;
  confidence_score: number;
  data_sources: string[];
  capital: number;
  risk: number;
  stress_mode: string;
  freshness: string;
  fallback_level: string;
  verification_status: 'PENDING' | 'REJECTED';
  lifecycle_stage: 'PREDICTION';
  outcome_linked: null;
  rejected: boolean;
  rejection_reason: string | null;
}

export interface LifecycleLedgerSnapshot {
  storage: LifecycleLedgerStorage;
  binding: typeof BINDING;
  total_predictions: number;
  pending: number;
  rejected: number;
  latest_prediction: LifecycleLedgerRecord | null;
  records: LifecycleLedgerRecord[];
  last_error: string | null;
}

const memory = new Map<string, LifecycleLedgerRecord>();
let storage: LifecycleLedgerStorage = 'degraded-memory';
let lastError: string | null = null;

function getKv(): KVNamespace | null {
  try {
    const env = getCloudflareContext().env as LedgerEnv;
    const kv = env.ORACLE_PREDICTIONS ?? null;
    if (kv && storage !== 'unavailable') storage = 'durable';
    if (!kv) storage = 'degraded-memory';
    return kv;
  } catch {
    storage = 'degraded-memory';
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function validHorizon(value: number): value is 30 | 60 | 90 {
  return value === 30 || value === 60 || value === 90;
}

export async function recordLifecyclePrediction(input: {
  horizon_days: number;
  asset_context: string;
  expected_return: number;
  expected_profit_usd: number;
  confidence_score: number;
  data_sources: string[];
  capital: number;
  risk: number;
  stress_mode: string;
  freshness: string;
  fallback_level: string;
}): Promise<LifecycleLedgerRecord> {
  const timestamp = new Date().toISOString();
  const validationErrors: string[] = [];
  if (!validHorizon(input.horizon_days)) validationErrors.push('INVALID_HORIZON');
  if (!input.asset_context.trim()) validationErrors.push('INVALID_ASSET_CONTEXT');
  if (input.data_sources.length === 0) validationErrors.push('MISSING_DATA_SOURCES');
  if (![input.expected_return, input.expected_profit_usd, input.confidence_score, input.capital, input.risk].every(Number.isFinite)) {
    validationErrors.push('NON_FINITE_PREDICTION');
  }
  if (input.confidence_score < 0 || input.confidence_score > 1) validationErrors.push('INVALID_CONFIDENCE');

  const rejected = validationErrors.length > 0;
  const record: LifecycleLedgerRecord = {
    prediction_id: `pred_${Date.now()}_${crypto.randomUUID()}`,
    timestamp,
    horizon_days: validHorizon(input.horizon_days) ? input.horizon_days : 30,
    asset_context: input.asset_context,
    expected_return: input.expected_return,
    expected_profit_usd: input.expected_profit_usd,
    confidence_score: input.confidence_score,
    data_sources: [...input.data_sources],
    capital: input.capital,
    risk: input.risk,
    stress_mode: input.stress_mode,
    freshness: input.freshness,
    fallback_level: input.fallback_level,
    verification_status: rejected ? 'REJECTED' : 'PENDING',
    lifecycle_stage: 'PREDICTION',
    outcome_linked: null,
    rejected,
    rejection_reason: rejected ? validationErrors.join(',') : null,
  };

  memory.set(record.prediction_id, record);
  const kv = getKv();
  if (kv) {
    try {
      await kv.put(PREFIX + record.prediction_id, JSON.stringify(record), { expirationTtl: TTL_SECONDS });
      storage = 'durable';
      lastError = null;
    } catch (error) {
      storage = 'unavailable';
      lastError = errorMessage(error);
      throw new Error(`LIFECYCLE_PERSIST_FAILED: ${lastError}`);
    }
  }
  return record;
}

async function durableRecords(limit: number): Promise<LifecycleLedgerRecord[]> {
  const kv = getKv();
  if (!kv) return [];
  try {
    const listed = await kv.list({ prefix: PREFIX, limit });
    const values = await Promise.all(listed.keys.map(async ({ name }) => {
      const raw = await kv.get(name);
      return raw ? JSON.parse(raw) as LifecycleLedgerRecord : null;
    }));
    storage = 'durable';
    lastError = null;
    return values.flatMap((value) => value === null ? [] : [value]);
  } catch (error) {
    storage = 'unavailable';
    lastError = errorMessage(error);
    return [];
  }
}

export async function getLifecycleLedgerSnapshot(limit = 100): Promise<LifecycleLedgerSnapshot> {
  const merged = new Map<string, LifecycleLedgerRecord>();
  for (const record of await durableRecords(limit)) merged.set(record.prediction_id, record);
  for (const record of memory.values()) merged.set(record.prediction_id, record);
  const records = [...merged.values()]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);
  return {
    storage,
    binding: BINDING,
    total_predictions: records.length,
    pending: records.filter((record) => record.verification_status === 'PENDING').length,
    rejected: records.filter((record) => record.verification_status === 'REJECTED').length,
    latest_prediction: records[0] ?? null,
    records,
    last_error: lastError,
  };
}
