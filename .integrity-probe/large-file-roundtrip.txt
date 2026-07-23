// src/components/dashboard/single-oracle-panel.tsx
// oracle_santander_v1_bloomberg_minimal — CANONICAL UI
//
// Per spec `ui_contract`:
//   single_dashboard_blocks: [
//     "MarketState",
//     "ScoreBoard",
//     "PredictionPanel",
//     "OutcomeComparison"
//   ]
//   forbidden: [
//     "duplicate_portfolio_value",
//     "multi_prediction_engines",
//     "multiple_scanner_layers"
//   ]
//
// Per spec `anti_frankenstein_rules`:
//   - "no_multi_scope_ui_duplicates"
//
// This is THE canonical panel — it renders ONE block per concept, sourced
// from the SINGLE engine (single-pass-oracle-engine). Legacy panels
// (multi-oracle-panel, fci-oracle-panel, etc.) are NOT removed; they
// continue to exist for backward compatibility. But this panel is the
// single canonical view per the spec.

'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Activity, Target, Gauge, AlertTriangle } from 'lucide-react';

interface SingleOracleResponse {
  success: boolean;
  vector: {
    timestamp: string;
    market_state: {
      timestamp: string;
      fx_mep: number;
      inflation_monthly: number;
      rates_tna: number;
      reserves_delta: number;
      risk_sentiment: number;
      liquidity_index: number;
      sources: string[];
      quality: string;
    };
    scores: Array<{
      asset: string;
      score: number;
      score_adjusted: number;
      regime: {
        regime: string;
        confidence: number;
        description: string;
      };
      prediction: {
        horizon_days: number;
        expected_return: number;
        confidence: number;
        risk_var_95: number;
      };
      action: string;
      breakdown: {
        contributions: {
          carry: number;
          inflation_hedge: number;
          fx_momentum: number;
          liquidity: number;
          risk_penalty: number;
        };
        weights: {
          carry: number;
          inflation_hedge: number;
          fx_momentum: number;
          liquidity: number;
          risk_penalty: number;
        };
      };
    }>;
    model_version: string;
  };
  learning: {
    total_verifications: number;
    mean_absolute_error: number;
    directional_accuracy_rate: number;
    mean_brier_score: number;
    last_update_timestamp: string | null;
  };
}

function pct(n: number, digits = 2): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${(n * 100).toFixed(digits)}%`;
}

function num(n: number, digits = 2): string {
  return n.toFixed(digits);
}

function qualityBadge(q: string): { bg: string; label: string } {
  switch (q) {
    case 'REAL': return { bg: 'bg-[#16a34a]', label: 'REAL' };
    case 'PARTIAL_FALLBACK': return { bg: 'bg-[#999999]', label: 'PARTIAL' };
    case 'STALE': return { bg: 'bg-[#dc2626]', label: 'STALE' };
    case 'ERROR': return { bg: 'bg-[#7f1d1d]', label: 'ERROR' };
    default: return { bg: 'bg-[#666]', label: q };
  }
}

function actionBadge(a: string): { bg: string; label: string } {
  switch (a) {
    case 'rebalance_signal': return { bg: 'bg-[#0066cc]', label: 'REBALANCE' };
    case 'hold_signal': return { bg: 'bg-[#666666]', label: 'HOLD' };
    case 'reduce_risk_signal': return { bg: 'bg-[#dc2626]', label: 'REDUCE RISK' };
    default: return { bg: 'bg-[#666]', label: a };
  }
}

// ─── BLOCK 1: MarketState ─────────────────────────────────────────────────
function MarketStateBlock({ state }: { state: SingleOracleResponse['vector']['market_state'] }) {
  const q = qualityBadge(state.quality);
  return (
    <div className="border border-[#e5e7eb] rounded-[8px] p-4 bg-white">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-[#0066cc]" />
          <h3 className="text-[14px] font-extrabold tracking-tight">MarketState</h3>
          <span className="text-[8px] text-[#999] font-mono">single source of truth</span>
        </div>
        <span className={`text-[9px] font-bold px-2 py-0.5 rounded text-white ${q.bg}`}>{q.label}</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-[11px]">
        <div>
          <div className="text-[9px] text-[#999] uppercase tracking-wide">FX MEP</div>
          <div className="font-mono font-bold text-[14px]">${num(state.fx_mep, 0)}</div>
        </div>
        <div>
          <div className="text-[9px] text-[#999] uppercase tracking-wide">Inflation m/o</div>
          <div className="font-mono font-bold text-[14px]">{pct(state.inflation_monthly, 1)}</div>
        </div>
        <div>
          <div className="text-[9px] text-[#999] uppercase tracking-wide">TNA</div>
          <div className="font-mono font-bold text-[14px]">{pct(state.rates_tna, 1)}</div>
        </div>
        <div>
          <div className="text-[9px] text-[#999] uppercase tracking-wide">Reserves Δ</div>
          <div className={`font-mono font-bold text-[14px] ${state.reserves_delta >= 0 ? 'text-[#16a34a]' : 'text-[#dc2626]'}`}>
            {state.reserves_delta >= 0 ? '+' : ''}{num(state.reserves_delta, 1)}B
          </div>
        </div>
        <div>
          <div className="text-[9px] text-[#999] uppercase tracking-wide">Risk sentiment</div>
          <div className="font-mono font-bold text-[14px]">{num(state.risk_sentiment, 2)}</div>
        </div>
        <div>
          <div className="text-[9px] text-[#999] uppercase tracking-wide">Liquidity</div>
          <div className="font-mono font-bold text-[14px]">{num(state.liquidity_index, 2)}</div>
        </div>
      </div>
      <div className="mt-3 pt-2 border-t border-[#f0f0f0] flex flex-wrap gap-1">
        {state.sources.map((s) => (
          <span key={s} className="text-[8px] font-mono bg-[#f5f5f5] px-1.5 py-0.5 rounded text-[#666]">{s}</span>
        ))}
      </div>
    </div>
  );
}

// ─── BLOCK 2: ScoreBoard ──────────────────────────────────────────────────
function ScoreBoardBlock({ score }: { score: SingleOracleResponse['vector']['scores'][0] }) {
  const a = actionBadge(score.action);
  const c = score.breakdown.contributions;
  const weights = score.breakdown.weights;
  const maxContribution = Math.max(0.01, ...Object.values(c).map((v) => Math.abs(v)));

  return (
    <div className="border border-[#e5e7eb] rounded-[8px] p-4 bg-white">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Gauge className="w-4 h-4 text-[#0066cc]" />
          <h3 className="text-[14px] font-extrabold tracking-tight">ScoreBoard — {score.asset}</h3>
          <span className="text-[8px] text-[#999] font-mono">one_score_per_asset</span>
        </div>
        <span className={`text-[9px] font-bold px-2 py-0.5 rounded text-white ${a.bg}`}>{a.label}</span>
      </div>

      <div className="flex items-end gap-4 mb-3">
        <div>
          <div className="text-[9px] text-[#999] uppercase tracking-wide">Raw score</div>
          <div className="font-mono font-extrabold text-[32px] leading-none">{num(score.score, 1)}</div>
        </div>
        <div>
          <div className="text-[9px] text-[#999] uppercase tracking-wide">Risk-adjusted</div>
          <div className="font-mono font-bold text-[22px] leading-none text-[#0066cc]">{num(score.score_adjusted, 1)}</div>
        </div>
        <div className="flex-1 text-right">
          <div className="text-[9px] text-[#999] uppercase tracking-wide">Regime</div>
          <div className="font-mono font-bold text-[12px]">{score.regime.regime}</div>
          <div className="text-[8px] text-[#999]">conf {(score.regime.confidence * 100).toFixed(0)}%</div>
        </div>
      </div>

      <div className="space-y-1.5">
        {([
          ['carry', c.carry, weights.carry],
          ['inflation_hedge', c.inflation_hedge, weights.inflation_hedge],
          ['fx_momentum', c.fx_momentum, weights.fx_momentum],
          ['liquidity', c.liquidity, weights.liquidity],
          ['risk_penalty', c.risk_penalty, weights.risk_penalty],
        ] as const).map(([key, value, w]) => {
          const pctWidth = (Math.abs(value) / maxContribution) * 100;
          const isNegative = value < 0;
          return (
            <div key={key} className="flex items-center gap-2 text-[10px]">
              <div className="w-24 font-mono text-[#666]">{key}</div>
              <div className="flex-1 h-3 bg-[#f5f5f5] rounded-sm relative overflow-hidden">
                <div
                  className={`h-full ${isNegative ? 'bg-[#dc2626]' : 'bg-[#16a34a]'}`}
                  style={{ width: `${pctWidth}%` }}
                />
              </div>
              <div className="w-16 text-right font-mono font-bold">
                {isNegative ? '' : '+'}{num(value, 4)}
              </div>
              <div className="w-10 text-right font-mono text-[9px] text-[#999]">w={num(w, 2)}</div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 pt-2 border-t border-[#f0f0f0]">
        <p className="text-[9px] text-[#666] italic">{score.regime.description}</p>
      </div>
    </div>
  );
}

// ─── BLOCK 3: PredictionPanel ─────────────────────────────────────────────
function PredictionBlock({ score }: { score: SingleOracleResponse['vector']['scores'][0] }) {
  const p = score.prediction;
  const isPositive = p.expected_return >= 0;
  return (
    <div className="border border-[#e5e7eb] rounded-[8px] p-4 bg-white">
      <div className="flex items-center gap-2 mb-3">
        <Target className="w-4 h-4 text-[#0066cc]" />
        <h3 className="text-[14px] font-extrabold tracking-tight">PredictionPanel — {p.horizon_days}d</h3>
        <span className="text-[8px] text-[#999] font-mono">single_horizon_forecast</span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="border border-[#f0f0f0] rounded-[6px] p-3">
          <div className="text-[9px] text-[#999] uppercase tracking-wide mb-1">Expected return</div>
          <div className={`flex items-center gap-1 font-mono font-extrabold text-[22px] leading-none ${isPositive ? 'text-[#16a34a]' : 'text-[#dc2626]'}`}>
            {isPositive ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
            {pct(p.expected_return, 2)}
          </div>
          <div className="text-[9px] text-[#999] mt-1">{p.horizon_days}d horizon</div>
        </div>

        <div className="border border-[#f0f0f0] rounded-[6px] p-3">
          <div className="text-[9px] text-[#999] uppercase tracking-wide mb-1">Confidence</div>
          <div className="font-mono font-extrabold text-[22px] leading-none">
            {(p.confidence * 100).toFixed(0)}<span className="text-[14px] text-[#999]">%</span>
          </div>
          <div className="mt-2 h-1.5 bg-[#f5f5f5] rounded-full overflow-hidden">
            <div className="h-full bg-[#0066cc]" style={{ width: `${p.confidence * 100}%` }} />
          </div>
        </div>

        <div className="border border-[#f0f0f0] rounded-[6px] p-3">
          <div className="text-[9px] text-[#999] uppercase tracking-wide mb-1">VaR 95% (30d)</div>
          <div className="flex items-center gap-1 font-mono font-extrabold text-[22px] leading-none text-[#dc2626]">
            <AlertTriangle className="w-4 h-4" />
            {pct(p.risk_var_95, 2)}
          </div>
          <div className="text-[9px] text-[#999] mt-1">worst-case 5%</div>
        </div>
      </div>
    </div>
  );
}

// ─── BLOCK 4: OutcomeComparison ───────────────────────────────────────────
function OutcomeComparisonBlock({ learning }: { learning: SingleOracleResponse['learning'] }) {
  const hitRate = (learning.directional_accuracy_rate * 100).toFixed(1);
  const maePct = (learning.mean_absolute_error * 100).toFixed(3);
  const brier = learning.mean_brier_score.toFixed(4);

  return (
    <div className="border border-[#e5e7eb] rounded-[8px] p-4 bg-white">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-[#0066cc]" />
          <h3 className="text-[14px] font-extrabold tracking-tight">OutcomeComparison</h3>
          <span className="text-[8px] text-[#999] font-mono">closed_loop_learning</span>
        </div>
        <span className="text-[9px] font-mono text-[#999]">
          n={learning.total_verifications} {learning.last_update_timestamp ? `· last ${new Date(learning.last_update_timestamp).toLocaleString('es-AR')}` : '· no verifications yet'}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <div className="text-[9px] text-[#999] uppercase tracking-wide mb-1">Hit rate (direction)</div>
          <div className="font-mono font-extrabold text-[22px] leading-none text-[#0066cc]">{hitRate}<span className="text-[14px]">%</span></div>
        </div>
        <div>
          <div className="text-[9px] text-[#999] uppercase tracking-wide mb-1">MAE</div>
          <div className="font-mono font-extrabold text-[22px] leading-none">{maePct}<span className="text-[14px] text-[#999]">%</span></div>
        </div>
        <div>
          <div className="text-[9px] text-[#999] uppercase tracking-wide mb-1">Brier score</div>
          <div className="font-mono font-extrabold text-[22px] leading-none">{brier}</div>
        </div>
      </div>

      <div className="mt-3 pt-2 border-t border-[#f0f0f0]">
        <p className="text-[9px] text-[#666] italic">
          Only verified predictions update model weights (per closed_loop_learning_v1 spec).
        </p>
      </div>
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────
export function SingleOraclePanel() {
  const [data, setData] = useState<SingleOracleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const fetchData = async () => {
      try {
        const res = await fetch('/api/oracle/single');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (mounted) {
          setData(json);
          setError(null);
        }
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'fetch failed');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 60000); // spec: refresh_mode interval_60s
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  if (loading && !data) {
    return (
      <div className="border border-[#e5e7eb] rounded-[8px] p-6 bg-white text-center">
        <div className="text-[12px] text-[#999]">Inicializando single-pass oracle engine…</div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="border border-[#dc2626] rounded-[8px] p-6 bg-white text-center">
        <div className="text-[12px] text-[#dc2626]">Error: {error}</div>
      </div>
    );
  }

  if (!data || !data.success || !data.vector) {
    return (
      <div className="border border-[#e5e7eb] rounded-[8px] p-6 bg-white text-center">
        <div className="text-[12px] text-[#999]">No data</div>
      </div>
    );
  }

  const sanScore = data.vector.scores[0];

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-3"
      data-testid="single-oracle-panel"
    >
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-[18px] font-extrabold tracking-tight">Santander Oracle v1 — Minimal Bloomberg</h2>
          <p className="text-[10px] text-[#999] font-mono">
            one_engine · one_loop · one_score · model: {data.vector.model_version}
          </p>
        </div>
        <div className="text-right">
          <div className="text-[9px] text-[#999]">Updated</div>
          <div className="text-[11px] font-mono">{new Date(data.vector.timestamp).toLocaleString('es-AR')}</div>
        </div>
      </div>

      {/* 4 canonical blocks per ui_contract.single_dashboard_blocks */}
      <MarketStateBlock state={data.vector.market_state} />
      {sanScore && <ScoreBoardBlock score={sanScore} />}
      {sanScore && <PredictionBlock score={sanScore} />}
      <OutcomeComparisonBlock learning={data.learning} />
    </motion.section>
  );
}
