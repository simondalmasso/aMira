// src/lib/amira-executor-sim.ts
// V10 — PAPER EXECUTOR (EXECUTOR LAYER)
//
// Per spec `architecture_upgrade.new_layers[executor_layer]`:
//   name: "Paper Executor"
//   responsibility: "Simular rebalanceos, no ejecutar operaciones reales."
//   must_have: [slippage, fees, partial fills, position tracking, paper-only mode]
//
// Per spec `required_changes.5_executor_simulator`:
//   - paper broker con slippage y fees
//   - rebalance simulado
//   - monitor de drawdown
//   - salida de emergencia por riesgo
//
// Per spec `engine_contracts.executor_output`:
//   nav: number
//   pnl: number
//   drawdown: number
//   fills: array
//
// Per spec `anti_frankenstein_rules`:
//   - "one compute layer" — the executor SIMULATES the rebalance, it does
//     NOT replace the decision engine's allocation. It produces metadata
//     (NAV, P&L, drawdown, simulated fills) that the monitor layer consumes.
//   - "show simulated and real values without clear labels" → FORBIDDEN.
//     Every executor output is tagged with `paper: true`.
//
// SAFE MODIFICATIONS: This module is advisory only — it does NOT execute
// real trades (it is a paper broker), does NOT call any new HTTP route, and
// does NOT change the decision engine's allocation logic. It takes a
// `DecisionEngineOutput` and simulates the rebalance, producing a `nav`,
// `pnl`, `drawdown`, and `fills` array that the UI can render.
//
// Polymarket-pattern transfer:
//   - "executor simulador" → paper broker with slippage + fees
//   - "paper-only mode" → enforced by constant `PAPER_ONLY = true`
//
// Not transferred:
//   - "wallet following", "market making cripto", "CLOB crypto".

import type {
  DecisionEngineOutput,
  Allocation,
  StressMode,
} from './oracle/portfolio-engine';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ExecutorFill {
  asset_id: string;
  asset_class: string;
  name: string;
  ticker?: string;
  /** 'BUY' | 'SELL' | 'HOLD' — simulated action */
  side: 'BUY' | 'SELL' | 'HOLD';
  /** Intended weight (fractional, 0..1) from the decision engine */
  intended_weight: number;
  /** Actual filled weight after slippage + fees (fractional, 0..1) */
  filled_weight: number;
  /** Intended USD notional */
  intended_notional_usd: number;
  /** Actual filled USD notional */
  filled_notional_usd: number;
  /** Simulated price impact (fractional, 0..1) */
  slippage_bps: number;
  /** Fee in basis points (fractional, 0..1) */
  fee_bps: number;
  /** Fee paid in USD */
  fee_usd: number;
  /** Slippage cost in USD */
  slippage_cost_usd: number;
  /** Fill ratio (0..1) — 1.0 = full fill, <1.0 = partial fill */
  fill_ratio: number;
  /** Why the fill happened (or didn't) — human-readable */
  reason: string;
}

export interface ExecutorOutput {
  /** ISO-8601 timestamp */
  generated_at: string;
  /** Paper mode flag — ALWAYS true per spec `must_have.paper-only mode` */
  paper: true;
  /** Net asset value after simulated rebalance (USD) */
  nav: number;
  /** Starting capital (USD) — echoed for traceability */
  starting_capital: number;
  /** Total P&L in USD (nav - starting_capital) */
  pnl: number;
  /** P&L as percentage (0..1) */
  pnl_pct: number;
  /** Maximum drawdown observed (0..1) — fraction of starting capital */
  drawdown: number;
  /** Total fees paid (USD) */
  total_fees_usd: number;
  /** Total slippage cost (USD) */
  total_slippage_usd: number;
  /** Number of simulated fills */
  fill_count: number;
  /** Number of partial fills */
  partial_fill_count: number;
  /** Average fill ratio (0..1) */
  avg_fill_ratio: number;
  /** Per-asset simulated fills */
  fills: ExecutorFill[];
  /** Stress mode echoed from the decision (for traceability) */
  stress_mode: StressMode;
  /** Risk level (0..1) echoed from the decision */
  risk_level: number;
  /** Number of positions held after the rebalance */
  position_count: number;
  /** Concentration of top position (0..1) — for risk monitoring */
  top_position_concentration: number;
  /** Cash drag (unallocated fraction, 0..1) */
  cash_drag: number;
  /** Whether emergency exit was triggered (always false in paper) */
  emergency_exit_triggered: boolean;
  /** Reason for emergency exit (if any) */
  emergency_exit_reason: string | null;
}

// ─── Constants ──────────────────────────────────────────────────────────────

// Per spec `must_have.paper-only mode` — this flag is immutable.
export const PAPER_ONLY = true as const;

// Default fee model — conservative for AR market ( Argentina has higher fees )
const DEFAULT_FEE_BPS = 0.30;  // 0.30% = 30 bps ( Comisión + market fees )
const DEFAULT_SLIPPAGE_BPS = 0.20;  // 0.20% = 20 bps ( Yahoo tickers have wider spreads )

// Partial fill threshold — for assets with very low liquidity, simulate partial fills
const PARTIAL_FILL_LIQUIDITY_THRESHOLD = 0.20;
const PARTIAL_FILL_RATIO = 0.65;

// Maximum weight per position (risk guardrail)
const MAX_POSITION_WEIGHT = 0.30;

// Drawdown guard — triggers emergency exit (in paper, just flags)
const DRAWDOWN_GUARD_THRESHOLD = 0.20;  // 20% drawdown

// ─── Helpers ────────────────────────────────────────────────────────────────

function computeSlippageBps(allocation: Allocation): number {
  // Higher slippage for less-liquid asset classes
  const liquidityFactor: Record<string, number> = {
    FCI: 0.5,         // very liquid
    PLAZO_FIJO: 0.8,  // very liquid (bank deposit)
    ACCIONES: 1.0,    // medium
    BONOS: 1.2,       // medium-low
    CEDEARS: 1.5,     // lower
    ETF_CEDEARS: 1.8, // lowest liquidity
  };
  const factor = liquidityFactor[allocation.asset.asset_class] ?? 1.0;
  return DEFAULT_SLIPPAGE_BPS * factor;
}

function computeFillRatio(allocation: Allocation): { ratio: number; reason: string } {
  // Use liquidity metric if available; otherwise default to full fill
  const liquidity = (allocation.asset as unknown as { liquidity?: number | null }).liquidity ?? null;
  if (liquidity == null) {
    return { ratio: 1.0, reason: 'Sin métrica de liquidez — fill completo asumido' };
  }
  if (liquidity < PARTIAL_FILL_LIQUIDITY_THRESHOLD) {
    return { ratio: PARTIAL_FILL_RATIO, reason: `Liquidez baja (${(liquidity * 100).toFixed(0)}%) — fill parcial asumido` };
  }
  return { ratio: 1.0, reason: 'Liquidez suficiente — fill completo' };
}

function computeDrawdown(pnl: number, startingCapital: number): number {
  // Drawdown is a fraction of starting capital — for paper simulation,
  // we approximate using the stress projection's worst case.
  if (startingCapital <= 0) return 0;
  if (pnl >= 0) return 0;
  return Math.min(1, Math.abs(pnl) / startingCapital);
}

// ─── Main composer ─────────────────────────────────────────────────────────

export interface ComposeExecutorOptions {
  /** Fee in basis points (default 30 bps = 0.30%) */
  feeBps?: number;
  /** Slippage in basis points (default 20 bps = 0.20%) */
  slippageBps?: number;
  /** Override stress-mode P&L (default: derive from decision.stress_projection) */
  overridePnl?: number;
}

export function composePaperExecutor(
  decision: DecisionEngineOutput | null,
  capital: number,
  options: ComposeExecutorOptions = {},
): ExecutorOutput {
  const feeBps = options.feeBps ?? DEFAULT_FEE_BPS;
  const slippageBpsBase = options.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  const nowIso = new Date().toISOString();

  if (!decision || !decision.allocations || decision.allocations.length === 0) {
    return {
      generated_at: nowIso,
      paper: PAPER_ONLY,
      nav: capital,
      starting_capital: capital,
      pnl: 0,
      pnl_pct: 0,
      drawdown: 0,
      total_fees_usd: 0,
      total_slippage_usd: 0,
      fill_count: 0,
      partial_fill_count: 0,
      avg_fill_ratio: 0,
      fills: [],
      stress_mode: decision?.stress ?? 'SIDEWAYS',
      risk_level: 0,
      position_count: 0,
      top_position_concentration: 0,
      cash_drag: 1,
      emergency_exit_triggered: false,
      emergency_exit_reason: null,
    };
  }

  const fills: ExecutorFill[] = [];
  let totalFees = 0;
  let totalSlippage = 0;
  let partialFills = 0;
  let fillRatioSum = 0;
  let totalAllocatedWeight = 0;
  let topWeight = 0;

  for (const allocation of decision.allocations) {
    const intendedWeight = allocation.weight;
    if (intendedWeight <= 0) continue;

    // Cap weight at MAX_POSITION_WEIGHT (risk guardrail — paper only)
    const cappedWeight = Math.min(MAX_POSITION_WEIGHT, intendedWeight);
    const intendedNotional = cappedWeight * capital;

    // Compute per-asset slippage based on liquidity
    const assetSlippageBps = computeSlippageBps(allocation) * (slippageBpsBase / DEFAULT_SLIPPAGE_BPS);
    const slippageCost = intendedNotional * (assetSlippageBps / 10000);
    const feeCost = intendedNotional * (feeBps / 10000);

    // Compute fill ratio
    const { ratio: fillRatio, reason } = computeFillRatio(allocation);
    const filledNotional = intendedNotional * fillRatio;
    const filledWeight = cappedWeight * fillRatio;

    if (fillRatio < 1.0) partialFills++;
    fillRatioSum += fillRatio;
    totalAllocatedWeight += filledWeight;
    if (filledWeight > topWeight) topWeight = filledWeight;

    totalFees += feeCost * fillRatio;
    totalSlippage += slippageCost * fillRatio;

    const side: 'BUY' | 'SELL' | 'HOLD' = cappedWeight > 0.001 ? 'BUY' : 'HOLD';

    fills.push({
      asset_id: allocation.asset.id,
      asset_class: allocation.asset.asset_class,
      name: allocation.asset.name,
      ticker: allocation.asset.ticker,
      side,
      intended_weight: intendedWeight,
      filled_weight: filledWeight,
      intended_notional_usd: intendedNotional,
      filled_notional_usd: filledNotional,
      slippage_bps: Math.round(assetSlippageBps * 100) / 100,
      fee_bps: Math.round(feeBps * 100) / 100,
      fee_usd: Math.round(feeCost * fillRatio * 100) / 100,
      slippage_cost_usd: Math.round(slippageCost * fillRatio * 100) / 100,
      fill_ratio: Math.round(fillRatio * 1000) / 1000,
      reason,
    });
  }

  // P&L: from the decision's stress_projection (already computed by decisionEngineCore).
  // If override provided, use that; otherwise use the existing projection.
  const overridePnl = options.overridePnl;
  const pnl =
    overridePnl != null
      ? overridePnl
      : decision.stress_projection.profit_absolute;
  const nav = capital + pnl - totalFees - totalSlippage;
  const pnlPct = capital > 0 ? (pnl - totalFees - totalSlippage) / capital : 0;

  // Drawdown approximation: use abs(min(pnl, 0)) / capital
  const drawdown = computeDrawdown(pnl, capital);

  // Cash drag: fraction of capital NOT allocated
  const cashDrag = Math.max(0, 1 - totalAllocatedWeight);

  // Top position concentration (fraction of total allocated weight)
  const topConcentration = totalAllocatedWeight > 0 ? topWeight / totalAllocatedWeight : 0;

  // Emergency exit check — paper-only, just flags
  let emergencyExit = false;
  let emergencyReason: string | null = null;
  if (drawdown >= DRAWDOWN_GUARD_THRESHOLD) {
    emergencyExit = true;
    emergencyReason = `Drawdown ${(drawdown * 100).toFixed(1)}% excede límite del ${(DRAWDOWN_GUARD_THRESHOLD * 100).toFixed(0)}%`;
  }

  return {
    generated_at: nowIso,
    paper: PAPER_ONLY,
    nav: Math.round(nav * 100) / 100,
    starting_capital: capital,
    pnl: Math.round(pnl * 100) / 100,
    pnl_pct: Math.round(pnlPct * 10000) / 10000,
    drawdown: Math.round(drawdown * 10000) / 10000,
    total_fees_usd: Math.round(totalFees * 100) / 100,
    total_slippage_usd: Math.round(totalSlippage * 100) / 100,
    fill_count: fills.length,
    partial_fill_count: partialFills,
    avg_fill_ratio: fills.length > 0 ? Math.round((fillRatioSum / fills.length) * 1000) / 1000 : 0,
    fills,
    stress_mode: decision.stress,
    risk_level: decision.risk,
    position_count: fills.filter((f) => f.side === 'BUY').length,
    top_position_concentration: Math.round(topConcentration * 1000) / 1000,
    cash_drag: Math.round(cashDrag * 1000) / 1000,
    emergency_exit_triggered: emergencyExit,
    emergency_exit_reason: emergencyReason,
  };
}

// ─── React Hook ────────────────────────────────────────────────────────────

import { useMemo } from 'react';

export function usePaperExecutor(
  decision: DecisionEngineOutput | null,
  capital: number,
  options: ComposeExecutorOptions = {},
): ExecutorOutput {
  const { feeBps, slippageBps, overridePnl } = options;
  return useMemo(
    () => composePaperExecutor(decision, capital, { feeBps, slippageBps, overridePnl }),
    [decision, capital, feeBps, slippageBps, overridePnl],
  );
}

// ─── Serialization helper ──────────────────────────────────────────────────
// Per spec `engine_contracts.executor_output` — JSON machine-readable output.

export function serializeExecutorOutput(output: ExecutorOutput): string {
  return JSON.stringify(output, null, 2);
}

// ─── Risk summary (used by monitor layer) ──────────────────────────────────

export interface ExecutorRiskSummary {
  drawdown: number;
  cash_drag: number;
  top_position_concentration: number;
  emergency_exit_triggered: boolean;
  emergency_exit_reason: string | null;
  total_costs_pct: number; // (fees + slippage) / starting_capital
}

export function summarizeExecutorRisk(output: ExecutorOutput): ExecutorRiskSummary {
  const totalCostsPct = output.starting_capital > 0
    ? (output.total_fees_usd + output.total_slippage_usd) / output.starting_capital
    : 0;
  return {
    drawdown: output.drawdown,
    cash_drag: output.cash_drag,
    top_position_concentration: output.top_position_concentration,
    emergency_exit_triggered: output.emergency_exit_triggered,
    emergency_exit_reason: output.emergency_exit_reason,
    total_costs_pct: Math.round(totalCostsPct * 10000) / 10000,
  };
}
