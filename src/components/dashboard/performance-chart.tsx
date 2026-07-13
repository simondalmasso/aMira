'use client';

import { useHedgeFundStore } from '@/store/hedge-fund-store';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

export function PerformanceChart() {
  const { equityCurve, metrics, chartView, setChartView } = useHedgeFundStore();

  type ViewKey = 'usd' | 'ars' | 'real';
  const view = chartView as ViewKey;

  const chartData = equityCurve.slice(-30).map((point) => ({
    ...point,
    label: point.date.slice(5),
  }));

  const viewConfig = {
    usd: {
      key: 'valueUSD' as const,
      label: 'Valor USD',
      color: '#000000',
      gradientId: 'usdGrad',
    },
    ars: {
      key: 'valueARS' as const,
      label: 'Valor ARS',
      color: '#999999',
      gradientId: 'arsGrad',
    },
    real: {
      key: 'realReturn' as const,
      label: 'Retorno real %',
      color: '#000000',
      gradientId: 'realGrad',
    },
  };

  const current = viewConfig[view];
  const values = chartData.map(d => d[current.key] as number);
  const minVal = values.length > 0 ? Math.min(...values) : 0;
  const maxVal = values.length > 0 ? Math.max(...values) : 100;

  return (
    <div className="py-4">
      {/* Toggle Vista */}
      <div className="flex gap-1 mb-4 bg-[#f5f5f5] rounded-lg p-1">
        {(['usd', 'ars', 'real'] as ViewKey[]).map((v) => (
          <button
            key={v}
            onClick={() => setChartView(v)}
            className={`flex-1 py-2 rounded-md text-[11px] font-bold uppercase tracking-[0.15em] transition-all ${
              view === v
                ? 'bg-[#ffffff] text-[#000000]'
                : 'text-[#999999] hover:text-[#000000]'
            }`}
          >
            {v === 'usd' ? 'USD' : v === 'ars' ? 'ARS' : 'Real %'}
          </button>
        ))}
      </div>

      {/* Gráfico */}
      <div className="h-56 -ml-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <defs>
              <linearGradient id={current.gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={current.color} stopOpacity={0.06} />
                <stop offset="100%" stopColor={current.color} stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#eaeaea" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: '#999999', fontWeight: 600 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={[minVal * 0.998, maxVal * 1.002]}
              tick={{ fontSize: 10, fill: '#999999', fontWeight: 600 }}
              axisLine={false}
              tickLine={false}
              width={55}
              tickFormatter={(v: number) => view === 'real' ? `${v.toFixed(1)}%` : `$${v.toFixed(0)}`}
            />
            {view === 'real' && (
              <ReferenceLine y={0} stroke="#eaeaea" strokeDasharray="3 3" />
            )}
            <Tooltip
              contentStyle={{
                backgroundColor: '#000000',
                border: 'none',
                borderRadius: '8px',
                color: '#ffffff',
                fontSize: '11px',
                fontWeight: 700,
                padding: '8px 12px',
                letterSpacing: '0.05em',
              }}
              formatter={(value: number) => [
                view === 'real' ? `${value.toFixed(2)}%` : `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
                current.label,
              ]}
            />
            <Area
              type="monotone"
              dataKey={current.key}
              stroke={current.color}
              strokeWidth={2}
              fill={`url(#${current.gradientId})`}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Stats Performance — KPI compacto */}
      <div className="grid grid-cols-3 gap-2 mt-4">
        <StatBlock label="Real 30d" value={metrics?.expectedRealReturn30d} suffix="%" positive={metrics ? metrics.expectedRealReturn30d >= 0 : true} tag="PARTIAL_FALLBACK" />
        <StatBlock label="Real 90d" value={metrics?.expectedRealReturn90d} suffix="%" positive={metrics ? metrics.expectedRealReturn90d >= 0 : true} tag="PARTIAL_FALLBACK" />
        <StatBlock label="Sharpe" value={metrics?.sharpeRatio} suffix="" positive={metrics ? metrics.sharpeRatio >= 0 : true} tag="PARTIAL_FALLBACK" />
      </div>

      <div className="grid grid-cols-2 gap-2 mt-2">
        <div className="border border-[#eaeaea] rounded-lg p-3">
          <div className="flex items-center gap-1.5">
            <p className="text-[21px] font-extrabold text-[#000000] leading-none">{metrics?.volatility30d.toFixed(2) ?? '--'}%</p>
            <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-[#999999] text-[#ffffff]">PARTIAL_FALLBACK</span>
          </div>
          <p className="text-[10px] font-semibold text-[#999999] uppercase tracking-[0.2em] mt-1">Volatilidad 30d</p>
          <div className="mt-2 h-1.5 bg-[#f0f0f0] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#000000] rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, (metrics?.volatility30d || 0) * 10)}%` }}
            />
          </div>
        </div>
        <div className="border border-[#eaeaea] rounded-lg p-3">
          <div className="flex items-center gap-1.5">
            <p className="text-[21px] font-extrabold text-[#000000] leading-none">{metrics?.maxDrawdown30d.toFixed(2) ?? '--'}%</p>
            <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-[#999999] text-[#ffffff]">PARTIAL_FALLBACK</span>
          </div>
          <p className="text-[10px] font-semibold text-[#999999] uppercase tracking-[0.2em] mt-1">Máx. drawdown</p>
          <div className="mt-2 h-1.5 bg-[#f0f0f0] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#dc2626] rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, (metrics?.maxDrawdown30d || 0) * 20)}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatBlock({ label, value, suffix, positive, tag }: {
  label: string;
  value?: number;
  suffix: string;
  positive: boolean;
  tag: string;
}) {
  return (
    <div className="border border-[#eaeaea] rounded-lg p-3 text-center">
      <div className="flex items-center justify-center gap-1">
        <p className={`text-[21px] font-extrabold leading-none text-[#000000]`}>
          {value !== undefined ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}${suffix}` : '--'}
        </p>
        <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-[#999999] text-[#ffffff]">{tag}</span>
      </div>
      <p className="text-[10px] font-semibold text-[#999999] uppercase tracking-[0.2em] mt-1">{label}</p>
    </div>
  );
}
