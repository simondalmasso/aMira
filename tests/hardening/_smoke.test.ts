// tests/hardening/_smoke.test.ts
// Smoke test — verify the test harness can import the engine.
import { test, expect } from 'bun:test';
import { runSinglePass } from '@/lib/single-pass-oracle-engine';

test('smoke — engine import works', () => {
  const v = runSinglePass({ fx_mep: 1200, inflation_monthly: 0.038, rates_tna: 0.30 });
  expect(v.scores.length).toBe(1);
  expect(v.scores[0]!.asset).toBe('SAN');
});
