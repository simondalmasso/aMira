import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
function source(path: string): string { return readFileSync(join(ROOT, path), 'utf8'); }

describe('Order #2 post-green persistence and API hardening', () => {
  test('no-data cron evidence is durable without overwriting canonical observation snapshots', () => {
    const cron = source('src/lib/oracle-multi/cron.ts');
    expect(cron).toContain("const NO_DATA_STATUS_PREFIX = 'snap:status'");
    expect(cron).toContain('`${NO_DATA_STATUS_PREFIX}:${cls}:${snapshotDate}`');
    expect(cron).toContain("source: 'OBSERVED_UNAVAILABLE'");
    expect(cron).toContain("data_class: 'OBSERVED_UNAVAILABLE'");
    expect(cron).toContain('{ expirationTtl: NO_DATA_STATUS_TTL_SECONDS }');
    expect(cron).toContain('combinePersistenceAcks');
    expect(cron).toContain('unavailableClasses');
    expect(cron).toContain('must never\n    // overwrite `snap:<class>:<date>`');
    expect(cron).not.toContain('errors: result.errors');
  });

  test('mutating class refresh routes fail closed when durable bindings are unavailable', () => {
    for (const route of ['src/app/api/oracle/bonds/route.ts', 'src/app/api/oracle/stocks/route.ts', 'src/app/api/oracle/cedears/route.ts']) {
      const text = source(route);
      expect(text).toContain('hasDurableBindings');
      expect(text).toContain('ORACLE_STORAGE_BINDINGS_UNAVAILABLE');
    }
    expect(source('src/app/api/oracle/fci/route.ts')).toContain('ORACLE_FCI_HISTORY_UNAVAILABLE');
  });

  test('public oracle class routes never echo raw caught exception messages', () => {
    for (const route of ['src/app/api/oracle/fci/route.ts', 'src/app/api/oracle/bonds/route.ts', 'src/app/api/oracle/stocks/route.ts', 'src/app/api/oracle/cedears/route.ts']) {
      const text = source(route);
      expect(text).not.toContain('error: msg');
      expect(text).not.toContain('${msg}');
    }
  });

  test('CEDEAR public type query rejects unsupported values instead of silently widening scope', () => {
    const route = source('src/app/api/oracle/cedears/route.ts');
    expect(route).toContain("type !== 'single' && type !== 'etf' && type !== 'all'");
    expect(route).toContain('INVALID_CEDEAR_TYPE');
  });

  test('data integrity layer is typed and does not double-penalize ERROR source state', () => {
    const integrity = source('src/lib/data-integrity.ts');
    expect(integrity).not.toContain('Record<string, any>');
    expect(integrity).not.toContain('ValidationResult<any>');
    expect(integrity).not.toContain("'REAL' | 'ERROR' | 'ERROR'");
    expect(integrity).not.toContain('as any');
    expect((integrity.match(/data\.source === 'ERROR'/g) ?? []).length).toBe(1);
    expect(integrity).toContain("data.source === 'PARTIAL_FALLBACK'");
  });

  test('temporal API validates query input and never exposes caught error details', () => {
    const route = source('src/app/api/temporal-validation/route.ts');
    expect(route).toContain('INVALID_TEMPORAL_VALIDATION_QUERY');
    expect(route).toContain("z.enum(['CONSERVATIVE', 'MODERATE', 'AGGRESSIVE'])");
    expect(route).not.toContain('as StrategicMode');
    expect(route).not.toContain('details: error');
  });

  test('temporal engine uses typed reconstructed MacroState and attribution adapters', () => {
    const engine = source('src/lib/temporal-validation-engine.ts');
    expect(engine).not.toContain('as unknown as MacroState');
    expect(engine).not.toContain('as any');
    expect(engine).toContain('bucketForIndex');
    expect(engine).toContain('runX10Engine(snapshot,');
  });

  test('audit, telemetry and PaperBroker APIs sanitize server errors', () => {
    const audit = source('src/app/api/audit/route.ts');
    expect(audit).toContain('INVALID_AUDIT_QUERY');
    expect(audit).toContain('AUDIT_OPERATION_FAILED');
    expect(audit).not.toContain('as any');
    expect(audit).not.toContain('error instanceof Error ? error.message');

    const paper = source('src/app/api/paper-broker/route.ts');
    expect(paper).toContain("persistence: 'ephemeral-isolate'");
    expect(paper).toContain('PAPER_BROKER_OPERATION_FAILED');
    expect(paper).not.toContain("error: error instanceof Error ? error.message");

    const telemetry = source('src/app/api/telemetry/route.ts');
    expect(telemetry).toContain('TELEMETRY_READ_FAILED');
    expect(telemetry).not.toContain("error: error instanceof Error ? error.message");
  });

  test('backtest cannot relabel synthetic fixtures as real because telemetry exists', () => {
    const route = source('src/app/api/backtest/route.ts');
    expect(route).toContain("dataLabel: 'SIMULADO'");
    expect(route).toContain("dataOrigin: 'TRAINING_MEMORY_ESTIMATE'");
    expect(route).toContain('realDataIntegrated: false');
    expect(route).toContain("role: 'AUXILIARY_CONTEXT_ONLY'");
    expect(route).not.toContain("const dataLabel = readyForRealBacktest ? 'REAL' : 'SIMULADO'");
    expect(route).not.toContain('as StrategicMode');
  });
});
