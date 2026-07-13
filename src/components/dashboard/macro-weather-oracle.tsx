'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useHedgeFundStore, type RiskAppetite, type ReturnTargetMode } from '@/store/hedge-fund-store';
import {
  type OracleState,
  type MacroRegime,
  type ProjectionOutput,
  type ProjectionScenario,
  computeOracle,
  computeProjections,
  REGIME_LABELS,
  REGIME_ICONS,
  REGIME_COLORS,
  RETURN_TARGETS,
} from '@/lib/macroOracle';
import {
  type RebalanceOracleOutput,
  computeRebalance,
} from '@/lib/rebalanceOracle';
import { type MacroState } from '@/lib/live-data';

// ============================================================================
// REGIME CONFIG — visual mapping with subtle color accents
// ============================================================================
const REGIME_CONFIG: Record<MacroRegime, {
  color: string;
  bgGradient: string;
  radarColor: string;
  icon: string;
  accentBorder: string;
  accentText: string;
}> = {
  CARRY: {
    color: '#000000',
    bgGradient: 'from-[#f0faf0] to-[#ffffff]',
    radarColor: '#16a34a',
    icon: '🟢',
    accentBorder: 'border-[#16a34a]/20',
    accentText: 'text-[#16a34a]',
  },
  CARRY_FAVORABLE: {
    color: '#000000',
    bgGradient: 'from-[#ecfdf5] to-[#ffffff]',
    radarColor: '#059669',
    icon: '💚',
    accentBorder: 'border-[#059669]/20',
    accentText: 'text-[#059669]',
  },
  NORMAL: {
    color: '#000000',
    bgGradient: 'from-[#f9fafb] to-[#ffffff]',
    radarColor: '#6b7280',
    icon: '⚪',
    accentBorder: 'border-[#6b7280]/20',
    accentText: 'text-[#6b7280]',
  },
  WARNING: {
    color: '#000000',
    bgGradient: 'from-[#fefce8] to-[#ffffff]',
    radarColor: '#ca8a04',
    icon: '🟡',
    accentBorder: 'border-[#ca8a04]/20',
    accentText: 'text-[#ca8a04]',
  },
  HIGH_VOL: {
    color: '#000000',
    bgGradient: 'from-[#fff7ed] to-[#ffffff]',
    radarColor: '#ea580c',
    icon: '🟠',
    accentBorder: 'border-[#ea580c]/20',
    accentText: 'text-[#ea580c]',
  },
  CRISIS: {
    color: '#000000',
    bgGradient: 'from-[#fef2f2] to-[#ffffff]',
    radarColor: '#dc2626',
    icon: '🔴',
    accentBorder: 'border-[#dc2626]/20',
    accentText: 'text-[#dc2626]',
  },
  GLOBAL_RISK_OFF: {
    color: '#000000',
    bgGradient: 'from-[#eff6ff] to-[#ffffff]',
    radarColor: '#2563eb',
    icon: '🔵',
    accentBorder: 'border-[#2563eb]/20',
    accentText: 'text-[#2563eb]',
  },
};

const RISK_BAND_CONFIG: Record<string, { label: string; bg: string }> = {
  stable: { label: 'ESTABLE', bg: 'bg-[#16a34a] text-[#ffffff]' },
  caution: { label: 'PRECAUCIÓN', bg: 'bg-[#ca8a04] text-[#ffffff]' },
  high: { label: 'ALTO RIESGO', bg: 'bg-[#dc2626] text-[#ffffff]' },
  crisis: { label: 'CRISIS', bg: 'bg-[#dc2626] text-[#ffffff] animate-pulse' },
};

const URGENCY_MAP: Record<string, { cls: string; icon: string }> = {
  baja: { cls: 'border-[#eaeaea]', icon: '→' },
  media: { cls: 'border-[#ca8a04]/30', icon: '↗' },
  alta: { cls: 'border-[#dc2626]/30', icon: '⬆' },
  'crítica': { cls: 'border-[#dc2626]', icon: '⚡' },
};

const RISK_APPETITE_CONFIG: Record<RiskAppetite, { short: string }> = {
  CONSERVADOR: { short: 'CON' },
  BALANCEADO: { short: 'BAL' },
  AGRESIVO_CONTROLADO: { short: 'AGR' },
};

const RETURN_TARGET_CONFIG: Record<ReturnTargetMode, { short: string; label: string }> = {
  CONSERVACION: { short: 'CONV', label: 'Conservación' },
  CRECIMIENTO_MODERADO: { short: 'MOD', label: 'Crecimiento moderado' },
  CRECIMIENTO_AGRESIVO: { short: 'AGR', label: 'Crecimiento agresivo' },
};

// Simplified data labels — colored, no brackets
const DATA_LABEL_STYLE: Record<string, { cls: string; text: string }> = {
  OBSERVADO: { cls: 'bg-[#0066cc] text-[#ffffff]', text: 'OBS' },
  REAL: { cls: 'bg-[#16a34a] text-[#ffffff]', text: 'REAL' },
  PARTIAL_FALLBACK: { cls: 'bg-[#999999] text-[#ffffff]', text: 'PARTIAL_FALLBACK' },
  SIMULADO: { cls: 'bg-[#ca8a04] text-[#ffffff]', text: 'SIM' },
  STALE: { cls: 'bg-[#dc2626] text-[#ffffff]', text: 'STALE' },
  ERROR: { cls: 'bg-[#7f1d1d] text-[#ffffff]', text: 'ERROR' },
  PROYECCIÓN: { cls: 'bg-[#2563eb] text-[#ffffff]', text: 'PROY' },
};

export function MacroWeatherOracle() {
  const { metrics, allocations, riskAppetite, setRiskAppetite, returnTargetMode, setReturnTargetMode } = useHedgeFundStore();
  const [oracleData, setOracleData] = useState<OracleState | null>(null);
  const [rebalanceData, setRebalanceData] = useState<RebalanceOracleOutput | null>(null);
  const [projections, setProjections] = useState<ProjectionOutput | null>(null);
  const [macroRaw, setMacroRaw] = useState<Record<string, unknown> | null>(null);
  const [projectionHorizon, setProjectionHorizon] = useState<30 | 60 | 90>(30);

  // Fetch macro data and compute oracle locally
  useEffect(() => {
    fetch('/api/macro')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setMacroRaw(data);
        }
      })
      .catch(() => {});
  }, []);

  // Recompute oracle when macro data or metrics or return target change
  useEffect(() => {
    if (!macroRaw || !metrics) return;

    const macro = buildMacroFromAPI(macroRaw);
    if (!macro) return;

    const oracle = computeOracle(macro);
    setOracleData(oracle);

    const rebalance = computeRebalance(
      oracle,
      allocations.map(a => ({
        productId: a.productId,
        productName: a.productName,
        weight: a.weight,
        amountARS: a.amountARS,
        amountUSD: a.amountUSD,
        category: a.category,
      })),
      metrics,
      returnTargetMode
    );
    setRebalanceData(rebalance);

    // Compute projections
    const totalUSD = allocations.reduce((s, a) => s + a.amountUSD, 0);
    const proj = computeProjections(oracle, metrics, totalUSD, riskAppetite, returnTargetMode, macro.source);
    setProjections(proj);
  }, [macroRaw, metrics, allocations, riskAppetite, returnTargetMode]);

  // Auto-refresh every 60s
  useEffect(() => {
    const interval = setInterval(() => {
      fetch('/api/macro')
        .then(res => res.json())
        .then(data => { if (data.success) setMacroRaw(data); })
        .catch(() => {});
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  if (!oracleData || !rebalanceData) {
    return (
      <div className="py-4 space-y-3 animate-pulse">
        <div className="h-32 bg-[#f5f5f5] rounded-xl" />
        <div className="grid grid-cols-4 gap-2">
          {[1,2,3,4].map(i => <div key={i} className="h-16 bg-[#f5f5f5] rounded-md" />)}
        </div>
      </div>
    );
  }

  const regimeConfig = REGIME_CONFIG[oracleData.regime];
  const riskConfig = RISK_BAND_CONFIG[oracleData.devaluationRiskBand];
  const isAlert = oracleData.devaluationProbability >= 60;

  // Return target info
  const target = RETURN_TARGETS[returnTargetMode];
  const projectedReturn = metrics?.expectedRealReturn30d ?? 0;
  const vsObjetivo = projectedReturn - ((target.monthlyMin + target.monthlyMax) / 2);

  return (
    <div className="space-y-3">
      {/* ═══════════════════════════════════════════════════════════
          CONTROLES — Perfil riesgo + Objetivo retorno
      ═══════════════════════════════════════════════════════════ */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-semibold text-[#999999] uppercase tracking-[0.15em]">Riesgo</span>
          <div className="flex gap-0.5 bg-[#f5f5f5] rounded-md p-0.5">
            {(['CONSERVADOR', 'BALANCEADO', 'AGRESIVO_CONTROLADO'] as RiskAppetite[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setRiskAppetite(mode)}
                className={`px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-[0.08em] transition-all ${
                  riskAppetite === mode
                    ? 'bg-[#000000] text-[#ffffff]'
                    : 'text-[#999999] hover:text-[#000000]'
                }`}
              >
                {RISK_APPETITE_CONFIG[mode].short}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-semibold text-[#999999] uppercase tracking-[0.15em]">Objetivo</span>
          <div className="flex gap-0.5 bg-[#f5f5f5] rounded-md p-0.5">
            {(['CONSERVACION', 'CRECIMIENTO_MODERADO', 'CRECIMIENTO_AGRESIVO'] as ReturnTargetMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setReturnTargetMode(mode)}
                className={`px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-[0.08em] transition-all ${
                  returnTargetMode === mode
                    ? 'bg-[#000000] text-[#ffffff]'
                    : 'text-[#999999] hover:text-[#000000]'
                }`}
              >
                {RETURN_TARGET_CONFIG[mode].short}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          MAPA CLIMÁTICO ECONÓMICO
      ═══════════════════════════════════════════════════════════ */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className={`relative rounded-xl p-5 bg-gradient-to-br ${regimeConfig.bgGradient} border ${regimeConfig.accentBorder} overflow-hidden`}
      >
        {/* Animated risk intensity overlay */}
        <div className="absolute inset-0 pointer-events-none">
          <motion.div
            animate={{
              opacity: isAlert ? [0.05, 0.12, 0.05] : [0.02, 0.04, 0.02],
            }}
            transition={{ duration: 2, repeat: Infinity }}
            className="absolute inset-0"
            style={{
              background: `radial-gradient(circle at 30% 40%, ${regimeConfig.radarColor} 0%, transparent 60%)`,
            }}
          />
        </div>

        <div className="relative z-10">
          {/* Top row: Regime badge + Devaluation score */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <WeatherRadar regime={oracleData.regime} signals={oracleData.signals} />
                <div>
                  <p className="text-[10px] font-semibold text-[#999999] uppercase tracking-[0.2em]">
                    Régimen
                  </p>
                  <p className="text-[16px] font-extrabold text-[#000000] leading-tight">
                    {regimeConfig.icon} {REGIME_LABELS[oracleData.regime]}
                  </p>
                </div>
              </div>
            </div>

            {/* Prob. devaluación */}
            <div className="text-right">
              <p className="text-[10px] font-semibold text-[#999999] uppercase tracking-[0.2em]">
                Prob. devaluación
              </p>
              <div className="flex items-baseline justify-end gap-1.5">
                <span className={`text-[31px] font-extrabold leading-none ${
                  oracleData.devaluationProbability >= 60 ? regimeConfig.accentText :
                  oracleData.devaluationProbability >= 30 ? 'text-[#ca8a04]' :
                  'text-[#16a34a]'
                }`}>
                  {oracleData.devaluationProbability.toFixed(0)}%
                </span>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${riskConfig.bg}`}>
                  {riskConfig.label}
                </span>
              </div>
            </div>
          </div>

          {/* Signal Bars */}
          <div className="grid grid-cols-4 gap-3">
            {oracleData.signals.map((signal) => (
              <SignalBar key={signal.name} signal={signal} accentColor={regimeConfig.radarColor} />
            ))}
          </div>

          {/* Confidence + vs Objetivo */}
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#eaeaea]/50">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-semibold text-[#999999] uppercase tracking-[0.15em]">Confianza</span>
              <div className="w-16 h-1.5 bg-[#f0f0f0] rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${oracleData.confidenceScore}%` }}
                  transition={{ duration: 0.8 }}
                  className="h-full rounded-full"
                  style={{ backgroundColor: regimeConfig.radarColor }}
                />
              </div>
              <span className="text-[10px] font-bold text-[#000000]">{oracleData.confidenceScore}%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-semibold text-[#999999] uppercase tracking-[0.1em]">
                vs objetivo
              </span>
              <span className={`text-[11px] font-extrabold ${
                vsObjetivo >= 0 ? 'text-[#16a34a]' : 'text-[#dc2626]'
              }`}>
                {vsObjetivo >= 0 ? '+' : ''}{vsObjetivo.toFixed(2)}%
              </span>
            </div>
          </div>
        </div>
      </motion.div>

      {/* ═══════════════════════════════════════════════════════════
          ALERTA
      ═══════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {isAlert && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-[#dc2626] text-[#ffffff] rounded-lg px-4 py-3 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <motion.div
                animate={{ opacity: [1, 0.4, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className="w-3 h-3 rounded-full bg-[#ffffff]"
              />
              <span className="text-[11px] font-bold uppercase tracking-[0.12em]">
                ALTO RIESGO DE DEVALUACIÓN — {oracleData.devaluationProbability.toFixed(0)}%
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══════════════════════════════════════════════════════════
          PROYECCIONES
      ═══════════════════════════════════════════════════════════ */}
      {projections && (
        <div className="border border-[#eaeaea] rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-semibold text-[#999999] uppercase tracking-[0.2em]">
              Proyecciones oráculo
            </p>
            <div className="flex gap-0.5 bg-[#f5f5f5] rounded-md p-0.5">
              {([30, 60, 90] as const).map((h) => (
                <button
                  key={h}
                  onClick={() => setProjectionHorizon(h)}
                  className={`px-2 py-0.5 rounded-md text-[9px] font-bold tracking-[0.1em] transition-all ${
                    projectionHorizon === h ? 'bg-[#000000] text-[#ffffff]' : 'text-[#999999]'
                  }`}
                >
                  {h}d
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            {projections.scenarios.map((scenario) => (
              <ProjectionRow key={scenario.id} scenario={scenario} horizon={projectionHorizon} />
            ))}
          </div>

          <div className="flex items-center gap-3 mt-2 pt-2 border-t border-[#eaeaea]/50">
            <div className="flex items-center gap-1">
              <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-[#16a34a] text-[#ffffff]">REAL</span>
              <span className="text-[8px] text-[#999999]">API</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-[#999999] text-[#ffffff]">PARTIAL_FALLBACK</span>
              <span className="text-[8px] text-[#999999]">Derivado</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-[#2563eb] text-[#ffffff]">PROY</span>
              <span className="text-[8px] text-[#999999]">Proyección</span>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          RECOMENDACIONES REBALANCE
      ═══════════════════════════════════════════════════════════ */}
      <div className="border border-[#eaeaea] rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-semibold text-[#999999] uppercase tracking-[0.2em]">
            Oráculo rebalance
          </p>
          <div className="flex items-center gap-2">
            <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${
              rebalanceData.returnTargetBias === 'por_debajo' ? 'bg-[#dc2626] text-[#ffffff]' :
              rebalanceData.returnTargetBias === 'por_encima' ? 'bg-[#16a34a] text-[#ffffff]' :
              'bg-[#999999] text-[#ffffff]'
            }`}>
              {rebalanceData.returnTargetBias === 'por_debajo' ? 'BAJO OBJETIVO' :
               rebalanceData.returnTargetBias === 'por_encima' ? 'SOBRE OBJETIVO' : 'EN OBJETIVO'}
            </span>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-[0.1em] ${
              rebalanceData.riskLevel === 'crítico' ? 'bg-[#dc2626] text-[#ffffff]' :
              rebalanceData.riskLevel === 'alto' ? 'bg-[#ca8a04] text-[#ffffff]' :
              rebalanceData.riskLevel === 'medio' ? 'bg-[#999999] text-[#ffffff]' :
              'bg-[#16a34a] text-[#ffffff]'
            }`}>
              {rebalanceData.riskLevel.toUpperCase()}
            </span>
          </div>
        </div>

        <p className="text-[11px] font-bold text-[#000000] mb-2">
          {rebalanceData.summary}
        </p>

        <div className="space-y-1.5">
          {rebalanceData.recommendations.map((rec, i) => {
            const urgency = URGENCY_MAP[rec.urgency] || URGENCY_MAP['baja'];
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className={`flex items-start gap-2 p-2 rounded-md border ${urgency.cls} bg-[#fafafa]`}
              >
                <span className="text-[13px] leading-none mt-0.5 flex-shrink-0">{urgency.icon}</span>
                <div className="min-w-0">
                  <p className="text-[11px] font-bold text-[#000000] leading-tight">
                    {rec.direction}
                  </p>
                  <p className="text-[9px] font-medium text-[#999999] mt-0.5 leading-snug">
                    {rec.reason}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          STATUS BAR
      ═══════════════════════════════════════════════════════════ */}
      <div className="flex items-center gap-2 px-1">
        <RegimeDot regime={oracleData.regime} />
        <div className="flex-1 h-px bg-[#eaeaea]" />
        <span className={`text-[8px] font-bold px-1 py-0.5 rounded ${
          oracleData.source === 'OBSERVADO' ? 'bg-[#0066cc] text-[#ffffff]' :
          oracleData.source === 'REAL' ? 'bg-[#16a34a] text-[#ffffff]' :
          oracleData.source === 'PARTIAL_FALLBACK' ? 'bg-[#999999] text-[#ffffff]' :
          oracleData.source === 'STALE' ? 'bg-[#dc2626] text-[#ffffff]' :
          oracleData.source === 'ERROR' ? 'bg-[#7f1d1d] text-[#ffffff]' :
          'bg-[#ca8a04] text-[#ffffff]'
        }`}>
          {oracleData.source}
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// PROJECTION ROW
// ============================================================================
function ProjectionRow({ scenario, horizon }: { scenario: ProjectionScenario; horizon: 30 | 60 | 90 }) {
  const returnRange = horizon === 30 ? scenario.returnRange30d
    : horizon === 60 ? scenario.returnRange60d
    : scenario.returnRange90d;
  const usdRange = horizon === 30 ? scenario.usdRange30d
    : horizon === 60 ? scenario.usdRange60d
    : scenario.usdRange90d;

  const labelStyle = DATA_LABEL_STYLE[scenario.label] || DATA_LABEL_STYLE.PARTIAL_FALLBACK;

  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex items-center gap-1.5">
        <span className={`text-[8px] font-bold px-1 py-0.5 rounded ${labelStyle.cls}`}>
          {labelStyle.text}
        </span>
        <span className="text-[10px] font-bold text-[#000000]">{scenario.name}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold text-[#000000]">
          {returnRange.min >= 0 ? '+' : ''}{returnRange.min.toFixed(1)}% a {returnRange.max >= 0 ? '+' : ''}{returnRange.max.toFixed(1)}%
        </span>
        <span className="text-[9px] font-medium text-[#999999]">
          ${usdRange.min.toFixed(0)}–${usdRange.max.toFixed(0)}
        </span>
        <span className="text-[9px] font-bold text-[#999999]">
          {(scenario.probability * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// WEATHER RADAR
// ============================================================================
function WeatherRadar({ regime, signals }: { regime: MacroRegime; signals: OracleState['signals'] }) {
  const config = REGIME_CONFIG[regime];
  const size = 44;
  const cx = size / 2;
  const cy = size / 2;
  const r = 17;

  const angles = [0, 90, 180, 270];
  const points = signals.map((signal, i) => {
    const angle = (angles[i] - 90) * (Math.PI / 180);
    const dist = (signal.value / 100) * r;
    return { x: cx + dist * Math.cos(angle), y: cy + dist * Math.sin(angle) };
  });

  const pathData = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';

  return (
    <div className="flex-shrink-0">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#eaeaea" strokeWidth="0.5" />
        <circle cx={cx} cy={cy} r={r * 0.66} fill="none" stroke="#f0f0f0" strokeWidth="0.5" />
        <circle cx={cx} cy={cy} r={r * 0.33} fill="none" stroke="#f0f0f0" strokeWidth="0.5" />
        {[0, 90, 180, 270].map(angle => {
          const rad = (angle - 90) * (Math.PI / 180);
          return <line key={angle} x1={cx} y1={cy} x2={cx + r * Math.cos(rad)} y2={cy + r * Math.sin(rad)} stroke="#f0f0f0" strokeWidth="0.5" />;
        })}
        <motion.path
          d={pathData}
          fill={`${config.radarColor}15`}
          stroke={config.radarColor}
          strokeWidth="1.5"
          strokeLinejoin="round"
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          style={{ transformOrigin: `${cx}px ${cy}px` }}
        />
        <circle cx={cx} cy={cy} r="2" fill={config.radarColor} />
      </svg>
    </div>
  );
}

// ============================================================================
// SIGNAL BAR
// ============================================================================
function SignalBar({ signal, accentColor }: { signal: OracleState['signals'][0]; accentColor: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] font-semibold text-[#999999] uppercase tracking-[0.1em] truncate">
          {signal.name}
        </span>
        <span className="text-[10px] font-bold text-[#000000]">
          {signal.value.toFixed(0)}
        </span>
      </div>
      <div className="h-1.5 bg-[#f0f0f0] rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${signal.value}%` }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className={`h-full rounded-full ${
            signal.direction === 'bajista' ? '' :
            signal.direction === 'neutral' ? 'bg-[#999999]' :
            'bg-[#cccccc]'
          }`}
          style={signal.direction === 'bajista' ? { backgroundColor: accentColor } : undefined}
        />
      </div>
      <div className="flex items-center gap-1 mt-0.5">
        <span className={`w-1.5 h-1.5 rounded-full ${
          signal.direction === 'bajista' ? '' :
          signal.direction === 'neutral' ? 'bg-[#999999]' :
          'bg-[#cccccc]'
        }`}
        style={signal.direction === 'bajista' ? { backgroundColor: accentColor } : undefined}
        />
        <span className="text-[8px] font-semibold text-[#999999] uppercase">
          {signal.direction}
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// REGIME DOT
// ============================================================================
function RegimeDot({ regime }: { regime: MacroRegime }) {
  const colors: Record<MacroRegime, string> = {
    CARRY: 'bg-[#16a34a]',
    CARRY_FAVORABLE: 'bg-[#059669]',
    NORMAL: 'bg-[#6b7280]',
    WARNING: 'bg-[#ca8a04]',
    HIGH_VOL: 'bg-[#ea580c] animate-pulse',
    CRISIS: 'bg-[#dc2626] animate-pulse',
    GLOBAL_RISK_OFF: 'bg-[#2563eb]',
  };
  return <div className={`w-2 h-2 rounded-full ${colors[regime]}`} />;
}

// ============================================================================
// HELPER
// ============================================================================
function buildMacroFromAPI(data: Record<string, unknown>) {
  try {
    const mep = data.mep as { rate: number; officialRate: number; gap: number; sell: number; buy: number };
    const inflation = data.inflation as { monthly: number; expected30d: number; expected90d: number; yearly: number };
    const rates = data.rates as { bcraPolicy: number; moneyMarket: number; plazoFijo: number; plazoFijoUVA: number };
    const cer = data.cer as { index: number; monthlyChange: number };
    const crawlingPeg = data.crawlingPeg as number;

    if (!mep || !inflation || !rates || !cer || crawlingPeg === undefined) return null;

    return {
      lastUpdate: (data.timestamp as string) || new Date().toISOString(),
      fetchedAt: (data.fetchedAt as string) || new Date().toISOString(),
      ageMinutes: (data.ageMinutes as number) ?? 0,
      lastSuccessfulFetch: (data.lastSuccessfulFetch as string | null) ?? null,
      source: (data.source as 'OBSERVADO' | 'REAL' | 'PARTIAL_FALLBACK' | 'ERROR' | 'STALE' | 'ERROR') || 'ERROR',
      mep,
      inflation,
      rates: {
        ...rates,
        lecaps: (rates as Record<string, number>).lecaps ?? 25,
        badlar: (rates as Record<string, number>).badlar ?? 22,
        leliq: (rates as Record<string, number>).leliq ?? 20,
        tml: (rates as Record<string, number>).tml ?? 20,
      },
      cer: { ...cer, dailyChange: (cer as Record<string, number>).dailyChange ?? 0.07 },
      crawlingPeg,
      realDataPct: (data.realDataPct as number) ?? 0,
      provenance: (data.provenance as MacroState['provenance']) || {} as MacroState['provenance'],
    };
  } catch {
    return null;
  }
}
