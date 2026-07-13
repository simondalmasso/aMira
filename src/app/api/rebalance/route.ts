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

    // Log rebalance to DB
    try {
      await db.rebalanceLog.create({
        data: {
          previousAllocs: JSON.stringify([]),
          newAllocs: JSON.stringify(result.allocations),
          reason: 'manual',
          metricsJson: JSON.stringify(result.metrics),
        },
      });
    } catch {
      // DB write failure shouldn't block the response
    }

    // Deactivate old allocations and create new ones
    try {
      await db.allocation.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });

      for (const alloc of result.allocations) {
        await db.allocation.create({
          data: {
            productId: alloc.productId,
            weight: alloc.weight,
            amountARS: alloc.amountARS,
            amountUSD: alloc.amountUSD,
            isActive: true,
          },
        });
      }
    } catch {
      // DB write failure shouldn't block
    }

    const equityCurve = generateEquityCurve(2000, result.allocations, products, macro, 90);

    // Backtest + provenance
    const backtest = computeBacktest(products);
    const dataLabel = getOverallDataLabel(macro);

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
      timestamp: result.timestamp,
      dataMode: result.dataMode,
      dataLabel,
      message: 'Portfolio rebalanced successfully',
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
    return NextResponse.json({
      success: false,
      error: 'Rebalance failed',
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
