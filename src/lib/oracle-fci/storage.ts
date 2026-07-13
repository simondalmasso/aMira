// src/lib/oracle-fci/storage.ts
// KV snapshot storage for historical VCP series (momentum + predictions)

import { FciSnapshot, FundCategory, NormalizedFund } from './types';

/**
 * KV binding: ORACLE_FCI_HISTORY
 * Keys:
 *   - "snapshot:YYYY-MM-DD"     → full FciSnapshot JSON (max ~25MB Cloudflare KV limit per value, our snapshot ~2MB)
 *   - "index:snapshots"         → JSON array of YYYY-MM-DD strings (sorted asc)
 */

export interface StorageAdapter {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

/** Production adapter — uses Cloudflare KV binding */
export class KVStorageAdapter implements StorageAdapter {
  constructor(private kv: KVNamespace) {}

  async get(key: string): Promise<string | null> {
    return this.kv.get(key);
  }

  async put(key: string, value: string): Promise<void> {
    // KV max value = 25MB; our snapshot is ~2MB max. Safe.
    await this.kv.put(key, value);
  }

  async list(prefix: string): Promise<string[]> {
    const list = await this.kv.list({ prefix });
    return list.keys.map((k) => k.name);
  }
}

/** Memory adapter for dev / fallback when KV not bound */
export class MemoryStorageAdapter implements StorageAdapter {
  private map = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
  async list(prefix: string): Promise<string[]> {
    return Array.from(this.map.keys()).filter((k) => k.startsWith(prefix));
  }
}

/** Build a snapshot object from current normalized funds */
export function buildSnapshot(funds: NormalizedFund[], source: string): FciSnapshot {
  const today = new Date();
  const fetched_at = today.toISOString();
  // Find the most common date in funds (the snapshot date)
  const dateCounts = new Map<string, number>();
  for (const f of funds) dateCounts.set(f.date, (dateCounts.get(f.date) ?? 0) + 1);
  let snapshotDate = today.toISOString().slice(0, 10);
  let maxCount = 0;
  for (const [d, c] of dateCounts) {
    if (c > maxCount) {
      maxCount = c;
      snapshotDate = d;
    }
  }

  return {
    date: snapshotDate,
    fetched_at,
    source,
    total_funds: funds.length,
    funds: funds.map((f) => ({
      name: f.name,
      category: f.category as FundCategory,
      vcp: f.vcp,
      ccp: f.ccp,
      patrimonio: f.patrimonio,
      date: f.date,
    })),
  };
}

/** Persist today's snapshot + update index (idempotent) */
export async function saveSnapshot(
  storage: StorageAdapter,
  snapshot: FciSnapshot,
): Promise<void> {
  const key = `snapshot:${snapshot.date}`;
  const existing = await storage.get(key);
  if (existing) return; // already saved today
  await storage.put(key, JSON.stringify(snapshot));

  // Update index
  const indexKey = 'index:snapshots';
  const indexRaw = await storage.get(indexKey);
  const index: string[] = indexRaw ? (JSON.parse(indexRaw) as string[]) : [];
  if (!index.includes(snapshot.date)) {
    index.push(snapshot.date);
    index.sort();
    await storage.put(indexKey, JSON.stringify(index));
  }
}

/** Load up to N most recent historical snapshots */
export async function loadRecentSnapshots(
  storage: StorageAdapter,
  limit = 35,
): Promise<FciSnapshot[]> {
  const indexRaw = await storage.get('index:snapshots');
  if (!indexRaw) return [];
  const index = JSON.parse(indexRaw) as string[];
  // Take last `limit` dates
  const dates = index.slice(-limit);
  const snapshots = await Promise.all(
    dates.map(async (d) => {
      const raw = await storage.get(`snapshot:${d}`);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as FciSnapshot;
      } catch {
        return null;
      }
    }),
  );
  return snapshots.filter((s): s is FciSnapshot => s !== null);
}

/** Build VCP time series per fund name */
export interface VcpSeries {
  name: string;
  series: Array<{ date: string; vcp: number }>;
}

export function buildVcpSeries(snapshots: FciSnapshot[]): Map<string, VcpSeries> {
  const byName = new Map<string, VcpSeries>();
  // Sort snapshots by date asc
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  for (const snap of sorted) {
    for (const f of snap.funds) {
      let entry = byName.get(f.name);
      if (!entry) {
        entry = { name: f.name, series: [] };
        byName.set(f.name, entry);
      }
      entry.series.push({ date: f.date, vcp: f.vcp });
    }
  }
  return byName;
}
