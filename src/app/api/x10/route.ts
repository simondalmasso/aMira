import { NextResponse } from 'next/server';
import { getMacroState, applyStaleDegradation } from '@/lib/live-data';
import { runX10Engine, autoSelectStrategicMode } from '@/lib/x10-engine';
import type { StrategicMode } from '@/lib/x10-strategy-layer';

export const dynamic = 'force-dynamic';
export const revalidate = 300; // 5 minutes

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const modeParam = searchParams.get('mode');
    const capitalParam = searchParams.get('capital');
    const autoMode = searchParams.get('auto') === 'true';

    // ─── L0: Fetch raw macro data ───
    const rawMacro = await getMacroState();
    const macro = applyStaleDegradation(rawMacro);

    // ─── Determine strategic mode ───
    let mode: StrategicMode = 'MODERATE';
    if (autoMode) {
      // Auto-select based on L1 signals (requires computing signals first)
      const { computeL1Signals } = await import('@/lib/x10-signal-layer');
      const signals = computeL1Signals(macro);
      mode = autoSelectStrategicMode(signals);
    } else if (modeParam && ['CONSERVATIVE', 'MODERATE', 'AGGRESSIVE'].includes(modeParam.toUpperCase())) {
      mode = modeParam.toUpperCase() as StrategicMode;
    }

    const initialCapital = capitalParam ? parseFloat(capitalParam) : 2000;

    // ─── Run full X10 engine pipeline ───
    const result = runX10Engine(macro, mode, initialCapital, 500);

    return NextResponse.json({
      success: true,
      engine: result.engineVersion,
      timestamp: result.timestamp,
      durationMs: result.durationMs,

      // L0 Data layer summary
      data: {
        source: result.dataLayer.macroSource,
        ageMinutes: result.dataLayer.dataAgeMinutes,
        realDataPct: result.dataLayer.realDataPct,
        hasError: result.dataLayer.hasError,
        allStale: result.dataLayer.allStale,
      },

      // L1 Signal layer summary
      signals: {
        regime: result.signalLayer.regime.regime,
        aggregateConfidence: result.signalLayer.aggregateConfidence,
        inflationTrend: result.signalLayer.inflation.trend,
        carryViable: result.signalLayer.carry.isViable,
        carrySpread: result.signalLayer.carry.realSpread,
        fisherRate: result.signalLayer.carry.fisherRate,
        volatilityRegime: result.signalLayer.volatility.regime,
        liquidityCondition: result.signalLayer.liquidity.condition,
        hasError: result.signalLayer.hasError,
        allStale: result.signalLayer.allStale,
      },

      // L2 Strategy layer (mandatory output)
      portfolio_allocation: result.portfolio_allocation,
      risk_metrics: result.risk_metrics,
      confidence_score: result.confidence_score,
      scenario_downside: result.scenario_downside,
      scenario_base: result.scenario_base,
      scenario_upside: result.scenario_upside,

      // L3 Execution layer
      execution: {
        mode: result.executionLayer.executionMode,
        isPaperFirst: result.executionLayer.isPaperFirst,
        isLive: result.executionLayer.isLive,
        frozenReason: result.executionLayer.frozenReason,
      },

      // X10 Directives status
      x10: result.x10Directives,

      // Strategic mode
      strategicMode: mode,
      modeConfig: result.strategyLayer.modeConfig,

      // Full provenance
      provenance: result.dataLayer.provenance,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: 'X10 Engine execution failed',
      detail: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const mode: StrategicMode = body.mode || 'MODERATE';
    const initialCapital = body.capital || 2000;
    const monthlyAnchor = body.monthlyAnchor || 500;
    const autoMode = body.auto || false;

    // ─── L0: Fetch raw macro data ───
    const rawMacro = await getMacroState();
    const macro = applyStaleDegradation(rawMacro);

    // ─── Determine strategic mode ───
    let selectedMode: StrategicMode = mode;
    if (autoMode) {
      const { computeL1Signals } = await import('@/lib/x10-signal-layer');
      const signals = computeL1Signals(macro);
      selectedMode = autoSelectStrategicMode(signals);
    }

    // ─── Run full X10 engine pipeline ───
    const result = runX10Engine(macro, selectedMode, initialCapital, monthlyAnchor);

    return NextResponse.json({
      success: true,
      engine: result.engineVersion,
      timestamp: result.timestamp,
      durationMs: result.durationMs,
      data: {
        source: result.dataLayer.macroSource,
        ageMinutes: result.dataLayer.dataAgeMinutes,
        realDataPct: result.dataLayer.realDataPct,
        hasError: result.dataLayer.hasError,
        allStale: result.dataLayer.allStale,
      },
      signals: {
        regime: result.signalLayer.regime.regime,
        aggregateConfidence: result.signalLayer.aggregateConfidence,
        inflationTrend: result.signalLayer.inflation.trend,
        carryViable: result.signalLayer.carry.isViable,
        carrySpread: result.signalLayer.carry.realSpread,
        fisherRate: result.signalLayer.carry.fisherRate,
        volatilityRegime: result.signalLayer.volatility.regime,
        liquidityCondition: result.signalLayer.liquidity.condition,
        hasError: result.signalLayer.hasError,
        allStale: result.signalLayer.allStale,
      },
      portfolio_allocation: result.portfolio_allocation,
      risk_metrics: result.risk_metrics,
      confidence_score: result.confidence_score,
      scenario_downside: result.scenario_downside,
      scenario_base: result.scenario_base,
      scenario_upside: result.scenario_upside,
      execution: {
        mode: result.executionLayer.executionMode,
        isPaperFirst: result.executionLayer.isPaperFirst,
        isLive: result.executionLayer.isLive,
        frozenReason: result.executionLayer.frozenReason,
      },
      x10: result.x10Directives,
      strategicMode: selectedMode,
      modeConfig: result.strategyLayer.modeConfig,
      provenance: result.dataLayer.provenance,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: 'X10 Engine execution failed',
      detail: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
