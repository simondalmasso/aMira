// ============================================================================
// Ω-X10 TEMPORAL VALIDATION API — synthetic/reconstructed validation only
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runTemporalValidation, type TemporalValidationConfig } from '@/lib/temporal-validation-engine';
import { getHistoricalDatasetStats, getSurvivalTests, getSnapshotsInRange } from '@/lib/macro-state-rebuilder';

export const dynamic = 'force-dynamic';

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM');
const querySchema = z.object({
  action: z.enum(['full', 'stats', 'survival']).default('full'),
  mode: z.enum(['CONSERVATIVE', 'MODERATE', 'AGGRESSIVE']).default('MODERATE'),
  capital: z.coerce.number().finite().positive().max(1_000_000_000).default(2000),
  start: month.default('2018-01'),
  end: month.default('2026-06'),
  survival: z.enum(['true', 'false']).default('true'),
}).strict().superRefine((value, ctx) => {
  if (value.start > value.end) {
    ctx.addIssue({ code: 'custom', path: ['start'], message: 'start must be before or equal to end' });
  }
});

function invalidQuery(error: z.ZodError) {
  return NextResponse.json({
    success: false,
    code: 'INVALID_TEMPORAL_VALIDATION_QUERY',
    issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message, code: issue.code })),
    timestamp: new Date().toISOString(),
  }, { status: 422 });
}

const syntheticHeaders = {
  'X-Data-Label': 'SIMULADO',
  'X-Data-Origin': 'TRAINING_MEMORY_ESTIMATE',
};

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parsed.success) return invalidQuery(parsed.error);

  const { action, mode, capital, start, end, survival } = parsed.data;
  try {
    if (action === 'stats') {
      return NextResponse.json({
        action: 'stats',
        data: getHistoricalDatasetStats(),
        timestamp: new Date().toISOString(),
        dataLabel: 'SIMULADO' as const,
        dataOrigin: 'TRAINING_MEMORY_ESTIMATE' as const,
        disclaimer: 'Estadísticas basadas en snapshots sintéticos/reconstruidos. No constituyen datos observados.',
        realDataIntegrated: false as const,
      }, { headers: syntheticHeaders });
    }

    if (action === 'survival') {
      const tests = getSurvivalTests();
      const snapshots = getSnapshotsInRange(start, end);
      return NextResponse.json({
        action: 'survival',
        tests: tests.map((test) => ({
          id: test.id,
          name: test.name,
          question: test.question,
          description: test.description,
          periodStart: test.periodStart,
          periodEnd: test.periodEnd,
          snapshotCount: test.snapshots.length,
        })),
        dateRange: { start, end },
        snapshotsInRange: snapshots.length,
        timestamp: new Date().toISOString(),
        dataLabel: 'SIMULADO' as const,
        dataOrigin: 'TRAINING_MEMORY_ESTIMATE' as const,
        disclaimer: 'Tests de supervivencia basados en snapshots sintéticos/reconstruidos. No constituyen datos observados.',
        realDataIntegrated: false as const,
      }, { headers: syntheticHeaders });
    }

    const config: TemporalValidationConfig = {
      mode,
      initialCapitalUSD: capital,
      dateRange: { start, end },
      includeSurvivalTests: survival === 'true',
      paperBrokerParams: {
        baseSlippageBps: 5,
        commissionRate: 0.001,
        fillProbability: 0.98,
      },
      seed: 42,
    };
    const result = runTemporalValidation(config);
    const serialized = {
      ...result,
      replayResults: result.replayResults.map((replay) => ({
        date: replay.date,
        label: replay.label,
        predictedRegime: replay.predictedRegime,
        actualRegime: replay.actualRegime,
        regimeCorrect: replay.regimeCorrect,
        confidence: replay.confidence,
        predictedReturnUSD: replay.predictedReturnUSD,
        actualReturnUSD: replay.actualReturnUSD,
        returnError: replay.returnError,
        ordersExecuted: replay.ordersExecuted,
        fillsExecuted: replay.fillsExecuted,
        commissionsPaid: replay.commissionsPaid,
        capitalPreservationActive: replay.capitalPreservationActive,
        emergencyFreeze: replay.emergencyFreeze,
        computationMs: replay.computationMs,
      })),
      pnlAttribution: result.pnlAttribution.slice(0, 5),
      dataLabel: 'SIMULADO' as const,
      dataOrigin: 'TRAINING_MEMORY_ESTIMATE' as const,
      disclaimer: 'Validación temporal basada en snapshots sintéticos/reconstruidos. No es un backtest observado ni debe usarse como evidencia de retorno real.',
      realDataIntegrated: false as const,
    };
    return NextResponse.json(serialized, { headers: syntheticHeaders });
  } catch (error) {
    console.error('[temporal-validation] execution failed', error);
    return NextResponse.json({
      success: false,
      code: 'TEMPORAL_VALIDATION_FAILED',
      error: 'Temporal validation failed',
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
