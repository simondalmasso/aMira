'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { StrategicMode } from '@/lib/x10-strategy-layer';

// ============================================================================
// API Response Types (mirrors /api/x10 output)
// ============================================================================
interface X10Response {
  success: boolean;
  engine: string;
  timestamp: string;
  durationMs: number;
  data: {
    source: string;
    ageMinutes: number;
    realDataPct: number;
    hasError: boolean;
    allStale: boolean;
  };
  signals: {
    regime: string;
    aggregateConfidence: number;
    inflationTrend: string;
    carryViable: boolean;
    carrySpread: number;
    fisherRate: number;
    volatilityRegime: string;
    liquidityCondition: string;
    hasError: boolean;
    allStale: boolean;
  };
  portfolio_allocation: {
    productId: string;
    productName: string;
    weight: number;
    amountUSD: number;
    category: string;
    strategySource: string;
  }[];
  risk_metrics: {
    expectedReturn30d: number;
    expectedReturn90d: number;
    probabilityOfLoss: number;
    maxDrawdownEstimate: number;
    capitalAtRisk: number;
    sharpeEstimate: number;
    fisherRealRate: number;
    volatilityRegime: string;
    liquidityCondition: string;
    capitalPreservationPct: number;
  };
  confidence_score: number;
  scenario_downside: { probability: number; returnMin: number; returnMax: number; returnExpected: number; label: string };
  scenario_base: { probability: number; returnMin: number; returnMax: number; returnExpected: number; label: string };
  scenario_upside: { probability: number; returnMin: number; returnMax: number; returnExpected: number; label: string };
  execution: {
    mode: string;
    isPaperFirst: boolean;
    isLive: boolean;
    frozenReason: string | null;
  };
  x10: {
    confidenceThrottle: { active: boolean; aggregateConfidence: number; multiplier: number };
    capitalPreservationFallback: { active: boolean };
    emergencyFreeze: { active: boolean; reason: string | null };
    killSwitch: { active: boolean; reason: string | null };
    deRiskMode: { active: boolean; probabilityOfLoss: number };
  };
  strategicMode: StrategicMode;
  modeConfig: {
    riskCap: number;
    leverage: number;
    targetMonthlyReturn: number;
    maxDrawdown: number;
    capitalPreservation: number;
  };
}

// ============================================================================
// VISUAL CONFIG
// ============================================================================
const REGIME_STYLE: Record<string, { color: string; bg: string; icon: string; label: string }> = {
  CARRY_FAVORABLE: { color: '#16a34a', bg: 'bg-[#16a34a]', icon: '🟢', label: 'Carry Favorable' },
  CARRY_NEUTRAL: { color: '#16a34a', bg: 'bg-[#16a34a]', icon: '🟢', label: 'Carry Neutral' },
  WARNING: { color: '#ca8a04', bg: 'bg-[#ca8a04]', icon: '🟡', label: 'Alerta' },
  CRISIS: { color: '#dc2626', bg: 'bg-[#dc2626]', icon: '🔴', label: 'Crisis' },
  GLOBAL_RISK_OFF: { color: '#2563eb', bg: 'bg-[#2563eb]', icon: '🔵', label: 'Risk-Off Global' },
};

const VOL_STYLE: Record<string, { color: string; label: string }> = {
  calm: { color: '#16a34a', label: 'Calma' },
  normal: { color: '#16a34a', label: 'Normal' },
  elevated: { color: '#ca8a04', label: 'Elevada' },
  stressed: { color: '#dc2626', label: 'Estrés' },
  crisis: { color: '#dc2626', label: 'Crisis' },
};

const MODE_STYLE: Record<StrategicMode, { cls: string; short: string }> = {
  CONSERVATIVE: { cls: 'bg-[#16a34a] text-[#ffffff]', short: 'CON' },
  MODERATE: { cls: 'bg-[#ca8a04] text-[#ffffff]', short: 'MOD' },
  AGGRESSIVE: { cls: 'bg-[#dc2626] text-[#ffffff]', short: 'AGR' },
};

const SOURCE_STYLE: Record<string, string> = {
  OBSERVADO: 'bg-[#0066cc] text-[#ffffff]',
  REAL: 'bg-[#16a34a] text-[#ffffff]',
  PARTIAL_FALLBACK: 'bg-[#999999] text-[#ffffff]',
  SIMULADO: 'bg-[#ca8a04] text-[#ffffff]',
  STALE: 'bg-[#dc2626] text-[#ffffff]',
  ERROR: 'bg-[#7f1d1d] text-[#ffffff]',
};

const STRATEGY_LABELS: Record<string, string> = {
  carry_optimization: 'Carry ARS',
  mean_reversion_micro: 'Mean Rev.',
  rate_arbitrage_simulation: 'Arb. Tasas',
  usd_hedged_allocations: 'Cobertura USD',
  capital_preservation: 'Preservación',
};

export function X10EnginePanel() {
  const [data, setData] = useState<X10Response | null>(null);
  const [selectedMode, setSelectedMode] = useState<StrategicMode>('MODERATE');
  const [autoMode, setAutoMode] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const fetchEngine = useCallback(() => {
    setIsLoading(true);
    fetch(`/api/x10?mode=${selectedMode}&auto=${autoMode}`)
      .then(res => res.json())
      .then(d => { if (d.success) setData(d); })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [selectedMode, autoMode]);

  useEffect(() => { fetchEngine(); }, [fetchEngine]);

  // Auto-refresh every 60s
  useEffect(() => {
    const interval = setInterval(fetchEngine, 60000);
    return () => clearInterval(interval);
  }, [fetchEngine]);

  if (!data) {
    return (
      <div className="py-4 space-y-3 animate-pulse">
        <div className="h-20 bg-[#f5f5f5] rounded-xl" />
        <div className="grid grid-cols-3 gap-2">
          {[1,2,3].map(i => <div key={i} className="h-16 bg-[#f5f5f5] rounded-md" />)}
        </div>
      </div>
    );
  }

  const regimeStyle = REGIME_STYLE[data.signals.regime] || REGIME_STYLE.WARNING;
  const volStyle = VOL_STYLE[data.risk_metrics.volatilityRegime] || VOL_STYLE.normal;
  const isFrozen = data.execution.mode === 'FROZEN';

  return (
    <div className="space-y-3">
      {/* ═══ ENGINE HEADER ═══ */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-bold text-[#999999] uppercase tracking-[0.2em]">
            {data.engine}
          </span>
          <span className="text-[8px] font-medium text-[#bbbbbb]">
            {data.durationMs}ms
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${SOURCE_STYLE[data.data.source] || SOURCE_STYLE.SIMULADO}`}>
            {data.data.source}
          </span>
          <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${MODE_STYLE[data.strategicMode].cls}`}>
            {MODE_STYLE[data.strategicMode].short}
          </span>
        </div>
      </div>

      {/* ═══ STRATEGIC MODE SELECTOR ═══ */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] font-semibold text-[#999999] uppercase tracking-[0.15em]">Modo</span>
          <div className="flex gap-0.5 bg-[#f5f5f5] rounded-md p-0.5">
            {(['CONSERVATIVE', 'MODERATE', 'AGGRESSIVE'] as StrategicMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => { setSelectedMode(mode); setAutoMode(false); }}
                className={`px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-[0.08em] transition-all ${
                  !autoMode && selectedMode === mode
                    ? 'bg-[#000000] text-[#ffffff]'
                    : 'text-[#999999] hover:text-[#000000]'
                }`}
              >
                {MODE_STYLE[mode].short}
              </button>
            ))}
            <button
              onClick={() => setAutoMode(true)}
              className={`px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-[0.08em] transition-all ${
                autoMode
                  ? 'bg-[#2563eb] text-[#ffffff]'
                  : 'text-[#999999] hover:text-[#2563eb]'
              }`}
            >
              AUTO
            </button>
          </div>
        </div>
      </div>

      {/* ═══ KILL SWITCH / EMERGENCY BANNER ═══ */}
      <AnimatePresence>
        {(isFrozen || data.x10.killSwitch.active) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-[#7f1d1d] text-[#ffffff] rounded-lg px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <motion.div
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
                className="w-3 h-3 rounded-full bg-[#ffffff]"
              />
              <span className="text-[11px] font-bold uppercase tracking-[0.12em]">
                ENGINE FROZEN — {data.execution.frozenReason || data.x10.killSwitch.reason || 'Condición de seguridad activada'}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ REGIME + CONFIDENCE ═══ */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className={`relative rounded-xl p-4 border overflow-hidden ${
          data.signals.regime === 'CRISIS' ? 'border-[#dc2626]/30 bg-[#fef2f2]' :
          data.signals.regime === 'WARNING' ? 'border-[#ca8a04]/30 bg-[#fefce8]' :
          'border-[#eaeaea] bg-[#ffffff]'
        }`}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-[21px]">{regimeStyle.icon}</span>
            <div>
              <p className="text-[9px] font-semibold text-[#999999] uppercase tracking-[0.2em]">Régimen</p>
              <p className="text-[15px] font-extrabold text-[#000000]">{regimeStyle.label}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-semibold text-[#999999] uppercase tracking-[0.2em]">Confianza</p>
            <div className="flex items-center gap-1.5">
              <div className="w-16 h-1.5 bg-[#f0f0f0] rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${data.confidence_score * 100}%` }}
                  transition={{ duration: 0.8 }}
                  className="h-full rounded-full"
                  style={{ backgroundColor: regimeStyle.color }}
                />
              </div>
              <span className="text-[13px] font-bold text-[#000000]">
                {(data.confidence_score * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        </div>

        {/* Signal indicators */}
        <div className="grid grid-cols-5 gap-2">
          <SignalMini label="FX" value={data.signals.regime === 'CRISIS' || data.signals.regime === 'WARNING' ? 70 : 25} color={regimeStyle.color} />
          <SignalMini label="Inflación" value={data.signals.inflationTrend === 'accelerating' ? 75 : data.signals.inflationTrend === 'stable' ? 35 : 15} color="#ca8a04" />
          <SignalMini label="Carry" value={data.signals.carryViable ? 25 : 80} color={data.signals.carryViable ? '#16a34a' : '#dc2626'} />
          <SignalMini label="Volatilidad" value={VOL_STYLE[data.risk_metrics.volatilityRegime]?.label === 'Crisis' ? 90 : VOL_STYLE[data.risk_metrics.volatilityRegime]?.label === 'Elevada' ? 60 : 30} color={volStyle.color} />
          <SignalMini label="Liquidez" value={data.risk_metrics.liquidityCondition === 'stressed' || data.risk_metrics.liquidityCondition === 'frozen' ? 80 : 25} color={data.risk_metrics.liquidityCondition === 'stressed' ? '#dc2626' : '#16a34a'} />
        </div>
      </motion.div>

      {/* ═══ X10 DIRECTIVES STATUS ═══ */}
      <div className="border border-[#eaeaea] rounded-lg p-3">
        <p className="text-[9px] font-semibold text-[#999999] uppercase tracking-[0.2em] mb-2">
          Directivas X10
        </p>
        <div className="grid grid-cols-5 gap-2">
          <DirectiveBadge
            label="Acelerador"
            active={data.x10.confidenceThrottle.active}
            detail={data.x10.confidenceThrottle.active ? `${(data.x10.confidenceThrottle.multiplier * 100).toFixed(0)}%` : 'OFF'}
          />
          <DirectiveBadge
            label="Preserv."
            active={data.x10.capitalPreservationFallback.active}
            detail={data.x10.capitalPreservationFallback.active ? 'ON' : 'OFF'}
          />
          <DirectiveBadge
            label="Congelam."
            active={data.x10.emergencyFreeze.active}
            detail={data.x10.emergencyFreeze.active ? 'ON' : 'OFF'}
          />
          <DirectiveBadge
            label="Stop Total"
            active={data.x10.killSwitch.active}
            detail={data.x10.killSwitch.active ? 'ON' : 'OFF'}
          />
          <DirectiveBadge
            label="De-Risk"
            active={data.x10.deRiskMode.active}
            detail={`${(data.x10.deRiskMode.probabilityOfLoss * 100).toFixed(0)}%`}
          />
        </div>
      </div>

      {/* ═══ RISK METRICS ═══ */}
      <div className="grid grid-cols-4 gap-2">
        <MetricCard label="Retorno 30d" value={`${data.risk_metrics.expectedReturn30d >= 0 ? '+' : ''}${data.risk_metrics.expectedReturn30d.toFixed(2)}%`} positive={data.risk_metrics.expectedReturn30d > 0} />
        <MetricCard label="P(pérdida)" value={`${(data.risk_metrics.probabilityOfLoss * 100).toFixed(0)}%`} positive={data.risk_metrics.probabilityOfLoss < 0.15} />
        <MetricCard label="Máx. DD" value={`${data.risk_metrics.maxDrawdownEstimate.toFixed(1)}%`} positive={data.risk_metrics.maxDrawdownEstimate < 10} />
        <MetricCard label="Sharpe" value={data.risk_metrics.sharpeEstimate.toFixed(2)} positive={data.risk_metrics.sharpeEstimate > 0} />
      </div>

      {/* ═══ SCENARIO BOUNDS ═══ */}
      <div className="border border-[#eaeaea] rounded-lg p-3">
        <p className="text-[9px] font-semibold text-[#999999] uppercase tracking-[0.2em] mb-2">
          Escenarios probabilísticos
        </p>
        <div className="space-y-1.5">
          <ScenarioRow label="Bajista" prob={data.scenario_downside.probability} range={[data.scenario_downside.returnMin, data.scenario_downside.returnMax]} expected={data.scenario_downside.returnExpected} color="#dc2626" />
          <ScenarioRow label="Base" prob={data.scenario_base.probability} range={[data.scenario_base.returnMin, data.scenario_base.returnMax]} expected={data.scenario_base.returnExpected} color="#000000" />
          <ScenarioRow label="Alcista" prob={data.scenario_upside.probability} range={[data.scenario_upside.returnMin, data.scenario_upside.returnMax]} expected={data.scenario_upside.returnExpected} color="#16a34a" />
        </div>
      </div>

      {/* ═══ ALLOCATIONS ═══ */}
      <div className="border border-[#eaeaea] rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[9px] font-semibold text-[#999999] uppercase tracking-[0.2em]">
            Asignaciones
          </p>
          <div className="flex items-center gap-1">
            <span className="text-[8px] font-medium text-[#999999]">
              Preserv.: {data.risk_metrics.capitalPreservationPct}%
            </span>
          </div>
        </div>
        <div className="space-y-1">
          {data.portfolio_allocation.map((alloc) => (
            <AllocationRow key={alloc.productId} alloc={alloc} />
          ))}
        </div>
      </div>

      {/* ═══ FISHER RATE ═══ */}
      <div className="border border-[#eaeaea] rounded-lg p-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[9px] font-semibold text-[#999999] uppercase tracking-[0.2em]">
              Tasa Real Fisher
            </p>
            <p className="text-[9px] font-medium text-[#bbbbbb] mt-0.5">
              ((1+TNA/12)/(1+IPC))-1
            </p>
          </div>
          <p className={`text-[17px] font-extrabold ${
            data.risk_metrics.fisherRealRate > 0 ? 'text-[#16a34a]' : 'text-[#dc2626]'
          }`}>
            {data.risk_metrics.fisherRealRate > 0 ? '+' : ''}{(data.risk_metrics.fisherRealRate / 100).toFixed(3)}%
          </p>
        </div>
      </div>

      {/* ═══ EXECUTION STATUS ═══ */}
      <div className="flex items-center gap-2 px-1">
        <div className={`w-2 h-2 rounded-full ${
          data.execution.mode === 'FROZEN' ? 'bg-[#dc2626] animate-pulse' :
          data.execution.mode === 'PAPER_LIVE' ? 'bg-[#16a34a]' :
          'bg-[#ca8a04]'
        }`} />
        <div className="flex-1 h-px bg-[#eaeaea]" />
        <span className="text-[9px] font-bold text-[#999999] uppercase tracking-[0.15em]">
          {data.execution.mode}
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function SignalMini({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[8px] font-semibold text-[#999999] uppercase tracking-[0.1em]">{label}</span>
        <span className="text-[9px] font-bold text-[#000000]">{value}</span>
      </div>
      <div className="h-1 bg-[#f0f0f0] rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(100, value)}%` }}
          transition={{ duration: 0.6 }}
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
        />
      </div>
    </div>
  );
}

function DirectiveBadge({ label, active, detail }: { label: string; active: boolean; detail: string }) {
  return (
    <div className={`text-center py-1 px-1 rounded-md border ${
      active ? 'border-[#dc2626]/30 bg-[#fef2f2]' : 'border-[#eaeaea] bg-[#fafafa]'
    }`}>
      <p className="text-[8px] font-bold text-[#999999] uppercase tracking-[0.1em]">{label}</p>
      <p className={`text-[10px] font-extrabold ${
        active ? 'text-[#dc2626]' : 'text-[#16a34a]'
      }`}>
        {detail}
      </p>
    </div>
  );
}

function MetricCard({ label, value, positive }: { label: string; value: string; positive: boolean }) {
  return (
    <div className="border border-[#eaeaea] rounded-md p-2 text-center">
      <p className="text-[8px] font-semibold text-[#999999] uppercase tracking-[0.15em]">{label}</p>
      <p className={`text-[14px] font-extrabold ${
        positive ? 'text-[#16a34a]' : 'text-[#dc2626]'
      }`}>
        {value}
      </p>
    </div>
  );
}

function ScenarioRow({ label, prob, range, expected, color }: {
  label: string; prob: number; range: [number, number]; expected: number; color: string;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex items-center gap-1.5">
        <span className="text-[8px] font-bold px-1 py-0.5 rounded" style={{ backgroundColor: color, color: '#ffffff' }}>
          {label.toUpperCase().slice(0, 4)}
        </span>
        <span className="text-[9px] font-bold text-[#000000]">{(prob * 100).toFixed(0)}%</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold text-[#000000]">
          {range[0] >= 0 ? '+' : ''}{range[0].toFixed(1)}% a {range[1] >= 0 ? '+' : ''}{range[1].toFixed(1)}%
        </span>
        <span className="text-[9px] font-bold" style={{ color }}>
          E={expected >= 0 ? '+' : ''}{expected.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

function AllocationRow({ alloc }: {
  alloc: { productId: string; productName: string; weight: number; amountUSD: number; category: string; strategySource: string };
}) {
  const stratLabel = STRATEGY_LABELS[alloc.strategySource] || alloc.strategySource;
  const weightPct = (alloc.weight * 100).toFixed(1);

  return (
    <div className="flex items-center justify-between py-1 border-b border-[#f5f5f5] last:border-0">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <p className="text-[11px] font-bold text-[#000000]">{alloc.productName}</p>
          <div className="flex items-center gap-1">
            <span className="text-[8px] font-semibold text-[#999999]">{alloc.category}</span>
            <span className="text-[8px] font-medium text-[#bbbbbb]">·</span>
            <span className="text-[8px] font-semibold text-[#2563eb]">{stratLabel}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-12 h-1 bg-[#f0f0f0] rounded-full overflow-hidden">
          <div
            className="h-full bg-[#000000] rounded-full"
            style={{ width: `${Math.min(100, alloc.weight * 200)}%` }}
          />
        </div>
        <span className="text-[11px] font-extrabold text-[#000000] w-10 text-right">{weightPct}%</span>
        <span className="text-[9px] font-medium text-[#999999] w-14 text-right">${alloc.amountUSD.toFixed(2)}</span>
      </div>
    </div>
  );
}
