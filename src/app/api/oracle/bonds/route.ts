// src/app/api/oracle/bonds/route.ts
// GET /api/oracle/bonds?q={query}&topN={n}
// Returns Argentine sovereign bonds ranked by V4 Oracle Score.

import { NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { runClassOracle, resolveMultiStorage } from '@/lib/oracle-multi';
import type { ClassOracleResponse } from '@/lib/oracle-multi';

export const dynamic = 'force-dynamic';
export const revalidate = 3600;

function getEnv() {
  // CRON_PERSISTENCE_WIRING_FIX — see /api/oracle/cron/route.ts for rationale.
  try {
    const ctx = getCloudflareContext();
    const env = ctx.env as {
      ORACLE_FCI_HISTORY?: KVNamespace;
      ORACLE_ASSETS_HISTORY?: KVNamespace;
      ORACLE_PREDICTIONS?: KVNamespace;
    };
    return {
      ORACLE_FCI_HISTORY: env.ORACLE_FCI_HISTORY,
      ORACLE_ASSETS_HISTORY: env.ORACLE_ASSETS_HISTORY,
      ORACLE_PREDICTIONS: env.ORACLE_PREDICTIONS,
    };
  } catch {
    return {
      ORACLE_FCI_HISTORY: undefined,
      ORACLE_ASSETS_HISTORY: undefined,
      ORACLE_PREDICTIONS: undefined,
    };
  }
}

export async function GET(req: NextRequest): Promise<NextResponse<ClassOracleResponse | { success: false; error: string }>> {
  try {
    const { searchParams } = new URL(req.url);
    const searchQuery = searchParams.get('q') ?? undefined;
    const topNParam = searchParams.get('topN');
    const topN = topNParam ? Math.min(Math.max(parseInt(topNParam, 10) || 25, 5), 100) : 25;

    const storage = resolveMultiStorage(getEnv());
    const result = await runClassOracle('BONOS', { storage, searchQuery, topN });

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
        'X-Oracle-Source': result.source,
        'X-Oracle-Status': result.source_status,
        'X-Oracle-Class': result.asset_class,
        'X-Oracle-Total': String(result.total_assets),
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: `ORACLE_BONDS runtime error: ${msg}` },
      { status: 500 },
    );
  }
}

export async function POST(): Promise<NextResponse<{ success: boolean; snapshot_date?: string; error?: string }>> {
  try {
    const storage = resolveMultiStorage(getEnv());
    const result = await runClassOracle('BONOS', { storage, topN: 1 });
    return NextResponse.json({ success: true, snapshot_date: result.snapshot_date });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
