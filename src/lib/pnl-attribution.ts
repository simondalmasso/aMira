// ============================================================================
// Ω-X10 PnL ATTRIBUTION SYSTEM — Performance Decomposition
//
// PURPOSE:
//   Track WHERE returns come from — per signal, per regime, per bucket,
//   per strategy module, per product. Without attribution, the system
//   cannot learn what works and what doesn't.
//
// DESIGN:
//   Attribution is computed at multiple levels:
//     1. Bucket level: Which capital bucket contributed most return?
//     2. Strategy level: Which strategy module generated the alpha?
//     3. Regime level: How does performance vary across regimes?
//     4. Signal level: Which signals predicted performance correctly?
//     5. Product level: Which products over/underperformed?
//
//   All attribution entries are stored for historical analysis.
//
// KEY INSIGHT (from reality audit):
//   "No performance attribution system" was ranked as HIGH impact gap.
//   Without this, we can't tell if the system adds value or just rides
//   the carry trade.
// ============================================================================

import { type CapitalRegime, type BucketId } from './capital-buckets';
import { type StrategyModuleName } from './x10-strategy-layer';
import { type MacroRegimeX10 } from './x10-signal-layer';
import { type DataLabel } from './live-data';

// ============================================================================
// ATTRIBUTION TYPES
// ============================================================================

export interface PnLAttributionEntry {
  /** Unique ID */
  id: string;
  /** Timestamp */
  timestamp: string;
  /** Period this attribution covers */
  periodStart: string;
  periodEnd: string;
  /** Total portfolio return (USD, %) */
  totalReturn: number;
  /** Return broken down by attribution level */
  bucketAttribution: BucketAttribution[];
  strategyAttribution: StrategyAttribution[];
  regimeAttribution: RegimeAttribution[];
  signalAttribution: SignalAttribution[];
  productAttribution: ProductAttribution[];
  /** Metadata */
  dataQuality: DataLabel;
  confidence: number;
  capitalUSD: number;
}

export interface BucketAttribution {
  bucketId: BucketId;
  bucketName: string;
  /** Weight in portfolio */
  weight: number;
  /** Return contribution (weight * return) */
  contributionToReturn: number;
  /** Standalone return of this bucket */
  standaloneReturn: number;
  /** Is this bucket active? */
  isActive: boolean;
}

export interface StrategyAttribution {
  strategyName: StrategyModuleName | 'rebalance' | 'manual' | 'initial';
  /** Number of positions from this strategy */
  positionCount: number;
  /** Total weight from this strategy */
  totalWeight: number;
  /** Weighted return from this strategy */
  weightedReturn: number;
  /** Average confidence of signals driving this strategy */
  avgConfidence: number;
  /** Was this strategy throttled by X10 directives? */
  wasThrottled: boolean;
}

export interface RegimeAttribution {
  regime: CapitalRegime;
  /** Number of periods spent in this regime */
  periodCount: number;
  /** Average return during this regime */
  avgReturn: number;
  /** Best return in this regime */
  bestReturn: number;
  /** Worst return in this regime */
  worstReturn: number;
  /** Average confidence during this regime */
  avgConfidence: number;
  /** How many times did the engine correctly predict this regime? */
  correctPredictions: number;
  totalPredictions: number;
}

export interface SignalAttribution {
  signalName: 'regime' | 'inflation' | 'carry' | 'volatility' | 'liquidity';
  /** Average signal value during the period */
  avgValue: number;
  /** Correlation between signal value and subsequent return */
  returnCorrelation: number;
  /** Was this signal discounted due to low confidence? */
  wasDiscounted: boolean;
  /** Contribution to allocation decision */
  decisionWeight: number;
}

export interface ProductAttribution {
  productId: string;
  productName: string;
  /** Bucket this product belongs to */
  bucketId: BucketId;
  /** Strategy that allocated to this product */
  strategySource: StrategyModuleName | 'rebalance' | 'manual' | 'initial';
  /** Weight in portfolio */
  weight: number;
  /** Return of this product (USD %) */
  returnPct: number;
  /** Contribution to portfolio return (weight * return) */
  contributionPct: number;
  /** Did this product outperform its expected return? */
  alpha: number;
  /** Data quality of this product's pricing */
  dataLabel: DataLabel;
}

// ============================================================================
// ATTRIBUTION COMPUTATION ENGINE
// ============================================================================

// In-memory store for attribution history (production would use DB)
let attributionHistory: PnLAttributionEntry[] = [];
const MAX_HISTORY = 500;

// Deterministic ID counter — no Math.random() allowed
let attributionCounter = 0;

export function computeAttribution(params: {
  periodStart: string;
  periodEnd: string;
  totalReturn: number;
  capitalUSD: number;
  confidence: number;
  dataQuality: DataLabel;
  currentRegime: CapitalRegime;
  // Bucket data
  bucketData: {
    bucketId: BucketId;
    bucketName: string;
    weight: number;
    standaloneReturn: number;
    isActive: boolean;
  }[];
  // Strategy data
  strategyData: {
    strategyName: StrategyModuleName | 'rebalance' | 'manual' | 'initial';
    positionCount: number;
    totalWeight: number;
    weightedReturn: number;
    avgConfidence: number;
    wasThrottled: boolean;
  }[];
  // Signal data
  signalData: {
    signalName: 'regime' | 'inflation' | 'carry' | 'volatility' | 'liquidity';
    avgValue: number;
    wasDiscounted: boolean;
    decisionWeight: number;
  }[];
  // Product data
  productData: {
    productId: string;
    productName: string;
    bucketId: BucketId;
    strategySource: StrategyModuleName | 'rebalance' | 'manual' | 'initial';
    weight: number;
    returnPct: number;
    expectedReturn: number;
    dataLabel: DataLabel;
  }[];
}): PnLAttributionEntry {
  const timestamp = new Date().toISOString();
  const id = `ATTR-${++attributionCounter}-${Date.now()}`;

  // ─── Bucket Attribution ───
  const bucketAttribution: BucketAttribution[] = params.bucketData.map(b => ({
    bucketId: b.bucketId,
    bucketName: b.bucketName,
    weight: b.weight,
    contributionToReturn: Math.round(b.weight * b.standaloneReturn * 10000) / 100,
    standaloneReturn: Math.round(b.standaloneReturn * 10000) / 100,
    isActive: b.isActive,
  }));

  // ─── Strategy Attribution ───
  const strategyAttribution: StrategyAttribution[] = params.strategyData.map(s => ({
    strategyName: s.strategyName,
    positionCount: s.positionCount,
    totalWeight: Math.round(s.totalWeight * 1000) / 1000,
    weightedReturn: Math.round(s.weightedReturn * 10000) / 100,
    avgConfidence: Math.round(s.avgConfidence * 100) / 100,
    wasThrottled: s.wasThrottled,
  }));

  // ─── Regime Attribution (computed from history) ───
  const regimeAttribution = computeRegimeAttribution(params.currentRegime, params.totalReturn, params.confidence);

  // ─── Signal Attribution ───
  const signalAttribution: SignalAttribution[] = params.signalData.map(s => ({
    signalName: s.signalName,
    avgValue: Math.round(s.avgValue * 1000) / 1000,
    returnCorrelation: computeSignalReturnCorrelation(s.signalName),
    wasDiscounted: s.wasDiscounted,
    decisionWeight: Math.round(s.decisionWeight * 1000) / 1000,
  }));

  // ─── Product Attribution ───
  const productAttribution: ProductAttribution[] = params.productData.map(p => ({
    productId: p.productId,
    productName: p.productName,
    bucketId: p.bucketId,
    strategySource: p.strategySource,
    weight: Math.round(p.weight * 1000) / 1000,
    returnPct: Math.round(p.returnPct * 10000) / 100,
    contributionPct: Math.round(p.weight * p.returnPct * 10000) / 100,
    alpha: Math.round((p.returnPct - p.expectedReturn) * 10000) / 100,
    dataLabel: p.dataLabel,
  }));

  const entry: PnLAttributionEntry = {
    id,
    timestamp,
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    totalReturn: Math.round(params.totalReturn * 10000) / 100,
    bucketAttribution,
    strategyAttribution,
    regimeAttribution,
    signalAttribution,
    productAttribution,
    dataQuality: params.dataQuality,
    confidence: Math.round(params.confidence * 100) / 100,
    capitalUSD: params.capitalUSD,
  };

  // Store in history
  attributionHistory.push(entry);
  if (attributionHistory.length > MAX_HISTORY) {
    attributionHistory = attributionHistory.slice(-MAX_HISTORY);
  }

  return entry;
}

// ============================================================================
// REGIME ATTRIBUTION — From historical data
// ============================================================================

// Regime-level tracking (accumulated over time)
const regimeTracker: Record<CapitalRegime, {
  returns: number[];
  confidences: number[];
  correctPredictions: number;
  totalPredictions: number;
}> = {
  CRISIS: { returns: [], confidences: [], correctPredictions: 0, totalPredictions: 0 },
  HIGH_VOL: { returns: [], confidences: [], correctPredictions: 0, totalPredictions: 0 },
  NORMAL: { returns: [], confidences: [], correctPredictions: 0, totalPredictions: 0 },
  CARRY_FAVORABLE: { returns: [], confidences: [], correctPredictions: 0, totalPredictions: 0 },
};

function computeRegimeAttribution(
  currentRegime: CapitalRegime,
  currentReturn: number,
  currentConfidence: number,
): RegimeAttribution[] {
  // Update tracker (returns + confidences only — totalPredictions/correctPredictions
  // are managed by recordRegimePrediction() to avoid double-counting)
  regimeTracker[currentRegime].returns.push(currentReturn);
  regimeTracker[currentRegime].confidences.push(currentConfidence);

  // Keep tracker bounded
  for (const regime of Object.keys(regimeTracker) as CapitalRegime[]) {
    if (regimeTracker[regime].returns.length > 365) {
      regimeTracker[regime].returns = regimeTracker[regime].returns.slice(-365);
      regimeTracker[regime].confidences = regimeTracker[regime].confidences.slice(-365);
    }
  }

  // Build attribution
  return (Object.keys(regimeTracker) as CapitalRegime[]).map(regime => {
    const data = regimeTracker[regime];
    const returns = data.returns;
    const avgReturn = returns.length > 0
      ? returns.reduce((s, r) => s + r, 0) / returns.length
      : 0;
    const bestReturn = returns.length > 0 ? Math.max(...returns) : 0;
    const worstReturn = returns.length > 0 ? Math.min(...returns) : 0;
    const avgConfidence = data.confidences.length > 0
      ? data.confidences.reduce((s, c) => s + c, 0) / data.confidences.length
      : 0;

    return {
      regime,
      periodCount: returns.length,
      avgReturn: Math.round(avgReturn * 10000) / 100,
      bestReturn: Math.round(bestReturn * 10000) / 100,
      worstReturn: Math.round(worstReturn * 10000) / 100,
      avgConfidence: Math.round(avgConfidence * 100) / 100,
      correctPredictions: data.correctPredictions,
      totalPredictions: data.totalPredictions,
    };
  });
}

// ============================================================================
// SIGNAL-RETURN CORRELATION — Which signals predict returns?
// ============================================================================

// Track signal values and subsequent returns for correlation computation
const signalReturnPairs: Record<string, { signalValue: number; subsequentReturn: number }[]> = {
  regime: [],
  inflation: [],
  carry: [],
  volatility: [],
  liquidity: [],
};

function computeSignalReturnCorrelation(signalName: string): number {
  const pairs = signalReturnPairs[signalName];
  if (!pairs || pairs.length < 5) return 0;

  const n = pairs.length;
  const meanSignal = pairs.reduce((s, p) => s + p.signalValue, 0) / n;
  const meanReturn = pairs.reduce((s, p) => s + p.subsequentReturn, 0) / n;

  let num = 0, den1 = 0, den2 = 0;
  for (const pair of pairs) {
    const sDiff = pair.signalValue - meanSignal;
    const rDiff = pair.subsequentReturn - meanReturn;
    num += sDiff * rDiff;
    den1 += sDiff * sDiff;
    den2 += rDiff * rDiff;
  }

  return (den1 > 0 && den2 > 0)
    ? Math.round((num / Math.sqrt(den1 * den2)) * 100) / 100
    : 0;
}

/** Record a signal-return pair for correlation tracking */
export function recordSignalReturn(
  signalName: 'regime' | 'inflation' | 'carry' | 'volatility' | 'liquidity',
  signalValue: number,
  subsequentReturn: number,
): void {
  if (!signalReturnPairs[signalName]) {
    signalReturnPairs[signalName] = [];
  }
  signalReturnPairs[signalName].push({ signalValue, subsequentReturn });

  // Keep bounded
  if (signalReturnPairs[signalName].length > 500) {
    signalReturnPairs[signalName] = signalReturnPairs[signalName].slice(-300);
  }
}

// ============================================================================
// BUG-011 FIX: Regime prediction tracking — increment correctPredictions
// ============================================================================

/** Record whether the regime prediction was correct (for attribution accuracy) */
export function recordRegimePrediction(
  actualRegime: CapitalRegime,
  predictedRegime: CapitalRegime,
  confidence: number,
): void {
  const tracker = regimeTracker[actualRegime];
  if (tracker) {
    tracker.totalPredictions++;
    if (predictedRegime === actualRegime) {
      tracker.correctPredictions++;
    }
  }
}

// ============================================================================
// ATTRIBUTION QUERIES
// ============================================================================

/** Get recent attribution entries */
export function getAttributionHistory(count: number = 50): PnLAttributionEntry[] {
  return attributionHistory.slice(-count);
}

/** Get the latest attribution entry */
export function getLatestAttribution(): PnLAttributionEntry | null {
  return attributionHistory.length > 0 ? attributionHistory[attributionHistory.length - 1] : null;
}

/** Compute attribution summary across all history */
export function getAttributionSummary(): {
  totalPeriods: number;
  avgReturn: number;
  bestPeriodReturn: number;
  worstPeriodReturn: number;
  bucketContributions: Record<BucketId, number>;
  strategyContributions: Record<string, number>;
  regimePerformance: Record<CapitalRegime, { avgReturn: number; periods: number }>;
  topAlphaProducts: { productId: string; alpha: number }[];
  worstAlphaProducts: { productId: string; alpha: number }[];
} {
  if (attributionHistory.length === 0) {
    return {
      totalPeriods: 0,
      avgReturn: 0,
      bestPeriodReturn: 0,
      worstPeriodReturn: 0,
      bucketContributions: {} as Record<BucketId, number>,
      strategyContributions: {},
      regimePerformance: {} as Record<CapitalRegime, { avgReturn: number; periods: number }>,
      topAlphaProducts: [],
      worstAlphaProducts: [],
    };
  }

  const returns = attributionHistory.map(e => e.totalReturn);
  const avgReturn = returns.reduce((s, r) => s + r, 0) / returns.length;

  // Aggregate bucket contributions
  const bucketContributions: Record<string, number> = {};
  for (const entry of attributionHistory) {
    for (const bucket of entry.bucketAttribution) {
      bucketContributions[bucket.bucketId] = (bucketContributions[bucket.bucketId] ?? 0) + bucket.contributionToReturn;
    }
  }

  // Aggregate strategy contributions
  const strategyContributions: Record<string, number> = {};
  for (const entry of attributionHistory) {
    for (const strategy of entry.strategyAttribution) {
      strategyContributions[strategy.strategyName] = (strategyContributions[strategy.strategyName] ?? 0) + strategy.weightedReturn;
    }
  }

  // Compute product alpha rankings
  const productAlpha: Record<string, { total: number; count: number }> = {};
  for (const entry of attributionHistory) {
    for (const product of entry.productAttribution) {
      if (!productAlpha[product.productId]) {
        productAlpha[product.productId] = { total: 0, count: 0 };
      }
      productAlpha[product.productId].total += product.alpha;
      productAlpha[product.productId].count++;
    }
  }

  const avgProductAlpha = Object.entries(productAlpha).map(([productId, data]) => ({
    productId,
    alpha: Math.round((data.total / data.count) * 100) / 100,
  }));

  avgProductAlpha.sort((a, b) => b.alpha - a.alpha);
  const topAlphaProducts = avgProductAlpha.slice(0, 3);
  const worstAlphaProducts = avgProductAlpha.slice(-3).reverse();

  return {
    totalPeriods: attributionHistory.length,
    avgReturn: Math.round(avgReturn * 100) / 100,
    bestPeriodReturn: Math.round(Math.max(...returns) * 100) / 100,
    worstPeriodReturn: Math.round(Math.min(...returns) * 100) / 100,
    bucketContributions: bucketContributions as Record<BucketId, number>,
    strategyContributions,
    regimePerformance: Object.fromEntries(
      (Object.keys(regimeTracker) as CapitalRegime[]).map(r => [
        r,
        {
          avgReturn: regimeTracker[r].returns.length > 0
            ? Math.round((regimeTracker[r].returns.reduce((s, v) => s + v, 0) / regimeTracker[r].returns.length) * 10000) / 100
            : 0,
          periods: regimeTracker[r].returns.length,
        },
      ])
    ) as Record<CapitalRegime, { avgReturn: number; periods: number }>,
    topAlphaProducts,
    worstAlphaProducts,
  };
}

/** Reset attribution state (for testing) */
export function resetAttribution(): void {
  attributionHistory = [];
  attributionCounter = 0;
  for (const key of Object.keys(regimeTracker) as CapitalRegime[]) {
    regimeTracker[key] = { returns: [], confidences: [], correctPredictions: 0, totalPredictions: 0 };
  }
  for (const key of Object.keys(signalReturnPairs)) {
    signalReturnPairs[key] = [];
  }
}
