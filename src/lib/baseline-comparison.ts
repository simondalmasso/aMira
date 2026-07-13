// ============================================================================
// Ω-X10 BASELINE COMPARISON ENGINE — TEMPORAL_VALIDATION_LAYER Step 5
//
// PURPOSE:
//   Compare X10 engine performance against simple passive benchmarks.
//   If the system can't beat "just buy USD" or "just hold CER", it adds no value.
//
// BENCHMARKS:
//   1. USD CASH — Hold USD cash (MEP rate appreciation)
//   2. CER BOND — Hold CER-indexed bonds (inflation protection)
//   3. MEP HOLD — Buy and hold MEP dollar
//   4. BTC — Bitcoin (high volatility alternative)
//   5. ARS CASH — Hold ARS cash (worst case, guaranteed loss to inflation)
//   6. PLOMO Fijo — Simple plazo fijo 30d rolling
//
// METHODOLOGY:
//   For each historical period, compute what each benchmark would have returned.
//   Then compare against X10's simulated portfolio return.
//
// KEY QUESTION:
//   "Does the X10 engine add alpha over simply holding CER or USD?"
//   If the answer is NO, the system is not adding value regardless of its
//   architectural elegance.
// ============================================================================

import { type CapitalRegime } from './capital-buckets';
import { type RebuiltMacroState } from './macro-state-rebuilder';

// ============================================================================
// SEEDED PRNG — Deterministic BTC returns for reproducible backtests
// ============================================================================

function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return function () {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================================
// BENCHMARK TYPES
// ============================================================================

export type BenchmarkId = 'USD_CASH' | 'CER_BOND' | 'MEP_HOLD' | 'BTC' | 'ARS_CASH' | 'PLAZO_FIJO';

export interface BenchmarkReturn {
  benchmarkId: BenchmarkId;
  benchmarkName: string;
  description: string;
  /** Monthly return in USD terms (%) */
  monthlyReturnUSD: number;
  /** Cumulative return over the period in USD terms (%) */
  cumulativeReturnUSD: number;
  /** Maximum drawdown during the period (%) */
  maxDrawdown: number;
  /** Volatility (std dev of monthly returns) */
  volatility: number;
  /** Sharpe ratio (if enough data) */
  sharpeRatio: number | null;
  /** Is this a passive benchmark? */
  isPassive: boolean;
  /** Risk level */
  riskLevel: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
}

export interface ComparisonResult {
  /** Period this comparison covers */
  periodStart: string;
  periodEnd: string;
  /** Number of months in the comparison */
  monthsCompared: number;
  /** X10 engine's performance */
  x10Performance: {
    cumulativeReturnUSD: number;
    monthlyAvgReturnUSD: number;
    maxDrawdown: number;
    volatility: number;
    sharpeRatio: number | null;
    regimeAccuracy: number;
  };
  /** Benchmark performances */
  benchmarks: BenchmarkReturn[];
  /** Does X10 add alpha over the best passive benchmark? */
  alphaOverBestPassive: number;
  /** Which benchmark had the best return? */
  bestBenchmark: BenchmarkId;
  /** Does X10 beat CER? */
  beatsCER: boolean;
  /** Does X10 beat USD? */
  beatsUSD: boolean;
  /** Does X10 beat all passive benchmarks? */
  beatsAllPassive: boolean;
  /** Value added assessment */
  valueAssessment: 'NEGATIVE_ALPHA' | 'MARGINAL_ALPHA' | 'POSITIVE_ALPHA' | 'STRONG_ALPHA';
  /** Summary text */
  summary: string;
  /** Per-month comparison data */
  monthlyComparison: MonthlyComparison[];
}

export interface MonthlyComparison {
  date: string;
  regime: CapitalRegime;
  x10ReturnUSD: number;
  benchmarkReturns: Record<BenchmarkId, number>;
  bestAlternative: BenchmarkId;
  x10VsBest: number; // positive = X10 wins
}

// ============================================================================
// BENCHMARK COMPUTATION — From reconstructed macro states
// ============================================================================

function computeBenchmarkReturns(
  snapshots: RebuiltMacroState[],
  seed: number | null = null,
): Record<BenchmarkId, { returns: number[]; cumulative: number; maxDD: number; vol: number; sharpe: number | null }> {
  const usdReturns: number[] = [];
  const cerReturns: number[] = [];
  const mepReturns: number[] = [];
  const btcReturns: number[] = [];
  const arsReturns: number[] = [];
  const pfReturns: number[] = [];

  // BUG-010 FIX: Seeded PRNG for deterministic BTC returns
  const btcRng = seed !== null ? mulberry32(seed) : Math.random;

  for (const s of snapshots) {
    // USD CASH: Return comes from MEP rate appreciation + any gap compression
    // If gap stays the same, USD return = crawlingPeg / 100
    // If gap narrows, USD underperforms; if gap widens, USD outperforms
    const usdReturn = s.crawlingPeg > 0 ? s.crawlingPeg / 100 * 100 : 0.1; // Minimal drift under bandas
    usdReturns.push(usdReturn);

    // CER BOND: CER monthly change + UVA premium, adjusted for FX
    const cerUSD = ((1 + s.cer.monthlyChange / 100) * (1 + s.rates.plazoFijoUVA / 12 / 100) / (1 + s.crawlingPeg / 100) - 1) * 100;
    cerReturns.push(cerUSD);

    // MEP HOLD: Gap-dependent return (buy MEP, hold, sell later)
    // When gap compresses → loss; when gap widens → gain
    const mepReturn = s.mep.gap > 10 ? -s.mep.gap * 0.01 : -s.mep.gap * 0.002;
    mepReturns.push(mepReturn);

    // BTC: Highly volatile, not directly tied to Argentina macro
    // BUG-010 FIX: Deterministic random walk using seeded PRNG
    // In crises, BTC tends to correlate with risk-off
    const btcBase = 1.5; // ~1.5%/month average
    const crisisAdjust = s.actualRegime === 'CRISIS' ? -3.0 : s.actualRegime === 'HIGH_VOL' ? -1.0 : 0;
    btcReturns.push(btcBase + crisisAdjust + (btcRng() - 0.5) * 10);

    // ARS CASH: Nominal rate / 12, adjusted for inflation + devaluation
    const arsNominal30d = s.rates.moneyMarket / 12;
    const arsReal = ((1 + arsNominal30d / 100) / (1 + s.inflation.monthly / 100) - 1) * 100;
    const arsUSD = ((1 + arsNominal30d / 100) / (1 + s.crawlingPeg / 100) - 1) * 100;
    arsReturns.push(arsUSD);

    // PLAZO FIJO: PF rate / 12, adjusted for devaluation
    const pfNominal30d = s.rates.plazoFijo / 12;
    const pfUSD = ((1 + pfNominal30d / 100) / (1 + s.crawlingPeg / 100) - 1) * 100;
    pfReturns.push(pfUSD);
  }

  const computeStats = (returns: number[]) => {
    const cumulative = returns.reduce((s, r) => s + r, 0);
    let peak = 0;
    let maxDD = 0;
    let running = 0;
    for (const r of returns) {
      running += r;
      peak = Math.max(peak, running);
      const dd = peak - running;
      maxDD = Math.max(maxDD, dd);
    }
    const mean = returns.length > 0 ? returns.reduce((s, r) => s + r, 0) / returns.length : 0;
    const variance = returns.length > 1
      ? returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / (returns.length - 1)
      : 0;
    const vol = Math.sqrt(variance);
    const sharpe = vol > 0 && returns.length >= 6 ? (mean / vol) * Math.sqrt(12) : null; // Annualized
    return { returns, cumulative: Math.round(cumulative * 100) / 100, maxDD: Math.round(maxDD * 100) / 100, vol: Math.round(vol * 100) / 100, sharpe: sharpe !== null ? Math.round(sharpe * 100) / 100 : null };
  };

  return {
    USD_CASH: computeStats(usdReturns),
    CER_BOND: computeStats(cerReturns),
    MEP_HOLD: computeStats(mepReturns),
    BTC: computeStats(btcReturns),
    ARS_CASH: computeStats(arsReturns),
    PLAZO_FIJO: computeStats(pfReturns),
  };
}

// ============================================================================
// MAIN: RUN BASELINE COMPARISON
// ============================================================================

export function runBaselineComparison(
  snapshots: RebuiltMacroState[],
  x10Returns: { date: string; returnUSD: number; predictedRegime: CapitalRegime; actualRegime: CapitalRegime }[],
  seed: number | null = null,
): ComparisonResult {
  if (snapshots.length === 0) {
    return {
      periodStart: '',
      periodEnd: '',
      monthsCompared: 0,
      x10Performance: { cumulativeReturnUSD: 0, monthlyAvgReturnUSD: 0, maxDrawdown: 0, volatility: 0, sharpeRatio: null, regimeAccuracy: 0 },
      benchmarks: [],
      alphaOverBestPassive: 0,
      bestBenchmark: 'CER_BOND',
      beatsCER: false,
      beatsUSD: false,
      beatsAllPassive: false,
      valueAssessment: 'NEGATIVE_ALPHA',
      summary: 'Insufficient data for comparison',
      monthlyComparison: [],
    };
  }

  const benchmarkData = computeBenchmarkReturns(snapshots, seed);

  // X10 performance
  const x10ReturnsArr = x10Returns.map(r => r.returnUSD);
  const x10Cumulative = x10ReturnsArr.reduce((s, r) => s + r, 0);
  const x10Mean = x10ReturnsArr.length > 0 ? x10ReturnsArr.reduce((s, r) => s + r, 0) / x10ReturnsArr.length : 0;
  let x10Peak = 0;
  let x10MaxDD = 0;
  let x10Running = 0;
  for (const r of x10ReturnsArr) {
    x10Running += r;
    x10Peak = Math.max(x10Peak, x10Running);
    x10MaxDD = Math.max(x10MaxDD, x10Peak - x10Running);
  }
  const x10Variance = x10ReturnsArr.length > 1
    ? x10ReturnsArr.reduce((s, r) => s + Math.pow(r - x10Mean, 2), 0) / (x10ReturnsArr.length - 1)
    : 0;
  const x10Vol = Math.sqrt(x10Variance);
  const x10Sharpe = x10Vol > 0 && x10ReturnsArr.length >= 6
    ? (x10Mean / x10Vol) * Math.sqrt(12) : null;

  // Regime accuracy
  const regimeCorrect = x10Returns.filter(r => r.predictedRegime === r.actualRegime).length;
  const regimeAccuracy = x10Returns.length > 0 ? regimeCorrect / x10Returns.length : 0;

  // Build benchmark results
  const benchmarkMeta: Record<BenchmarkId, { name: string; desc: string; passive: boolean; risk: BenchmarkReturn['riskLevel'] }> = {
    USD_CASH: { name: 'USD Cash', desc: 'Hold USD cash (dólar blue)', passive: true, risk: 'LOW' },
    CER_BOND: { name: 'CER Bond', desc: 'Hold CER-indexed bonds', passive: true, risk: 'MEDIUM' },
    MEP_HOLD: { name: 'MEP Hold', desc: 'Buy and hold MEP dollar', passive: true, risk: 'HIGH' },
    BTC: { name: 'Bitcoin', desc: 'BTC buy and hold', passive: true, risk: 'VERY_HIGH' },
    ARS_CASH: { name: 'ARS Cash', desc: 'Hold ARS in money market', passive: true, risk: 'LOW' },
    PLAZO_FIJO: { name: 'Plazo Fijo', desc: 'Rolling 30d plazo fijo', passive: true, risk: 'LOW' },
  };

  const benchmarks: BenchmarkReturn[] = (Object.keys(benchmarkMeta) as BenchmarkId[]).map(id => {
    const data = benchmarkData[id];
    const meta = benchmarkMeta[id];
    return {
      benchmarkId: id,
      benchmarkName: meta.name,
      description: meta.desc,
      monthlyReturnUSD: data.returns.length > 0
        ? Math.round((data.returns.reduce((s, r) => s + r, 0) / data.returns.length) * 100) / 100
        : 0,
      cumulativeReturnUSD: data.cumulative,
      maxDrawdown: data.maxDD,
      volatility: data.vol,
      sharpeRatio: data.sharpe,
      isPassive: meta.passive,
      riskLevel: meta.risk,
    };
  });

  // Find best passive benchmark
  const passiveBenchmarks = benchmarks.filter(b => b.isPassive);
  const bestPassive = passiveBenchmarks.reduce((best, b) =>
    b.cumulativeReturnUSD > best.cumulativeReturnUSD ? b : best,
    passiveBenchmarks[0]);

  const alpha = x10Cumulative - bestPassive.cumulativeReturnUSD;

  // Individual comparisons
  const beatsCER = x10Cumulative > (benchmarkData.CER_BOND?.cumulative ?? 0);
  const beatsUSD = x10Cumulative > (benchmarkData.USD_CASH?.cumulative ?? 0);
  const beatsAll = passiveBenchmarks.every(b => x10Cumulative > b.cumulativeReturnUSD);

  // Value assessment
  let valueAssessment: ComparisonResult['valueAssessment'];
  if (alpha < -5) valueAssessment = 'NEGATIVE_ALPHA';
  else if (alpha < 2) valueAssessment = 'MARGINAL_ALPHA';
  else if (alpha < 8) valueAssessment = 'POSITIVE_ALPHA';
  else valueAssessment = 'STRONG_ALPHA';

  // Monthly comparison
  const monthlyComparison: MonthlyComparison[] = snapshots.map((s, i) => {
    const x10Ret = x10Returns[i]?.returnUSD ?? 0;
    const benchmarkRets: Record<BenchmarkId, number> = {
      USD_CASH: benchmarkData.USD_CASH.returns[i] ?? 0,
      CER_BOND: benchmarkData.CER_BOND.returns[i] ?? 0,
      MEP_HOLD: benchmarkData.MEP_HOLD.returns[i] ?? 0,
      BTC: benchmarkData.BTC.returns[i] ?? 0,
      ARS_CASH: benchmarkData.ARS_CASH.returns[i] ?? 0,
      PLAZO_FIJO: benchmarkData.PLAZO_FIJO.returns[i] ?? 0,
    };

    const bestAlt = (Object.entries(benchmarkRets) as [BenchmarkId, number][])
      .reduce((best, [id, ret]) => ret > best.ret ? { id, ret } : best, { id: 'CER_BOND' as BenchmarkId, ret: -Infinity });

    return {
      date: s.snapshotDate,
      regime: s.actualRegime,
      x10ReturnUSD: Math.round(x10Ret * 100) / 100,
      benchmarkReturns: Object.fromEntries(
        Object.entries(benchmarkRets).map(([k, v]) => [k, Math.round(v * 100) / 100])
      ) as Record<BenchmarkId, number>,
      bestAlternative: bestAlt.id,
      x10VsBest: Math.round((x10Ret - bestAlt.ret) * 100) / 100,
    };
  });

  // Summary
  const summary = valueAssessment === 'NEGATIVE_ALPHA'
    ? `X10 UNDERPERFORMS: ${alpha.toFixed(1)}% below ${bestPassive.benchmarkName}. The system does not add value over passive benchmarks in this period.`
    : valueAssessment === 'MARGINAL_ALPHA'
    ? `X10 MARGINAL: ${alpha.toFixed(1)}% above ${bestPassive.benchmarkName}. System adds marginal value but may not justify operational complexity.`
    : valueAssessment === 'POSITIVE_ALPHA'
    ? `X10 ADDS VALUE: ${alpha.toFixed(1)}% above ${bestPassive.benchmarkName}. System demonstrates regime-timing alpha, especially in crisis avoidance.`
    : `X10 STRONG ALPHA: ${alpha.toFixed(1)}% above ${bestPassive.benchmarkName}. System significantly outperforms passive benchmarks through regime-adaptive allocation.`;

  return {
    periodStart: snapshots[0]?.snapshotDate ?? '',
    periodEnd: snapshots[snapshots.length - 1]?.snapshotDate ?? '',
    monthsCompared: snapshots.length,
    x10Performance: {
      cumulativeReturnUSD: Math.round(x10Cumulative * 100) / 100,
      monthlyAvgReturnUSD: Math.round(x10Mean * 100) / 100,
      maxDrawdown: Math.round(x10MaxDD * 100) / 100,
      volatility: Math.round(x10Vol * 100) / 100,
      sharpeRatio: x10Sharpe,
      regimeAccuracy: Math.round(regimeAccuracy * 100) / 100,
    },
    benchmarks,
    alphaOverBestPassive: Math.round(alpha * 100) / 100,
    bestBenchmark: bestPassive.benchmarkId,
    beatsCER,
    beatsUSD,
    beatsAllPassive: beatsAll,
    valueAssessment,
    summary,
    monthlyComparison,
  };
}
