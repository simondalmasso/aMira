// tests/hardening/h7-performance.test.ts
// ============================================================================
// H7 — Performance Profile
// ============================================================================
// METRICS:
//   - latency       — p50, p95, p99 of single engine run
//   - memory        — heap usage before/after a sweep
//   - cpu           — user+system time per run
//   - allocations   — approximate (via heap delta)
//   - bundle        — verify engine source files are within size budget
//   - coldstart     — first-run overhead (module-load + first invocation)
// ============================================================================

import { test, describe, expect } from 'bun:test';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { runEngine, GOLDEN_INPUTS, sweepInputs } from './_helpers';

const require_ = createRequire(import.meta.url);
const SRC_DIR = join(dirname(require_.resolve('@/lib/single-pass-oracle-engine')), '..');

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

function heapUsedMB(): number {
  if (typeof process !== 'undefined' && process.memoryUsage) {
    return process.memoryUsage().heapUsed / (1024 * 1024);
  }
  return 0;
}

describe('H7 — Performance Profile', () => {
  // ─── latency ────────────────────────────────────────────────────────────
  test('latency — 1000 runs: p50 < 1ms, p95 < 5ms, p99 < 20ms', () => {
    const input = GOLDEN_INPUTS.baseline_2025;
    // Warm up
    for (let i = 0; i < 50; i++) runEngine(input);

    const timings: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const t0 = performance.now();
      runEngine(input);
      const t1 = performance.now();
      timings.push(t1 - t0);
    }
    timings.sort((a, b) => a - b);

    const p50 = percentile(timings, 50);
    const p95 = percentile(timings, 95);
    const p99 = percentile(timings, 99);

    console.log(`H7 latency: p50=${p50.toFixed(3)}ms p95=${p95.toFixed(3)}ms p99=${p99.toFixed(3)}ms`);

    expect(p50).toBeLessThan(1);
    expect(p95).toBeLessThan(5);
    expect(p99).toBeLessThan(20);
  });

  // ─── memory ─────────────────────────────────────────────────────────────
  test('memory — 1000-run sweep does not leak > 5MB heap', () => {
    if (!process.memoryUsage) {
      console.log('process.memoryUsage not available — skipping');
      return;
    }

    // Force GC if available (Bun supports Bun.gc)
    if (typeof (globalThis as { Bun?: { gc?: () => void } }).Bun?.gc === 'function') {
      (globalThis as { Bun: { gc: () => void } }).Bun.gc();
    }

    const baseline = heapUsedMB();

    for (let i = 0; i < 1000; i++) {
      runEngine(GOLDEN_INPUTS.baseline_2025);
    }

    if (typeof (globalThis as { Bun?: { gc?: () => void } }).Bun?.gc === 'function') {
      (globalThis as { Bun: { gc: () => void } }).Bun.gc();
    }

    const after = heapUsedMB();
    const delta = after - baseline;
    console.log(`H7 memory: baseline=${baseline.toFixed(2)}MB after=${after.toFixed(2)}MB delta=${delta.toFixed(2)}MB`);

    // Allow up to 5MB drift (engine should not leak significantly)
    expect(delta).toBeLessThan(5);
  });

  // ─── cpu ────────────────────────────────────────────────────────────────
  test('cpu — 1000 runs use < 1s of user+system CPU time', () => {
    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      runEngine(GOLDEN_INPUTS.baseline_2025);
    }
    const wallMs = Date.now() - start;
    console.log(`H7 cpu: 1000 runs took ${wallMs}ms wall time`);
    expect(wallMs).toBeLessThan(1000);
  });

  // ─── allocations (approximate via heap delta per run) ────────────────────
  test('allocations — single run allocates < 100KB heap (steady state)', () => {
    if (!process.memoryUsage) return;

    // Warm up
    for (let i = 0; i < 100; i++) runEngine(GOLDEN_INPUTS.baseline_2025);

    // Measure 10 runs and average
    const samples: number[] = [];
    for (let i = 0; i < 10; i++) {
      if (typeof (globalThis as { Bun?: { gc?: () => void } }).Bun?.gc === 'function') {
        (globalThis as { Bun: { gc: () => void } }).Bun.gc();
      }
      const before = heapUsedMB();
      runEngine(GOLDEN_INPUTS.baseline_2025);
      const after = heapUsedMB();
      samples.push((after - before) * 1024); // KB
    }
    const avgKB = samples.reduce((a, b) => a + b, 0) / samples.length;
    console.log(`H7 allocations: avg per-run heap delta = ${avgKB.toFixed(2)} KB`);
    // Allow generous bound — engine creates an AssetScoreVector + breakdown each call
    expect(avgKB).toBeLessThan(100);
  });

  // ─── bundle — verify engine source files within size budget ─────────────
  test('bundle — engine source files within size budget', () => {
    const engineFiles = [
      'single-pass-oracle-engine.ts',
      'single-market-state.ts',
      'linear-factor-model.ts',
      'oracle/v2/index.ts',
      'oracle/v3/index.ts',
    ];
    const sizes: { file: string; kb: number }[] = [];
    for (const rel of engineFiles) {
      const path = join(SRC_DIR, 'lib', rel);
      if (!existsSync(path)) continue;
      const stat = statSync(path);
      sizes.push({ file: rel, kb: stat.size / 1024 });
    }
    console.log('H7 bundle (engine source sizes):');
    for (const s of sizes) console.log(`  ${s.file}: ${s.kb.toFixed(2)} KB`);

    // Each engine source file should be < 50 KB
    for (const s of sizes) {
      expect(s.kb).toBeLessThan(50);
    }
    // Total engine bundle should be < 200 KB
    const total = sizes.reduce((a, b) => a + b.kb, 0);
    expect(total).toBeLessThan(200);
  });

  // ─── coldstart — first run vs steady-state ──────────────────────────────
  test('coldstart — first run < 100ms (module load + first invocation)', () => {
    // Note: by the time this test runs, modules are already loaded — this is
    // a best-effort measurement. The real coldstart happens once per worker
    // isolate and is bounded by the bundle test above.
    const t0 = performance.now();
    runEngine(GOLDEN_INPUTS.baseline_2025);
    const t1 = performance.now();
    const elapsed = t1 - t0;
    console.log(`H7 coldstart: first run took ${elapsed.toFixed(3)}ms`);
    expect(elapsed).toBeLessThan(100);
  });

  // ─── throughput ─────────────────────────────────────────────────────────
  test('throughput — engine handles > 1000 runs/second steady-state', () => {
    const input = GOLDEN_INPUTS.baseline_2025;
    // Warm up
    for (let i = 0; i < 100; i++) runEngine(input);

    const N = 2000;
    const start = performance.now();
    for (let i = 0; i < N; i++) runEngine(input);
    const elapsed = performance.now() - start;
    const rps = N / (elapsed / 1000);
    console.log(`H7 throughput: ${rps.toFixed(0)} runs/sec (${N} runs in ${elapsed.toFixed(1)}ms)`);
    expect(rps).toBeGreaterThan(1000);
  });

  // ─── sweep stress ───────────────────────────────────────────────────────
  test('sweep — 500 random inputs complete in < 1s', () => {
    const inputs = sweepInputs(500);
    const start = performance.now();
    for (const input of inputs) {
      runEngine(input);
    }
    const elapsed = performance.now() - start;
    console.log(`H7 sweep: 500 inputs in ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(1000);
  });
});
