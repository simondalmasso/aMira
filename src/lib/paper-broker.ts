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
    this.fillParams = { ...DEFAULT_FILL_PARAMS, ...fillParams };
    this.rng = this.fillParams.seed !== null ? mulberry32(this.fillParams.seed) : null;

    // BUG-009 FIX: Portfolio starts with ONLY USD cash.
    // cashARS = 0 — ARS is obtained by selling USD at MEP rate when buying ARS products.
    // At t0: totalValueUSD = cashUSD + cashARS/mepRate = initialCapitalUSD + 0 = initialCapitalUSD ✅
    this.portfolio = {
      id: `PAPER-${Date.now()}`,
      totalValueUSD: initialCapitalUSD,
      totalValueARS: 0, // No ARS cash until FX conversion
      cashUSD: initialCapitalUSD,
      cashARS: 0, // BUG-009 FIX: was initialCapitalUSD * mepRate (double capital)
      currentMEPRate: mepRate,
      positions: new Map(),
      orders: [],
      realizedPnL: 0,
      unrealizedPnL: 0,
      totalCommissions: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
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

    // Calculate quantity from target weight and portfolio value
    const portfolioValue = currency === 'USD'
      ? this.portfolio.totalValueUSD
      : this.portfolio.totalValueARS;
    const targetValue = portfolioValue * params.targetWeight;
    const quantity = params.currentPrice > 0 ? targetValue / params.currentPrice : 0;

    const order: PaperOrder = {
      id: orderId,
      createdAt: now,
      updatedAt: now,
      productId: params.productId,
      productName: params.productName,
      side: params.side,
      orderType: params.orderType ?? 'MARKET',
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

    // Validate order
    const validation = this.validateOrder(order);
    if (!validation.valid) {
      order.status = 'REJECTED';
      order.rejectionReason = validation.reason ?? 'Order validation failed';
      this.portfolio.orders.push(order);
      this.logAudit(order, 'REJECTED', validation.reason ?? 'Order validation failed');
      return order;
    }

    // Submit for execution
    order.status = 'SUBMITTED';
    this.portfolio.orders.push(order);

    // Simulate execution
    return this.simulateFill(order, params.currentPrice);
  }

  // ─── Validate an order before execution ───

  private validateOrder(order: PaperOrder): { valid: boolean; reason?: string } {
    // Check: quantity must be positive
    if (order.quantity <= 0) {
      return { valid: false, reason: 'Order quantity must be positive' };
    }

    // Check: target weight must be [0, 1]
    if (order.targetWeight < 0 || order.targetWeight > 1) {
      return { valid: false, reason: `Target weight ${order.targetWeight} out of bounds [0,1]` };
    }

    // Check: sufficient cash for BUY orders
    if (order.side === 'BUY') {
      const estimatedCost = order.quantity * (order.limitPrice ?? 0);
      if (order.fillCurrency === 'USD') {
        if (estimatedCost > this.portfolio.cashUSD * 1.05) {
          return { valid: false, reason: `Insufficient USD cash: need ~${estimatedCost.toFixed(0)}, have ${this.portfolio.cashUSD.toFixed(0)}` };
        }
      } else {
        // ARS purchase: check if we have enough ARS, or can convert from USD
        const arsAvailable = this.portfolio.cashARS + this.portfolio.cashUSD * this.portfolio.currentMEPRate;
        if (estimatedCost > arsAvailable * 1.05) {
          return { valid: false, reason: `Insufficient cash (USD+ARS): need ~${estimatedCost.toFixed(0)} ARS, have ${arsAvailable.toFixed(0)} ARS equivalent` };
        }
      }
    }

    // Check: sufficient position for SELL orders
    if (order.side === 'SELL') {
      const position = this.portfolio.positions.get(order.productId);
      if (!position || position.quantity < order.quantity * 0.99) {
        return { valid: false, reason: `Insufficient position: trying to sell ${order.quantity}, have ${position?.quantity ?? 0}` };
      }
    }

    // Check: leverage constraint — total position value must not exceed portfolio value
    // (NO leverage = 1.0x hard cap)
    if (order.side === 'BUY') {
      const totalAfterBuy = this.getTotalPositionValue() + order.quantity * (order.limitPrice ?? 0);
      const maxAllowed = this.portfolio.totalValueARS * 1.0; // 1.0x leverage cap
      if (totalAfterBuy > maxAllowed) {
        return { valid: false, reason: `Leverage constraint: would exceed 1.0x cap` };
      }
    }

    return { valid: true };
  }

  // ─── Simulate fill with slippage, latency, and probability ───

  private simulateFill(order: PaperOrder, marketPrice: number): PaperOrder {
    const now = new Date().toISOString();
    const regimeMultiplier = this.getRegimeSlippageMultiplier();

    // BUG-010 FIX: Use seeded PRNG for deterministic backtests
    // Simulate fill probability
    const fillRoll = this.random();
    if (fillRoll > this.fillParams.fillProbability) {
      order.status = 'CANCELLED';
      order.updatedAt = now;
      order.rejectionReason = 'Simulated: order not filled (low liquidity)';
      this.logAudit(order, 'CANCELLED', 'Fill probability check failed');
      return order;
    }

    // Calculate slippage
    const slippageBps = this.fillParams.baseSlippageBps +
      regimeMultiplier * this.fillParams.volatilitySlippageBps;
    order.slippageBps = slippageBps;

    // Apply slippage to fill price
    const slippageFactor = slippageBps / 10000;
    const slipDirection = order.side === 'BUY' ? 1 : -1; // Buy: price goes up, Sell: price goes down
    order.fillPrice = Math.round(marketPrice * (1 + slipDirection * slippageFactor) * 100) / 100;

    // BUG-010 FIX: Use seeded PRNG for partial fill simulation
    const partialRoll = this.random();
    if (partialRoll < this.fillParams.partialFillProbability) {
      const fillRatio = 0.5 + this.random() * this.fillParams.maxPartialFillRatio;
      order.filledQuantity = Math.round(order.quantity * fillRatio * 100) / 100;
      order.status = 'PARTIALLY_FILLED';
    } else {
      order.filledQuantity = order.quantity;
      order.status = 'FILLED';
    }

    // Calculate commission
    const tradeValue = order.filledQuantity * order.fillPrice;
    order.commissionARS = Math.max(
      this.fillParams.minCommissionARS,
      tradeValue * this.fillParams.commissionRate
    );

    // BUG-010 FIX: Use seeded PRNG for latency simulation
    order.executionLatencyMs = this.fillParams.baseLatencyMs +
      Math.round(this.random() * 200 * regimeMultiplier);

    // Settlement date
    const settlementDate = new Date();
    settlementDate.setDate(settlementDate.getDate() + this.fillParams.settlementDays);
    order.settlementDate = settlementDate.toISOString();

    order.updatedAt = now;

    // Update portfolio
    this.applyFill(order);

    this.logAudit(order, order.status, `Filled ${order.filledQuantity}/${order.quantity} @ ${order.fillPrice}`);

    return order;
  }

  // ─── Apply a fill to the portfolio ───

  private applyFill(order: PaperOrder): void {
    const fillValue = order.filledQuantity * (order.fillPrice ?? 0);

    if (order.side === 'BUY') {
      // BUG-009 FIX: Auto-convert USD→ARS when buying ARS products with insufficient ARS cash
      if (order.fillCurrency !== 'USD') {
        const arsNeeded = fillValue + order.commissionARS;
        if (this.portfolio.cashARS < arsNeeded) {
          const deficit = arsNeeded - this.portfolio.cashARS;
          const usdToConvert = Math.ceil(deficit / this.portfolio.currentMEPRate * 100) / 100;
          if (usdToConvert <= this.portfolio.cashUSD) {
            this.portfolio.cashUSD -= usdToConvert;
            this.portfolio.cashARS += usdToConvert * this.portfolio.currentMEPRate;
          }
        }
      }

      // Deduct cash
      if (order.fillCurrency === 'USD') {
        this.portfolio.cashUSD -= fillValue + order.commissionARS / this.portfolio.currentMEPRate;
      } else {
        this.portfolio.cashARS -= fillValue + order.commissionARS;
      }

      // Add to position
      const existing = this.portfolio.positions.get(order.productId);
      if (existing) {
        const newQuantity = existing.quantity + order.filledQuantity;
        const newCostBasis = existing.totalCostBasis + fillValue;
        existing.quantity = newQuantity;
        existing.totalCostBasis = newCostBasis;
        existing.avgCostBasis = newQuantity > 0 ? newCostBasis / newQuantity : 0;
        existing.strategySource = order.strategySource;
        existing.bucketId = order.bucketId;
        existing.updatedAt = new Date().toISOString();
      } else {
        this.portfolio.positions.set(order.productId, {
          productId: order.productId,
          productName: order.productName,
          currency: order.fillCurrency,
          quantity: order.filledQuantity,
          avgCostBasis: order.fillPrice ?? 0,
          totalCostBasis: fillValue,
          currentPrice: order.fillPrice ?? 0,
          marketValue: fillValue,
          unrealizedPnL: 0,
          unrealizedPnLPct: 0,
          weight: 0,
          bucketId: order.bucketId,
          strategySource: order.strategySource,
          updatedAt: new Date().toISOString(),
          history: [{
            timestamp: new Date().toISOString(),
            quantity: order.filledQuantity,
            marketValue: fillValue,
            unrealizedPnL: 0,
            price: order.fillPrice ?? 0,
          }],
        });
      }
    } else {
      // SELL: add cash, reduce position
      if (order.fillCurrency === 'USD') {
        this.portfolio.cashUSD += fillValue - order.commissionARS / this.portfolio.currentMEPRate;
      } else {
        this.portfolio.cashARS += fillValue - order.commissionARS;
      }

      // Realize PnL
      const existing = this.portfolio.positions.get(order.productId);
      if (existing) {
        const costOfSold = order.filledQuantity * existing.avgCostBasis;
        const realizedPnL = fillValue - costOfSold - order.commissionARS;
        this.portfolio.realizedPnL += realizedPnL;

        // ATTRIBUTION PIPELINE: Record signal-return pair for PnL attribution
        const returnPct = costOfSold > 0 ? (realizedPnL / costOfSold) * 100 : 0;
        recordSignalReturn('regime', this.portfolio.currentRegime === 'CRISIS' ? 0.9 : this.portfolio.currentRegime === 'HIGH_VOL' ? 0.6 : 0.2, returnPct);
        recordSignalReturn('carry', (this.portfolio.totalValueUSD > 0 ? 1 : 0), returnPct);

        existing.quantity -= order.filledQuantity;
        existing.totalCostBasis = existing.quantity * existing.avgCostBasis;

        if (existing.quantity <= 0.001) {
          // Position fully closed
          this.portfolio.positions.delete(order.productId);
        } else {
          existing.updatedAt = new Date().toISOString();
        }
      }
    }

    // Track commissions
    this.portfolio.totalCommissions += order.commissionARS;

    // Recalculate portfolio value
    this.recalculatePortfolio();

    this.portfolio.updatedAt = new Date().toISOString();
  }

  // ─── Recalculate portfolio values ───

  recalculatePortfolio(): void {
    let totalARS = this.portfolio.cashARS;
    let totalUSD = this.portfolio.cashUSD;
    let totalUnrealizedPnL = 0;

    for (const [_, position] of this.portfolio.positions) {
      const mv = position.quantity * position.currentPrice;
      position.marketValue = mv;
      position.unrealizedPnL = mv - position.totalCostBasis;
      position.unrealizedPnLPct = position.totalCostBasis > 0
        ? (position.unrealizedPnL / position.totalCostBasis) * 100
        : 0;

      if (position.currency === 'USD') {
        totalUSD += mv;
      } else {
        totalARS += mv;
      }
      totalUnrealizedPnL += position.unrealizedPnL;
    }

    this.portfolio.totalValueARS = totalARS;
    this.portfolio.totalValueUSD = totalUSD + totalARS / this.portfolio.currentMEPRate;
    this.portfolio.unrealizedPnL = totalUnrealizedPnL;

    // Recalculate position weights
    const totalPortfolioValue = this.portfolio.totalValueARS;
    for (const [_, position] of this.portfolio.positions) {
      position.weight = totalPortfolioValue > 0
        ? position.marketValue / totalPortfolioValue
        : 0;
    }
  }

  // ─── Update market prices for all positions ───

  updatePrices(priceMap: Record<string, number>, mepRate: number): void {
    this.portfolio.currentMEPRate = mepRate;

    for (const [productId, position] of this.portfolio.positions) {
      if (priceMap[productId] !== undefined) {
        position.currentPrice = priceMap[productId];
        position.updatedAt = new Date().toISOString();

        // Add history snapshot
        position.history.push({
          timestamp: new Date().toISOString(),
          quantity: position.quantity,
          marketValue: position.quantity * position.currentPrice,
          unrealizedPnL: position.quantity * position.currentPrice - position.totalCostBasis,
          price: position.currentPrice,
        });

        // Keep history bounded
        if (position.history.length > 365) {
          position.history = position.history.slice(-365);
        }
      }
    }

    this.recalculatePortfolio();
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

      // Skip trivial rebalances (< 0.5% weight change)
      if (Math.abs(weightDiff) < 0.005) continue;

      const side: OrderSide = weightDiff > 0 ? 'BUY' : 'SELL';
      const absWeight = Math.abs(weightDiff);

      const order = this.submitOrder({
        productId: target.productId,
        productName: target.productName,
        side,
        targetWeight: absWeight,
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
    if (status) {
      return this.portfolio.orders.filter(o => o.status === status);
    }
    return [...this.portfolio.orders];
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
      .map(p => ({
        productId: p.productId,
        weight: Math.round(p.weight * 1000) / 1000,
        unrealizedPnLPct: Math.round(p.unrealizedPnLPct * 100) / 100,
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

  // ─── Helper: regime slippage multiplier ───

  private getRegimeSlippageMultiplier(): number {
    switch (this.portfolio.currentRegime) {
      case 'CRISIS': return 4;
      case 'HIGH_VOL': return 3;
      case 'NORMAL': return 1;
      case 'CARRY_FAVORABLE': return 0.5;
      default: return 1;
    }
  }

  // ─── Helper: total position value ───

  private getTotalPositionValue(): number {
    let total = 0;
    for (const [_, pos] of this.portfolio.positions) {
      total += pos.marketValue;
    }
    return total;
  }

  // ─── Audit logging ───

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

    // Keep audit log bounded
    if (this.auditLog.length > 5000) {
      this.auditLog = this.auditLog.slice(-3000);
    }
  }

  getAuditLog(count: number = 100): BrokerAuditEntry[] {
    return this.auditLog.slice(-count);
  }
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
