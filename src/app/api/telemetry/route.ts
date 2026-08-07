// ============================================================================
// API ROUTE: /api/telemetry — validated decision/event/metric reads
// ============================================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getDecisionLog,
  getEventLog,
  getTelemetrySummary,
  getMetricsHistory,
  getTelemetryStorageStatus,
} from '@/lib/telemetry';
import { getAttributionHistory, getAttributionSummary } from '@/lib/pnl-attribution';

const decisionTypes = [
  'ALLOCATION_COMPUTED', 'REGIME_TRANSITION', 'REBALANCE_EXECUTED',
  'KILL_SWITCH_ACTIVATED', 'EMERGENCY_FREEZE', 'CAPITAL_PRESERVATION_MODE',
  'CONFIDENCE_THROTTLE', 'DE_RISK_MODE', 'DATA_INTEGRITY_FAILURE',
  'STALE_DEGRADATION', 'STRATEGY_OVERRIDE', 'MANUAL_INTERVENTION',
] as const;
const eventTypes = [
  'PIPELINE_EXECUTION', 'DATA_FETCH', 'DATA_DEGRADATION', 'REGIME_CHANGE',
  'REBALANCE_TRIGGERED', 'RISK_LIMIT_BREACH', 'USER_ACTION', 'SYSTEM_ERROR',
  'BACKTEST_RUN', 'INTEGRITY_CHECK', 'PAPER_TRADE_EXECUTED',
] as const;

const querySchema = z.object({
  action: z.enum(['summary', 'decisions', 'events', 'metrics', 'attribution', 'attribution-summary']).default('summary'),
  decisionType: z.enum(decisionTypes).optional(),
  eventType: z.enum(eventTypes).optional(),
  severity: z.enum(['info', 'warning', 'critical']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(50),
  count: z.coerce.number().int().min(1).max(1000).default(50),
}).strict();

export async function GET(request: Request) {
  const startedAt = Date.now();
  try {
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
    if (!parsed.success) {
      return NextResponse.json({
        success: false,
        code: 'INVALID_TELEMETRY_QUERY',
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message, code: issue.code })),
        timestamp: new Date().toISOString(),
      }, { status: 422 });
    }

    const { action, decisionType, eventType, severity, limit, count } = parsed.data;
    if (action === 'summary') {
      const summary = await getTelemetrySummary();
      return NextResponse.json({
        success: true,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        telemetry: summary,
        storage: summary.storage,
        totalDecisions: summary.totalDecisions,
        daysOfHistory: summary.daysOfHistory,
        oldestDecision: summary.oldestDecision,
        newestDecision: summary.newestDecision,
      });
    }
    if (action === 'decisions') {
      const decisions = await getDecisionLog({ decisionType, severity, limit });
      return NextResponse.json({ success: true, timestamp: new Date().toISOString(), decisions, count: decisions.length, storage: getTelemetryStorageStatus() });
    }
    if (action === 'events') {
      const events = await getEventLog({ eventType, limit });
      return NextResponse.json({ success: true, timestamp: new Date().toISOString(), events, count: events.length, storage: getTelemetryStorageStatus() });
    }
    if (action === 'metrics') {
      const history = await getMetricsHistory(count);
      return NextResponse.json({ success: true, timestamp: new Date().toISOString(), metrics: history, storage: getTelemetryStorageStatus() });
    }
    if (action === 'attribution') {
      return NextResponse.json({ success: true, timestamp: new Date().toISOString(), attribution: getAttributionHistory(count), storage: getTelemetryStorageStatus() });
    }
    return NextResponse.json({ success: true, timestamp: new Date().toISOString(), attributionSummary: getAttributionSummary(), storage: getTelemetryStorageStatus() });
  } catch (error) {
    console.error('[telemetry] read failed', error);
    return NextResponse.json({
      success: false,
      code: 'TELEMETRY_READ_FAILED',
      error: 'Telemetry read failed',
      storage: getTelemetryStorageStatus(),
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
