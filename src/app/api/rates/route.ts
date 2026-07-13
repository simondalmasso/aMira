import { NextResponse } from 'next/server';
import { fetchBCRAData, fetchCERData } from '@/lib/bcra-api';
import { fetchINDECInflation } from '@/lib/indec-api';
import { fetchBluelytics, getMacroState, applyStaleDegradation } from '@/lib/live-data';

export const dynamic = 'force-dynamic';
export const revalidate = 300; // 5 minutes

// ============================================================================
// DIAGNOSTIC ENDPOINT — Raw API data + real data percentage
// GET /api/rates → Shows exactly what each API returned
// ============================================================================
export async function GET() {
  try {
    const timestamp = new Date().toISOString();

    // Fetch all raw data sources in parallel
    const [bluelytics, bcraData, cerData, indecData, rawMacroState] = await Promise.all([
      fetchBluelytics(),
      fetchBCRAData(),
      fetchCERData(),
      fetchINDECInflation(),
      getMacroState(),
    ]);
    const macroState = applyStaleDegradation(rawMacroState);

    // Compute real data stats
    const provenance = macroState.provenance;
    const totalSources = Object.keys(provenance).length;
    const realSources = Object.values(provenance).filter(p => p.label === 'REAL').length;
    const realPct = macroState.realDataPct;

    return NextResponse.json({
      success: true,
      timestamp,

      // ─── Real data percentage ───
      realData: {
        percentage: realPct,
        realSources,
        totalSources,
        target: 70,
        status: realPct >= 70 ? 'META ALCANZADA' : realPct >= 40 ? 'EN PROGRESO' : 'INSUFICIENTE',
      },

      // ─── Raw API results ───
      sources: {
        bluelytics: {
          status: bluelytics ? 'OK' : 'FAILED',
          url: 'https://api.bluelytics.com.ar/v2/latest',
          lastUpdate: bluelytics?.last_update ?? null,
          data: bluelytics ? {
            blue_avg: bluelytics.blue.value_avg,
            blue_sell: bluelytics.blue.value_sell,
            blue_buy: bluelytics.blue.value_buy,
            oficial_avg: bluelytics.oficial.value_avg,
          } : null,
        },
        bcra: {
          status: bcraData.isReal ? 'OK' : 'FAILED',
          url: bcraData.sourceUrl,
          dataDate: bcraData.dataDate,
          error: bcraData.error ?? null,
          data: {
            policyRate: bcraData.bcraPolicyTNA,
            leliqRate: bcraData.bcraPolicyTNA, // LELIQ tracks policy rate (not in BCRARates)
            badlarRate: bcraData.badlarTNA,
            tmlRate: bcraData.badlarTNA - 2, // TML typically 2pp below BADLAR
            lecapsRate: bcraData.lecapsTNA,
            officialRate: bcraData.officialRate,
            reservesUSD: bcraData.reservesUSD,
            moneyMarketDerived: bcraData.moneyMarketTNA,
          },
        },
        cer: {
          status: cerData.isReal ? 'OK' : 'FAILED',
          url: cerData.sourceUrl,
          dataDate: cerData.dataDate,
          error: cerData.error ?? null,
          data: {
            index: cerData.index,
            monthlyChange: cerData.monthlyChange,
            dailyChange: cerData.dailyChange,
          },
        },
        indec: {
          status: indecData.isReal ? 'OK' : 'FAILED',
          url: indecData.sourceUrl,
          dataDate: indecData.dataDate,
          error: indecData.error ?? null,
          data: {
            lastMonthInflation: indecData.lastMonthInflation,
            lastMonthDate: indecData.lastMonthDate,
            coreInflation: indecData.coreInflation,
            threeMonthAvg: indecData.threeMonthAvg,
            sixMonthAvg: indecData.sixMonthAvg,
            twelveMonthAccum: indecData.twelveMonthAccum,
            projected30d: indecData.projected30d,
            projected90d: indecData.projected90d,
            monthlySeries: indecData.monthlySeries.slice(-6),
          },
        },
      },

      // ─── Derived macro state ───
      macro: {
        mep: macroState.mep,
        inflation: macroState.inflation,
        rates: macroState.rates,
        cer: macroState.cer,
        crawlingPeg: macroState.crawlingPeg,
      },

      // ─── Provenance per category ───
      provenance: Object.fromEntries(
        Object.entries(provenance).map(([key, prov]) => [
          key,
          {
            label: prov.label,
            source: prov.source,
            url: prov.url,
            dataDate: prov.dataDate,
            stalenessHours: prov.stalenessHours,
          },
        ])
      ),
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch rates data',
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
