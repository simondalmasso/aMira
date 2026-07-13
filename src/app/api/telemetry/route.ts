// ============================================================================
// API ROUTE: /api/telemetry — Decision logs + event tracking
// ============================================================================

import { NextResponse } from 'next/server';
import {
  getDecisionLog,
  getEventLog,
  getTelemetrySummary,
  getMetricsHistory,
} from '@/lib/telemetry';
import { getAttributionHistory, getAttributionSummary } from '@/lib/pnl-attribution';

export async function GET(request: Request) {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') ?? 'summary';

    switch (action) {
      case 'summary': {
        const summary = await getTelemetrySummary();
        return NextResponse.json({
          success: true,
          timestamp: new Date().toISOString(),
          telemetry: summary,
          // FIX_CRON_TELEMETRY_BACKTEST (Fix 2): also expose top-level so the
          // /api/telemetry?action=summary response shape matches what
          // dashboards expect from /api/backtest.
          totalDecisions: summary.totalDecisions,
          daysOfHistory: summary.daysOfHistory,
          oldestDecision: summary.oldestDecision,
          newestDecision: summary.newestDecision,
        });
      }

      case 'decisions': {
        const decisionType = searchParams.get('decisionType') as any;
        const severity = searchParams.get('severity') as any;
        const limit = parseInt(searchParams.get('limit') ?? '50');
        const decisions = await getDecisionLog({ decisionType, severity, limit });
        return NextResponse.json({
          success: true,
          timestamp: new Date().toISOString(),
          decisions,
          count: decisions.length,
        });
      }

      case 'events': {
        const eventType = searchParams.get('eventType') as any;
        const limit = parseInt(searchParams.get('limit') ?? '100');
        const events = await getEventLog({ eventType, limit });
        return NextResponse.json({
          success: true,
          timestamp: new Date().toISOString(),
          events,
          count: events.length,
        });
      }

      case 'metrics': {
        const count = parseInt(searchParams.get('count') ?? '50');
        const history = await getMetricsHistory(count);
        return NextResponse.json({
          success: true,
          timestamp: new Date().toISOString(),
          metrics: history,
        });
      }

      case 'attribution': {
        const limit = parseInt(searchParams.get('count') ?? '20');
        const history = getAttributionHistory(limit);
        return NextResponse.json({
          success: true,
          timestamp: new Date().toISOString(),
          attribution: history,
        });
      }

      case 'attribution-summary': {
        const summary = getAttributionSummary();
        return NextResponse.json({
          success: true,
          timestamp: new Date().toISOString(),
          attributionSummary: summary,
        });
      }

      default:
        return NextResponse.json({
          success: false,
          error: `Unknown action: ${action}. Valid: summary, decisions, events, metrics, attribution, attribution-summary`,
        }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
