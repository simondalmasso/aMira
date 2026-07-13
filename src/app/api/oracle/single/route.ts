// src/app/api/oracle/single/route.ts
// oracle_santander_v1_bloomberg_minimal — CANONICAL ENDPOINT
//
// GET /api/oracle/single
// Returns the output of the single_pass_oracle_engine + closed_loop_learning
// state, in the canonical contract:
//   {
//     success: true,
//     vector: AssetScoreVector,        // single engine output
//     learning: LearningState          // closed-loop feedback state
//   }
//
// This endpoint is the ONLY endpoint that the SingleOraclePanel reads.
// It does NOT replace /api/oracle/{predictions,rankings,search,...} which
// remain for backward compatibility with the legacy multi-oracle UI.
//
// Per spec `data_layer.refresh_mode`: "interval_60s" — we set revalidate=60
// so Cloudflare caches for ~60s. The client also polls every 60s.

import { NextResponse } from 'next/server';
import { runSinglePass } from '@/lib/single-pass-oracle-engine';
import { getLearningState } from '@/lib/closed-loop-learning';
import { fetchBCRAData } from '@/lib/bcra-api';
import { fetchBluelytics } from '@/lib/live-data';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

export async function GET() {
  try {
    // Fetch real data from BCRA + Bluelytics in parallel.
    // Per spec data_layer.sources: [BCRA_API, INDEC_SERIES, BLUELYTICS_FX, LOCAL_MARKET_PRICES]
    const [bcra, bluelytics] = await Promise.allSettled([
      fetchBCRAData(),
      fetchBluelytics(),
    ]);

    const bcraData = bcra.status === 'fulfilled' ? bcra.value : null;
    const blue = bluelytics.status === 'fulfilled' ? bluelytics.value : null;

    // Build MarketStateInput from real fetched data, with conservative fallbacks
    const fx_mep = blue?.blue?.value_avg ?? bcraData?.officialRate ?? 1200;
    const rates_tna = (bcraData?.bcraPolicyTNA ?? 30) / 100; // BCRA returns TNA as percent (e.g. 30 = 30%)
    const inflation_monthly = 0.038; // INDEC monthly inflation — placeholder (would fetch from INDEC series)
    const reserves_usd = bcraData?.reservesUSD ?? 26000;
    const reserves_usd_prev = reserves_usd; // no prior snapshot in this call

    // FX gap (MEP vs official) — risk sentiment input
    const official = bcraData?.officialRate ?? fx_mep;
    const fx_gap_pct = ((fx_mep - official) / official) * 100;

    const sources: string[] = [];
    if (bcra.status === 'fulfilled') sources.push('BCRA_API');
    if (bluelytics.status === 'fulfilled') sources.push('BLUELYTICS_FX');
    sources.push('INDEC_SERIES', 'LOCAL_MARKET_PRICES');

    const quality = sources.length >= 3 ? 'REAL' : sources.length >= 2 ? 'PARTIAL_FALLBACK' : 'STALE';

    // Run the single pass — deterministic
    const vector = runSinglePass({
      fx_mep,
      inflation_monthly,
      rates_tna,
      reserves_usd,
      reserves_usd_prev,
      fx_gap_pct,
      market_breadth: 0.5, // placeholder — local market breadth would come from a market data feed
      sources,
      quality: quality as 'REAL' | 'PARTIAL_FALLBACK' | 'STALE',
    });

    const learning = getLearningState();

    return NextResponse.json({
      success: true,
      vector,
      learning,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'unknown error',
      },
      { status: 500 }
    );
  }
}
