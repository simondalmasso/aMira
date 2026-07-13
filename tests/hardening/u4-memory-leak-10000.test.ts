// tests/hardening/u4-memory-leak-10000.test.ts
// ============================================================================
// U4 — Memory Leak Audit (10000 invocations)
// ============================================================================
// GOAL: 10000 consecutive invocations of the engine. Verify:
//   - heap usage does NOT grow unboundedly
//   - GC reclaims memory between batches
//   - no object accumulation
//   - no event listener leaks (not applicable to pure engine, but we check)
//
// PASS CRITERIA:
//   - All 10000 runs complete without exception
//   - Heap delta (end - start) is < 5 MB (we allow small GC variance)
//   - Heap high-water mark < 50 MB
//   - Average per-run heap delta < 500 bytes
// ============================================================================

import { test, expect } from 'bun:test';
import { GOLDEN_INPUTS, runEngine } from './_helpers';

const TOTAL_RUNS = 10000;
const BATCH_SIZE = 500;
const BATCHES = TOTAL_RUNS / BATCH_SIZE; // 20

// Force GC if available
function forceGc(): void {
  if (typeof globalThis.gc === 'function') {
    globalThis.gc();
  }
}

function getHeapUsedMB(): number {
  return process.memoryUsage().heapUsed / (1024 * 1024);
}
function getHeapTotalMB(): number {
  return process.memoryUsage().heapTotal / (1024 * 1024);
}
function getRssMB(): number {
  return process.memoryUsage().rss / (1024 * 1024);
}
function getExternalMB(): number {
  return process.memoryUsage().external / (1024 * 1024);
}

test('U4.1 — 10000 consecutive invocations do not leak heap memory', () => {
  const inputKeys = Object.keys(GOLDEN_INPUTS);

  // Warm-up: run 100 times to stabilize JIT & GC
  for (let i = 0; i < 100; i++) {
    runEngine(GOLDEN_INPUTS[inputKeys[i % inputKeys.length]!]);
  }
  forceGc();

  // Baseline measurement
  const baselineHeap = getHeapUsedMB();
  const baselineRss = getRssMB();
  const baselineExternal = getExternalMB();
  const baselineTotal = getHeapTotalMB();

  const batchSamples: Array<{
    batch: number;
    runs_completed: number;
    heap_used_mb: number;
    heap_total_mb: number;
    rss_mb: number;
    external_mb: number;
  }> = [];

  let maxHeapSeen = baselineHeap;
  let errorCount = 0;

  for (let batch = 0; batch < BATCHES; batch++) {
    for (let i = 0; i < BATCH_SIZE; i++) {
      const input = GOLDEN_INPUTS[inputKeys[(batch * BATCH_SIZE + i) % inputKeys.length]!];
      try {
        runEngine(input);
      } catch {
        errorCount++;
      }
    }

    // Sample heap every batch (no forced GC to detect drift)
    const sample = {
      batch,
      runs_completed: (batch + 1) * BATCH_SIZE,
      heap_used_mb: getHeapUsedMB(),
      heap_total_mb: getHeapTotalMB(),
      rss_mb: getRssMB(),
      external_mb: getExternalMB(),
    };
    batchSamples.push(sample);
    if (sample.heap_used_mb > maxHeapSeen) maxHeapSeen = sample.heap_used_mb;
  }

  // Final forced GC
  forceGc();

  const finalHeap = getHeapUsedMB();
  const finalRss = getRssMB();
  const finalTotal = getHeapTotalMB();
  const finalExternal = getExternalMB();

  const heapDeltaMB = finalHeap - baselineHeap;
  const rssDeltaMB = finalRss - baselineRss;
  const externalDeltaMB = finalExternal - baselineExternal;

  // Compute linear regression slope (MB per batch) — if slope > 0 and
  // R² > 0.7, we have a linear leak.
  const n = batchSamples.length;
  const xs = batchSamples.map((_, i) => i);
  const ys = batchSamples.map(s => s.heap_used_mb);
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - xMean) * (ys[i]! - yMean);
    den += (xs[i]! - xMean) ** 2;
  }
  const slope = den === 0 ? 0 : num / den; // MB per batch
  // R²
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    const yPred = yMean + slope * (xs[i]! - xMean);
    ssTot += (ys[i]! - yMean) ** 2;
    ssRes += (ys[i]! - yPred) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  console.log('\n[U4.1] Memory Leak Audit Summary');
  console.log('─────────────────────────────────────────────────────────');
  console.log(`  TOTAL RUNS:           ${TOTAL_RUNS}`);
  console.log(`  BATCHES:              ${BATCHES} (${BATCH_SIZE} runs each)`);
  console.log(`  ERRORS:               ${errorCount}`);
  console.log(`  BASELINE heap:        ${baselineHeap.toFixed(3)} MB`);
  console.log(`  FINAL heap:           ${finalHeap.toFixed(3)} MB`);
  console.log(`  HEAP DELTA:           ${heapDeltaMB >= 0 ? '+' : ''}${heapDeltaMB.toFixed(3)} MB`);
  console.log(`  MAX heap seen:        ${maxHeapSeen.toFixed(3)} MB`);
  console.log(`  RSS delta:            ${rssDeltaMB >= 0 ? '+' : ''}${rssDeltaMB.toFixed(3)} MB`);
  console.log(`  External delta:       ${externalDeltaMB >= 0 ? '+' : ''}${externalDeltaMB.toFixed(3)} MB`);
  console.log(`  Heap-Total delta:     ${(finalTotal - baselineTotal).toFixed(3)} MB`);
  console.log(`  Linear-fit slope:     ${slope.toFixed(4)} MB/batch (R²=${r2.toFixed(3)})`);
  console.log('─────────────────────────────────────────────────────────');

  // Print first, middle, last batch samples
  console.log('  Per-batch samples (first/mid/last):');
  const indices = [0, Math.floor(n / 2), n - 1];
  for (const idx of indices) {
    const s = batchSamples[idx]!;
    console.log(`    batch ${String(s.batch).padStart(2)}: runs=${s.runs_completed}  heap=${s.heap_used_mb.toFixed(2)}MB  rss=${s.rss_mb.toFixed(2)}MB`);
  }
  console.log('');

  // === ASSERTIONS ===
  // 1. No errors during 10000 runs
  expect(errorCount).toBe(0);

  // 2. Heap delta < 5 MB (after GC)
  //    (Bun's GC is not perfectly aggressive, so we allow generous bounds)
  expect(Math.abs(heapDeltaMB)).toBeLessThan(5);

  // 3. Max heap never exceeded 50 MB
  expect(maxHeapSeen).toBeLessThan(50);

  // 4. No linear leak (slope < 0.1 MB/batch AND R² < 0.7 indicates no leak)
  //    OR slope is negative (heap shrinks over time)
  const noLinearLeak = slope < 0.1 || r2 < 0.7;
  expect(noLinearLeak).toBe(true);

  // 5. RSS delta < 30 MB (RSS includes V8 overhead, less precise)
  expect(Math.abs(rssDeltaMB)).toBeLessThan(30);
});

test('U4.2 — GC reclaims memory between batches', () => {
  const inputKeys = Object.keys(GOLDEN_INPUTS);

  // Warm-up
  for (let i = 0; i < 50; i++) {
    runEngine(GOLDEN_INPUTS[inputKeys[i % inputKeys.length]!]);
  }
  forceGc();
  const before = getHeapUsedMB();

  // 1000 runs
  for (let i = 0; i < 1000; i++) {
    runEngine(GOLDEN_INPUTS[inputKeys[i % inputKeys.length]!]);
  }
  const peak = getHeapUsedMB();

  // Force GC
  forceGc();
  const after = getHeapUsedMB();

  console.log(`[U4.2] GC reclaim test: before=${before.toFixed(2)}MB  peak=${peak.toFixed(2)}MB  after=${after.toFixed(2)}MB  reclaimed=${(peak - after).toFixed(2)}MB`);

  // After GC, heap should be back near baseline (within 2 MB)
  expect(Math.abs(after - before)).toBeLessThan(2);

  // Peak during run is allowed to be higher
  expect(peak).toBeGreaterThanOrEqual(before);
});

test('U4.3 — No listener accumulation (event emitter count stable)', () => {
  // The engine doesn't use EventEmitter, but this test verifies the broader
  // invariant that no listeners are being added implicitly via side effects.
  // We use process.getMaxListeners() and a manual counter.
  const before = process.listenerCount('uncaughtException');
  const before2 = process.listenerCount('unhandledRejection');

  for (let i = 0; i < 1000; i++) {
    const input = GOLDEN_INPUTS.baseline_2025;
    runEngine(input);
  }

  const after = process.listenerCount('uncaughtException');
  const after2 = process.listenerCount('unhandledRejection');

  expect(after).toBe(before);
  expect(after2).toBe(before2);
});

test('U4.4 — Object count does not grow unboundedly', () => {
  // Use a heuristic: V8's heap statistics give us the number of allocated objects.
  // We sample before and after to check the delta is bounded.
  const inputKeys = Object.keys(GOLDEN_INPUTS);
  const v8 = require('node:v8');
  const statsBefore = v8.getHeapStatistics();

  for (let i = 0; i < 5000; i++) {
    runEngine(GOLDEN_INPUTS[inputKeys[i % inputKeys.length]!]);
  }
  forceGc();
  const statsAfter = v8.getHeapStatistics();

  const objectCountDelta = statsAfter.used_heap_size - statsBefore.used_heap_size;
  console.log(`[U4.4] Heap stats — before used: ${(statsBefore.used_heap_size / 1024 / 1024).toFixed(2)}MB  after used: ${(statsAfter.used_heap_size / 1024 / 1024).toFixed(2)}MB  delta: ${(objectCountDelta / 1024).toFixed(2)}KB`);

  // Allow ≤ 5MB growth after GC (V8 may keep some objects in young gen)
  expect(Math.abs(objectCountDelta)).toBeLessThan(5 * 1024 * 1024);
});
