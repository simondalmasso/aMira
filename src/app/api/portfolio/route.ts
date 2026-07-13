import { NextResponse } from 'next/server';
import { getMacroState, getProductsFromMacro, getScenariosFromMacro, computeBacktest, getOverallDataLabel, applyStaleDegradation } from '@/lib/live-data';
import { optimizePortfolio, optimizePortfolioMulti, generateEquityCurve } from '@/lib/portfolio-engine';

export const dynamic = 'force-dynamic';
export const revalidate = 300;

export async function GET() {
  try {
    const rawMacro = await getMacroState();
    const macro = applyStaleDegradation(rawMacro);
    const result = optimizePortfolio(macro);
    const multiResult = optimizePortfolioMulti(macro);
    const products = getProductsFromMacro(macro);
    const scenarios = getScenariosFromMacro(macro);
    const equityCurve = generateEquityCurve(2000, result.allocations, products, macro, 90);
    const capitalARS = 2000 * macro.mep.rate;

    // Build allocations for ALL products (include 0-weight for unallocated)
    const allocatedIds = new Set(result.allocations.map(a => a.productId));
    const allAllocations = [
      ...result.allocations.map(a => ({
        productId: a.productId,
        name: a.productName,
        weight: a.weight,
        weightPercent: `${(a.weight * 100).toFixed(1)}%`,
        amountUSD: a.amountUSD,
        amountARS: a.amountARS,
        category: a.category,
      })),
      ...products
        .filter(p => !allocatedIds.has(p.id))
        .map(p => ({
          productId: p.id,
          name: p.shortName,
          weight: 0,
          weightPercent: '0.0%',
          amountUSD: 0,
          amountARS: 0,
          category: p.category,
        })),
    ];

    // Backtest + provenance
    const backtest = computeBacktest(products);
    const dataLabel = getOverallDataLabel(macro);

    return NextResponse.json({
      success: true,
      timestamp: result.timestamp,
      dataMode: result.dataMode,
      dataLabel,
      capital: {
        usd: 2000,
        ars: Math.round(capitalARS),
      },
      allocations: allAllocations,
      metrics: result.metrics,
      scenarios: result.scenarioResults,
      equityCurve: equityCurve.slice(-30), // Last 30 days for API
      mepRate: macro.mep.rate,
      multiProfile: multiResult,
      backtest,
      provenance: macro.provenance,
      realDataPct: macro.realDataPct,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: 'Portfolio optimization failed',
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
