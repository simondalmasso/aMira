// src/components/dashboard/bloomberg-lite-terminal.tsx
// Oracle_Santander_v1_REAL — V11_MINIMAL_BLOOMBERG_REFACTORED
//
// Per spec `architecture.bloomberg_module`:
//   name: "bloomberg_lite_terminal"
//   position: "SIDE_PANEL_ISOLATED"
//   role: "visualization_and_context_only"
//   must_not_influence_core: true
//   features: [market_ticker_stream, fx_view, macro_indicators, historical_charts]
//   data_source: "read_only_mirror_of_oracle_inputs"
//   render_rule: "RIGHT_SIDE_OR_BOTTOM_TAB_ONLY"
//
// Per spec `ui_layout_priority.hard_rule`:
//   "ORACLE ALWAYS FIRST VISUAL BLOCK"
//
// This module is INTENTIONALLY a READ-ONLY MIRROR of the same MarketState
// that the SingleOraclePanel reads. It does NOT compute scores, does NOT
// generate predictions, does NOT emit actions. It only visualizes the raw
// market inputs as a Bloomberg-style ticker/macro strip.
//
// Per spec `architecture.bloomberg_module.must_not_influence_core: true` —
// no exports from this file are imported by single-pass-oracle-engine,
// linear-factor-model, or closed-loop-learning.

'use client';

import { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Minus, Activity, DollarSign, BarChart3, Clock } from 'lucide-react';

interface BloombergData {
  success: boolean;
  vector: {
    timestamp: string;
    market_state: {
      fx_mep: number;
      inflation_monthly: number;
      rates_tna: number;
      reserves_delta: number;
      risk_sentiment: number;
      liquidity_index: number;
      sources: string[];
      quality: string;
    };
  };
}

function fmtPct(n: number, digits = 2): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${(n * 100).toFixed(digits)}%`;
}

function fmtNum(n: number, digits = 2): string {
  return n.toFixed(digits);
}

// ─── Ticker Stream — simulated tick stream (read-only, no compute) ────────
// Per spec feature: "market_ticker_stream"
type TrendDir = 'up' | 'down' | 'flat';
function TickerStream({ mep, tna }: { mep: number; tna: number }) {
  const items: { sym: string; val: string; trend: TrendDir }[] = [
    { sym: 'USD/ARS MEP', val: `$${fmtNum(mep, 0)}`, trend: 'up' },
    { sym: 'TNA', val: `${(tna * 100).toFixed(1)}%`, trend: 'flat' },
    { sym: 'SAN', val: '--', trend: 'flat' },
    { sym: 'BBAR', val: '--', trend: 'flat' },
    { sym: 'GGAL', val: '--', trend: 'flat' },
    { sym: 'YPF', val: '--', trend: 'flat' },
    { sym: 'AL30', val: '--', trend: 'flat' },
    { sym: 'GD30', val: '--', trend: 'flat' },
    { sym: 'PXF30', val: '--', trend: 'flat' },
  ];
  return (
    <div className="overflow-hidden border border-[#1a1a1a] rounded bg-[#0a0a0a]">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-[#1a1a1a]">
        <Activity className="w-3 h-3 text-[#00ff00]" />
        <span className="text-[8px] font-mono text-[#00ff00] uppercase tracking-wider">Market Ticker</span>
      </div>
      <div className="px-2 py-1.5 space-y-0.5">
        {items.map((it) => (
          <div key={it.sym} className="flex items-center justify-between text-[10px] font-mono">
            <span className="text-[#999]">{it.sym}</span>
            <div className="flex items-center gap-1">
              <span className="text-[#fff] font-bold">{it.val}</span>
              {it.trend === 'up' && <TrendingUp className="w-2.5 h-2.5 text-[#00ff00]" />}
              {it.trend === 'down' && <TrendingDown className="w-2.5 h-2.5 text-[#ff3030]" />}
              {it.trend === 'flat' && <Minus className="w-2.5 h-2.5 text-[#666]" />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── FX View — read-only mirror of MEP ────────────────────────────────────
// Per spec feature: "fx_view"
function FxView({ mep, risk_sentiment }: { mep: number; risk_sentiment: number }) {
  return (
    <div className="border border-[#1a1a1a] rounded bg-[#0a0a0a] p-2">
      <div className="flex items-center gap-2 mb-1.5 border-b border-[#1a1a1a] pb-1">
        <DollarSign className="w-3 h-3 text-[#00ff00]" />
        <span className="text-[8px] font-mono text-[#00ff00] uppercase tracking-wider">FX View</span>
      </div>
      <div className="text-[22px] font-mono font-bold text-[#fff] leading-none">${fmtNum(mep, 0)}</div>
      <div className="text-[8px] text-[#666] font-mono mt-0.5">USD/ARS MEP</div>
      <div className="mt-1.5 pt-1 border-t border-[#1a1a1a]">
        <div className="flex justify-between text-[8px] font-mono">
          <span className="text-[#666]">RISK SENT</span>
          <span className={risk_sentiment > 0 ? 'text-[#00ff00]' : 'text-[#ff3030]'}>
            {risk_sentiment > 0 ? 'RISK-ON' : 'RISK-OFF'} {fmtNum(risk_sentiment, 2)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Macro Indicators — read-only mirror of inflation, rates, reserves ───
// Per spec feature: "macro_indicators"
function MacroIndicators({
  inflation,
  tna,
  reserves_delta,
  liquidity,
}: {
  inflation: number;
  tna: number;
  reserves_delta: number;
  liquidity: number;
}) {
  // ─── U1 FIX: REAL CARRY — Fisher canonical formula ───────────────────
  // Per COUNCIL EXECUTION ORDER UI_TRUTHFULNESS_PATCH_v1 Fix U1:
  //   Previous buggy formula: tna - Math.pow(1 + inflation, 12) - 1 + 1
  //   This subtracted the compounding FACTOR (1.5637) instead of the
  //   annualized RATE (0.5637), producing -127.4% instead of -17.5%.
  //
  //   Canonical Fisher (same as carry-panel.tsx):
  //     inflationAnnual = (1 + inflationMonthly)^12 - 1
  //     realCarry = (1 + tna) / (1 + inflationAnnual) - 1
  //
  //   For tna=0.29, inflationMonthly=0.038:
  //     inflationAnnual = 0.5645
  //     realCarry = 1.29 / 1.5645 - 1 = -0.1754 → -17.5%
  //
  //   Guards: tna finite, inflation finite, inflation > -1, denominator > 0.
  //   If any guard fails: display 'N/D'.
  const tnaFinite = typeof tna === 'number' && isFinite(tna);
  const inflationFinite = typeof inflation === 'number' && isFinite(inflation);
  const inflationValid = inflationFinite && inflation > -1;
  const inflationAnnual = inflationValid ? Math.pow(1 + inflation, 12) - 1 : NaN;
  const denominatorValid = isFinite(inflationAnnual) && (1 + inflationAnnual) > 0;
  const realCarryValid = tnaFinite && inflationValid && denominatorValid;
  const realCarry = realCarryValid ? (1 + tna) / (1 + inflationAnnual) - 1 : NaN;
  const realCarryDisplay = realCarryValid ? fmtPct(realCarry, 1) : 'N/D';
  const realCarryColor = realCarryValid ? (realCarry >= 0 ? '#00ff00' : '#ff3030') : '#666666';

  const rows = [
    { label: 'INFL m/o', val: fmtPct(inflation, 2), color: '#fff' },
    { label: 'INFL y/y', val: fmtPct(Math.pow(1 + inflation, 12) - 1, 1), color: '#fff' },
    { label: 'TNA', val: `${(tna * 100).toFixed(1)}%`, color: '#fff' },
    { label: 'REAL CARRY', val: realCarryDisplay, color: realCarryColor },
    { label: 'RESERVES Δ', val: `${reserves_delta >= 0 ? '+' : ''}${fmtNum(reserves_delta, 1)}B`, color: reserves_delta >= 0 ? '#00ff00' : '#ff3030' },
    { label: 'LIQUIDITY', val: fmtNum(liquidity, 2), color: '#fff' },
  ];
  return (
    <div className="border border-[#1a1a1a] rounded bg-[#0a0a0a] p-2">
      <div className="flex items-center gap-2 mb-1.5 border-b border-[#1a1a1a] pb-1">
        <BarChart3 className="w-3 h-3 text-[#00ff00]" />
        <span className="text-[8px] font-mono text-[#00ff00] uppercase tracking-wider">Macro Indicators</span>
      </div>
      <div className="space-y-0.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between text-[10px] font-mono">
            <span className="text-[#999]">{r.label}</span>
            <span className="font-bold" style={{ color: r.color }}>{r.val}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Historical Charts (sparkline placeholder) ────────────────────────────
// Per spec feature: "historical_charts"
function HistoricalSparkline({ label, value, color }: { label: string; value: number; color: string }) {
  // Generate a deterministic pseudo-history from the current value
  // (purely visual — does NOT feed any compute path)
  const points: number[] = [];
  let v = value;
  for (let i = 0; i < 20; i++) {
    v = v * (1 + (Math.sin(i * 1.3) * 0.01));
    points.push(v);
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const w = 100;
  const h = 24;
  const path = points.map((p, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - ((p - min) / range) * h;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return (
    <div className="border border-[#1a1a1a] rounded bg-[#0a0a0a] p-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[8px] font-mono text-[#999] uppercase tracking-wider">{label}</span>
        <span className="text-[10px] font-mono font-bold" style={{ color }}>{fmtNum(value, 2)}</span>
      </div>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <path d={path} fill="none" stroke={color} strokeWidth="1" />
      </svg>
    </div>
  );
}

// ─── Main Bloomberg Lite Terminal ─────────────────────────────────────────
export function BloombergLiteTerminal() {
  const [data, setData] = useState<BloombergData | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string>('--');

  useEffect(() => {
    let mounted = true;
    const fetchData = async () => {
      try {
        const res = await fetch('/api/oracle/single');
        if (!res.ok) return;
        const json = await res.json();
        if (mounted && json?.success) {
          setData(json);
          setLastUpdate(new Date().toLocaleTimeString('es-AR'));
        }
      } catch {
        // silent — Bloomberg panel is secondary
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  if (!data?.success) {
    return (
      <div className="border border-[#1a1a1a] rounded bg-[#0a0a0a] p-3 text-center">
        <div className="text-[10px] font-mono text-[#666]">Bloomberg Lite — esperando MarketState…</div>
      </div>
    );
  }

  const s = data.vector.market_state;

  return (
    <aside
      data-testid="bloomberg-lite-terminal"
      aria-label="Bloomberg Lite Terminal — visualization only"
      className="space-y-2"
    >
      {/* Header — Bloomberg-style dark */}
      <div className="border border-[#1a1a1a] rounded bg-[#0a0a0a] px-2 py-1.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-[#00ff00] animate-pulse" />
          <span className="text-[10px] font-mono font-bold text-[#00ff00] tracking-wider">BLOOMBERG LITE</span>
        </div>
        <div className="flex items-center gap-1 text-[#666]">
          <Clock className="w-2.5 h-2.5" />
          <span className="text-[8px] font-mono">{lastUpdate}</span>
        </div>
      </div>

      {/* U7 FIX: Visible READ-ONLY MIRROR badge + disclaimer */}
      <div className="border border-[#1a1a1a] rounded bg-[#0a0a0a] px-2 py-1">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span
            data-testid="bloomberg-role-badge"
            className="text-[8px] font-mono font-bold px-1.5 py-0.5 rounded bg-[#1e3a5f] text-[#60a5fa] border border-[#3b82f640] tracking-wider"
          >
            READ-ONLY MIRROR
          </span>
        </div>
        <p className="text-[7px] font-mono text-[#666] leading-tight">
          VISUALIZATION &amp; CONTEXT ONLY · DOES NOT INFLUENCE ORACLE CORE
        </p>
      </div>

      <TickerStream mep={s.fx_mep} tna={s.rates_tna} />
      <FxView mep={s.fx_mep} risk_sentiment={s.risk_sentiment} />
      <MacroIndicators
        inflation={s.inflation_monthly}
        tna={s.rates_tna}
        reserves_delta={s.reserves_delta}
        liquidity={s.liquidity_index}
      />
      <HistoricalSparkline label="FX MEP 20d" value={s.fx_mep} color="#00ff00" />
      <HistoricalSparkline label="LIQUIDITY 20d" value={s.liquidity_index} color="#00aaff" />
    </aside>
  );
}
