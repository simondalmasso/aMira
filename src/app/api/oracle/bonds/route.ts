// src/app/api/oracle/bonds/route.ts
// GET /api/oracle/bonds?q={query}&topN={n}
// Returns Argentine sovereign bonds ranked by V4 Oracle Score.

import { NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { runClassOracle, resolveMultiStorage } from '@/lib/oracle-multi';
import type { ClassOracleResponse } from '@/lib/oracle-multi';

export const dynamic = 'force-dynamic';
export const revalidate = 3600;

type OracleEnv = {
  ORACLE_FCI_HISTORY?: KVNamespace;
  ORACLE_ASSETS_HISTORY?: KVNamespace;
  ORACLE_PREDICTIONS?: KVNamespace;
};

function getEnv(): OracleEnv {
  try {
    const env = getCloudflareContext().env as OracleEnv;
    return {
      ORACLE_FCI_HISTORY: env.ORACLE_FCI_HISTORY,
      ORACLE_ASSETS_HISTORY: env.ORACLE_ASSETS_HISTORY,
      ORACLE_PREDICTIONS: env.ORACLE_PREDICTIONS,
    };
  } catch {
    return {};
  }
}

function hasDurableBindings(env: OracleEnv): boolean {
  return Boolean(
    env.ORACLE_FCI_HISTORY && typeof env.ORACLE_FCI_HISTORY.get === 'function'
    && env.ORACLE_ASSETS_HISTORY && typeof env.ORACLE_ASSETS_HISTORY.get === 'function'
    && env.ORACLE_PREDICTIONS && typeof env.ORACLE_PREDICTIONS.get === 'function',
  );
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
  } catch (error: unknown) {
    console.error('[oracle-bonds] GET failed', error);
    return NextResponse.json({ success: false, error: 'ORACLE_BONDS_UNAVAILABLE' }, { status: 500 });
  }
}

export async function POST(): Promise<NextResponse<{
  success: boolean;
  snapshot_date?: string;
  persistence_expected?: boolean;
  source_status?: ClassOracleResponse['source_status'];
  total_assets?: number;
  reason?: string;
  error?: string;
}>> {
  try {
    const env = getEnv();
    if (!hasDurableBindings(env)) {
      return NextResponse.json({ success: false, error: 'ORACLE_STORAGE_BINDINGS_UNAVAILABLE' }, { status: 503 });
    }
    const storage = resolveMultiStorage(env);
    const result = await runClassOracle('BONOS', { storage, topN: 1 });
    const persistenceExpected = result.total_assets > 0;
    return NextResponse.json({
      success: true,
      snapshot_date: result.snapshot_date,
      persistence_expected: persistenceExpected,
      source_status: result.source_status,
      total_assets: result.total_assets,
      reason: persistenceExpected ? undefined : 'NO_OBSERVED_BOND_DATA_AVAILABLE',
    });
  } catch (error: unknown) {
    console.error('[oracle-bonds] POST refresh failed', error);
    return NextResponse.json({ success: false, error: 'ORACLE_BONDS_REFRESH_FAILED' }, { status: 500 });
  }
}
