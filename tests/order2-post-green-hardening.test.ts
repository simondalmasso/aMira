import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

function source(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

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
    for (const route of [
      'src/app/api/oracle/bonds/route.ts',
      'src/app/api/oracle/stocks/route.ts',
      'src/app/api/oracle/cedears/route.ts',
    ]) {
      const text = source(route);
      expect(text).toContain('hasDurableBindings');
      expect(text).toContain('ORACLE_STORAGE_BINDINGS_UNAVAILABLE');
    }

    expect(source('src/app/api/oracle/fci/route.ts')).toContain('ORACLE_FCI_HISTORY_UNAVAILABLE');
  });

  test('public oracle class routes never echo raw caught exception messages', () => {
    for (const route of [
      'src/app/api/oracle/fci/route.ts',
      'src/app/api/oracle/bonds/route.ts',
      'src/app/api/oracle/stocks/route.ts',
      'src/app/api/oracle/cedears/route.ts',
    ]) {
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
});
