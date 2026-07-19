// ============================================================================
// API ROUTE: /api/paper-broker — strictly validated PAPER-only broker contract
// ============================================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { PaperBroker } from '@/lib/paper-broker';
import { flushTelemetryWrites, logEvent } from '@/lib/telemetry';

export const dynamic = 'force-dynamic';

const orderStatuses = [
  'PENDING', 'SUBMITTED', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED', 'SETTLED',
] as const;
const regimes = ['CRISIS', 'HIGH_VOL', 'NORMAL', 'CARRY_FAVORABLE'] as const;
const strategies = [
  'carry_optimization', 'mean_reversion_micro', 'rate_arbitrage_simulation',
  'usd_hedged_allocations', 'capital_preservation', 'rebalance', 'manual',
] as const;
const rebalanceStrategies = [
  'carry_optimization', 'mean_reversion_micro', 'rate_arbitrage_simulation',
  'usd_hedged_allocations', 'capital_preservation', 'rebalance',
] as const;
const buckets = [
  'CAPITAL_PRESERVATION', 'INFLATION_HEDGE', 'CARRY_OPPORTUNISTIC',
  'USD_HEDGE_GROWTH', 'OPPORTUNISTIC_TACTICAL',
] as const;

const positiveFinite = z.number().finite().positive();
const nonNegativeFinite = z.number().finite().nonnegative();
const weight = z.number().finite().positive().max(1);
const confidence = z.number().finite().min(0).max(1);

const getQuerySchema = z.object({
  action: z.enum(['summary', 'positions', 'orders', 'audit']).default('summary'),
  status: z.enum(orderStatuses).optional(),
  count: z.coerce.number().int().min(1).max(1000).default(100),
});

const resetSchema = z.object({
  action: z.literal('reset'),
  capital: nonNegativeFinite.max(1_000_000_000).default(2000),
  mepRate: positiveFinite.max(1_000_000).default(1445),
}).strict();

const submitOrderSchema = z.object({
  action: z.literal('submit-order'),
  productId: z.string().trim().min(1).max(100),
  productName: z.string().trim().min(1).max(200),
  side: z.enum(['BUY', 'SELL']),
  targetWeight: weight,
  orderType: z.enum(['MARKET', 'LIMIT']).default('MARKET'),
  limitPrice: positiveFinite.optional(),
  strategySource: z.enum(strategies).default('manual'),
  bucketId: z.enum(buckets).nullable().optional(),
  regime: z.enum(regimes).default('NORMAL'),
  confidence: confidence.default(0.5),
  currentPrice: positiveFinite,
  currency: z.enum(['ARS', 'USD']).default('ARS'),
  mepRate: positiveFinite.max(1_000_000).default(1445),
}).strict().superRefine((value, ctx) => {
  if (value.orderType === 'LIMIT' && value.limitPrice === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['limitPrice'],
      message: 'limitPrice is required for LIMIT orders',
    });
  }
});

const targetAllocationSchema = z.object({
  productId: z.string().trim().min(1).max(100),
  productName: z.string().trim().min(1).max(200),
  weight,
  strategySource: z.enum(rebalanceStrategies),
  bucketId: z.enum(buckets).nullable().optional(),
  currentPrice: positiveFinite,
  currency: z.enum(['ARS', 'USD']).default('ARS'),
}).strict();

const rebalanceSchema = z.object({
  action: z.literal('rebalance'),
  targetAllocations: z.array(targetAllocationSchema).min(1).max(100),
  regime: z.enum(regimes).default('NORMAL'),
  confidence: confidence.default(0.5),
  mepRate: positiveFinite.max(1_000_000).default(1445),
}).strict().superRefine((value, ctx) => {
  const duplicateIds = value.targetAllocations
    .map((item) => item.productId)
    .filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicateIds.length > 0) {
    ctx.addIssue({ code: 'custom', path: ['targetAllocations'], message: `duplicate productId: ${duplicateIds[0]}` });
  }
  const totalWeight = value.targetAllocations.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight > 1.00000001) {
    ctx.addIssue({ code: 'custom', path: ['targetAllocations'], message: 'target allocation weights exceed 1.0' });
  }
});

const updatePricesSchema = z.object({
  action: z.literal('update-prices'),
  priceMap: z.record(z.string().trim().min(1), positiveFinite),
  mepRate: positiveFinite.max(1_000_000).default(1445),
}).strict().superRefine((value, ctx) => {
  if (Object.keys(value.priceMap).length === 0) {
    ctx.addIssue({ code: 'custom', path: ['priceMap'], message: 'priceMap must contain at least one price' });
  }
});

const postBodySchema = z.discriminatedUnion('action', [
  resetSchema,
  submitOrderSchema,
  rebalanceSchema,
  updatePricesSchema,
]);

// Paper state is intentionally isolated from real execution. It is process-local until
// a dedicated, versioned paper-ledger persistence contract is introduced.
let broker: PaperBroker | null = null;

function getBroker(mepRate: number = 1445): PaperBroker {
  if (!broker) broker = new PaperBroker(2000, mepRate);
  return broker;
}

function invalidRequest(error: z.ZodError) {
  return NextResponse.json({
    success: false,
    code: 'INVALID_REQUEST',
    error: 'Request validation failed',
    issues: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    })),
    timestamp: new Date().toISOString(),
  }, { status: 422 });
}

function paperStateMetadata() {
  return {
    executionMode: 'PAPER_ONLY' as const,
    persistence: 'ephemeral-isolate' as const,
    durable: false,
    realBrokerConnected: false,
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = getQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) return invalidRequest(parsed.error);

    const { action, status, count } = parsed.data;
    const b = getBroker();

    if (action === 'summary') {
      return NextResponse.json({
        success: true,
        timestamp: new Date().toISOString(),
        summary: b.getPortfolioSummary(),
        brokerState: paperStateMetadata(),
      });
    }

    if (action === 'positions') {
      const positions = Array.from(b.getPositions().values()).map((position) => ({
        productId: position.productId,
        productName: position.productName,
        currency: position.currency,
        quantity: position.quantity,
        avgCostBasis: position.avgCostBasis,
        currentPrice: position.currentPrice,
        marketValue: position.marketValue,
        unrealizedPnL: position.unrealizedPnL,
        unrealizedPnLPct: position.unrealizedPnLPct,
        weight: position.weight,
        bucketId: position.bucketId,
        strategySource: position.strategySource,
      }));
      return NextResponse.json({ success: true, timestamp: new Date().toISOString(), positions, brokerState: paperStateMetadata() });
    }

    if (action === 'orders') {
      const orders = b.getOrders(status);
      return NextResponse.json({ success: true, timestamp: new Date().toISOString(), orders, brokerState: paperStateMetadata() });
    }

    const auditLog = b.getAuditLog(count);
    return NextResponse.json({ success: true, timestamp: new Date().toISOString(), auditLog, brokerState: paperStateMetadata() });
  } catch (error) {
    return NextResponse.json({
      success: false,
      code: 'PAPER_BROKER_READ_FAILED',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const startTime = Date.now();
  try {
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({
        success: false,
        code: 'INVALID_JSON',
        error: 'Request body must be valid JSON',
        timestamp: new Date().toISOString(),
      }, { status: 400 });
    }

    const parsed = postBodySchema.safeParse(rawBody);
    if (!parsed.success) return invalidRequest(parsed.error);
    const body = parsed.data;

    if (body.action === 'reset') {
      broker = new PaperBroker(body.capital, body.mepRate);
      logEvent({
        eventType: 'PAPER_TRADE_EXECUTED',
        source: '/api/paper-broker',
        data: { action: 'reset', capital: body.capital, mepRate: body.mepRate },
        success: true,
      });
      const telemetryStorage = await flushTelemetryWrites();
      return NextResponse.json({
        success: true,
        message: `Paper broker reset with $${body.capital} at MEP ${body.mepRate}`,
        timestamp: new Date().toISOString(),
        brokerState: paperStateMetadata(),
        telemetryStorage,
      });
    }

    if (body.action === 'submit-order') {
      const b = getBroker(body.mepRate);
      const order = b.submitOrder({
        productId: body.productId,
        productName: body.productName,
        side: body.side,
        targetWeight: body.targetWeight,
        orderType: body.orderType,
        limitPrice: body.limitPrice,
        strategySource: body.strategySource,
        bucketId: body.bucketId,
        regime: body.regime,
        confidence: body.confidence,
        currentPrice: body.currentPrice,
        currency: body.currency,
      });
      logEvent({
        eventType: 'PAPER_TRADE_EXECUTED',
        source: '/api/paper-broker',
        data: { orderId: order.id, status: order.status, productId: order.productId },
        success: order.status !== 'REJECTED',
        error: order.rejectionReason ?? undefined,
      });
      const telemetryStorage = await flushTelemetryWrites();
      return NextResponse.json({
        success: order.status !== 'REJECTED',
        order,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        brokerState: paperStateMetadata(),
        telemetryStorage,
      }, { status: order.status === 'REJECTED' ? 409 : 200 });
    }

    if (body.action === 'rebalance') {
      const b = getBroker(body.mepRate);
      const orders = b.executeRebalance(body.targetAllocations, body.regime, body.confidence);
      const success = orders.every((order) => order.status !== 'REJECTED');
      logEvent({
        eventType: 'PAPER_TRADE_EXECUTED',
        source: '/api/paper-broker',
        data: { action: 'rebalance', orderCount: orders.length, rejectedCount: orders.filter((order) => order.status === 'REJECTED').length },
        success,
      });
      const telemetryStorage = await flushTelemetryWrites();
      return NextResponse.json({
        success,
        orders,
        summary: b.getPortfolioSummary(),
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        brokerState: paperStateMetadata(),
        telemetryStorage,
      }, { status: success ? 200 : 409 });
    }

    const b = getBroker(body.mepRate);
    b.updatePrices(body.priceMap, body.mepRate);
    return NextResponse.json({
      success: true,
      summary: b.getPortfolioSummary(),
      timestamp: new Date().toISOString(),
      brokerState: paperStateMetadata(),
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      code: 'PAPER_BROKER_OPERATION_FAILED',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
