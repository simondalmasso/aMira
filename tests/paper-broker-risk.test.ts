/// <reference types="bun-types" />
import { expect, test } from 'bun:test';
import { PaperBroker, type FillSimulationParams } from '@/lib/paper-broker';

const fillParams: Partial<FillSimulationParams> = {
  baseSlippageBps: 10,
  volatilitySlippageBps: 0,
  commissionRate: 0.001,
  minCommissionARS: 100,
  fillProbability: 1,
  partialFillProbability: 0,
  seed: 20260717,
};

function createBroker(): PaperBroker {
  return new PaperBroker(2000, 1445, fillParams);
}

function financialSnapshot(broker: PaperBroker): string {
  const portfolio = broker.getPortfolio();
  return JSON.stringify({
    totalValueUSD: portfolio.totalValueUSD,
    totalValueARS: portfolio.totalValueARS,
    cashUSD: portfolio.cashUSD,
    cashARS: portfolio.cashARS,
    realizedPnL: portfolio.realizedPnL,
    unrealizedPnL: portfolio.unrealizedPnL,
    totalCommissions: portfolio.totalCommissions,
    positions: Array.from(portfolio.positions.entries()).map(([id, position]) => [id, {
      currency: position.currency,
      quantity: position.quantity,
      avgCostBasis: position.avgCostBasis,
      totalCostBasis: position.totalCostBasis,
      currentPrice: position.currentPrice,
      marketValue: position.marketValue,
      unrealizedPnL: position.unrealizedPnL,
      weight: position.weight,
    }]),
  });
}

function assertPortfolioInvariants(broker: PaperBroker): void {
  const portfolio = broker.getPortfolio();
  const positions = Array.from(portfolio.positions.values());
  const weightSum = positions.reduce((sum, position) => sum + position.weight, 0);

  expect(Number.isFinite(portfolio.totalValueARS)).toBe(true);
  expect(Number.isFinite(portfolio.totalValueUSD)).toBe(true);
  expect(Number.isFinite(portfolio.cashARS)).toBe(true);
  expect(Number.isFinite(portfolio.cashUSD)).toBe(true);
  expect(Number.isFinite(portfolio.realizedPnL)).toBe(true);
  expect(Number.isFinite(portfolio.unrealizedPnL)).toBe(true);
  expect(Number.isFinite(portfolio.totalCommissions)).toBe(true);
  expect(positions.every(position => Number.isFinite(position.weight))).toBe(true);
  expect(positions.every(position => position.quantity >= 0)).toBe(true);
  expect(weightSum).toBeLessThanOrEqual(1 + 1e-8);
}

function fundARSCommissionCash(broker: PaperBroker): void {
  const buy = broker.submitOrder({
    productId: 'ARS-FUND',
    productName: 'ARS funding asset',
    side: 'BUY',
    targetWeight: 0.1,
    strategySource: 'manual',
    regime: 'NORMAL',
    confidence: 1,
    currentPrice: 1000,
    currency: 'ARS',
  });
  if (buy.status !== 'FILLED') throw new Error(`ARS funding buy failed: ${buy.rejectionReason}`);

  const position = broker.getPositions().get('ARS-FUND');
  if (!position) throw new Error('ARS funding position was not created');
  const sell = broker.submitOrder({
    productId: 'ARS-FUND',
    productName: 'ARS funding asset',
    side: 'SELL',
    targetWeight: position.weight,
    strategySource: 'manual',
    regime: 'NORMAL',
    confidence: 1,
    currentPrice: 1000,
    currency: 'ARS',
  });
  if (sell.status !== 'FILLED') throw new Error(`ARS funding sell failed: ${sell.rejectionReason}`);
}

test('normalizes the initial portfolio to ARS without double-counting capital', () => {
  const broker = createBroker();
  const portfolio = broker.getPortfolio();
  expect({ totalValueUSD: portfolio.totalValueUSD, totalValueARS: portfolio.totalValueARS }).toEqual({ totalValueUSD: 2000, totalValueARS: 2_890_000 });
  expect(portfolio.positions.size).toBe(0);
  expect(portfolio.orders).toHaveLength(0);
  assertPortfolioInvariants(broker);
});

test('MARKET buy uses currentPrice plus conservative slippage and commission', () => {
  const broker = createBroker();
  const before = broker.getPortfolio().totalValueARS;
  const order = broker.submitOrder({
    productId: 'ARS-MARKET', productName: 'ARS Market', side: 'BUY', targetWeight: 0.1,
    strategySource: 'manual', regime: 'NORMAL', confidence: 0.9, currentPrice: 1000, currency: 'ARS',
  });
  expect(order.status).toBe('FILLED');
  expect({ fillPrice: order.fillPrice, slippageBps: order.slippageBps }).toEqual({ fillPrice: 1001, slippageBps: 10 });
  expect(broker.getPortfolio().totalValueARS).toBeCloseTo(before + order.filledQuantity * (1000 - 1001) - order.commissionARS, 6);
  assertPortfolioInvariants(broker);
});

test('rejects a USD buy when USD cash is sufficient but ARS commission cash is not', () => {
  const broker = createBroker();
  const before = financialSnapshot(broker);
  const order = broker.submitOrder({
    productId: 'USD-NO-COMMISSION', productName: 'USD Asset', side: 'BUY', targetWeight: 0.1,
    strategySource: 'manual', regime: 'NORMAL', confidence: 0.9, currentPrice: 100, currency: 'USD',
  });
  expect({ status: order.status, reason: order.rejectionReason }).toEqual({ status: 'REJECTED', reason: 'INSUFFICIENT_ARS_FOR_COMMISSION' });
  expect(financialSnapshot(broker)).toBe(before);
  expect(broker.getOrders('REJECTED')).toHaveLength(1);
  assertPortfolioInvariants(broker);
});

test('keeps all financial state byte-equivalent when request validation fails', () => {
  const broker = createBroker();
  const before = financialSnapshot(broker);
  const order = broker.submitOrder({
    productId: 'BAD-PRICE', productName: 'Bad Price', side: 'BUY', targetWeight: 0.2,
    strategySource: 'manual', regime: 'NORMAL', confidence: 0.9, currentPrice: Number.NaN, currency: 'ARS',
  });
  expect({ status: order.status, reason: order.rejectionReason }).toEqual({ status: 'REJECTED', reason: 'INVALID_CURRENT_PRICE' });
  expect(financialSnapshot(broker)).toBe(before);
  expect(broker.getAuditLog(1)[0]).toMatchObject({ event: 'REJECTED', details: 'INVALID_CURRENT_PRICE' });
  assertPortfolioInvariants(broker);
});

test('LIMIT buy respects the limit after slippage calculation', () => {
  const broker = createBroker();
  const order = broker.submitOrder({
    productId: 'ARS-LIMIT', productName: 'ARS Limit', side: 'BUY', targetWeight: 0.1,
    orderType: 'LIMIT', limitPrice: 1000.5, strategySource: 'manual', regime: 'NORMAL', confidence: 0.9,
    currentPrice: 1000, currency: 'ARS',
  });
  expect(order.status).toBe('FILLED');
  expect(order.fillPrice).toBeLessThanOrEqual(1000.5);
  expect(order.limitPrice).toBe(1000.5);
  assertPortfolioInvariants(broker);
});

test('rejects a non-marketable LIMIT without mutating financial state', () => {
  const broker = createBroker();
  const before = financialSnapshot(broker);
  const order = broker.submitOrder({
    productId: 'ARS-LIMIT-BAD', productName: 'ARS Limit Bad', side: 'BUY', targetWeight: 0.1,
    orderType: 'LIMIT', limitPrice: 999, strategySource: 'manual', regime: 'NORMAL', confidence: 0.9,
    currentPrice: 1000, currency: 'ARS',
  });
  expect({ status: order.status, reason: order.rejectionReason }).toEqual({ status: 'REJECTED', reason: 'BUY_LIMIT_NOT_MARKETABLE' });
  expect(financialSnapshot(broker)).toBe(before);
  expect(broker.getPositions().has('ARS-LIMIT-BAD')).toBe(false);
  assertPortfolioInvariants(broker);
});

test('rejects a full-weight buy that would exceed available equity after costs', () => {
  const broker = createBroker();
  const before = financialSnapshot(broker);
  const order = broker.submitOrder({
    productId: 'ARS-LEVERAGE', productName: 'ARS Leverage', side: 'BUY', targetWeight: 1,
    strategySource: 'manual', regime: 'NORMAL', confidence: 0.9, currentPrice: 1000, currency: 'ARS',
  });
  expect(order.status).toBe('REJECTED');
  expect(['INSUFFICIENT_ARS_EQUIVALENT_CASH', 'LEVERAGE_LIMIT_EXCEEDED'].includes(order.rejectionReason ?? '')).toBe(true);
  expect(financialSnapshot(broker)).toBe(before);
  assertPortfolioInvariants(broker);
});

test('converts a USD position to ARS exactly once when calculating its weight', () => {
  const broker = createBroker();
  fundARSCommissionCash(broker);
  const order = broker.submitOrder({
    productId: 'USD-WEIGHT', productName: 'USD Weight', side: 'BUY', targetWeight: 0.1,
    strategySource: 'manual', regime: 'NORMAL', confidence: 0.9, currentPrice: 100, currency: 'USD',
  });
  const portfolio = broker.getPortfolio();
  const position = broker.getPositions().get('USD-WEIGHT');
  expect(order.status).toBe('FILLED');
  expect(position).toBeDefined();
  expect(position?.weight).toBeCloseTo(((position?.marketValue ?? 0) * portfolio.currentMEPRate) / portfolio.totalValueARS, 10);
  assertPortfolioInvariants(broker);
});

test('keeps mixed ARS and USD position weights finite over one ARS denominator', () => {
  const broker = createBroker();
  fundARSCommissionCash(broker);
  const usdOrder = broker.submitOrder({
    productId: 'USD-MIX', productName: 'USD Mix', side: 'BUY', targetWeight: 0.2,
    strategySource: 'manual', regime: 'NORMAL', confidence: 0.9, currentPrice: 100, currency: 'USD',
  });
  const arsOrder = broker.submitOrder({
    productId: 'ARS-MIX', productName: 'ARS Mix', side: 'BUY', targetWeight: 0.2,
    strategySource: 'manual', regime: 'NORMAL', confidence: 0.9, currentPrice: 1000, currency: 'ARS',
  });
  expect({ usd: usdOrder.status, ars: arsOrder.status }).toEqual({ usd: 'FILLED', ars: 'FILLED' });
  expect(new Set(Array.from(broker.getPositions().values(), position => position.currency))).toEqual(new Set(['ARS', 'USD']));
  assertPortfolioInvariants(broker);
});

test('blocks invalid MEP reevaluation before any portfolio mutation', () => {
  const broker = createBroker();
  const before = financialSnapshot(broker);
  expect(() => broker.updatePrices({}, 0)).toThrow('MEP rate must be finite and positive');
  expect(financialSnapshot(broker)).toBe(before);
  assertPortfolioInvariants(broker);
});

test('never allows a sale to create negative quantities or negative cash', () => {
  const broker = createBroker();
  const buy = broker.submitOrder({
    productId: 'ARS-SELL', productName: 'ARS Sell', side: 'BUY', targetWeight: 0.2,
    strategySource: 'manual', regime: 'NORMAL', confidence: 0.9, currentPrice: 1000, currency: 'ARS',
  });
  const position = broker.getPositions().get('ARS-SELL');
  if (!position) throw new Error('Expected ARS-SELL position');
  const sell = broker.submitOrder({
    productId: 'ARS-SELL', productName: 'ARS Sell', side: 'SELL', targetWeight: position.weight / 2,
    strategySource: 'manual', regime: 'NORMAL', confidence: 0.9, currentPrice: 1000, currency: 'ARS',
  });
  const oversell = broker.submitOrder({
    productId: 'ARS-SELL', productName: 'ARS Sell', side: 'SELL', targetWeight: 1,
    strategySource: 'manual', regime: 'NORMAL', confidence: 0.9, currentPrice: 1000, currency: 'ARS',
  });
  expect({ buy: buy.status, sell: sell.status, oversell: oversell.status }).toEqual({ buy: 'FILLED', sell: 'FILLED', oversell: 'REJECTED' });
  expect(broker.getPositions().get('ARS-SELL')?.quantity ?? 0).toBeGreaterThanOrEqual(0);
  assertPortfolioInvariants(broker);
});

test('preserves finite post-fill balances, weights and PnL across a mixed sequence', () => {
  const broker = createBroker();
  fundARSCommissionCash(broker);
  broker.submitOrder({
    productId: 'USD-SEQUENCE', productName: 'USD Sequence', side: 'BUY', targetWeight: 0.15,
    strategySource: 'manual', regime: 'NORMAL', confidence: 0.8, currentPrice: 50, currency: 'USD',
  });
  broker.submitOrder({
    productId: 'ARS-SEQUENCE', productName: 'ARS Sequence', side: 'BUY', targetWeight: 0.15,
    strategySource: 'manual', regime: 'NORMAL', confidence: 0.8, currentPrice: 500, currency: 'ARS',
  });
  broker.updatePrices({ 'USD-SEQUENCE': 52, 'ARS-SEQUENCE': 510 }, 1500);
  expect(broker.getPositions().size).toBe(2);
  assertPortfolioInvariants(broker);
});
