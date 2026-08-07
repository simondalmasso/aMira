import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getMacroState, applyStaleDegradation } from '@/lib/live-data';
import { runX10Engine, autoSelectStrategicMode, type X10EngineOutput } from '@/lib/x10-engine';
import type { StrategicMode } from '@/lib/x10-strategy-layer';

export const dynamic = 'force-dynamic';
export const revalidate = 300;

const modeSchema = z.enum(['CONSERVATIVE', 'MODERATE', 'AGGRESSIVE']);
const capitalSchema = z.coerce.number().finite().positive().max(1_000_000_000);
const querySchema = z.object({
  mode: modeSchema.default('MODERATE'),
  capital: capitalSchema.default(2000),
  auto: z.enum(['true', 'false']).default('false'),
  monthlyAnchor: capitalSchema.default(500),
}).strict();
const bodySchema = z.object({
  mode: modeSchema.default('MODERATE'),
  capital: z.number().finite().positive().max(1_000_000_000).default(2000),
  monthlyAnchor: z.number().finite().positive().max(1_000_000_000).default(500),
  auto: z.boolean().default(false),
}).strict();

function invalidRequest(error: z.ZodError, code: 'INVALID_X10_QUERY' | 'INVALID_X10_BODY') {
  return NextResponse.json({
    success: false,
    code,
    issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message, code: issue.code })),
    timestamp: new Date().toISOString(),
  }, { status: 422 });
}

async function selectMode(requested: StrategicMode, auto: boolean, macro: Awaited<ReturnType<typeof getMacroState>>): Promise<StrategicMode> {
  if (!auto) return requested;
  const { computeL1Signals } = await import('@/lib/x10-signal-layer');
  return autoSelectStrategicMode(computeL1Signals(macro));
}

function responsePayload(result: X10EngineOutput, selectedMode: StrategicMode) {
  return {
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
  };
}

async function execute(mode: StrategicMode, capital: number, monthlyAnchor: number, auto: boolean) {
  const rawMacro = await getMacroState();
  const macro = applyStaleDegradation(rawMacro);
  const selectedMode = await selectMode(mode, auto, macro);
  return responsePayload(runX10Engine(macro, selectedMode, capital, monthlyAnchor), selectedMode);
}

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) return invalidRequest(parsed.error, 'INVALID_X10_QUERY');
  try {
    return NextResponse.json(await execute(parsed.data.mode, parsed.data.capital, parsed.data.monthlyAnchor, parsed.data.auto === 'true'));
  } catch (error) {
    console.error('[x10] GET execution failed', error);
    return NextResponse.json({ success: false, code: 'X10_EXECUTION_FAILED', error: 'X10 Engine execution failed', timestamp: new Date().toISOString() }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ success: false, code: 'INVALID_JSON', error: 'Request body must be valid JSON', timestamp: new Date().toISOString() }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) return invalidRequest(parsed.error, 'INVALID_X10_BODY');
  try {
    return NextResponse.json(await execute(parsed.data.mode, parsed.data.capital, parsed.data.monthlyAnchor, parsed.data.auto));
  } catch (error) {
    console.error('[x10] POST execution failed', error);
    return NextResponse.json({ success: false, code: 'X10_EXECUTION_FAILED', error: 'X10 Engine execution failed', timestamp: new Date().toISOString() }, { status: 500 });
  }
}
