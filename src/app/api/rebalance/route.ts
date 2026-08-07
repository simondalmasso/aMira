import { NextResponse } from 'next/server';
import { getMacroState, getProductsFromMacro, computeBacktest, getOverallDataLabel, applyStaleDegradation } from '@/lib/live-data';
import { optimizePortfolio, optimizePortfolioMulti, generateEquityCurve } from '@/lib/portfolio-engine';
import { db } from '@/lib/db';

export async function POST() {
  try {
    const rawMacro = await getMacroState();
    const macro = applyStaleDegradation(rawMacro);
    const result = optimizePortfolio(macro);
    const multiResult = optimizePortfolioMulti(macro);
    const products = getProductsFromMacro(macro);

    let persistenceDurable = false;
    let persistenceWarning: string | null = null;
    try {
      const previousAllocs = await db.allocation.findMany({ where: { isActive: true } });
      await db.$transaction(async (tx) => {
        await tx.rebalanceLog.create({
          data: {
            previousAllocs: JSON.stringify(previousAllocs),
            newAllocs: JSON.stringify(result.allocations),
            reason: 'manual',
            metricsJson: JSON.stringify(result.metrics),
          },
        });
        await tx.allocation.updateMany({ where: { isActive: true }, data: { isActive: false } });
        for (const allocation of result.allocations) {
          await tx.allocation.create({
            data: {
              productId: allocation.productId,
              weight: allocation.weight,
              amountARS: allocation.amountARS,
              amountUSD: allocation.amountUSD,
              isActive: true,
            },
          });
        }
      });
      persistenceDurable = true;
    } catch (error) {
      console.error('[rebalance] transactional persistence failed', error);
      persistenceWarning = 'REBALANCE_PERSISTENCE_FAILED';
    }

    const equityCurve = generateEquityCurve(2000, result.allocations, products, macro, 90);
    const backtest = computeBacktest(products);
    const dataLabel = getOverallDataLabel(macro);
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

    return NextResponse.json({
      success: true,
      timestamp: result.timestamp,
      dataMode: result.dataMode,
      dataLabel,
      message: persistenceDurable ? 'Portfolio rebalanced and persisted' : 'Portfolio rebalance computed; persistence degraded',
      persistence: {
        state: persistenceDurable ? 'durable' : 'degraded',
        durable: persistenceDurable,
        transactional: true,
        warning: persistenceWarning,
      },
      allocations: allAllocations,
      metrics: result.metrics,
      scenarioResults: result.scenarioResults,
      equityCurve,
      mepRate: macro.mep.rate,
      multiProfile: multiResult,
      backtest,
      provenance: macro.provenance,
    });
  } catch (error) {
    console.error('[rebalance] computation failed', error);
    return NextResponse.json({ success: false, code: 'REBALANCE_FAILED', error: 'Rebalance failed', timestamp: new Date().toISOString() }, { status: 500 });
  }
}
