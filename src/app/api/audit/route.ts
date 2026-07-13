// ============================================================================
// API ROUTE: /api/audit — Data integrity audit + failure simulation
// ============================================================================

import { NextResponse } from 'next/server';
import {
  runIntegrityGate,
  runFailureSimulationSuite,
  getAuditLog,
  getAuditStats,
  validateData,
  MacroStateSchema,
} from '@/lib/data-integrity';
import { getMacroState } from '@/lib/live-data';
import { runX10Engine } from '@/lib/x10-engine';
import { logEvent } from '@/lib/telemetry';

export async function GET(request: Request) {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') ?? 'status';

    switch (action) {
      case 'status': {
        // Get audit statistics
        const stats = getAuditStats();
        return NextResponse.json({
          success: true,
          timestamp: new Date().toISOString(),
          stats,
        });
      }

      case 'log': {
        // Get recent audit log
        const count = parseInt(searchParams.get('count') ?? '50');
        const log = getAuditLog(count);
        return NextResponse.json({
          success: true,
          timestamp: new Date().toISOString(),
          log,
        });
      }

      case 'validate': {
        // Run integrity gate on current macro data
        const macro = await getMacroState();
        const gateResult = runIntegrityGate(macro);

        // Also run schema validation
        const schemaResult = validateData(macro, MacroStateSchema, 'MacroState');

        logEvent({
          eventType: 'INTEGRITY_CHECK',
          source: '/api/audit',
          data: {
            gatePassed: gateResult.passed,
            qualityScore: gateResult.dataQualityScore,
            recommendation: gateResult.recommendation,
          },
          durationMs: Date.now() - startTime,
          success: true,
        });

        return NextResponse.json({
          success: true,
          timestamp: new Date().toISOString(),
          integrityGate: gateResult,
          schemaValidation: {
            success: schemaResult.success,
            errors: schemaResult.errors,
            warnings: schemaResult.warnings,
          },
          durationMs: Date.now() - startTime,
        });
      }

      case 'simulate-failures': {
        // Run complete failure simulation suite
        const macro = await getMacroState();
        const macroObj = JSON.parse(JSON.stringify(macro));

        const results = runFailureSimulationSuite(
          macroObj,
          (corruptedMacro) => {
            try {
              const output = runX10Engine(corruptedMacro as any, 'MODERATE', 2000);
              return {
                confidence: output.confidence_score,
                source: output.dataLayer.macroSource as string,
                isCapitalPreservation: output.x10Directives.capitalPreservationFallback.active,
                isEmergencyFreeze: output.x10Directives.emergencyFreeze.active,
              };
            } catch {
              return {
                confidence: 0,
                source: 'ERROR',
                isCapitalPreservation: true,
                isEmergencyFreeze: true,
              };
            }
          },
        );

        // Assess overall resilience
        const passed = results.filter(r => r.result === 'PASSED' || r.result === 'DEGRADED' || r.result === 'FROZEN').length;
        const failed = results.filter(r => r.result === 'FAILED').length;
        const overallResilience = failed === 0 ? 'RESILIENT' : failed <= 2 ? 'PARTIALLY_RESILIENT' : 'FRAGILE';

        logEvent({
          eventType: 'INTEGRITY_CHECK',
          source: '/api/audit',
          data: { overallResilience, passed, failed, total: results.length },
          durationMs: Date.now() - startTime,
          success: true,
        });

        return NextResponse.json({
          success: true,
          timestamp: new Date().toISOString(),
          overallResilience,
          failureSimulationResults: results,
          summary: {
            totalTests: results.length,
            passed: results.filter(r => r.result === 'PASSED').length,
            degraded: results.filter(r => r.result === 'DEGRADED').length,
            frozen: results.filter(r => r.result === 'FROZEN').length,
            failed: results.filter(r => r.result === 'FAILED').length,
          },
          durationMs: Date.now() - startTime,
        });
      }

      default:
        return NextResponse.json({
          success: false,
          error: `Unknown action: ${action}. Valid actions: status, log, validate, simulate-failures`,
        }, { status: 400 });
    }
  } catch (error) {
    logEvent({
      eventType: 'INTEGRITY_CHECK',
      source: '/api/audit',
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
