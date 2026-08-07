// ============================================================================
// API ROUTE: /api/audit — typed data-integrity audit + failure simulation
// ============================================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  runIntegrityGate,
  runFailureSimulationSuite,
  getAuditLog,
  getAuditStats,
  validateData,
  MacroStateSchema,
} from '@/lib/data-integrity';
import { getMacroState, type MacroState } from '@/lib/live-data';
import { runX10Engine } from '@/lib/x10-engine';
import { logEvent } from '@/lib/telemetry';

const querySchema = z.object({
  action: z.enum(['status', 'log', 'validate', 'simulate-failures']).default('status'),
  count: z.coerce.number().int().min(1).max(1000).default(50),
}).strict();

function invalidQuery(error: z.ZodError) {
  return NextResponse.json({
    success: false,
    code: 'INVALID_AUDIT_QUERY',
    issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message, code: issue.code })),
    timestamp: new Date().toISOString(),
  }, { status: 422 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasCanonicalCoverage(value: z.infer<typeof MacroStateSchema>): value is MacroState {
  return Object.values(value.provenance).every((entry) =>
    entry.coverage === undefined || entry.coverage === 'full' || entry.coverage === 'partial' || entry.coverage === 'none',
  );
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  const parsedQuery = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsedQuery.success) return invalidQuery(parsedQuery.error);
  const { action, count } = parsedQuery.data;

  try {
    if (action === 'status') {
      return NextResponse.json({ success: true, timestamp: new Date().toISOString(), stats: getAuditStats() });
    }

    if (action === 'log') {
      return NextResponse.json({ success: true, timestamp: new Date().toISOString(), log: getAuditLog(count) });
    }

    if (action === 'validate') {
      const macro = await getMacroState();
      const gateResult = runIntegrityGate(macro);
      const schemaResult = validateData(macro, MacroStateSchema, 'MacroState');
      logEvent({
        eventType: 'INTEGRITY_CHECK',
        source: '/api/audit',
        data: {
          gatePassed: gateResult.passed,
          qualityScore: gateResult.dataQualityScore,
          recommendation: gateResult.recommendation,
        },
        durationMs: Date.now() - startedAt,
        success: true,
      });
      return NextResponse.json({
        success: true,
        timestamp: new Date().toISOString(),
        integrityGate: gateResult,
        schemaValidation: { success: schemaResult.success, errors: schemaResult.errors, warnings: schemaResult.warnings },
        durationMs: Date.now() - startedAt,
      });
    }

    const macro = await getMacroState();
    const cloned: unknown = JSON.parse(JSON.stringify(macro));
    if (!isRecord(cloned)) {
      return NextResponse.json({ success: false, code: 'AUDIT_SERIALIZATION_FAILED', error: 'Audit input unavailable' }, { status: 500 });
    }

    const results = runFailureSimulationSuite(cloned, (corruptedMacro) => {
      const parsed = MacroStateSchema.safeParse(corruptedMacro);
      if (!parsed.success || !hasCanonicalCoverage(parsed.data)) {
        return { confidence: 0, source: 'ERROR', isCapitalPreservation: true, isEmergencyFreeze: true };
      }
      const output = runX10Engine(parsed.data, 'MODERATE', 2000);
      return {
        confidence: output.confidence_score,
        source: output.dataLayer.macroSource,
        isCapitalPreservation: output.x10Directives.capitalPreservationFallback.active,
        isEmergencyFreeze: output.x10Directives.emergencyFreeze.active,
      };
    });

    const passed = results.filter((result) => result.result !== 'FAILED').length;
    const failed = results.length - passed;
    const overallResilience = failed === 0 ? 'RESILIENT' : failed <= 2 ? 'PARTIALLY_RESILIENT' : 'FRAGILE';
    logEvent({
      eventType: 'INTEGRITY_CHECK',
      source: '/api/audit',
      data: { overallResilience, passed, failed, total: results.length },
      durationMs: Date.now() - startedAt,
      success: true,
    });
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      overallResilience,
      failureSimulationResults: results,
      summary: {
        totalTests: results.length,
        passed: results.filter((result) => result.result === 'PASSED').length,
        degraded: results.filter((result) => result.result === 'DEGRADED').length,
        frozen: results.filter((result) => result.result === 'FROZEN').length,
        failed,
      },
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    console.error('[audit] operation failed', error);
    logEvent({
      eventType: 'INTEGRITY_CHECK',
      source: '/api/audit',
      success: false,
      error: 'AUDIT_OPERATION_FAILED',
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({
      success: false,
      code: 'AUDIT_OPERATION_FAILED',
      error: 'Audit operation failed',
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
