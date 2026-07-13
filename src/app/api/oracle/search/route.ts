// src/app/api/oracle/search/route.ts
// GET /api/oracle/search?q={query}&limit={n}
// Unified fuzzy search across all asset classes.

import { NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { runMultiOracle, resolveMultiStorage, MultiAssetSearcher } from '@/lib/oracle-multi';
import type { SearchResponse } from '@/lib/oracle-multi';

export const dynamic = 'force-dynamic';
export const revalidate = 300; // 5 min — search is more dynamic

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

export async function GET(req: NextRequest): Promise<NextResponse<SearchResponse | { success: false; error: string }>> {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q') ?? '';
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 50, 5), 200) : 50;

    if (!query || query.trim().length < 2) {
      return NextResponse.json({
        query,
        total_results: 0,
        results: [],
        searched_at: new Date().toISOString(),
      } satisfies SearchResponse);
    }

    const storage = resolveMultiStorage(getEnv());
    // Run multi-oracle to get all ranked assets
    const full = await runMultiOracle({ storage, topN: 100 });
    const allAssets = Object.values(full.by_class).flat();

    const searcher = new MultiAssetSearcher(allAssets);
    const results = searcher.search(query, limit);

    const response: SearchResponse = {
      query,
      total_results: results.length,
      results,
      searched_at: new Date().toISOString(),
    };

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        'X-Oracle-Search-Results': String(results.length),
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: `ORACLE_SEARCH runtime error: ${msg}` },
      { status: 500 },
    );
  }
}
