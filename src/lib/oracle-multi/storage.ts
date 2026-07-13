// src/lib/oracle-multi/storage.ts
// Storage layer for V4 multi-asset Oracle.
// 3 KV namespaces per spec:
//   ORACLE_FCI_HISTORY       — FCI snapshots (existing)
//   ORACLE_ASSETS_HISTORY    — non-FCI asset snapshots (stocks/bonds/cedears/etfs/pf)
//   ORACLE_PREDICTIONS       — cached predictions (7d TTL)
// Plus a Memory adapter for dev fallback.

import type { AssetSnapshot, AssetClass, PricePoint } from './types';

// ─── Storage Adapter Interface ──────────────────────────────────────────────

export interface StorageAdapter {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  list(prefix: string, limit?: number): Promise<{ keys: string[] }>;
}

// ─── Cloudflare KV Adapter ──────────────────────────────────────────────────

export class KVStorageAdapter implements StorageAdapter {
  constructor(private kv: KVNamespace) {}

  async get(key: string): Promise<string | null> {
    return await this.kv.get(key);
  }

  async put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
    await this.kv.put(key, value, opts);
  }

  async list(prefix: string, limit = 100): Promise<{ keys: string[] }> {
    const result = await this.kv.list({ prefix, limit });
    return { keys: result.keys.map((k) => k.name) };
  }
}

// ─── In-memory Adapter (dev fallback) ───────────────────────────────────────

export class MemoryStorageAdapter implements StorageAdapter {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async list(prefix: string, limit = 100): Promise<{ keys: string[] }> {
    const keys: string[] = [];
    for (const k of this.store.keys()) {
      if (k.startsWith(prefix)) {
        keys.push(k);
        if (keys.length >= limit) break;
      }
    }
    return { keys };
  }
}

// ─── Snapshot persistence ───────────────────────────────────────────────────

const SNAPSHOT_PREFIX = 'snap';
const HISTORY_RETENTION_DAYS = 3650;

/** Build an AssetSnapshot from a list of normalized assets.
 *
 * FASE_0_LOCALECOMPARE_NULL_GUARD (2026-07-01):
 *   Some upstream sources (or stale KV entries) return `date: null` /
 *   `date: undefined` even though the TS type is `string`. When this propagates
 *   to `buildPriceSeries`, the `a.date.localeCompare(b.date)` call crashes with
 *   `TypeError: Cannot read properties of null (reading 'localeCompare')`,
 *   which kills `runMultiOracle` mid-flight (HTTP 500 in predictions POST,
 *   `jobs_failed=1` in cron telemetry, decision-engine frozen).
 *
 *   This function now coerces every `date` to a valid `YYYY-MM-DD` string,
 *   falling back to today's date when missing — preventing the bad data from
 *   reaching the persistence layer in the first place.
 *
 * FASE_0.5_HARDEN_NULL_PRICE (2026-07-03):
 *   KV audit revealed 459 FCI entries with `price: null`. Even though the TS
 *   type is `price: number`, runtime JSON from upstream sources can carry null
 *   (failed fetch), NaN (parse error), or <=0 (sentinel for "no quote"). If we
 *   persist these unfiltered, `runMultiOracle` will eventually process them
 *   once MIN_HISTORY_DAYS (9) is reached — causing numeric crashes (e.g.
 *   `(last - past) / past` with past=0 → Infinity) or silent NaN propagation
 *   through momentum / volatility / trendStrength computations.
 *
 *   We now filter out assets with invalid `price` at write time. This prevents
 *   new garbage from reaching KV. The companion filter in `buildPriceSeries`
 *   handles pre-existing stale KV entries written before this fix.
 */
export function buildSnapshot(
  assets: import('./types').NormalizedAsset[],
  assetClass: AssetClass,
  source: string,
): AssetSnapshot {
  const todayIso = new Date().toISOString().slice(0, 10);
  let droppedInvalidPrice = 0;
  const safeAssets = assets
    .map((a) => ({
      ...a,
      date: typeof a.date === 'string' && a.date.length > 0 ? a.date : todayIso,
    }))
    .filter((a) => {
      // FASE_0.5: drop assets with invalid price (null, NaN, non-positive)
      if (typeof a.price !== 'number' || !isFinite(a.price) || a.price <= 0) {
        droppedInvalidPrice++;
        return false;
      }
      return true;
    });
  if (droppedInvalidPrice > 0) {
    console.warn(
      `[storage] buildSnapshot(${assetClass}, ${source}): dropped ${droppedInvalidPrice} ` +
        `asset(s) with invalid price (null/NaN/<=0) out of ${assets.length} raw.`,
    );
  }
  const dateCounts = new Map<string, number>();
  for (const a of safeAssets) dateCounts.set(a.date, (dateCounts.get(a.date) ?? 0) + 1);
  let snapshotDate = todayIso;
  let maxCount = 0;
  for (const [d, c] of dateCounts) {
    if (c > maxCount) {
      maxCount = c;
      snapshotDate = d;
    }
  }
  return {
    date: snapshotDate,
    fetched_at: new Date().toISOString(),
    source,
    asset_class: assetClass,
    total_assets: safeAssets.length,
    assets: safeAssets.map((a) => ({
      id: a.id,
      name: a.name,
      ticker: a.ticker,
      sub_category: a.sub_category,
      currency: a.currency,
      date: a.date,
      price: a.price,
      volume: a.volume,
      market_cap_ars: a.market_cap_ars,
      issuer: a.issuer,
    })),
  };
}

/** Save snapshot — idempotent per date (same date = overwrite). */
export async function saveSnapshot(
  storage: StorageAdapter,
  snapshot: AssetSnapshot,
): Promise<void> {
  const key = `${SNAPSHOT_PREFIX}:${snapshot.asset_class}:${snapshot.date}`;
  await storage.put(key, JSON.stringify(snapshot));
}

/** Load recent snapshots (most recent first, up to `limit`). */
export async function loadRecentSnapshots(
  storage: StorageAdapter,
  assetClass: AssetClass,
  limit: number,
): Promise<AssetSnapshot[]> {
  const prefix = `${SNAPSHOT_PREFIX}:${assetClass}:`;
  const { keys } = await storage.list(prefix, limit * 2);
  // Sort keys descending (date sort works because ISO dates lexicographic)
  const sortedKeys = keys.sort().reverse().slice(0, limit);
  const snapshots: AssetSnapshot[] = [];
  for (const key of sortedKeys) {
    const raw = await storage.get(key);
    if (raw) {
      try {
        snapshots.push(JSON.parse(raw) as AssetSnapshot);
      } catch {
        // skip malformed
      }
    }
  }
  return snapshots;
}

/** Build a PricePoint[] series per asset_id from historical snapshots.
 *
 * FASE_0_LOCALECOMPARE_NULL_GUARD (2026-07-01):
 *   Defensive filter — even with `buildSnapshot` now coercing dates, stale KV
 *   entries written before the fix can still have `date: null` at the snapshot
 *   level or the asset level. We drop any snapshot or asset whose `date` is
 *   not a non-empty string, and use a null-safe comparator so the sort never
 *   calls `.localeCompare` on `null`/`undefined`.
 *
 * FASE_0.5_HARDEN_NULL_PRICE (2026-07-03):
 *   Same defense extended to `price`. Stale KV entries (and any new garbage
 *   that slips past `buildSnapshot`'s filter) can carry `price: null`,
 *   `price: NaN`, or `price: 0`/negative. We drop those points here so the
 *   downstream `predictAsset` / `momentumFromSeries` / `volatilityFromSeries`
 *   / `trendStrengthFromSeries` computations never see invalid numerics.
 *
 *   This is the critical guard: without it, `(last - past) / past` with
 *   `past=0` yields `Infinity`, and `Math.sqrt(variance)` with NaN inputs
 *   yields `NaN` — both of which silently propagate through the oracle_score
 *   weighting and corrupt the rankings without raising an exception.
 */
export function buildPriceSeries(snapshots: AssetSnapshot[]): Map<string, PricePoint[]> {
  const map = new Map<string, PricePoint[]>();
  // Filter out snapshots whose top-level date is missing/empty
  const validSnapshots = snapshots.filter(
    (s) => typeof s?.date === 'string' && s.date.length > 0,
  );
  if (validSnapshots.length === 0) return map;
  // Sort snapshots ascending by date (null-safe comparator)
  const sorted = [...validSnapshots].sort((a, b) => {
    const da = typeof a?.date === 'string' ? a.date : '';
    const db = typeof b?.date === 'string' ? b.date : '';
    return da.localeCompare(db);
  });
  for (const snap of sorted) {
    for (const a of snap.assets) {
      // Skip assets whose date is missing/empty — defensive against stale KV
      if (typeof a?.date !== 'string' || a.date.length === 0) continue;
      // FASE_0.5: Skip assets whose price is missing/invalid — prevents NaN/Infinity
      // propagation through downstream numeric ops (momentum, volatility, trend, OLS).
      if (typeof a?.price !== 'number' || !isFinite(a.price) || a.price <= 0) continue;
      const arr = map.get(a.id) ?? [];
      arr.push({ date: a.date, price: a.price });
      map.set(a.id, arr);
    }
  }
  return map;
}

/** Persist a prediction cache entry (30d TTL per spec). */
export async function savePrediction(
  storage: StorageAdapter,
  assetId: string,
  prediction: import('./types').AssetPrediction,
  ttlSeconds = 86400,
): Promise<void> {
  const key = `pred:${assetId}`;
  await storage.put(key, JSON.stringify(prediction), { expirationTtl: ttlSeconds });
}

// ─── Storage Resolver ───────────────────────────────────────────────────────

export interface MultiStorage {
  fci: StorageAdapter;
  assets: StorageAdapter;
  predictions: StorageAdapter;
}

/** Resolve 3 storage adapters from Cloudflare KV bindings (or memory fallback). */
export function resolveMultiStorage(env?: {
  ORACLE_FCI_HISTORY?: KVNamespace;
  ORACLE_ASSETS_HISTORY?: KVNamespace;
  ORACLE_PREDICTIONS?: KVNamespace;
}): MultiStorage {
  // CRON_PERSISTENCE_VISIBILITY_FIX v2 — FAIL-LOUDLY when env is provided but
  // KV bindings are missing. This signals a broken env wiring path (typical
  // when called from scheduled() where `process.env.*` is not populated and
  // `getCloudflareContext()` was not used to recover the bindings).
  //
  // Previously this branch only emitted a `console.warn` and then silently
  // fell back to `MemoryStorageAdapter` — meaning the cron kept reporting
  // `jobs_ok` while every KV write died with the isolate (ghost execution,
  // zero persistence). The 2026-06-22 → 2026-06-26 CASO_B silent-failure
  // window was caused exactly by this code path.
  //
  // We now throw so that:
  //   1. The cron wrapper classifies the run as `jobs_failed` (not `jobs_ok`).
  //   2. Telemetry records an explicit error event instead of a silent ghost.
  //   3. Operators are forced to fix the wiring (Option A: getCloudflareContext)
  //      instead of relying on the silent memory fallback.
  if (env) {
    const missing: string[] = [];
    if (!env.ORACLE_FCI_HISTORY || typeof env.ORACLE_FCI_HISTORY.get !== 'function') missing.push('ORACLE_FCI_HISTORY');
    if (!env.ORACLE_ASSETS_HISTORY || typeof env.ORACLE_ASSETS_HISTORY.get !== 'function') missing.push('ORACLE_ASSETS_HISTORY');
    if (!env.ORACLE_PREDICTIONS || typeof env.ORACLE_PREDICTIONS.get !== 'function') missing.push('ORACLE_PREDICTIONS');
    if (missing.length > 0) {
      const msg = `[storage] FATAL — env provided but KV bindings missing: ${missing.join(', ')} → refusing to fall back to MemoryStorageAdapter (silent persistence loss). Wiring path broken — apply CRON_PERSISTENCE_WIRING_FIX (getCloudflareContext) in the caller.`;
      console.error(msg);
      throw new Error(msg);
    }
  }
  const fci = env?.ORACLE_FCI_HISTORY && typeof env.ORACLE_FCI_HISTORY.get === 'function'
    ? new KVStorageAdapter(env.ORACLE_FCI_HISTORY)
    : new MemoryStorageAdapter();
  const assets = env?.ORACLE_ASSETS_HISTORY && typeof env.ORACLE_ASSETS_HISTORY.get === 'function'
    ? new KVStorageAdapter(env.ORACLE_ASSETS_HISTORY)
    : new MemoryStorageAdapter();
  const predictions = env?.ORACLE_PREDICTIONS && typeof env.ORACLE_PREDICTIONS.get === 'function'
    ? new KVStorageAdapter(env.ORACLE_PREDICTIONS)
    : new MemoryStorageAdapter();
  return { fci, assets, predictions };
}

export { HISTORY_RETENTION_DAYS };
