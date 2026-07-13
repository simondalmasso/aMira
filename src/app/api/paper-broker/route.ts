// ============================================================================
// API ROUTE: /api/paper-broker — Paper trading broker endpoints
// ============================================================================

import { NextResponse } from 'next/server';
import { PaperBroker } from '@/lib/paper-broker';
import { logEvent } from '@/lib/telemetry';

// Singleton broker instance (resets on server restart — production would use DB)
let broker: PaperBroker | null = null;

function getBroker(mepRate: number = 1445): PaperBroker {
  if (!broker) {
    broker = new PaperBroker(2000, mepRate);
  }
  return broker;
}

export async function GET(request: Request) {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') ?? 'summary';

    switch (action) {
      case 'summary': {
        const b = getBroker();
        const summary = b.getPortfolioSummary();
        return NextResponse.json({
          success: true,
          timestamp: new Date().toISOString(),
          summary,
        });
      }

      case 'positions': {
        const b = getBroker();
        const positions = Array.from(b.getPositions().values()).map(p => ({
          productId: p.productId,
          productName: p.productName,
          currency: p.currency,
          quantity: p.quantity,
          avgCostBasis: p.avgCostBasis,
          currentPrice: p.currentPrice,
          marketValue: p.marketValue,
          unrealizedPnL: p.unrealizedPnL,
          unrealizedPnLPct: p.unrealizedPnLPct,
          weight: p.weight,
          bucketId: p.bucketId,
          strategySource: p.strategySource,
        }));
        return NextResponse.json({
          success: true,
          timestamp: new Date().toISOString(),
          positions,
        });
      }

      case 'orders': {
        const b = getBroker();
        const status = searchParams.get('status') as any;
        const orders = b.getOrders(status);
        return NextResponse.json({
          success: true,
          timestamp: new Date().toISOString(),
          orders,
        });
      }

      case 'audit': {
        const b = getBroker();
        const count = parseInt(searchParams.get('count') ?? '100');
        const auditLog = b.getAuditLog(count);
        return NextResponse.json({
          success: true,
          timestamp: new Date().toISOString(),
          auditLog,
        });
      }

      default:
        return NextResponse.json({
          success: false,
          error: `Unknown action: ${action}. Valid: summary, positions, orders, audit`,
        }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const startTime = Date.now();

  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'reset': {
        const capital = body.capital ?? 2000;
        const mepRate = body.mepRate ?? 1445;
        broker = new PaperBroker(capital, mepRate);
        logEvent({
          eventType: 'PAPER_TRADE_EXECUTED',
          source: '/api/paper-broker',
          data: { action: 'reset', capital, mepRate },
          success: true,
        });
        return NextResponse.json({
          success: true,
          message: `Paper broker reset with $${capital} at MEP ${mepRate}`,
          timestamp: new Date().toISOString(),
        });
      }

      case 'submit-order': {
        const b = getBroker(body.mepRate ?? 1445);
        const order = b.submitOrder({
          productId: body.productId,
          productName: body.productName,
          side: body.side,
          targetWeight: body.targetWeight,
          orderType: body.orderType,
          limitPrice: body.limitPrice,
          strategySource: body.strategySource ?? 'manual',
          bucketId: body.bucketId,
          regime: body.regime ?? 'NORMAL',
          confidence: body.confidence ?? 0.5,
          currentPrice: body.currentPrice,
          currency: body.currency,
        });

        logEvent({
          eventType: 'PAPER_TRADE_EXECUTED',
          source: '/api/paper-broker',
          data: { orderId: order.id, status: order.status, productId: order.productId },
          success: order.status !== 'REJECTED',
        });

        return NextResponse.json({
          success: order.status !== 'REJECTED',
          order,
          timestamp: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        });
      }

      case 'rebalance': {
        const b = getBroker(body.mepRate ?? 1445);
        const orders = b.executeRebalance(
          body.targetAllocations,
          body.regime ?? 'NORMAL',
          body.confidence ?? 0.5,
        );

        logEvent({
          eventType: 'PAPER_TRADE_EXECUTED',
          source: '/api/paper-broker',
          data: { action: 'rebalance', orderCount: orders.length },
          success: true,
        });

        return NextResponse.json({
          success: true,
          orders,
          summary: b.getPortfolioSummary(),
          timestamp: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        });
      }

      case 'update-prices': {
        const b = getBroker();
        b.updatePrices(body.priceMap, body.mepRate ?? 1445);
        return NextResponse.json({
          success: true,
          summary: b.getPortfolioSummary(),
          timestamp: new Date().toISOString(),
        });
      }

      default:
        return NextResponse.json({
          success: false,
          error: `Unknown action: ${action}. Valid: reset, submit-order, rebalance, update-prices`,
        }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
