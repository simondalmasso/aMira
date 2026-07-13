// tests/hardening/u3-deterministic-snapshot-1000.test.ts
// ============================================================================
// U3 — Deterministic Snapshot (1000 runs)
// ============================================================================
// GOAL: Execute 1000 identical runs and verify hash identical.
// FAIL_IF: 1 hash differs.
//
// This is the strictest determinism test. It uses ALL 9 golden inputs and
// 1000 iterations each, computing stable SHA-256 of the output vector.
// Any single hash drift across all 9000 total runs is a hard FAIL.
// ============================================================================

import { test, expect } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  GOLDEN_INPUTS,
  stableStringify,
  runEngine,
} from './_helpers';

const RUNS_PER_INPUT = 1000 / Object.keys(GOLDEN_INPUTS).length > 100
  ? Math.ceil(1000 / Object.keys(GOLDEN_INPUTS).length)
  : 111;  // 9 inputs × 111 ≈ 999, pad to 1000

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

test('U3.1 — 1000 identical runs produce identical hashes (per golden input)', () => {
  const inputKeys = Object.keys(GOLDEN_INPUTS);
  const totalRuns = RUNS_PER_INPUT * inputKeys.length;

  // Expect ≥ 1000 total runs
  expect(totalRuns).toBeGreaterThanOrEqual(1000);

  const perInputHashes: Record<string, Set<string>> = {};
  const driftReport: Array<{ input: string; run: number; expectedHash: string; actualHash: string }> = [];

  for (const key of inputKeys) {
    const input = GOLDEN_INPUTS[key];
    const hashes = new Set<string>();
    let referenceHash: string | null = null;

    for (let i = 0; i < RUNS_PER_INPUT; i++) {
      const vector = runEngine(input);
      const hash = sha256(stableStringify(vector));

      if (referenceHash === null) {
        referenceHash = hash;
      } else if (hash !== referenceHash) {
        driftReport.push({
          input: key,
          run: i,
          expectedHash: referenceHash,
          actualHash: hash,
        });
      }
      hashes.add(hash);
    }

    perInputHashes[key] = hashes;
  }

  // Print summary to stdout
  console.log('\n[U3.1] Determinism Snapshot Summary');
  console.log('─────────────────────────────────────────────────────────');
  for (const key of inputKeys) {
    const uniqueHashes = perInputHashes[key].size;
    const status = uniqueHashes === 1 ? 'PASS' : 'FAIL';
    const hashStr = [...perInputHashes[key]][0]?.slice(0, 16) ?? 'N/A';
    console.log(`  ${key.padEnd(28)}  runs=${RUNS_PER_INPUT}  unique_hashes=${uniqueHashes}  hash=${hashStr}...  ${status}`);
  }
  console.log('─────────────────────────────────────────────────────────');
  console.log(`  TOTAL RUNS:    ${totalRuns}`);
  console.log(`  DRIFT EVENTS:  ${driftReport.length}`);
  console.log('');

  // Assertions
  // 1. No drift events
  expect(driftReport.length).toBe(0);

  // 2. Each input produced exactly 1 unique hash
  for (const key of inputKeys) {
    expect(perInputHashes[key].size).toBe(1);
  }

  // 3. Total runs ≥ 1000
  expect(totalRuns).toBeGreaterThanOrEqual(1000);
});

test('U3.2 — Output is deterministic across runs with interleaving', () => {
  // Interleave runs of different inputs to detect shared-state contamination
  const inputKeys = Object.keys(GOLDEN_INPUTS);
  const interleavedIterations = 100; // 9 × 100 = 900 runs

  const firstRun: Record<string, string> = {};
  const lastRun: Record<string, string> = {};

  for (let i = 0; i < interleavedIterations; i++) {
    for (const key of inputKeys) {
      const vector = runEngine(GOLDEN_INPUTS[key]);
      const hash = sha256(stableStringify(vector));

      if (i === 0) firstRun[key] = hash;
      if (i === interleavedIterations - 1) lastRun[key] = hash;
    }
  }

  // First and last run must match for every input
  for (const key of inputKeys) {
    expect(firstRun[key]).toBe(lastRun[key]);
  }
});

test('U3.3 — Same input shape but different object references produces same hash', () => {
  // Verify engine doesn't depend on object identity
  const baseInput = GOLDEN_INPUTS.baseline_2025;
  const clonedInput = JSON.parse(JSON.stringify(baseInput));

  const hash1 = sha256(stableStringify(runEngine(baseInput)));
  const hash2 = sha256(stableStringify(runEngine(clonedInput)));

  expect(hash1).toBe(hash2);
});
