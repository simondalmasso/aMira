import { NextResponse } from 'next/server';
import { getMacroState, getProductsFromMacro, applyStaleDegradation } from '@/lib/live-data';
import { optimizePortfolio } from '@/lib/portfolio-engine';
import { db } from '@/lib/db';

export async function POST() {
  const startedAt = Date.now();
  try {
    const rawMacro = await getMacroState();
    const macro = applyStaleDegradation(rawMacro);
    const result = optimizePortfolio(macro);
    const products = getProductsFromMacro(macro);

    let marketSnapshotSaved = false;
    let portfolioSnapshotSaved = false;
    let allocationReadSucceeded = false;
    let rebalanceNeeded = false;
    const persistenceWarnings: string[] = [];

    try {
      await db.marketSnapshot.create({
        data: {
          mepRate: macro.mep.rate,
          officialRate: macro.mep.officialRate,
          gapPercent: macro.mep.gap,
          inflationMonthly: macro.inflation.monthly,
          inflationExpected30d: macro.inflation.expected30d,
          bcraPolicyRate: macro.rates.bcraPolicy,
          crawlingPeg: macro.crawlingPeg,
          cerIndex: macro.cer.index,
          cerMonthlyChange: macro.cer.monthlyChange,
          moneyMarketTNA: macro.rates.moneyMarket,
          plazoFijoTNA: macro.rates.plazoFijo,
          plazoFijoUVATNA: macro.rates.plazoFijoUVA,
        },
      });
      marketSnapshotSaved = true;
    } catch (error) {
      console.error('[sync] market snapshot persistence failed', error);
      persistenceWarnings.push('MARKET_SNAPSHOT_PERSISTENCE_FAILED');
    }

    try {
      await db.portfolioSnapshot.create({
        data: {
          totalUSD: 2000,
          totalARS: Math.round(2000 * macro.mep.rate),
          realReturn30d: result.metrics.expectedRealReturn30d,
          nominalReturn30d: result.metrics.expectedNominalReturn30d,
          volatility30d: result.metrics.volatility30d,
          maxDrawdown30d: result.metrics.maxDrawdown30d,
          capitalSafetyScore: result.metrics.capitalSafetyScore,
          sharpeRatio: result.metrics.sharpeRatio,
          fxExposure: result.metrics.fxExposure,
          inflationExposure: result.metrics.inflationExposure,
          allocationsJson: JSON.stringify(result.allocations),
        },
      });
      portfolioSnapshotSaved = true;
    } catch (error) {
      console.error('[sync] portfolio snapshot persistence failed', error);
      persistenceWarnings.push('PORTFOLIO_SNAPSHOT_PERSISTENCE_FAILED');
    }

    try {
      const currentAllocs = await db.allocation.findMany({ where: { isActive: true } });
      allocationReadSucceeded = true;
      rebalanceNeeded = currentAllocs.some((current) => {
        const target = result.allocations.find((allocation) => allocation.productId === current.productId);
        return Boolean(target && Math.abs(target.weight - current.weight) > 0.03);
      });
    } catch (error) {
      console.error('[sync] allocation read failed', error);
      persistenceWarnings.push('ALLOCATION_READ_FAILED');
    }

    const durationMs = Date.now() - startedAt;
    let syncLogSaved = false;
    try {
      await db.syncLog.create({
        data: {
          status: marketSnapshotSaved && portfolioSnapshotSaved ? 'success' : 'degraded',
          mepUpdated: marketSnapshotSaved && (macro.provenance.mepRate.dataClass === 'OBSERVED'),
          macroUpdated: marketSnapshotSaved,
          portfolioUpdated: portfolioSnapshotSaved,
          rebalanceNeeded,
          durationMs,
        },
      });
      syncLogSaved = true;
    } catch (error) {
      console.error('[sync] sync log persistence failed', error);
      persistenceWarnings.push('SYNC_LOG_PERSISTENCE_FAILED');
    }

    const allocatedIds = new Set(result.allocations.map((allocation) => allocation.productId));
    const allAllocations = [
      ...result.allocations,
      ...products.filter((product) => !allocatedIds.has(product.id)).map((product) => ({
        productId: product.id,
        productName: product.shortName,
        weight: 0,
        amountARS: 0,
        amountUSD: 0,
        category: product.category,
      })),
    ];

    const persistenceDurable = marketSnapshotSaved && portfolioSnapshotSaved && allocationReadSucceeded && syncLogSaved;
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      dataMode: macro.source,
      durationMs,
      updates: {
        mep: marketSnapshotSaved && macro.provenance.mepRate.dataClass === 'OBSERVED',
        macro: marketSnapshotSaved,
        portfolio: portfolioSnapshotSaved,
        rebalanceNeeded,
      },
      persistence: {
        state: persistenceDurable ? 'durable' : 'degraded',
        durable: persistenceDurable,
        marketSnapshotSaved,
        portfolioSnapshotSaved,
        allocationReadSucceeded,
        syncLogSaved,
        warnings: persistenceWarnings,
      },
      mepRate: macro.mep.rate,
      metrics: result.metrics,
      allocations: allAllocations,
    });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    console.error('[sync] execution failed', error);
    try {
      await db.syncLog.create({
        data: {
          status: 'failed',
          mepUpdated: false,
          macroUpdated: false,
          portfolioUpdated: false,
          rebalanceNeeded: false,
          errorDetail: 'SYNC_EXECUTION_FAILED',
          durationMs,
        },
      });
    } catch (logError) {
      console.error('[sync] failed-run log persistence failed', logError);
    }
    return NextResponse.json({ success: false, code: 'SYNC_EXECUTION_FAILED', error: 'Sync failed', timestamp: new Date().toISOString() }, { status: 500 });
  }
}
