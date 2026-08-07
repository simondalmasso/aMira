// src/app/api/oracle/cedears/route.ts
// GET /api/oracle/cedears?q={query}&topN={n}&type={single|etf|all}
// Returns CEDEARs (single-stock foreign) AND/OR ETF CEDEARs ranked by V4 Oracle Score.

import { NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { runMultiOracle, resolveMultiStorage } from '@/lib/oracle-multi';
import type { ClassOracleResponse, AssetClass } from '@/lib/oracle-multi';

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
    const type = searchParams.get('type') ?? 'all';
    if (type !== 'single' && type !== 'etf' && type !== 'all') {
      return NextResponse.json({ success: false, error: 'INVALID_CEDEAR_TYPE' }, { status: 400 });
    }
    const topNParam = searchParams.get('topN');
    const topN = topNParam ? Math.min(Math.max(parseInt(topNParam, 10) || 25, 5), 100) : 25;

    const classes: AssetClass[] = type === 'single' ? ['CEDEARS'] : type === 'etf' ? ['ETF_CEDEARS'] : ['CEDEARS', 'ETF_CEDEARS'];
    const storage = resolveMultiStorage(getEnv());
    const full = await runMultiOracle({ storage, classes, searchQuery, topN });

    const allAssets = [
      ...(full.by_class['CEDEARS'] ?? []),
      ...(full.by_class['ETF_CEDEARS'] ?? []),
    ];

    const response: ClassOracleResponse = {
      generated_at: full.generated_at,
      snapshot_date: full.snapshot_date,
      source: full.source,
      source_status: full.source_status,
      asset_class: type === 'single' ? 'CEDEARS' : type === 'etf' ? 'ETF_CEDEARS' : 'CEDEARS',
      total_assets: full.total_assets,
      assets_in_output: allAssets.length,
      rankings: {
        top10_by_oracle_score: [...allAssets].sort((a, b) => b.oracle_score - a.oracle_score).slice(0, 10),
        top10_by_market_cap: [...allAssets]
          .filter((a) => a.market_cap_ars != null)
          .sort((a, b) => (b.market_cap_ars ?? 0) - (a.market_cap_ars ?? 0))
          .slice(0, 10),
        top10_predicted_30d: allAssets
          .filter((a) => a.prediction && a.prediction.expected_return_30d !== null)
          .sort((a, b) => (b.prediction?.expected_return_30d ?? -Infinity) - (a.prediction?.expected_return_30d ?? -Infinity))
          .slice(0, 10),
        top10_most_stable: [...allAssets]
          .filter((a) => a.volatility !== null)
          .sort((a, b) => (a.volatility ?? 1) - (b.volatility ?? 1))
          .slice(0, 10),
        top_gainers_7d: [...allAssets]
          .filter((a) => a.momentum_7d !== null)
          .sort((a, b) => (b.momentum_7d ?? -Infinity) - (a.momentum_7d ?? -Infinity))
          .slice(0, 10),
        top_losers_7d: [...allAssets]
          .filter((a) => a.momentum_7d !== null)
          .sort((a, b) => (a.momentum_7d ?? Infinity) - (b.momentum_7d ?? Infinity))
          .slice(0, 10),
      },
      assets: allAssets,
      metadata: {
        history_days_available: full.metadata.history_days_available,
        prediction_engine_active: full.metadata.prediction_engine_active,
        guards: full.metadata.guards,
        fallback_chain_used: full.metadata.fallback_chain_used,
        score_weights: full.metadata.score_weights,
      },
      errors: full.errors,
      evidence: full.evidence,
    };

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
        'X-Oracle-Source': response.source,
        'X-Oracle-Status': response.source_status,
        'X-Oracle-Total': String(response.total_assets),
      },
    });
  } catch (error: unknown) {
    console.error('[oracle-cedears] GET failed', error);
    return NextResponse.json({ success: false, error: 'ORACLE_CEDEARS_UNAVAILABLE' }, { status: 500 });
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
    const result = await runMultiOracle({ storage, classes: ['CEDEARS', 'ETF_CEDEARS'], topN: 1 });
    const persistenceExpected = result.total_assets > 0;
    return NextResponse.json({
      success: true,
      snapshot_date: result.snapshot_date,
      persistence_expected: persistenceExpected,
      source_status: result.source_status,
      total_assets: result.total_assets,
      reason: persistenceExpected ? undefined : 'NO_OBSERVED_CEDEAR_DATA_AVAILABLE',
    });
  } catch (error: unknown) {
    console.error('[oracle-cedears] POST refresh failed', error);
    return NextResponse.json({ success: false, error: 'ORACLE_CEDEARS_REFRESH_FAILED' }, { status: 500 });
  }
}
