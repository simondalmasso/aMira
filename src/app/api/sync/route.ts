import { NextResponse } from 'next/server';
import { getMacroState, getProductsFromMacro, applyStaleDegradation } from '@/lib/live-data';
import { optimizePortfolio } from '@/lib/portfolio-engine';
import { db } from '@/lib/db';

export async function POST() {
  const startTime = Date.now();

  try {
    const rawMacro = await getMacroState();
    const macro = applyStaleDegradation(rawMacro);
    const result = optimizePortfolio(macro);
    const products = getProductsFromMacro(macro);

    // Save market snapshot
    let mepUpdated = false;
    let macroUpdated = true;
    let portfolioUpdated = true;
    let rebalanceNeeded = false;

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
      mepUpdated = macro.source === 'REAL' || macro.source === 'OBSERVADO';

      // Save portfolio snapshot
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

      // Check if rebalance needed (drift > 3%)
      const currentAllocs = await db.allocation.findMany({ where: { isActive: true } });
      if (currentAllocs.length > 0) {
        for (const current of currentAllocs) {
          const target = result.allocations.find(a => a.productId === current.productId);
          if (target && Math.abs(target.weight - current.weight) > 0.03) {
            rebalanceNeeded = true;
            break;
          }
        }
      }

    } catch {
      // DB failures shouldn't block sync
    }

    // Log sync
    const durationMs = Date.now() - startTime;
    try {
      await db.syncLog.create({
        data: {
          status: 'success',
          mepUpdated,
          macroUpdated,
          portfolioUpdated,
          rebalanceNeeded,
          durationMs,
        },
      });
    } catch {
      // Ignore
    }

    // Include all products (0-weight for unallocated)
    const allocatedIds = new Set(result.allocations.map(a => a.productId));
    const allAllocations = [
      ...result.allocations,
      ...products
        .filter(p => !allocatedIds.has(p.id))
        .map(p => ({
          productId: p.id,
          productName: p.shortName,
          weight: 0,
          amountARS: 0,
          amountUSD: 0,
          category: p.category,
        })),
    ];

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      dataMode: macro.source,
      durationMs,
      updates: {
        mep: mepUpdated,
        macro: macroUpdated,
        portfolio: portfolioUpdated,
        rebalanceNeeded,
      },
      mepRate: macro.mep.rate,
      metrics: result.metrics,
      allocations: allAllocations,
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    try {
      await db.syncLog.create({
        data: {
          status: 'failed',
          mepUpdated: false,
          macroUpdated: false,
          portfolioUpdated: false,
          rebalanceNeeded: false,
          errorDetail: String(error),
          durationMs,
        },
      });
    } catch {
      // Ignore
    }

    return NextResponse.json({
      success: false,
      error: 'Sync failed',
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
