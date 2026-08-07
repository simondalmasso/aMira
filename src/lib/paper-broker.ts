// ============================================================================
// Ω-X10 PAPER EXECUTION BROKER — Execution Abstraction Layer
//
// PURPOSE:
//   This is the execution abstraction identified as CRITICAL gap #3.
//   Without an execution layer, the X10 engine produces allocations
//   but cannot track what would actually happen if they were executed.
//
//   This broker simulates the complete lifecycle of an order:
//     Signal → Decision → Order → Fill → Position → PnL
//
// DESIGN PRINCIPLES:
//   1. Paper-first ALWAYS — no real money ever moves
//   2. Simulate realistic execution: slippage, latency, partial fills
//   3. Track positions over time with cost basis
//   4. Compute realized + unrealized PnL per position
//   5. Maintain full audit trail of every order and fill
//   6. NEVER connect to a real broker without explicit opt-in + safeguards
//
// LIFECYCLE:
//   PENDING → SUBMITTED → PARTIALLY_FILLED → FILLED → SETTLED
//                                    ↘ CANCELLED
//                                    ↘ REJECTED
// ============================================================================

import { type DataLabel } from './live-data';
import { type StrategicMode, type StrategyModuleName } from './x10-strategy-layer';
import { type CapitalRegime, type BucketId } from './capital-buckets';
import { recordSignalReturn } from './pnl-attribution';

// ============================================================================
// ORDER TYPES
// ============================================================================

export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT';
export type OrderStatus =
  | 'PENDING'
  | 'SUBMITTED'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'SETTLED';

export interface PaperOrder {
  /** Unique order ID */
  id: string;
  /** Timestamp when the order was created */
  createdAt: string;
  /** Timestamp when the order was last updated */
  updatedAt: string;
  /** Product identifier */
  productId: string;
  /** Product name */
  productName: string;
  /** Buy or sell */
  side: OrderSide;
  /** Order type */
  orderType: OrderType;
  /** Quantity in instrument units (e.g. shares, nominal) */
  quantity: number;
  /** Intended weight in portfolio [0, 1] */
  targetWeight: number;
  /** Limit price (for LIMIT orders) */
  limitPrice: number | null;
  /** Execution price (filled price) */
  fillPrice: number | null;
  /** Currency of the fill price */
  fillCurrency: 'ARS' | 'USD';
  /** Number of units actually filled */
  filledQuantity: number;
  /** Current status */
  status: OrderStatus;
  /** Which strategy module generated this order */
  strategySource: StrategyModuleName | 'rebalance' | 'manual';
  /** Which capital bucket this order belongs to */
  bucketId: BucketId | null;
  /** Regime at the time of order creation */
  regimeAtCreation: CapitalRegime;
  /** Confidence at the time of order creation */
  confidenceAtCreation: number;
  /** Slippage in basis points */
  slippageBps: number;
  /** Commission in ARS */
  commissionARS: number;
  /** Rejection reason (if rejected) */
  rejectionReason: string | null;
  /** Settlement date */
  settlementDate: string | null;
  /** Execution latency in ms (simulated) */
  executionLatencyMs: number;
}

// ============================================================================
// POSITION TRACKING
// ============================================================================

export interface PaperPosition {
  /** Product identifier */
  productId: string;
  /** Product name */
  productName: string;
  /** Currency of the position */
  currency: 'ARS' | 'USD';
  /** Current quantity held */
  quantity: number;
  /** Average cost basis per unit */
  avgCostBasis: number;
  /** Total cost basis (quantity * avgCostBasis) */
  totalCostBasis: number;
  /** Current market price */
  currentPrice: number;
  /** Current market value (quantity * currentPrice) */
  marketValue: number;
  /** Unrealized PnL */
  unrealizedPnL: number;
  /** Unrealized PnL % */
  unrealizedPnLPct: number;
  /** Weight in portfolio */
  weight: number;
  /** Bucket assignment */
  bucketId: BucketId | null;
  /** Strategy source */
  strategySource: StrategyModuleName | 'rebalance' | 'manual' | 'initial';
  /** Last updated */
  updatedAt: string;
  /** Position history (PnL snapshots) */
  history: PositionSnapshot[];
}

export interface PositionSnapshot {
  timestamp: string;
  quantity: number;
  marketValue: number;
  unrealizedPnL: number;
  price: number;
}

// ============================================================================
// PORTFOLIO STATE
// ============================================================================

export interface PaperPortfolio {
  /** Portfolio ID */
  id: string;
  /** Current total value in USD */
  totalValueUSD: number;
  /** Current total value in ARS */
  totalValueARS: number;
  /** Cash balance USD */
  cashUSD: number;
  /** Cash balance ARS */
  cashARS: number;
  /** Current MEP rate used for USD/ARS conversion */
  currentMEPRate: number;
  /** Open positions */
  positions: Map<string, PaperPosition>;
  /** Order history */
  orders: PaperOrder[];
  /** Cumulative realized PnL */
  realizedPnL: number;
  /** Cumulative unrealized PnL */
  unrealizedPnL: number;
  /** Cumulative commissions paid */
  totalCommissions: number;
  /** Portfolio creation date */
  createdAt: string;
  /** Last updated */
  updatedAt: string;
  /** Current regime */
  currentRegime: CapitalRegime;
  /** Number of rebalances executed */
  rebalanceCount: number;
}

// ============================================================================
// FILL SIMULATION PARAMETERS
// ============================================================================

export interface FillSimulationParams {
  /** Base slippage in basis points (default: 5 bps = 0.05%) */
  baseSlippageBps: number;
  /** Additional slippage per volatility regime level (0-4) */
  volatilitySlippageBps: number;
  /** Commission rate as fraction of trade value (default: 0.001 = 0.1%) */
  commissionRate: number;
  /** Minimum commission in ARS */
  minCommissionARS: number;
  /** Settlement delay in days */
  settlementDays: number;
  /** Simulated execution latency in ms (for order book simulation) */
  baseLatencyMs: number;
  /** Fill probability (1.0 = always fills, 0.5 = 50% chance) */
  fillProbability: number;
  /** Partial fill probability */
  partialFillProbability: number;
  /** Max partial fill ratio (0.5 = can fill up to 50% of order) */
  maxPartialFillRatio: number;
  /** RNG seed for deterministic backtests (null = Math.random) */
  seed: number | null;
}

export const DEFAULT_FILL_PARAMS: FillSimulationParams = {
  baseSlippageBps: 5,
  volatilitySlippageBps: 3,
  commissionRate: 0.001,
  minCommissionARS: 100,
  settlementDays: 1,
  baseLatencyMs: 150,
  fillProbability: 0.98,
  partialFillProbability: 0.05,
  maxPartialFillRatio: 0.5,
  seed: null,
};

// ============================================================================
// SEEDED PRNG (mulberry32) — Deterministic randomness for reproducible backtests
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
// PAPER BROKER CLASS
// ============================================================================

export class PaperBroker {
  private static readonly LEVERAGE_LIMIT = 1;
  private static readonly INVARIANT_TOLERANCE = 1e-8;

  private portfolio: PaperPortfolio;
  private fillParams: FillSimulationParams;
  private orderCounter: number = 0;
  private auditLog: BrokerAuditEntry[] = [];
  /** Seeded PRNG for deterministic backtests (null = Math.random) */
  private rng: (() => number) | null;

  constructor(
    initialCapitalUSD: number = 2000,
    mepRate: number = 1445,
    fillParams: Partial<FillSimulationParams> = {},
  ) {
    if (!Number.isFinite(initialCapitalUSD) || initialCapitalUSD < 0) {
      throw new RangeError('Initial capital must be a finite non-negative USD amount');
    }
    this.assertValidMEP(mepRate);

    this.fillParams = { ...DEFAULT_FILL_PARAMS, ...fillParams };
    this.validateFillParams(this.fillParams);
    this.rng = this.fillParams.seed !== null ? mulberry32(this.fillParams.seed) : null;

    const now = new Date().toISOString();
    this.portfolio = {
      id: `PAPER-${Date.now()}`,
      totalValueUSD: initialCapitalUSD,
      totalValueARS: initialCapitalUSD * mepRate,
      cashUSD: initialCapitalUSD,
      cashARS: 0,
      currentMEPRate: mepRate,
      positions: new Map(),
      orders: [],
      realizedPnL: 0,
      unrealizedPnL: 0,
      totalCommissions: 0,
      createdAt: now,
      updatedAt: now,
      currentRegime: 'NORMAL',
      rebalanceCount: 0,
    };
  }

  /** Get the RNG function (seeded or Math.random) */
  private random(): number {
    return this.rng ? this.rng() : Math.random();
  }

  // ─── Submit an order ───

  submitOrder(params: {
    productId: string;
    productName: string;
    side: OrderSide;
    targetWeight: number;
    orderType?: OrderType;
    limitPrice?: number;
    strategySource: StrategyModuleName | 'rebalance' | 'manual';
    bucketId?: BucketId | null;
    regime: CapitalRegime;
    confidence: number;
    currentPrice: number;
    currency?: 'ARS' | 'USD';
  }): PaperOrder {
    const orderId = `ORD-${++this.orderCounter}-${Date.now()}`;
    const now = new Date().toISOString();
    const currency = params.currency ?? 'ARS';
    const orderType = params.orderType ?? 'MARKET';

    const validationPriceResult = this.resolveValidationPrice(
      orderType,
      params.currentPrice,
      params.limitPrice,
    );
    const validationPrice = validationPriceResult.price;
    const totalValueARS = this.computePortfolioMetrics(
      this.clonePositions(this.portfolio.positions),
      this.portfolio.cashARS,
      this.portfolio.cashUSD,
      this.portfolio.currentMEPRate,
    ).totalValueARS;
    const targetValueARS = Number.isFinite(params.targetWeight)
      ? totalValueARS * params.targetWeight
      : Number.NaN;
    const targetValueNative = currency === 'USD'
      ? targetValueARS / this.portfolio.currentMEPRate
      : targetValueARS;
    const quantity = validationPrice !== null && validationPrice > 0
      ? targetValueNative / validationPrice
      : 0;

    const order: PaperOrder = {
      id: orderId,
      createdAt: now,
      updatedAt: now,
      productId: params.productId,
      productName: params.productName,
      side: params.side,
      orderType,
      quantity: Math.round(quantity * 100) / 100,
      targetWeight: params.targetWeight,
      limitPrice: params.limitPrice ?? null,
      fillPrice: null,
      fillCurrency: currency,
      filledQuantity: 0,
      status: 'PENDING',
      strategySource: params.strategySource,
      bucketId: params.bucketId ?? null,
      regimeAtCreation: params.regime,
      confidenceAtCreation: params.confidence,
      slippageBps: 0,
      commissionARS: 0,
      rejectionReason: null,
      settlementDate: null,
      executionLatencyMs: 0,
    };

    const requestValidation = this.validateRequest(order, params.currentPrice, validationPriceResult.reason);
    if (!requestValidation.valid || validationPrice === null) {
      return this.rejectOrder(order, requestValidation.reason ?? validationPriceResult.reason ?? 'INVALID_ORDER');
    }

    const snapshot = this.createFinancialSnapshot(params.currentPrice, order.productId);
    const preflight = this.validatePreflight(order, validationPrice, params.currentPrice, snapshot);
    if (!preflight.valid) {
      return this.rejectOrder(order, preflight.reason ?? 'PREFLIGHT_REJECTED');
    }

    order.status = 'SUBMITTED';
    return this.simulateFillAtomically(order, validationPrice, params.currentPrice, snapshot, preflight);
  }

  private resolveValidationPrice(
    orderType: OrderType,
    currentPrice: number,
    limitPrice: number | undefined,
  ): { price: number | null; reason?: string } {
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      return { price: null, reason: 'INVALID_CURRENT_PRICE' };
    }
    if (orderType === 'MARKET') {
      return { price: currentPrice };
    }
    if (orderType !== 'LIMIT') {
      return { price: null, reason: 'INVALID_ORDER_TYPE' };
    }
    if (limitPrice === undefined || !Number.isFinite(limitPrice) || limitPrice <= 0) {
      return { price: null, reason: 'INVALID_LIMIT_PRICE' };
    }
    return { price: limitPrice };
  }

  private validateRequest(
    order: PaperOrder,
    currentPrice: number,
    priceError?: string,
  ): { valid: boolean; reason?: string } {
    if (priceError) return { valid: false, reason: priceError };
    if (!order.productId.trim()) return { valid: false, reason: 'INVALID_PRODUCT_ID' };
    if (!order.productName.trim()) return { valid: false, reason: 'INVALID_PRODUCT_NAME' };
    if (order.side !== 'BUY' && order.side !== 'SELL') return { valid: false, reason: 'INVALID_SIDE' };
    if (order.fillCurrency !== 'ARS' && order.fillCurrency !== 'USD') return { valid: false, reason: 'INVALID_CURRENCY' };
    if (!Number.isFinite(order.targetWeight) || order.targetWeight <= 0 || order.targetWeight > 1) {
      return { valid: false, reason: 'INVALID_TARGET_WEIGHT' };
    }
    if (!Number.isFinite(order.quantity) || order.quantity <= 0) {
      return { valid: false, reason: 'INVALID_QUANTITY' };
    }
    if (!Number.isFinite(order.confidenceAtCreation) || order.confidenceAtCreation < 0 || order.confidenceAtCreation > 1) {
      return { valid: false, reason: 'INVALID_CONFIDENCE' };
    }
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      return { valid: false, reason: 'INVALID_CURRENT_PRICE' };
    }
    if (!this.isValidMEP(this.portfolio.currentMEPRate)) {
      return { valid: false, reason: 'INVALID_MEP_RATE' };
    }
    if (order.orderType === 'LIMIT') {
      const limitPrice = order.limitPrice;
      if (limitPrice === null || !Number.isFinite(limitPrice) || limitPrice <= 0) {
        return { valid: false, reason: 'INVALID_LIMIT_PRICE' };
      }
      if (order.side === 'BUY' && currentPrice > limitPrice) {
        return { valid: false, reason: 'BUY_LIMIT_NOT_MARKETABLE' };
      }
      if (order.side === 'SELL' && currentPrice < limitPrice) {
        return { valid: false, reason: 'SELL_LIMIT_NOT_MARKETABLE' };
      }
    }
    return { valid: true };
  }

  private validatePreflight(
    order: PaperOrder,
    validationPrice: number,
    currentPrice: number,
    snapshot: FinancialSnapshot,
  ): FillPreflight {
    const slippageBps = this.calculateSlippageBps();
    const conservativeFillPrice = this.calculateFillPrice(order, validationPrice, currentPrice, slippageBps);
    const fillValueNative = order.quantity * conservativeFillPrice;
    const fillValueARS = this.toARS(fillValueNative, order.fillCurrency, snapshot.mepRate);
    const commissionARS = Math.max(
      this.fillParams.minCommissionARS,
      fillValueARS * this.fillParams.commissionRate,
    );

    if (![conservativeFillPrice, fillValueNative, fillValueARS, commissionARS].every(Number.isFinite)) {
      return { valid: false, reason: 'NON_FINITE_PREFLIGHT', slippageBps, conservativeFillPrice, maxFillValueNative: 0, maxCommissionARS: 0 };
    }

    if (order.side === 'SELL') {
      const position = snapshot.positions.get(order.productId);
      if (!position || position.currency !== order.fillCurrency || position.quantity + PaperBroker.INVARIANT_TOLERANCE < order.quantity) {
        return { valid: false, reason: 'INSUFFICIENT_POSITION', slippageBps, conservativeFillPrice, maxFillValueNative: fillValueNative, maxCommissionARS: commissionARS };
      }
      if (order.fillCurrency === 'USD' && snapshot.cashARS + PaperBroker.INVARIANT_TOLERANCE < commissionARS) {
        return { valid: false, reason: 'INSUFFICIENT_ARS_FOR_COMMISSION', slippageBps, conservativeFillPrice, maxFillValueNative: fillValueNative, maxCommissionARS: commissionARS };
      }
    } else if (order.fillCurrency === 'USD') {
      if (snapshot.cashUSD + PaperBroker.INVARIANT_TOLERANCE < fillValueNative) {
        return { valid: false, reason: 'INSUFFICIENT_USD_CASH', slippageBps, conservativeFillPrice, maxFillValueNative: fillValueNative, maxCommissionARS: commissionARS };
      }
      if (snapshot.cashARS + PaperBroker.INVARIANT_TOLERANCE < commissionARS) {
        return { valid: false, reason: 'INSUFFICIENT_ARS_FOR_COMMISSION', slippageBps, conservativeFillPrice, maxFillValueNative: fillValueNative, maxCommissionARS: commissionARS };
      }
    } else {
      const availableARS = snapshot.cashARS + snapshot.cashUSD * snapshot.mepRate;
      if (availableARS + PaperBroker.INVARIANT_TOLERANCE < fillValueNative + commissionARS) {
        return { valid: false, reason: 'INSUFFICIENT_ARS_EQUIVALENT_CASH', slippageBps, conservativeFillPrice, maxFillValueNative: fillValueNative, maxCommissionARS: commissionARS };
      }
    }

    if (order.side === 'BUY') {
      const projectedExposureARS = snapshot.grossExposureARS + fillValueARS;
      const projectedEquityARS = snapshot.totalValueARS - commissionARS +
        this.toARS(order.quantity * (currentPrice - conservativeFillPrice), order.fillCurrency, snapshot.mepRate);
      if (!Number.isFinite(projectedEquityARS) || projectedEquityARS <= 0 ||
          projectedExposureARS / projectedEquityARS > PaperBroker.LEVERAGE_LIMIT + PaperBroker.INVARIANT_TOLERANCE) {
        return { valid: false, reason: 'LEVERAGE_LIMIT_EXCEEDED', slippageBps, conservativeFillPrice, maxFillValueNative: fillValueNative, maxCommissionARS: commissionARS };
      }
    }

    return {
      valid: true,
      slippageBps,
      conservativeFillPrice,
      maxFillValueNative: fillValueNative,
      maxCommissionARS: commissionARS,
    };
  }

  private simulateFillAtomically(
    order: PaperOrder,
    validationPrice: number,
    currentPrice: number,
    snapshot: FinancialSnapshot,
    preflight: FillPreflight,
  ): PaperOrder {
    const now = new Date().toISOString();
    if (this.random() > this.fillParams.fillProbability) {
      order.status = 'CANCELLED';
      order.updatedAt = now;
      order.rejectionReason = 'SIMULATED_LOW_LIQUIDITY';
      this.portfolio.orders.push(order);
      this.logAudit(order, 'CANCELLED', order.rejectionReason);
      return order;
    }

    const partialRoll = this.random();
    const fillRatio = partialRoll < this.fillParams.partialFillProbability
      ? 0.5 + this.random() * this.fillParams.maxPartialFillRatio
      : 1;
    const filledQuantity = Math.round(order.quantity * Math.min(fillRatio, 1) * 100) / 100;
    const fillPrice = this.calculateFillPrice(order, validationPrice, currentPrice, preflight.slippageBps);
    const fillValueNative = filledQuantity * fillPrice;
    const fillValueARS = this.toARS(fillValueNative, order.fillCurrency, snapshot.mepRate);
    const commissionARS = Math.max(
      this.fillParams.minCommissionARS,
      fillValueARS * this.fillParams.commissionRate,
    );

    if (fillValueNative > preflight.maxFillValueNative + PaperBroker.INVARIANT_TOLERANCE ||
        commissionARS > preflight.maxCommissionARS + PaperBroker.INVARIANT_TOLERANCE) {
      return this.rejectOrder(order, 'FILL_EXCEEDS_PREFLIGHT');
    }

    const prepared: PreparedFill = {
      fillPrice,
      filledQuantity,
      fillValueNative,
      fillValueARS,
      commissionARS,
      slippageBps: preflight.slippageBps,
      executionLatencyMs: this.fillParams.baseLatencyMs +
        Math.round(this.random() * 200 * this.getRegimeSlippageMultiplier()),
      settlementDate: this.calculateSettlementDate(),
    };

    const proposal = this.buildPostFillState(order, prepared, currentPrice, snapshot);
    if (!proposal.valid || !proposal.state) {
      return this.rejectOrder(order, proposal.reason ?? 'POST_FILL_BUILD_FAILED');
    }

    const invariantError = this.validatePostFillState(order, prepared, currentPrice, snapshot, proposal.state);
    if (invariantError) {
      return this.rejectOrder(order, invariantError);
    }

    order.fillPrice = prepared.fillPrice;
    order.filledQuantity = prepared.filledQuantity;
    order.slippageBps = prepared.slippageBps;
    order.commissionARS = prepared.commissionARS;
    order.executionLatencyMs = prepared.executionLatencyMs;
    order.settlementDate = prepared.settlementDate;
    order.status = prepared.filledQuantity < order.quantity ? 'PARTIALLY_FILLED' : 'FILLED';
    order.updatedAt = now;

    this.applyFinancialState(proposal.state);
    this.portfolio.orders.push(order);
    this.portfolio.updatedAt = now;

    if (proposal.attribution) {
      try {
        recordSignalReturn('regime', proposal.attribution.regimeSignal, proposal.attribution.returnPct);
        recordSignalReturn('carry', proposal.attribution.carrySignal, proposal.attribution.returnPct);
      } catch {
        this.logAudit(order, 'ATTRIBUTION_DEGRADED', 'Fill committed; attribution recorder unavailable');
      }
    }

    this.logAudit(order, order.status, `Filled ${order.filledQuantity}/${order.quantity} @ ${order.fillPrice}`);
    return order;
  }

  private buildPostFillState(
    order: PaperOrder,
    fill: PreparedFill,
    currentPrice: number,
    snapshot: FinancialSnapshot,
  ): ProposedStateResult {
    let cashARS = snapshot.cashARS;
    let cashUSD = snapshot.cashUSD;
    let realizedPnL = snapshot.realizedPnL;
    const positions = this.clonePositions(snapshot.positions);
    let attribution: ProposedStateResult['attribution'];

    if (order.side === 'BUY') {
      if (order.fillCurrency === 'USD') {
        cashUSD -= fill.fillValueNative;
        cashARS -= fill.commissionARS;
      } else {
        const requiredARS = fill.fillValueNative + fill.commissionARS;
        if (cashARS < requiredARS) {
          const deficitARS = requiredARS - cashARS;
          const usdToConvert = deficitARS / snapshot.mepRate;
          cashUSD -= usdToConvert;
          cashARS += usdToConvert * snapshot.mepRate;
        }
        cashARS -= requiredARS;
      }

      const existing = positions.get(order.productId);
      if (existing && existing.currency !== order.fillCurrency) {
        return { valid: false, reason: 'POSITION_CURRENCY_MISMATCH' };
      }
      if (existing) {
        const newQuantity = existing.quantity + fill.filledQuantity;
        const newCostBasis = existing.totalCostBasis + fill.fillValueNative;
        existing.quantity = newQuantity;
        existing.totalCostBasis = newCostBasis;
        existing.avgCostBasis = newQuantity > 0 ? newCostBasis / newQuantity : 0;
        existing.currentPrice = currentPrice;
        existing.strategySource = order.strategySource;
        existing.bucketId = order.bucketId;
        existing.updatedAt = order.updatedAt;
      } else {
        positions.set(order.productId, {
          productId: order.productId,
          productName: order.productName,
          currency: order.fillCurrency,
          quantity: fill.filledQuantity,
          avgCostBasis: fill.fillPrice,
          totalCostBasis: fill.fillValueNative,
          currentPrice,
          marketValue: fill.filledQuantity * currentPrice,
          unrealizedPnL: fill.filledQuantity * (currentPrice - fill.fillPrice),
          unrealizedPnLPct: fill.fillPrice > 0 ? ((currentPrice - fill.fillPrice) / fill.fillPrice) * 100 : 0,
          weight: 0,
          bucketId: order.bucketId,
          strategySource: order.strategySource,
          updatedAt: order.updatedAt,
          history: [{
            timestamp: order.updatedAt,
            quantity: fill.filledQuantity,
            marketValue: fill.filledQuantity * currentPrice,
            unrealizedPnL: fill.filledQuantity * (currentPrice - fill.fillPrice),
            price: currentPrice,
          }],
        });
      }
    } else {
      const existing = positions.get(order.productId);
      if (!existing || existing.currency !== order.fillCurrency || existing.quantity < fill.filledQuantity) {
        return { valid: false, reason: 'INSUFFICIENT_POSITION_AT_FILL' };
      }

      if (order.fillCurrency === 'USD') {
        cashUSD += fill.fillValueNative;
        cashARS -= fill.commissionARS;
      } else {
        cashARS += fill.fillValueNative - fill.commissionARS;
      }

      const costOfSoldNative = fill.filledQuantity * existing.avgCostBasis;
      const realizedPnLARS = this.toARS(fill.fillValueNative - costOfSoldNative, order.fillCurrency, snapshot.mepRate) - fill.commissionARS;
      realizedPnL += realizedPnLARS;
      const returnPct = costOfSoldNative > 0
        ? (realizedPnLARS / this.toARS(costOfSoldNative, order.fillCurrency, snapshot.mepRate)) * 100
        : 0;
      attribution = {
        regimeSignal: snapshot.currentRegime === 'CRISIS' ? 0.9 : snapshot.currentRegime === 'HIGH_VOL' ? 0.6 : 0.2,
        carrySignal: snapshot.totalValueUSD > 0 ? 1 : 0,
        returnPct,
      };

      existing.quantity -= fill.filledQuantity;
      existing.totalCostBasis = existing.quantity * existing.avgCostBasis;
      existing.currentPrice = currentPrice;
      if (existing.quantity <= 0.001) {
        positions.delete(order.productId);
      } else {
        existing.updatedAt = order.updatedAt;
      }
    }

    const metrics = this.computePortfolioMetrics(positions, cashARS, cashUSD, snapshot.mepRate);
    return {
      valid: true,
      attribution,
      state: {
        cashARS,
        cashUSD,
        positions,
        realizedPnL,
        unrealizedPnL: metrics.unrealizedPnLARS,
        totalCommissions: snapshot.totalCommissions + fill.commissionARS,
        totalValueARS: metrics.totalValueARS,
        totalValueUSD: metrics.totalValueUSD,
        grossExposureARS: metrics.grossExposureARS,
        weightSum: metrics.weightSum,
      },
    };
  }

  private validatePostFillState(
    order: PaperOrder,
    fill: PreparedFill,
    currentPrice: number,
    snapshot: FinancialSnapshot,
    state: ProposedFinancialState,
  ): string | null {
    const finiteScalars = [
      state.cashARS,
      state.cashUSD,
      state.realizedPnL,
      state.unrealizedPnL,
      state.totalCommissions,
      state.totalValueARS,
      state.totalValueUSD,
      state.grossExposureARS,
      state.weightSum,
    ];
    if (!finiteScalars.every(Number.isFinite)) return 'NON_FINITE_POST_FILL_STATE';
    if (state.cashARS < -PaperBroker.INVARIANT_TOLERANCE) return 'NEGATIVE_ARS_CASH';
    if (state.cashUSD < -PaperBroker.INVARIANT_TOLERANCE) return 'NEGATIVE_USD_CASH';
    if (state.totalValueARS <= 0 || state.totalValueUSD <= 0) return 'NON_POSITIVE_PORTFOLIO_VALUE';

    for (const position of state.positions.values()) {
      const fields = [
        position.quantity,
        position.avgCostBasis,
        position.totalCostBasis,
        position.currentPrice,
        position.marketValue,
        position.unrealizedPnL,
        position.unrealizedPnLPct,
        position.weight,
      ];
      if (!fields.every(Number.isFinite)) return 'NON_FINITE_POSITION_STATE';
      if (position.quantity < -PaperBroker.INVARIANT_TOLERANCE) return 'NEGATIVE_POSITION_QUANTITY';
      if (position.weight < -PaperBroker.INVARIANT_TOLERANCE) return 'NEGATIVE_POSITION_WEIGHT';
    }

    if (state.weightSum > 1 + PaperBroker.INVARIANT_TOLERANCE) return 'POSITION_WEIGHTS_EXCEED_ONE';
    const leverage = state.grossExposureARS / state.totalValueARS;
    if (!Number.isFinite(leverage) || leverage > PaperBroker.LEVERAGE_LIMIT + PaperBroker.INVARIANT_TOLERANCE) {
      return 'LEVERAGE_LIMIT_EXCEEDED_POST_FILL';
    }

    const independentlyComputed = this.computePortfolioMetrics(
      this.clonePositions(state.positions),
      state.cashARS,
      state.cashUSD,
      snapshot.mepRate,
    );
    if (Math.abs(independentlyComputed.totalValueARS - state.totalValueARS) > 0.01) {
      return 'INCOHERENT_ARS_EQUITY';
    }
    if (Math.abs(independentlyComputed.weightSum - state.weightSum) > PaperBroker.INVARIANT_TOLERANCE) {
      return 'INCOHERENT_POSITION_WEIGHTS';
    }

    if (order.fillCurrency === 'USD' && snapshot.cashARS + PaperBroker.INVARIANT_TOLERANCE < fill.commissionARS) {
      return 'INSUFFICIENT_ARS_FOR_COMMISSION';
    }

    const marketVsFillARS = this.toARS(
      fill.filledQuantity * (currentPrice - fill.fillPrice),
      order.fillCurrency,
      snapshot.mepRate,
    );
    const expectedEquityDeltaARS = order.side === 'BUY'
      ? marketVsFillARS - fill.commissionARS
      : -marketVsFillARS - fill.commissionARS;
    const actualEquityDeltaARS = state.totalValueARS - snapshot.totalValueARS;
    if (Math.abs(actualEquityDeltaARS - expectedEquityDeltaARS) > 0.05) {
      return 'INCOHERENT_EQUITY_DELTA';
    }

    return null;
  }

  private applyFinancialState(state: ProposedFinancialState): void {
    this.portfolio.cashARS = Math.max(0, state.cashARS);
    this.portfolio.cashUSD = Math.max(0, state.cashUSD);
    this.portfolio.positions = state.positions;
    this.portfolio.realizedPnL = state.realizedPnL;
    this.portfolio.unrealizedPnL = state.unrealizedPnL;
    this.portfolio.totalCommissions = state.totalCommissions;
    this.portfolio.totalValueARS = state.totalValueARS;
    this.portfolio.totalValueUSD = state.totalValueUSD;
  }

  private rejectOrder(order: PaperOrder, reason: string): PaperOrder {
    order.status = 'REJECTED';
    order.rejectionReason = reason;
    order.fillPrice = null;
    order.filledQuantity = 0;
    order.commissionARS = 0;
    order.updatedAt = new Date().toISOString();
    this.portfolio.orders.push(order);
    this.logAudit(order, 'REJECTED', reason);
    return order;
  }

  // ─── Recalculate portfolio values ───

  recalculatePortfolio(): void {
    this.assertValidMEP(this.portfolio.currentMEPRate);
    const metrics = this.computePortfolioMetrics(
      this.portfolio.positions,
      this.portfolio.cashARS,
      this.portfolio.cashUSD,
      this.portfolio.currentMEPRate,
    );
    this.portfolio.totalValueARS = metrics.totalValueARS;
    this.portfolio.totalValueUSD = metrics.totalValueUSD;
    this.portfolio.unrealizedPnL = metrics.unrealizedPnLARS;
  }

  // ─── Update market prices for all positions ───

  updatePrices(priceMap: Record<string, number>, mepRate: number): void {
    this.assertValidMEP(mepRate);
    for (const [productId, price] of Object.entries(priceMap)) {
      if (!Number.isFinite(price) || price <= 0) {
        throw new RangeError(`Invalid market price for ${productId}`);
      }
    }

    const positions = this.clonePositions(this.portfolio.positions);
    const now = new Date().toISOString();
    for (const [productId, position] of positions) {
      const nextPrice = priceMap[productId];
      if (nextPrice !== undefined) {
        position.currentPrice = nextPrice;
        position.updatedAt = now;
        position.history.push({
          timestamp: now,
          quantity: position.quantity,
          marketValue: position.quantity * nextPrice,
          unrealizedPnL: position.quantity * nextPrice - position.totalCostBasis,
          price: nextPrice,
        });
        if (position.history.length > 365) position.history = position.history.slice(-365);
      }
    }

    const metrics = this.computePortfolioMetrics(positions, this.portfolio.cashARS, this.portfolio.cashUSD, mepRate);
    if (![metrics.totalValueARS, metrics.totalValueUSD, metrics.weightSum].every(Number.isFinite)) {
      throw new RangeError('Price update produced non-finite portfolio metrics');
    }

    this.portfolio.currentMEPRate = mepRate;
    this.portfolio.positions = positions;
    this.portfolio.totalValueARS = metrics.totalValueARS;
    this.portfolio.totalValueUSD = metrics.totalValueUSD;
    this.portfolio.unrealizedPnL = metrics.unrealizedPnLARS;
    this.portfolio.updatedAt = now;
  }

  // ─── Execute a rebalance: generate orders to match target allocations ───

  executeRebalance(
    targetAllocations: { productId: string; productName: string; weight: number; strategySource: StrategyModuleName | 'rebalance'; bucketId?: BucketId | null; currentPrice: number; currency?: 'ARS' | 'USD' }[],
    regime: CapitalRegime,
    confidence: number,
  ): PaperOrder[] {
    const orders: PaperOrder[] = [];
    this.portfolio.rebalanceCount++;

    for (const target of targetAllocations) {
      const currentPos = this.portfolio.positions.get(target.productId);
      const currentWeight = currentPos?.weight ?? 0;
      const weightDiff = target.weight - currentWeight;
      if (Math.abs(weightDiff) < 0.005) continue;

      const order = this.submitOrder({
        productId: target.productId,
        productName: target.productName,
        side: weightDiff > 0 ? 'BUY' : 'SELL',
        targetWeight: Math.abs(weightDiff),
        strategySource: target.strategySource,
        bucketId: target.bucketId ?? null,
        regime,
        confidence,
        currentPrice: target.currentPrice,
        currency: target.currency,
      });
      orders.push(order);
    }

    this.portfolio.currentRegime = regime;
    return orders;
  }

  // ─── Getters ───

  getPortfolio(): Readonly<PaperPortfolio> {
    return this.portfolio;
  }

  getPositions(): ReadonlyMap<string, PaperPosition> {
    return this.portfolio.positions;
  }

  getOrders(status?: OrderStatus): PaperOrder[] {
    return status ? this.portfolio.orders.filter(order => order.status === status) : [...this.portfolio.orders];
  }

  getPortfolioSummary(): {
    totalValueUSD: number;
    totalValueARS: number;
    cashUSD: number;
    cashARS: number;
    positionCount: number;
    realizedPnL: number;
    unrealizedPnL: number;
    totalCommissions: number;
    rebalanceCount: number;
    currentRegime: CapitalRegime;
    topPositions: { productId: string; weight: number; unrealizedPnLPct: number }[];
  } {
    const positions = Array.from(this.portfolio.positions.values());
    const topPositions = positions
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 5)
      .map(position => ({
        productId: position.productId,
        weight: Math.round(position.weight * 1000) / 1000,
        unrealizedPnLPct: Math.round(position.unrealizedPnLPct * 100) / 100,
      }));

    return {
      totalValueUSD: Math.round(this.portfolio.totalValueUSD * 100) / 100,
      totalValueARS: Math.round(this.portfolio.totalValueARS),
      cashUSD: Math.round(this.portfolio.cashUSD * 100) / 100,
      cashARS: Math.round(this.portfolio.cashARS),
      positionCount: positions.length,
      realizedPnL: Math.round(this.portfolio.realizedPnL * 100) / 100,
      unrealizedPnL: Math.round(this.portfolio.unrealizedPnL * 100) / 100,
      totalCommissions: Math.round(this.portfolio.totalCommissions),
      rebalanceCount: this.portfolio.rebalanceCount,
      currentRegime: this.portfolio.currentRegime,
      topPositions,
    };
  }

  private calculateSlippageBps(): number {
    return this.fillParams.baseSlippageBps +
      this.getRegimeSlippageMultiplier() * this.fillParams.volatilitySlippageBps;
  }

  private calculateFillPrice(
    order: PaperOrder,
    validationPrice: number,
    currentPrice: number,
    slippageBps: number,
  ): number {
    const direction = order.side === 'BUY' ? 1 : -1;
    const slippedMarketPrice = currentPrice * (1 + direction * slippageBps / 10000);
    const boundedPrice = order.orderType === 'LIMIT'
      ? order.side === 'BUY'
        ? Math.min(slippedMarketPrice, validationPrice)
        : Math.max(slippedMarketPrice, validationPrice)
      : slippedMarketPrice;
    return Math.round(boundedPrice * 100) / 100;
  }

  private calculateSettlementDate(): string {
    const date = new Date();
    date.setDate(date.getDate() + this.fillParams.settlementDays);
    return date.toISOString();
  }

  private createFinancialSnapshot(currentPrice: number, productId: string): FinancialSnapshot {
    const positions = this.clonePositions(this.portfolio.positions);
    const tradedPosition = positions.get(productId);
    if (tradedPosition) tradedPosition.currentPrice = currentPrice;
    const metrics = this.computePortfolioMetrics(
      positions,
      this.portfolio.cashARS,
      this.portfolio.cashUSD,
      this.portfolio.currentMEPRate,
    );
    return Object.freeze({
      cashARS: this.portfolio.cashARS,
      cashUSD: this.portfolio.cashUSD,
      mepRate: this.portfolio.currentMEPRate,
      positions,
      realizedPnL: this.portfolio.realizedPnL,
      unrealizedPnL: metrics.unrealizedPnLARS,
      totalCommissions: this.portfolio.totalCommissions,
      totalValueARS: metrics.totalValueARS,
      totalValueUSD: metrics.totalValueUSD,
      grossExposureARS: metrics.grossExposureARS,
      currentRegime: this.portfolio.currentRegime,
    });
  }

  private clonePositions(source: ReadonlyMap<string, PaperPosition>): Map<string, PaperPosition> {
    return new Map(Array.from(source.entries(), ([productId, position]) => [
      productId,
      { ...position, history: position.history.map(snapshot => ({ ...snapshot })) },
    ]));
  }

  private computePortfolioMetrics(
    positions: Map<string, PaperPosition>,
    cashARS: number,
    cashUSD: number,
    mepRate: number,
  ): PortfolioMetrics {
    this.assertValidMEP(mepRate);
    let grossExposureARS = 0;
    let unrealizedPnLARS = 0;

    for (const position of positions.values()) {
      position.marketValue = position.quantity * position.currentPrice;
      position.unrealizedPnL = position.marketValue - position.totalCostBasis;
      position.unrealizedPnLPct = position.totalCostBasis > 0
        ? (position.unrealizedPnL / position.totalCostBasis) * 100
        : 0;
      grossExposureARS += this.toARS(position.marketValue, position.currency, mepRate);
      unrealizedPnLARS += this.toARS(position.unrealizedPnL, position.currency, mepRate);
    }

    const totalValueARS = cashARS + cashUSD * mepRate + grossExposureARS;
    const totalValueUSD = totalValueARS / mepRate;
    let weightSum = 0;
    for (const position of positions.values()) {
      position.weight = totalValueARS > 0
        ? this.toARS(position.marketValue, position.currency, mepRate) / totalValueARS
        : 0;
      weightSum += position.weight;
    }

    return { totalValueARS, totalValueUSD, grossExposureARS, unrealizedPnLARS, weightSum };
  }

  private toARS(value: number, currency: 'ARS' | 'USD', mepRate: number): number {
    return currency === 'USD' ? value * mepRate : value;
  }

  private isValidMEP(mepRate: number): boolean {
    return Number.isFinite(mepRate) && mepRate > 0;
  }

  private assertValidMEP(mepRate: number): void {
    if (!this.isValidMEP(mepRate)) throw new RangeError('MEP rate must be finite and positive');
  }

  private validateFillParams(params: FillSimulationParams): void {
    const nonNegative = [
      params.baseSlippageBps,
      params.volatilitySlippageBps,
      params.commissionRate,
      params.minCommissionARS,
      params.settlementDays,
      params.baseLatencyMs,
      params.maxPartialFillRatio,
    ];
    if (!nonNegative.every(value => Number.isFinite(value) && value >= 0)) {
      throw new RangeError('Fill simulation parameters must be finite and non-negative');
    }
    if (![params.fillProbability, params.partialFillProbability].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) {
      throw new RangeError('Fill probabilities must be finite values in [0,1]');
    }
    if (params.maxPartialFillRatio > 0.5) {
      throw new RangeError('Max partial fill ratio must not exceed 0.5');
    }
  }

  private getRegimeSlippageMultiplier(): number {
    switch (this.portfolio.currentRegime) {
      case 'CRISIS': return 4;
      case 'HIGH_VOL': return 3;
      case 'NORMAL': return 1;
      case 'CARRY_FAVORABLE': return 0.5;
      default: return 1;
    }
  }

  private logAudit(order: PaperOrder, event: string, details: string): void {
    this.auditLog.push({
      timestamp: new Date().toISOString(),
      orderId: order.id,
      productId: order.productId,
      event,
      details,
      portfolioValueUSD: this.portfolio.totalValueUSD,
      regime: this.portfolio.currentRegime,
    });
    if (this.auditLog.length > 5000) this.auditLog = this.auditLog.slice(-3000);
  }

  getAuditLog(count: number = 100): BrokerAuditEntry[] {
    return this.auditLog.slice(-count);
  }
}

interface FinancialSnapshot {
  readonly cashARS: number;
  readonly cashUSD: number;
  readonly mepRate: number;
  readonly positions: Map<string, PaperPosition>;
  readonly realizedPnL: number;
  readonly unrealizedPnL: number;
  readonly totalCommissions: number;
  readonly totalValueARS: number;
  readonly totalValueUSD: number;
  readonly grossExposureARS: number;
  readonly currentRegime: CapitalRegime;
}

interface FillPreflight {
  valid: boolean;
  reason?: string;
  slippageBps: number;
  conservativeFillPrice: number;
  maxFillValueNative: number;
  maxCommissionARS: number;
}

interface PreparedFill {
  fillPrice: number;
  filledQuantity: number;
  fillValueNative: number;
  fillValueARS: number;
  commissionARS: number;
  slippageBps: number;
  executionLatencyMs: number;
  settlementDate: string;
}

interface ProposedFinancialState {
  cashARS: number;
  cashUSD: number;
  positions: Map<string, PaperPosition>;
  realizedPnL: number;
  unrealizedPnL: number;
  totalCommissions: number;
  totalValueARS: number;
  totalValueUSD: number;
  grossExposureARS: number;
  weightSum: number;
}

interface ProposedStateResult {
  valid: boolean;
  reason?: string;
  state?: ProposedFinancialState;
  attribution?: {
    regimeSignal: number;
    carrySignal: number;
    returnPct: number;
  };
}

interface PortfolioMetrics {
  totalValueARS: number;
  totalValueUSD: number;
  grossExposureARS: number;
  unrealizedPnLARS: number;
  weightSum: number;
}

export interface BrokerAuditEntry {
  timestamp: string;
  orderId: string;
  productId: string;
  event: string;
  details: string;
  portfolioValueUSD: number;
  regime: CapitalRegime;
}
