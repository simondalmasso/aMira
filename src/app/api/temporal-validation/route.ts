// ============================================================================
// Ω-X10 TEMPORAL VALIDATION API — Unified Validation Endpoint
// ============================================================================
// GET  /api/temporal-validation — Run temporal validation
//   ?mode=MODERATE                    — Strategic mode
//   ?capital=2000                     — Initial capital USD
//   &start=2018-01                    — Start date
//   &end=2026-06                      — End date
//   &survival=true                    — Include survival tests
//   &action=full|stats|survival       — What to return
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { runTemporalValidation, type TemporalValidationConfig } from '@/lib/temporal-validation-engine';
import { getHistoricalDatasetStats, getSurvivalTests, getSnapshotsInRange } from '@/lib/macro-state-rebuilder';
import { type StrategicMode } from '@/lib/x10-strategy-layer';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const action = searchParams.get('action') ?? 'full';
  const mode = (searchParams.get('mode') ?? 'MODERATE') as StrategicMode;
  const capital = parseInt(searchParams.get('capital') ?? '2000', 10);
  const start = searchParams.get('start') ?? '2018-01';
  const end = searchParams.get('end') ?? '2026-06';
  const includeSurvival = searchParams.get('survival') !== 'false';

  try {
    switch (action) {
      case 'stats': {
        const stats = getHistoricalDatasetStats();
        return NextResponse.json({
          action: 'stats',
          data: stats,
          timestamp: new Date().toISOString(),
          // TV-01: Data origin disclaimer
          dataLabel: 'SIMULADO' as const,
          dataOrigin: 'TRAINING_MEMORY_ESTIMATE' as const,
          disclaimer: 'Estadísticas basadas en snapshots sintéticos generados por LLM. No constituyen datos observados.',
          realDataIntegrated: false as const,
        }, {
          headers: {
            'X-Data-Label': 'SIMULADO',
            'X-Data-Origin': 'TRAINING_MEMORY_ESTIMATE',
          },
        });
      }

      case 'survival': {
        const tests = getSurvivalTests();
        const snapshots = getSnapshotsInRange(start, end);
        return NextResponse.json({
          action: 'survival',
          tests: tests.map(t => ({
            id: t.id,
            name: t.name,
            question: t.question,
            description: t.description,
            periodStart: t.periodStart,
            periodEnd: t.periodEnd,
            snapshotCount: t.snapshots.length,
          })),
          dateRange: { start, end },
          snapshotsInRange: snapshots.length,
          timestamp: new Date().toISOString(),
          // TV-01: Data origin disclaimer
          dataLabel: 'SIMULADO' as const,
          dataOrigin: 'TRAINING_MEMORY_ESTIMATE' as const,
          disclaimer: 'Tests de supervivencia basados en snapshots sintéticos. No constituyen datos observados.',
          realDataIntegrated: false as const,
        }, {
          headers: {
            'X-Data-Label': 'SIMULADO',
            'X-Data-Origin': 'TRAINING_MEMORY_ESTIMATE',
          },
        });
      }

      case 'full':
      default: {
        const config: TemporalValidationConfig = {
          mode,
          initialCapitalUSD: capital,
          dateRange: { start, end },
          includeSurvivalTests: includeSurvival,
          paperBrokerParams: {
            baseSlippageBps: 5,
            commissionRate: 0.001,
            fillProbability: 0.98,
          },
          seed: 42, // BUG-010 FIX: Deterministic by default
        };

        const result = runTemporalValidation(config);

        // Return a serializable version (strip the full engineOutput to reduce payload)
        const serialized = {
          ...result,
          replayResults: result.replayResults.map(r => ({
            date: r.date,
            label: r.label,
            predictedRegime: r.predictedRegime,
            actualRegime: r.actualRegime,
            regimeCorrect: r.regimeCorrect,
            confidence: r.confidence,
            predictedReturnUSD: r.predictedReturnUSD,
            actualReturnUSD: r.actualReturnUSD,
            returnError: r.returnError,
            ordersExecuted: r.ordersExecuted,
            fillsExecuted: r.fillsExecuted,
            commissionsPaid: r.commissionsPaid,
            capitalPreservationActive: r.capitalPreservationActive,
            emergencyFreeze: r.emergencyFreeze,
            computationMs: r.computationMs,
          })),
          pnlAttribution: result.pnlAttribution.slice(0, 5),
          // TV-01: Data origin disclaimer — top level
          dataLabel: 'SIMULADO' as const,
          dataOrigin: 'TRAINING_MEMORY_ESTIMATE' as const,
          disclaimer: 'Validación temporal basada en snapshots sintéticos generados por LLM. regimeAccuracy no es métrica real. No usar para decisiones de inversión.',
          realDataIntegrated: false as const,
        };

        return NextResponse.json(serialized, {
          headers: {
            'X-Data-Label': 'SIMULADO',
            'X-Data-Origin': 'TRAINING_MEMORY_ESTIMATE',
          },
        });
      }
    }
  } catch (error) {
    console.error('[TEMPORAL_VALIDATION_API] Error:', error);
    return NextResponse.json(
      {
        error: 'Temporal validation failed',
        details: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
