// src/components/dashboard/single-oracle-panel.tsx
// Canonical four-block UI for /api/oracle/single. Null/partial states are explicit.

'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Activity, AlertTriangle, Gauge, Target, TrendingDown, TrendingUp } from 'lucide-react';
import type { OracleSingleResponse, OracleSingleSuccessResponse } from '@/lib/oracle/single-response';

function pct(value: number, digits = 2): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(digits)}%`;
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="border border-[#e5e7eb] rounded-[8px] p-4 bg-white">{children}</div>;
}

function MarketStateBlock({ data }: { data: OracleSingleSuccessResponse }) {
  const state = data.vector.market_state;
  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2"><Activity className="w-4 h-4 text-[#0066cc]" /><h3 className="text-[14px] font-extrabold">MarketState</h3></div>
        <span className="text-[9px] font-mono text-[#666]">{state.quality}</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-[11px] font-mono">
        <div>FX MEP <b>${state.fx_mep.toFixed(0)}</b></div>
        <div>Inflation <b>{pct(state.inflation_monthly, 1)}</b></div>
        <div>TNA <b>{pct(state.rates_tna, 1)}</b></div>
        <div>Reserves Δ <b>{state.reserves_delta.toFixed(1)}</b></div>
        <div>Risk <b>{state.risk_sentiment.toFixed(2)}</b></div>
        <div>Liquidity <b>{state.liquidity_index.toFixed(2)}</b></div>
      </div>
      <div className="mt-3 text-[8px] font-mono text-[#777]">{state.sources.join(' · ')}</div>
    </Card>
  );
}

function ScoreBoardBlock({ data }: { data: OracleSingleSuccessResponse }) {
  const score = data.vector.scores.find((item) => item.asset === 'SAN') ?? null;
  if (!score) {
    return <Card><div className="text-[11px] text-[#854d0e] font-mono">ScoreBoard unavailable · NO_PRIMARY_SCORE</div></Card>;
  }
  return (
    <Card>
      <div className="flex items-center gap-2 mb-3"><Gauge className="w-4 h-4 text-[#0066cc]" /><h3 className="text-[14px] font-extrabold">ScoreBoard — {score.asset}</h3></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono">
        <div><div className="text-[9px] text-[#999]">RAW</div><b className="text-[22px]">{score.score.toFixed(1)}</b></div>
        <div><div className="text-[9px] text-[#999]">ADJUSTED</div><b className="text-[22px] text-[#0066cc]">{score.score_adjusted.toFixed(1)}</b></div>
        <div><div className="text-[9px] text-[#999]">REGIME</div><b>{score.regime.regime}</b></div>
        <div><div className="text-[9px] text-[#999]">ACTION</div><b>{score.action}</b></div>
      </div>
    </Card>
  );
}

function PredictionBlock({ data }: { data: OracleSingleSuccessResponse }) {
  const score = data.vector.scores.find((item) => item.asset === 'SAN') ?? null;
  if (!score) return null;
  const prediction = score.prediction;
  const positive = prediction.expected_return >= 0;
  return (
    <Card>
      <div className="flex items-center gap-2 mb-3"><Target className="w-4 h-4 text-[#0066cc]" /><h3 className="text-[14px] font-extrabold">PredictionPanel — {prediction.horizon_days}d</h3></div>
      <div className="grid grid-cols-3 gap-3 font-mono">
        <div><div className="text-[9px] text-[#999]">EXPECTED RETURN</div><div className={`flex items-center gap-1 font-extrabold ${positive ? 'text-[#16a34a]' : 'text-[#dc2626]'}`}>{positive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}{pct(prediction.expected_return)}</div></div>
        <div><div className="text-[9px] text-[#999]">CONFIDENCE</div><b>{(prediction.confidence * 100).toFixed(0)}%</b></div>
        <div><div className="text-[9px] text-[#999]">VAR 95%</div><div className="flex items-center gap-1 text-[#dc2626]"><AlertTriangle className="w-4 h-4" /><b>{pct(prediction.risk_var_95)}</b></div></div>
      </div>
    </Card>
  );
}

function OutcomeComparisonBlock({ data }: { data: OracleSingleSuccessResponse }) {
  const learning = data.learning;
  const hit = learning.directional_accuracy_rate === null ? '—' : `${(learning.directional_accuracy_rate * 100).toFixed(1)}%`;
  const mae = learning.mean_absolute_error === null ? '—' : `${(learning.mean_absolute_error * 100).toFixed(3)}%`;
  const brier = learning.mean_brier_score === null ? '—' : learning.mean_brier_score.toFixed(4);
  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2"><Activity className="w-4 h-4 text-[#0066cc]" /><h3 className="text-[14px] font-extrabold">OutcomeComparison</h3></div>
        <span className="text-[9px] font-mono text-[#777]">{learning.status} · n={learning.sampleCount}</span>
      </div>
      <div className="grid grid-cols-3 gap-3 font-mono">
        <div><div className="text-[9px] text-[#999]">HIT RATE</div><b>{hit}</b></div>
        <div><div className="text-[9px] text-[#999]">MAE</div><b>{mae}</b></div>
        <div><div className="text-[9px] text-[#999]">BRIER</div><b>{brier}</b></div>
      </div>
      {learning.status === 'NO_HISTORY' && <p className="mt-3 text-[9px] text-[#777] italic">No verified prediction history yet; learning metrics are intentionally unavailable.</p>}
    </Card>
  );
}

export function SingleOraclePanel() {
  const [data, setData] = useState<OracleSingleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const response = await fetch('/api/oracle/single');
        const payload = await response.json() as OracleSingleResponse;
        if (!mounted) return;
        setData(payload);
        setError(response.ok ? null : payload.success ? `HTTP ${response.status}` : payload.error);
      } catch {
        if (mounted) setError('Oracle response unavailable');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    const interval = setInterval(() => void load(), 60_000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  if (loading && !data) return <Card><div className="text-[12px] text-[#999]">Inicializando single-pass oracle engine…</div></Card>;
  if (!data) return <Card><div className="text-[12px] text-[#dc2626]">{error ?? 'No data'}</div></Card>;
  if (!data.success) return <Card><div className="text-[12px] text-[#dc2626]">{data.error}</div></Card>;

  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3" data-testid="single-oracle-panel">
      <div className="flex items-center justify-between">
        <div><h2 className="text-[18px] font-extrabold">Santander Oracle v1 — Minimal Bloomberg</h2><p className="text-[10px] text-[#999] font-mono">one_engine · one_loop · one_score · {data.vector.model_version}</p></div>
        <div className="text-[10px] font-mono text-[#777]">{new Date(data.timestamp).toLocaleString('es-AR')}</div>
      </div>
      {data.status === 'PARTIAL' && <div className="border border-[#eab308] rounded-[8px] px-3 py-2 bg-[#fefce8] text-[10px] text-[#854d0e] font-mono">PARTIAL · {data.warnings.join(', ')}</div>}
      <MarketStateBlock data={data} />
      <ScoreBoardBlock data={data} />
      <PredictionBlock data={data} />
      <OutcomeComparisonBlock data={data} />
    </motion.section>
  );
}
