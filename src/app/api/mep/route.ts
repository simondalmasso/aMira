import { NextResponse } from 'next/server';
import { fetchBluelytics, getMacroState, applyStaleDegradation } from '@/lib/live-data';

export const dynamic = 'force-dynamic';
export const revalidate = 300; // 5 minutes

export async function GET() {
  try {
    const [bluelytics, rawMacro] = await Promise.all([
      fetchBluelytics(),
      getMacroState(),
    ]);
    const macro = applyStaleDegradation(rawMacro);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      source: macro.source,
      mep: {
        rate: macro.mep.rate,
        officialRate: macro.mep.officialRate,
        gap: macro.mep.gap,
        sell: macro.mep.sell,
        buy: macro.mep.buy,
      },
      bluelytics: bluelytics ? {
        lastUpdate: bluelytics.last_update,
        blue: bluelytics.blue,
        oficial: bluelytics.oficial,
      } : null,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch MEP data',
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
