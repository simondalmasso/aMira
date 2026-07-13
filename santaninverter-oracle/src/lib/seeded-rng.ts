// ============================================================================
// SEEDED PRNG (mulberry32) — Deterministic randomness for reproducible results
// Cloudflare Worker compatible — no Math.random() in backtest pipeline
// ============================================================================

export function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return function () {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Create a deterministic RNG: seed is MANDATORY, null seed is FORBIDDEN */
export function createRng(seed: number | null): () => number {
  if (seed === null) throw new Error('CRITICAL: createRng(null) is forbidden — seed is mandatory for determinism');
  return mulberry32(seed);
}
