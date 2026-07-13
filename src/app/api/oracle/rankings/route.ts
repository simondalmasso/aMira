// src/app/api/oracle/rankings/route.ts
// GET /api/oracle/rankings?topN={n}&class={class}
// Returns unified global rankings across all asset classes.

import { NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { runMultiOracle, resolveMultiStorage } from '@/lib/oracle-multi';
import type { MultiOracleResponse, AssetClass } from '@/lib/oracle-multi';

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

export async function GET(req: NextRequest): Promise<NextResponse<MultiOracleResponse | { success: false; error: string }>> {
  try {
    const { searchParams } = new URL(req.url);
    const topNParam = searchParams.get('topN');
    const topN = topNParam ? Math.min(Math.max(parseInt(topNParam, 10) || 25, 5), 100) : 25;
    const classFilter = searchParams.get('class') as AssetClass | null;
    const classes = classFilter ? [classFilter] : undefined;

    const storage = resolveMultiStorage(getEnv());
    const result = await runMultiOracle({ storage, classes, topN });

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
        'X-Oracle-Source': result.source,
        'X-Oracle-Status': result.source_status,
        'X-Oracle-Total': String(result.total_assets),
        'X-Oracle-Classes-Fetched': result.metadata.classes_fetched.join(','),
        'X-Oracle-Classes-Failed': result.metadata.classes_failed.join(',') || 'none',
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: `ORACLE_RANKINGS runtime error: ${msg}` },
      { status: 500 },
    );
  }
}

export async function POST(): Promise<NextResponse<{ success: boolean; snapshot_date?: string; error?: string }>> {
  try {
    const storage = resolveMultiStorage(getEnv());
    const result = await runMultiOracle({ storage, topN: 1 });
    return NextResponse.json({ success: true, snapshot_date: result.snapshot_date });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
