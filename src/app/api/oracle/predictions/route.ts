// src/app/api/oracle/predictions/route.ts
// GET /api/oracle/predictions?min_confidence={0-1}&asset_class={class}
// Returns all assets with predictions, sorted by confidence desc.

import { NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { runMultiOracle, resolveMultiStorage } from '@/lib/oracle-multi';
import type { PredictionsResponse } from '@/lib/oracle-multi';

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

export async function GET(req: NextRequest): Promise<NextResponse<PredictionsResponse | { success: false; error: string }>> {
  try {
    const { searchParams } = new URL(req.url);
    const minConfidenceParam = searchParams.get('min_confidence');
    const minConfidence = minConfidenceParam ? Math.max(0, Math.min(1, parseFloat(minConfidenceParam))) : 0.65;
    const assetClass = searchParams.get('asset_class') as import('@/lib/oracle-multi').AssetClass | null;

    const storage = resolveMultiStorage(getEnv());
    const classes = assetClass ? [assetClass] : undefined;
    const full = await runMultiOracle({ storage, classes, topN: 100 });

    const predictions = full.rankings.top10_predicted_30d
      .concat(full.by_class && Object.values(full.by_class).flat().filter((a) => a.prediction != null && !full.rankings.top10_predicted_30d.includes(a)))
      .filter((a) => a.prediction != null && a.prediction.confidence >= minConfidence)
      .map((a) => ({
        asset_id: a.id,
        name: a.name,
        asset_class: a.asset_class,
        ticker: a.ticker,
        expected_return_30d: a.prediction!.expected_return_30d,
        confidence: a.prediction!.confidence,
        bull_probability: a.prediction!.bull_probability,
        bear_probability: a.prediction!.bear_probability,
        volatility_score: a.prediction!.volatility_score,
        models_used: a.prediction!.models_used,
      }))
      .sort((a, b) => b.confidence - a.confidence);

    // Deduplicate by asset_id
    const seen = new Set<string>();
    const deduped = predictions.filter((p) => {
      if (seen.has(p.asset_id)) return false;
      seen.add(p.asset_id);
      return true;
    });

    const highConvictionCount = deduped.filter((p) => p.confidence > 0.85).length;

    const response: PredictionsResponse = {
      generated_at: full.generated_at,
      snapshot_date: full.snapshot_date,
      total_predictions: deduped.length,
      high_conviction_count: highConvictionCount,
      predictions: deduped,
      metadata: {
        guards: full.metadata.guards,
        confidence_threshold: 0.65,
        min_history_days: 9,
      },
    };

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
        'X-Oracle-Status': full.source_status,
        'X-Oracle-Predictions-Count': String(deduped.length),
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: `ORACLE_PREDICTIONS runtime error: ${msg}` },
      { status: 500 },
    );
  }
}

/**
 * POST /api/oracle/predictions
 *
 * P2_PREDICTIONS_POST_HANDLER_FIX_v1 — invoked by scripts/wrap-worker-with-cron.mjs
 * scheduled() handler with method: 'POST' (line 74 of wrapper). The handler
 * previously only exported GET, so Next.js returned HTTP 405 Method Not Allowed
 * on every cron invocation since 2026-06-22 → `refresh_predictions` never ran
 * → decision engine stuck in confidenceThrottle (recentConfidence=0.33) →
 * no new DEC-* decisions generated.
 *
 * Plumbing-only fix. NO changes to scoring engine, weights, or model.
 * Mirrors `refresh_predictions` job in src/lib/oracle-multi/cron.ts:81-94
 * (runMultiOracle with topN:5, no class filter — runs all classes so the
 * predictor has the latest snapshots).
 *
 * Deviations from Qwen's literal snippet (documented for audit):
 *   1. Uses local `getEnv()` (P1 CRON_PERSISTENCE_WIRING_FIX applied — uses
 *      getCloudflareContext().env, NOT process.env.*). `getOracleEnv` does
 *      NOT exist in this codebase. Fail-loudly check in resolveMultiStorage()
 *      still fires if any KV binding is undefined after the ctx lookup.
 *   2. Uses `result.predictions_summary.assets_with_predictions` for the
 *      count. The MultiOracleResponse shape (types.ts:187-192) has no
 *      `predictions[]` array — only `predictions_summary`. Also surfaces
 *      `predictions_active` and `high_conviction_count` for cron telemetry.
 */
export async function POST(): Promise<NextResponse> {
  const startedAt = Date.now();
  try {
    const storage = resolveMultiStorage(getEnv());
    const result = await runMultiOracle({ storage, topN: 5 });
    const durationMs = Date.now() - startedAt;

    return NextResponse.json({
      success: true,
      snapshot_date: result.snapshot_date,
      source_status: result.source_status,
      predictions_active: result.predictions_summary.active,
      predictions_count: result.predictions_summary.assets_with_predictions,
      high_conviction_count: result.predictions_summary.high_conviction_count,
      duration_ms: durationMs,
    });
  } catch (err: unknown) {
    const durationMs = Date.now() - startedAt;
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[predictions/POST] runMultiOracle failed:', msg);
    return NextResponse.json(
      { success: false, error: msg, duration_ms: durationMs },
      { status: 500 },
    );
  }
}
