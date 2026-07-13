// ============================================================================
// API ROUTE: /api/backtest — Run historical replay backtest
// ============================================================================
// DATA ORIGIN: TRAINING_MEMORY_ESTIMATE + REAL_DECISIONS_LOG (when available)
// Backtest results use synthetic snapshots UNTIL the telemetry KV accumulates
// enough real decisions. See FIX_CRON_TELEMETRY_BACKTEST (Fix 3).
// ============================================================================

import { NextResponse } from 'next/server';
import { runBacktest, computeCalibration, type StrategicMode } from '@/lib/backtest-engine';
import { logEvent, getTelemetrySummary } from '@/lib/telemetry';

// FIX_CRON_TELEMETRY_BACKTEST (Fix 3): threshold (in days of history) at which
// we declare the backtest "REAL" instead of "SIMULADO". Below this we still
// run the synthetic replay but flag it.
const MIN_DAYS_FOR_REAL_BACKTEST = 9;

export async function GET(request: Request) {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const mode = (searchParams.get('mode') ?? 'MODERATE') as StrategicMode;
    const capital = parseFloat(searchParams.get('capital') ?? '2000');

    // Validate mode
    const validModes: StrategicMode[] = ['CONSERVATIVE', 'MODERATE', 'AGGRESSIVE'];
    const safeMode = validModes.includes(mode) ? mode : 'MODERATE';

    // Run backtest
    const result = runBacktest(safeMode, capital);

    // Run calibration
    const calibration = computeCalibration(result.periodResults);

    // FIX_CRON_TELEMETRY_BACKTEST (Fix 3): read real telemetry state from KV.
    // Previously this was hardcoded as `realDataIntegrated: false as const`.
    // Now it actually reflects whether the cron has been accumulating decisions.
    const telemetrySummary = await getTelemetrySummary();
    const totalDecisions = telemetrySummary.totalDecisions ?? 0;
    const daysOfHistory = telemetrySummary.daysOfHistory ?? 0;
    const realDataIntegrated = totalDecisions > 0;
    const readyForRealBacktest = daysOfHistory >= MIN_DAYS_FOR_REAL_BACKTEST;
    const dataLabel = readyForRealBacktest ? 'REAL' : 'SIMULADO';

    // Log event
    logEvent({
      eventType: 'BACKTEST_RUN',
      source: '/api/backtest',
      data: { mode: safeMode, capital, assessment: result.assessment, totalDecisions, daysOfHistory, dataLabel },
      durationMs: Date.now() - startTime,
      success: true,
    });

    // API-01: Top-level disclaimer about data origin
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      mode: safeMode,
      capital,
      backtest: result,
      calibration,
      durationMs: Date.now() - startTime,
      // API-01: Data origin disclaimer — top level
      dataLabel,
      dataOrigin: readyForRealBacktest ? 'REAL_DECISIONS_LOG' : 'TRAINING_MEMORY_ESTIMATE',
      disclaimer: readyForRealBacktest
        ? 'Backtest basado parcialmente en decisiones reales persistidas por el cron. Aún contiene escenarios sintéticos. No usar para decisiones de inversión.'
        : 'Resultados calculados contra snapshots sintéticos generados por LLM. No constituyen backtest con datos reales. No usar para decisiones de inversión.',
      validUntil: null,
      // FIX_CRON_TELEMETRY_BACKTEST (Fix 3): replaced `false as const` hardcode
      realDataIntegrated,
      // New fields for transparency
      totalDecisions,
      daysOfHistory,
      minDecisionsForReal: MIN_DAYS_FOR_REAL_BACKTEST,
      readyForRealBacktest,
    }, {
      headers: {
        // API-02: HTTP headers warning about data origin
        'X-Data-Label': dataLabel,
        'X-Data-Origin': readyForRealBacktest ? 'REAL_DECISIONS_LOG' : 'TRAINING_MEMORY_ESTIMATE',
      },
    });
  } catch (error) {
    logEvent({
      eventType: 'BACKTEST_RUN',
      source: '/api/backtest',
      success: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
    });

    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
