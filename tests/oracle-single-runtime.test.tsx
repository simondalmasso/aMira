import { beforeEach, describe, expect, test } from 'bun:test';
import { createOracleSingleHandlers, type OracleSingleDependencies } from '@/app/api/oracle/single/route';
import { runSinglePass, type AssetScoreVector } from '@/lib/single-pass-oracle-engine';
import type { MarketStateInput } from '@/lib/single-market-state';
import { resetLearningState, getLearningSummary } from '@/lib/closed-loop-learning';

const INPUT: MarketStateInput = {
  fx_mep: 1_250,
  inflation_monthly: 0.03,
  rates_tna: 0.30,
  reserves_usd: 26_000,
  reserves_usd_prev: 26_000,
  fx_gap_pct: 5,
  market_breadth: 0.55,
  sources: ['TEST:canonical'],
  quality: 'REAL',
};

const TELEMETRY = {
  state: 'durable',
  binding: 'ORACLE_PREDICTIONS',
  bindingAvailable: true,
  pendingWrites: 0,
  lastSuccessfulReadAt: new Date(0).toISOString(),
  lastSuccessfulWriteAt: new Date(0).toISOString(),
  lastErrorAt: null,
  lastError: null,
};

const LIFECYCLE = {
  storage: 'durable',
  binding: 'ORACLE_PREDICTIONS',
  total_predictions: 0,
  pending: 0,
  rejected: 0,
  latest_prediction: null,
  records: [],
  last_error: null,
};

function dependenciesFor(vector: AssetScoreVector, counters: { v1: number; v3: number; lifecycle: number }) {
  const macro = {
    source: 'TEST',
    realDataPct: 100,
    fetchedAt: new Date(0).toISOString(),
    lastSuccessfulFetch: new Date(0).toISOString(),
  };
  const adapter = {
    input: INPUT,
    overallLabel: 'REAL',
    quality: 'REAL',
    fieldProvenance: [],
    limitations: [],
  };
  return {
    getMacroState: async () => macro,
    applyStaleDegradation: (value: unknown) => value,
    macroStateToMarketInput: () => adapter,
    runSinglePass: () => {
      counters.v1 += 1;
      return vector;
    },
    runV3IntelligenceEnrichment: async (_input: unknown, precomputed: AssetScoreVector) => {
      counters.v3 += 1;
      return {
        v1: precomputed,
        v2: { version: 'v2-test' },
        v3: { version: 'v3-test' },
      };
    },
    recordLifecyclePrediction: async () => {
      counters.lifecycle += 1;
      return {
        prediction_id: 'pred-test',
        rejected: false,
        rejection_reason: null,
      };
    },
    getLifecycleLedgerSnapshot: async () => LIFECYCLE,
    getLearningSummary,
    flushTelemetryWrites: async () => TELEMETRY,
    logEvent: () => undefined,
  } as unknown as Partial<OracleSingleDependencies>;
}

beforeEach(() => {
  resetLearningState();
});

describe('/api/oracle/single runtime contract', () => {
  test('READY executes the canonical V1 engine exactly once and reuses its vector for V3 when durability is confirmed', async () => {
    const vector = runSinglePass(INPUT);
    const counters = { v1: 0, v3: 0, lifecycle: 0 };
    const { GET } = createOracleSingleHandlers(dependenciesFor(vector, counters));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.status).toBe('READY');
    expect(body.warnings).toEqual([]);
    expect(counters).toEqual({ v1: 1, v3: 1, lifecycle: 1 });
    expect(body.learning.status).toBe('NO_HISTORY');
    expect(body.learning.sampleCount).toBe(0);
    expect(body.learning.mean_absolute_error).toBeNull();
    expect(body.learning.directional_accuracy_rate).toBeNull();
    expect(body.learning.mean_brier_score).toBeNull();
  });

  test('durability degradation is visible as PARTIAL without discarding the canonical prediction', async () => {
    const vector = runSinglePass(INPUT);
    const counters = { v1: 0, v3: 0, lifecycle: 0 };
    const dependencies = dependenciesFor(vector, counters);
    dependencies.getLifecycleLedgerSnapshot = (async () => ({ ...LIFECYCLE, storage: 'degraded-memory' })) as OracleSingleDependencies['getLifecycleLedgerSnapshot'];
    dependencies.flushTelemetryWrites = (async () => ({ ...TELEMETRY, state: 'degraded-memory', bindingAvailable: false })) as OracleSingleDependencies['flushTelemetryWrites'];
    const { GET } = createOracleSingleHandlers(dependencies);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.status).toBe('PARTIAL');
    expect(body.warnings).toEqual(['LIFECYCLE_NOT_DURABLE', 'TELEMETRY_NOT_DURABLE']);
    expect(body.vector.scores.length).toBeGreaterThan(0);
    expect(counters).toEqual({ v1: 1, v3: 1, lifecycle: 1 });
  });

  test('missing primary score returns controlled PARTIAL without V2/V3 or lifecycle mutation', async () => {
    const vector = { ...runSinglePass(INPUT), scores: [] };
    const counters = { v1: 0, v3: 0, lifecycle: 0 };
    const { GET } = createOracleSingleHandlers(dependenciesFor(vector, counters));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.status).toBe('PARTIAL');
    expect(body.warnings).toEqual(['NO_PRIMARY_SCORE']);
    expect(body.v2).toBeNull();
    expect(body.v3).toBeNull();
    expect(body.lifecycleRecord).toBeNull();
    expect(counters).toEqual({ v1: 1, v3: 0, lifecycle: 0 });
  });

  test('pipeline failures are sanitized', async () => {
    const vector = runSinglePass(INPUT);
    const counters = { v1: 0, v3: 0, lifecycle: 0 };
    const dependencies = dependenciesFor(vector, counters);
    dependencies.runSinglePass = (() => {
      throw new Error('SECRET_INTERNAL_DETAIL');
    }) as OracleSingleDependencies['runSinglePass'];
    const { GET } = createOracleSingleHandlers(dependencies);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.code).toBe('CANONICAL_ORACLE_PIPELINE_FAILED');
    expect(body.error).toBe('Canonical oracle pipeline failed');
    expect(JSON.stringify(body)).not.toContain('SECRET_INTERNAL_DETAIL');
  });

  test('POST rejects malformed JSON without exposing internals', async () => {
    const vector = runSinglePass(INPUT);
    const counters = { v1: 0, v3: 0, lifecycle: 0 };
    const { POST } = createOracleSingleHandlers(dependenciesFor(vector, counters));
    const request = new Request('http://localhost/api/oracle/single', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json',
    });

    const response = await POST(request);
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body).toMatchObject({ success: false, code: 'INVALID_ORACLE_REQUEST', error: 'Malformed JSON body' });
    expect(counters).toEqual({ v1: 0, v3: 0, lifecycle: 0 });
  });
});
