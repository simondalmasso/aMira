// src/app/api/oracle/single/route.ts
// CANONICAL ORACLE ENDPOINT — one macro state, one V1→V2→V3 pipeline.

import { NextResponse } from 'next/server';
import { applyStaleDegradation, getMacroState } from '@/lib/live-data';
import { macroStateToMarketInput } from '@/lib/macro-market-adapter';
import { runV3IntelligenceEnrichment } from '@/lib/oracle/v3';
import { getLearningState } from '@/lib/closed-loop-learning';
import { getLifecycleSnapshot, recordPrediction } from '@/lib/amira-prediction-lifecycle';
import { flushTelemetryWrites, logEvent } from '@/lib/telemetry';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

const PAPER_REFERENCE_CAPITAL_USD = 2_000;

export async function GET() {
  const startedAt = Date.now();
  try {
    const macro = applyStaleDegradation(await getMacroState());
    const adapter = macroStateToMarketInput(macro);
    const { v1, v2, v3 } = await runV3IntelligenceEnrichment(adapter.input);

    const primaryScore = v1.scores[0];
    const lifecycleRecord = recordPrediction({
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

    logEvent({
      eventType: 'PIPELINE_EXECUTION',
      source: '/api/oracle/single',
      data: {
        modelVersion: v1.model_version,
        v2Version: v2.version,
        v3Version: v3.version,
        macroQuality: adapter.quality,
        lifecyclePredictionId: lifecycleRecord.prediction_id,
      },
      durationMs: Date.now() - startedAt,
      success: !lifecycleRecord.rejected,
      error: lifecycleRecord.rejection_reason ?? undefined,
    });
    const telemetryStorage = await flushTelemetryWrites();

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      vector: v1,
      learning: getLearningState(),
      lifecycle: getLifecycleSnapshot(),
      lifecycleRecord,
      v2,
      v3,
      macro: {
        source: macro.source,
        overallLabel: adapter.overallLabel,
        realDataPct: macro.realDataPct,
        fetchedAt: macro.fetchedAt,
        lastSuccessfulFetch: macro.lastSuccessfulFetch,
        fieldProvenance: adapter.fieldProvenance,
        limitations: adapter.limitations,
      },
      telemetryStorage,
    });
  } catch (error) {
    logEvent({
      eventType: 'SYSTEM_ERROR',
      source: '/api/oracle/single',
      data: { stage: 'canonical-v1-v2-v3' },
      durationMs: Date.now() - startedAt,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
    const telemetryStorage = await flushTelemetryWrites();
    return NextResponse.json({
      success: false,
      code: 'CANONICAL_ORACLE_PIPELINE_FAILED',
      error: error instanceof Error ? error.message : 'Unknown error',
      telemetryStorage,
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
