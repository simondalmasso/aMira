// src/app/api/oracle/fci/route.ts
// ORACLE_FCI_AR_V3 endpoint — full pipeline: fetch → normalize → snapshot → rank → predict → search
// Cache TTL: 1 hour (per spec). Storage: KV binding ORACLE_FCI_HISTORY (or memory fallback).

import { NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { runOracleFci, KVStorageAdapter, MemoryStorageAdapter } from '@/lib/oracle-fci';
import type { OracleFciResponse } from '@/lib/oracle-fci';

export const dynamic = 'force-dynamic';
export const revalidate = 3600; // 1 hour cache

function getKV(): KVNamespace | undefined {
  try {
    const env = getCloudflareContext().env as { ORACLE_FCI_HISTORY?: KVNamespace };
    const kv = env.ORACLE_FCI_HISTORY;
    return kv && typeof kv.get === 'function' && typeof kv.put === 'function' ? kv : undefined;
  } catch {
    return undefined;
  }
}

export async function GET(req: NextRequest): Promise<NextResponse<OracleFciResponse | { success: false; error: string }>> {
  try {
    const { searchParams } = new URL(req.url);
    const searchQuery = searchParams.get('q') ?? undefined;
    const topNParam = searchParams.get('topN');
    const topN = topNParam ? Math.min(Math.max(parseInt(topNParam, 10) || 25, 5), 100) : 25;

    const kv = getKV();
    const storage = kv ? new KVStorageAdapter(kv) : new MemoryStorageAdapter();

    const result = await runOracleFci({
      storage,
      topN,
      searchQuery,
    });

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
        'X-Oracle-Fci-Source': result.source,
        'X-Oracle-Fci-Status': result.source_status,
        'X-Oracle-Fci-Snapshot': result.snapshot_date,
        'X-Oracle-Fci-Total': String(result.total_funds),
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        success: false,
        error: `ORACLE_FCI runtime error: ${msg}`,
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}

/** POST endpoint — trigger snapshot save (for cron or manual refresh) */
export async function POST(): Promise<NextResponse<{
  success: boolean;
  snapshot_date?: string;
  persistence_expected?: boolean;
  source_status?: OracleFciResponse['source_status'];
  total_funds?: number;
  error?: string;
}>> {
  try {
    const kv = getKV();
    if (!kv) {
      return NextResponse.json({ success: false, error: 'ORACLE_FCI_HISTORY binding unavailable' }, { status: 503 });
    }
    const result = await runOracleFci({ storage: new KVStorageAdapter(kv), topN: 1 });
    return NextResponse.json({
      success: result.source_status !== 'ERROR',
      snapshot_date: result.snapshot_date,
      persistence_expected: result.total_funds > 0,
      source_status: result.source_status,
      total_funds: result.total_funds,
    }, { status: result.source_status === 'ERROR' ? 503 : 200 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
