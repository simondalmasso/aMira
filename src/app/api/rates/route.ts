import { NextResponse } from 'next/server';
import { fetchBCRAData, fetchCERData } from '@/lib/bcra-api';
import { fetchINDECInflation } from '@/lib/indec-api';
import { fetchBluelytics, getMacroState, applyStaleDegradation } from '@/lib/live-data';

export const dynamic = 'force-dynamic';
export const revalidate = 300;

export async function GET() {
  try {
    const timestamp = new Date().toISOString();
    const [bluelytics, bcraData, cerData, indecData, rawMacroState] = await Promise.all([
      fetchBluelytics(), fetchBCRAData(), fetchCERData(), fetchINDECInflation(), getMacroState(),
    ]);
    const macroState = applyStaleDegradation(rawMacroState);
    const provenance = macroState.provenance;
    const totalSources = Object.keys(provenance).length;
    const realSources = Object.values(provenance).filter((item) => item.dataClass === 'OBSERVED').length;
    const realPct = macroState.realDataPct;

    return NextResponse.json({
      success: true,
      timestamp,
      realData: {
        percentage: realPct,
        realSources,
        totalSources,
        target: 70,
        status: realPct >= 70 ? 'META ALCANZADA' : realPct >= 40 ? 'EN PROGRESO' : 'INSUFICIENTE',
      },
      sources: {
        bluelytics: {
          status: bluelytics ? 'OK' : 'FAILED',
          errorCode: bluelytics ? null : 'SOURCE_UNAVAILABLE',
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
          errorCode: bcraData.isReal ? null : 'SOURCE_UNAVAILABLE',
          url: bcraData.sourceUrl,
          dataDate: bcraData.dataDate,
          data: {
            policyRate: bcraData.bcraPolicyTNA,
            leliqRate: bcraData.bcraPolicyTNA,
            badlarRate: bcraData.badlarTNA,
            tmlRate: bcraData.badlarTNA - 2,
            lecapsRate: bcraData.lecapsTNA,
            officialRate: bcraData.officialRate,
            reservesUSD: bcraData.reservesUSD,
            moneyMarketDerived: bcraData.moneyMarketTNA,
          },
        },
        cer: {
          status: cerData.isReal ? 'OK' : 'FAILED',
          errorCode: cerData.isReal ? null : 'SOURCE_UNAVAILABLE',
          url: cerData.sourceUrl,
          dataDate: cerData.dataDate,
          data: { index: cerData.index, monthlyChange: cerData.monthlyChange, dailyChange: cerData.dailyChange },
        },
        indec: {
          status: indecData.isReal ? 'OK' : 'FAILED',
          errorCode: indecData.isReal ? null : 'SOURCE_UNAVAILABLE',
          url: indecData.sourceUrl,
          dataDate: indecData.dataDate,
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
      macro: {
        mep: macroState.mep,
        inflation: macroState.inflation,
        rates: macroState.rates,
        cer: macroState.cer,
        crawlingPeg: macroState.crawlingPeg,
      },
      provenance: Object.fromEntries(Object.entries(provenance).map(([key, item]) => [key, {
        label: item.label,
        dataClass: item.dataClass,
        source: item.source,
        url: item.url,
        dataDate: item.dataDate,
        stalenessHours: item.stalenessHours,
        limitations: item.limitations ?? [],
      }])),
    });
  } catch (error) {
    console.error('[rates] endpoint failed', error);
    return NextResponse.json({ success: false, code: 'RATES_FETCH_FAILED', error: 'Failed to fetch rates data', timestamp: new Date().toISOString() }, { status: 500 });
  }
}
