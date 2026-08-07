// src/app/api/oracle/single/route.ts
// CANONICAL ORACLE ENDPOINT — one macro state, one V1→V2→V3 pipeline.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { applyStaleDegradation, getMacroState } from '@/lib/live-data';
import { macroStateToMarketInput } from '@/lib/macro-market-adapter';
import { runSinglePass } from '@/lib/single-pass-oracle-engine';
import { runV3IntelligenceEnrichment } from '@/lib/oracle/v3';
import { getLifecycleLedgerSnapshot, recordLifecyclePrediction } from '@/lib/amira-prediction-lifecycle-ledger';
import { getLearningSummary } from '@/lib/closed-loop-learning';
import { flushTelemetryWrites, logEvent } from '@/lib/telemetry';
import type { OracleSingleErrorResponse, OracleSingleResponse, OracleSingleSuccessResponse } from '@/lib/oracle/single-response';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

const PAPER_REFERENCE_CAPITAL_USD = 2_000;
const DEFAULT_ASSET = 'SAN' as const;

const OracleSingleRequestSchema = z.object({
  asset: z.literal(DEFAULT_ASSET).optional(),
}).strict();

type OracleSingleRequest = z.infer<typeof OracleSingleRequestSchema>;

const productionDependencies = {
  getMacroState,
  applyStaleDegradation,
  macroStateToMarketInput,
  runSinglePass,
  runV3IntelligenceEnrichment,
  getLifecycleLedgerSnapshot,
  recordLifecyclePrediction,
  getLearningSummary,
  flushTelemetryWrites,
  logEvent,
};

export type OracleSingleDependencies = typeof productionDependencies;

function macroMetadata(
  macro: Awaited<ReturnType<OracleSingleDependencies['getMacroState']>>,
  adapter: ReturnType<OracleSingleDependencies['macroStateToMarketInput']>,
): OracleSingleSuccessResponse['macro'] {
  return {
    source: macro.source,
    overallLabel: adapter.overallLabel,
    realDataPct: macro.realDataPct,
    fetchedAt: macro.fetchedAt,
    lastSuccessfulFetch: macro.lastSuccessfulFetch,
    fieldProvenance: adapter.fieldProvenance,
    limitations: adapter.limitations,
  };
}

function json(response: OracleSingleResponse, status = 200): NextResponse<OracleSingleResponse> {
  return NextResponse.json(response, { status });
}

export function createOracleSingleHandlers(
  overrides: Partial<OracleSingleDependencies> = {},
): {
  GET: () => Promise<NextResponse<OracleSingleResponse>>;
  POST: (request: Request) => Promise<NextResponse<OracleSingleResponse>>;
} {
  const dependencies: OracleSingleDependencies = { ...productionDependencies, ...overrides };

  async function execute(request: OracleSingleRequest): Promise<NextResponse<OracleSingleResponse>> {
    const startedAt = Date.now();
    try {
      const macro = dependencies.applyStaleDegradation(await dependencies.getMacroState());
      const adapter = dependencies.macroStateToMarketInput(macro);
      const v1 = dependencies.runSinglePass(adapter.input);
      const primaryScore = v1.scores.find((score) => score.asset === (request.asset ?? DEFAULT_ASSET)) ?? null;

      if (primaryScore === null) {
        dependencies.logEvent({
          eventType: 'PIPELINE_EXECUTION',
          source: '/api/oracle/single',
          data: { modelVersion: v1.model_version, macroQuality: adapter.quality, warning: 'NO_PRIMARY_SCORE' },
          durationMs: Date.now() - startedAt,
          success: false,
          error: 'NO_PRIMARY_SCORE',
        });
        const [lifecycle, telemetryStorage] = await Promise.all([
          dependencies.getLifecycleLedgerSnapshot(),
          dependencies.flushTelemetryWrites(),
        ]);
        return json({
          success: true,
          status: 'PARTIAL',
          warnings: ['NO_PRIMARY_SCORE'],
          timestamp: new Date().toISOString(),
          vector: v1,
          learning: dependencies.getLearningSummary(),
          lifecycle,
          lifecycleRecord: null,
          v2: null,
          v3: null,
          macro: macroMetadata(macro, adapter),
          telemetryStorage,
        });
      }

      const { v1: enrichedV1, v2, v3 } = await dependencies.runV3IntelligenceEnrichment(adapter.input, v1);
      if (v3 === null) {
        dependencies.logEvent({
          eventType: 'PIPELINE_EXECUTION',
          source: '/api/oracle/single',
          data: { modelVersion: enrichedV1.model_version, macroQuality: adapter.quality, warning: 'ENRICHMENT_UNAVAILABLE' },
          durationMs: Date.now() - startedAt,
          success: false,
          error: 'ENRICHMENT_UNAVAILABLE',
        });
        const [lifecycle, telemetryStorage] = await Promise.all([
          dependencies.getLifecycleLedgerSnapshot(),
          dependencies.flushTelemetryWrites(),
        ]);
        return json({
          success: true,
          status: 'PARTIAL',
          warnings: ['ENRICHMENT_UNAVAILABLE'],
          timestamp: new Date().toISOString(),
          vector: enrichedV1,
          learning: dependencies.getLearningSummary(),
          lifecycle,
          lifecycleRecord: null,
          v2,
          v3: null,
          macro: macroMetadata(macro, adapter),
          telemetryStorage,
        });
      }
      const lifecycleRecord = await dependencies.recordLifecyclePrediction({
        horizon_days: primaryScore.prediction.horizon_days,
        asset_context: primaryScore.asset,
        expected_return: primaryScore.prediction.expected_return,
        expected_profit_usd: primaryScore.prediction.expected_return * PAPER_REFERENCE_CAPITAL_USD,
        confidence_score: primaryScore.prediction.confidence,
        data_sources: adapter.input.sources ?? [],
        capital: PAPER_REFERENCE_CAPITAL_USD,
        risk: Math.abs(primaryScore.prediction.risk_var_95),
        stress_mode: primaryScore.regime.regime,
        freshness: adapter.quality,
        fallback_level: adapter.overallLabel,
      });

      dependencies.logEvent({
        eventType: 'PIPELINE_EXECUTION',
        source: '/api/oracle/single',
        data: {
          modelVersion: enrichedV1.model_version,
          v2Version: v2.version,
          v3Version: v3.version,
          macroQuality: adapter.quality,
          lifecyclePredictionId: lifecycleRecord.prediction_id,
        },
        durationMs: Date.now() - startedAt,
        success: !lifecycleRecord.rejected,
        error: lifecycleRecord.rejection_reason ?? undefined,
      });
      const [lifecycle, telemetryStorage] = await Promise.all([
        dependencies.getLifecycleLedgerSnapshot(),
        dependencies.flushTelemetryWrites(),
      ]);
      const durabilityWarnings: OracleSingleSuccessResponse['warnings'] = [];
      if (lifecycle.storage !== 'durable') durabilityWarnings.push('LIFECYCLE_NOT_DURABLE');
      if (telemetryStorage.state !== 'durable') durabilityWarnings.push('TELEMETRY_NOT_DURABLE');
      return json({
        success: true,
        status: durabilityWarnings.length === 0 ? 'READY' : 'PARTIAL',
        warnings: durabilityWarnings,
        timestamp: new Date().toISOString(),
        vector: enrichedV1,
        learning: dependencies.getLearningSummary(),
        lifecycle,
        lifecycleRecord,
        v2,
        v3,
        macro: macroMetadata(macro, adapter),
        telemetryStorage,
      });
    } catch {
      dependencies.logEvent({
        eventType: 'SYSTEM_ERROR',
        source: '/api/oracle/single',
        data: { stage: 'canonical-v1-v2-v3' },
        durationMs: Date.now() - startedAt,
        success: false,
        error: 'CANONICAL_ORACLE_PIPELINE_FAILED',
      });
      const telemetryStorage = await dependencies.flushTelemetryWrites();
      const response: OracleSingleErrorResponse = {
        success: false,
        code: 'CANONICAL_ORACLE_PIPELINE_FAILED',
        error: 'Canonical oracle pipeline failed',
        telemetryStorage,
        timestamp: new Date().toISOString(),
      };
      return json(response, 500);
    }
  }

  return {
    GET: () => execute({ asset: DEFAULT_ASSET }),
    POST: async (request: Request) => {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({
          success: false,
          code: 'INVALID_ORACLE_REQUEST',
          error: 'Malformed JSON body',
          telemetryStorage: await dependencies.flushTelemetryWrites(),
          timestamp: new Date().toISOString(),
        }, 400);
      }
      const parsed = OracleSingleRequestSchema.safeParse(body);
      if (!parsed.success) {
        return json({
          success: false,
          code: 'INVALID_ORACLE_REQUEST',
          error: 'Invalid oracle request',
          telemetryStorage: await dependencies.flushTelemetryWrites(),
          timestamp: new Date().toISOString(),
        }, 400);
      }
      return execute(parsed.data);
    },
  };
}

const handlers = createOracleSingleHandlers();

export async function GET(): Promise<NextResponse<OracleSingleResponse>> {
  return handlers.GET();
}

export async function POST(request: Request): Promise<NextResponse<OracleSingleResponse>> {
  return handlers.POST(request);
}
