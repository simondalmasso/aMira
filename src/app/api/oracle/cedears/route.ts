// src/app/api/oracle/cedears/route.ts
// GET /api/oracle/cedears?q={query}&topN={n}&type={single|etf|all}
// Returns CEDEARs (single-stock foreign) AND/OR ETF CEDEARs ranked by V4 Oracle Score.

import { NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { runMultiOracle, resolveMultiStorage } from '@/lib/oracle-multi';
import type { ClassOracleResponse, AssetClass } from '@/lib/oracle-multi';

export const dynamic = 'force-dynamic';
export const revalidate = 3600;

function getEnv() {
  // CRON_PERSISTENCE_WIRING_FIX — see /api/oracle/cron/route.ts for rationale.
  // `process.env.ORACLE_*` is NOT populated inside OpenNext Route Handlers
  // when invoked from the scheduled() cron context → KV bindings silently
  // resolve to `undefined` → MemoryStorageAdapter fallback → ghost writes.
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
    const type = searchParams.get('type') ?? 'all'; // 'single' | 'etf' | 'all'
    const topNParam = searchParams.get('topN');
    const topN = topNParam ? Math.min(Math.max(parseInt(topNParam, 10) || 25, 5), 100) : 25;

    const classes: AssetClass[] = type === 'single' ? ['CEDEARS'] : type === 'etf' ? ['ETF_CEDEARS'] : ['CEDEARS', 'ETF_CEDEARS'];

    const storage = resolveMultiStorage(getEnv());
    const full = await runMultiOracle({ storage, classes, searchQuery, topN });

    // Combine CEDEARS + ETF_CEDEARS into one ClassOracleResponse-shaped payload
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
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: `ORACLE_CEDEARS runtime error: ${msg}` },
      { status: 500 },
    );
  }
}

export async function POST(): Promise<NextResponse<{ success: boolean; snapshot_date?: string; error?: string }>> {
  try {
    const storage = resolveMultiStorage(getEnv());
    const result = await runMultiOracle({ storage, classes: ['CEDEARS', 'ETF_CEDEARS'], topN: 1 });
    return NextResponse.json({ success: true, snapshot_date: result.snapshot_date });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
