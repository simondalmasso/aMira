// ============================================================================
// API ROUTE: /api/backtest — synthetic/reconstructed historical replay
// DATA ORIGIN IS ALWAYS TRAINING_MEMORY_ESTIMATE for this engine.
// Persisted telemetry is auxiliary context; it does not convert fixtures to observed history.
// ============================================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { runBacktest, computeCalibration } from '@/lib/backtest-engine';
import { logEvent, getTelemetrySummary } from '@/lib/telemetry';

const querySchema = z.object({
  mode: z.enum(['CONSERVATIVE', 'MODERATE', 'AGGRESSIVE']).default('MODERATE'),
  capital: z.coerce.number().finite().positive().max(1_000_000_000).default(2000),
}).strict();

function invalidQuery(error: z.ZodError) {
  return NextResponse.json({
    success: false,
    code: 'INVALID_BACKTEST_QUERY',
    issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message, code: issue.code })),
    timestamp: new Date().toISOString(),
  }, { status: 422 });
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) return invalidQuery(parsed.error);
  const { mode, capital } = parsed.data;

  try {
    const result = runBacktest(mode, capital);
    const calibration = computeCalibration(result.periodResults);
    const telemetrySummary = await getTelemetrySummary();
    const totalDecisions = telemetrySummary.totalDecisions ?? 0;
    const daysOfHistory = telemetrySummary.daysOfHistory ?? 0;

    logEvent({
      eventType: 'BACKTEST_RUN',
      source: '/api/backtest',
      data: {
        mode,
        capital,
        assessment: result.assessment,
        fixtureOrigin: 'TRAINING_MEMORY_ESTIMATE',
        telemetryDecisionsAvailable: totalDecisions,
        telemetryDaysAvailable: daysOfHistory,
      },
      durationMs: Date.now() - startedAt,
      success: true,
    });

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      mode,
      capital,
      backtest: result,
      calibration,
      durationMs: Date.now() - startedAt,
      dataLabel: 'SIMULADO' as const,
      dataOrigin: 'TRAINING_MEMORY_ESTIMATE' as const,
      disclaimer: 'Resultados calculados contra snapshots sintéticos/reconstruidos. La existencia de telemetría real no convierte estas fixtures en historia observada. No usar como evidencia de rendimiento real.',
      validUntil: null,
      realDataIntegrated: false as const,
      telemetryContext: {
        available: totalDecisions > 0,
        totalDecisions,
        daysOfHistory,
        role: 'AUXILIARY_CONTEXT_ONLY' as const,
      },
    }, {
      headers: {
        'X-Data-Label': 'SIMULADO',
        'X-Data-Origin': 'TRAINING_MEMORY_ESTIMATE',
      },
    });
  } catch (error) {
    console.error('[backtest] execution failed', error);
    logEvent({
      eventType: 'BACKTEST_RUN',
      source: '/api/backtest',
      success: false,
      error: 'BACKTEST_EXECUTION_FAILED',
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({
      success: false,
      code: 'BACKTEST_EXECUTION_FAILED',
      error: 'Backtest execution failed',
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
