'use client';

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useHedgeFundStore } from '@/store/hedge-fund-store';
import { type GoalInput, type GoalResult, type GoalHorizon, computeGoal } from '@/lib/goal-engine';
import { type PortfolioProfile } from '@/lib/portfolio-engine';
import { Target, TrendingUp, TrendingDown, AlertTriangle, CheckCircle, XCircle, ChevronDown } from 'lucide-react';

// ============================================================================
// PROFILE COLOR MAP
// ============================================================================
const PROFILE_COLORS: Record<PortfolioProfile, { accent: string; bg: string; text: string }> = {
  CONSERVADOR: { accent: '#16a34a', bg: 'bg-[#f0faf0]', text: 'text-[#16a34a]' },
  MODERADO: { accent: '#ca8a04', bg: 'bg-[#fefce8]', text: 'text-[#ca8a04]' },
  ARRIESGADO: { accent: '#dc2626', bg: 'bg-[#fef2f2]', text: 'text-[#dc2626]' },
};

const IMPACT_STYLE: Record<string, { cls: string; icon: string }> = {
  bajo: { cls: 'border-[#16a34a]/20', icon: '→' },
  medio: { cls: 'border-[#ca8a04]/30', icon: '↗' },
  alto: { cls: 'border-[#dc2626]/30', icon: '⬆' },
};

const RISK_STYLE: Record<string, { cls: string; label: string }> = {
  bajo: { cls: 'bg-[#16a34a] text-[#ffffff]', label: 'BAJO' },
  medio: { cls: 'bg-[#ca8a04] text-[#ffffff]', label: 'MEDIO' },
  alto: { cls: 'bg-[#dc2626] text-[#ffffff]', label: 'ALTO' },
  muy_alto: { cls: 'bg-[#dc2626] text-[#ffffff] animate-pulse', label: 'MUY ALTO' },
};

const REALISM_STYLE: Record<string, { cls: string; icon: React.ReactNode; label: string }> = {
  alcanzable: { cls: 'bg-[#16a34a] text-[#ffffff]', icon: <CheckCircle className="w-5 h-5" />, label: 'SI' },
  dificil: { cls: 'bg-[#ca8a04] text-[#ffffff]', icon: <AlertTriangle className="w-5 h-5" />, label: 'DIFÍCIL' },
  irrealista: { cls: 'bg-[#dc2626] text-[#ffffff]', icon: <XCircle className="w-5 h-5" />, label: 'NO' },
};

export function GoalSection() {
  const { macro, applyProfile } = useHedgeFundStore();

  // Input state
  const [capitalUSD, setCapitalUSD] = useState(2000);
  const [horizon, setHorizon] = useState<GoalHorizon>(90);
  const [targetUSD, setTargetUSD] = useState(100);

  // Goal output is pure derived state; unknown remains null until macro exists.
  const result = useMemo<GoalResult | null>(
    () => macro ? computeGoal({ capitalUSD, horizon, targetUSD }, macro) : null,
    [macro, capitalUSD, horizon, targetUSD],
  );

  if (!macro) {
    return (
      <div className="py-4 animate-pulse">
        <div className="h-64 bg-[#f5f5f5] rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ═══════════════════════════════════════════════════════════
          INPUTS
      ═══════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-3 gap-2">
        {/* Capital */}
        <div>
          <label className="text-[8px] font-semibold text-[#999999] uppercase tracking-[0.2em] block mb-1">
            Capital USD
          </label>
          <input
            type="number"
            value={capitalUSD}
            onChange={(e) => setCapitalUSD(Math.max(100, Number(e.target.value)))}
            className="w-full px-3 py-2 rounded-lg border border-[#eaeaea] text-[15px] font-extrabold text-[#000000] bg-[#ffffff] focus:outline-none focus:border-[#000000] transition-colors"
          />
        </div>

        {/* Horizonte */}
        <div>
          <label className="text-[8px] font-semibold text-[#999999] uppercase tracking-[0.2em] block mb-1">
            Horizonte
          </label>
          <div className="flex gap-0.5 bg-[#f5f5f5] rounded-lg p-0.5">
            {([30, 60, 90] as GoalHorizon[]).map((h) => (
              <button
                key={h}
                onClick={() => setHorizon(h)}
                className={`flex-1 py-2 rounded-md text-[12px] font-bold tracking-[0.05em] transition-all ${
                  horizon === h
                    ? 'bg-[#000000] text-[#ffffff]'
                    : 'text-[#999999] hover:text-[#000000]'
                }`}
              >
                {h}d
              </button>
            ))}
          </div>
        </div>

        {/* Meta */}
        <div>
          <label className="text-[8px] font-semibold text-[#999999] uppercase tracking-[0.2em] block mb-1">
            Meta USD
          </label>
          <input
            type="number"
            value={targetUSD}
            onChange={(e) => setTargetUSD(Math.max(1, Number(e.target.value)))}
            className="w-full px-3 py-2 rounded-lg border border-[#eaeaea] text-[15px] font-extrabold text-[#000000] bg-[#ffffff] focus:outline-none focus:border-[#000000] transition-colors"
          />
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          RESULTS
      ═══════════════════════════════════════════════════════════ */}
      <AnimatePresence mode="wait">
        {result && (
          <motion.div
            key={`${capitalUSD}-${horizon}-${targetUSD}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="space-y-2"
          >
            {/* ── ¿La meta es realista? ── */}
            <div className={`rounded-xl p-4 flex items-center justify-between ${
              result.realismDetail === 'alcanzable'
                ? 'bg-[#f0faf0] border-2 border-[#16a34a]/20'
                : result.realismDetail === 'dificil'
                ? 'bg-[#fefce8] border-2 border-[#ca8a04]/20'
                : 'bg-[#fef2f2] border-2 border-[#dc2626]/20'
            }`}>
              <div className="flex items-center gap-3">
                {REALISM_STYLE[result.realismDetail].icon}
                <div>
                  <p className="text-[10px] font-semibold text-[#999999] uppercase tracking-[0.2em]">
                    ¿La meta es realista?
                  </p>
                  <p className={`text-[29px] font-extrabold leading-none mt-0.5 ${
                    result.realismDetail === 'alcanzable' ? 'text-[#16a34a]' :
                    result.realismDetail === 'dificil' ? 'text-[#ca8a04]' :
                    'text-[#dc2626]'
                  }`}>
                    {REALISM_STYLE[result.realismDetail].label}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-semibold text-[#999999] uppercase tracking-[0.2em]">
                  Probabilidad de éxito
                </p>
                <p className="text-[15px] font-bold text-[#cc3300] leading-none mt-1 bg-[#fff3f0] px-2 py-1 rounded-md">
                  [SIMULADO]
                </p>
                <p className="text-[8px] font-medium text-[#999999] mt-1 leading-tight max-w-[120px]">
                  Sin volatilidades históricas reales, las probabilidades no son confiables.
                </p>
              </div>
            </div>

            {/* ── Retorno requerido vs disponible ── */}
            <div className="bg-[#000000] rounded-xl p-4 text-[#ffffff]">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[9px] font-semibold text-[#666666] uppercase tracking-[0.2em]">Retorno requerido</p>
                  <p className="text-[23px] font-extrabold leading-none mt-1">
                    +{result.requiredMonthlyPct.toFixed(2)}%/mes
                  </p>
                  <p className="text-[10px] font-medium text-[#666666] mt-0.5">
                    +{result.requiredReturnPct.toFixed(2)}% total en {horizon}d
                  </p>
                </div>
                <div>
                  <p className="text-[9px] font-semibold text-[#666666] uppercase tracking-[0.2em]">Mejor cartera disponible</p>
                  <div className="flex items-baseline gap-2 mt-1">
                    <p className="text-[23px] font-extrabold leading-none">
                      +{result.bestProfileReturnPct.toFixed(2)}%/mes
                    </p>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full`}
                      style={{ backgroundColor: PROFILE_COLORS[result.bestProfile].accent, color: '#ffffff' }}>
                      {result.bestProfile}
                    </span>
                  </div>
                  <p className="text-[10px] font-medium text-[#666666] mt-0.5">
                    +{result.bestProfileReturnTotalPct.toFixed(2)}% total en {horizon}d
                  </p>
                </div>
              </div>
            </div>

            {/* ── Escenarios ── */}
            <div className="grid grid-cols-3 gap-2">
              <div className="border border-[#dc2626]/20 rounded-lg p-3 bg-[#fef2f2]">
                <p className="text-[8px] font-semibold text-[#999999] uppercase tracking-[0.2em]">Pesimista</p>
                <p className={`text-[19px] font-extrabold leading-none mt-1 ${result.pessimisticUSD < 0 ? 'text-[#dc2626]' : 'text-[#000000]'}`}>
                  {result.pessimisticUSD >= 0 ? '+' : ''}${result.pessimisticUSD.toFixed(0)}
                </p>
                <p className="text-[9px] font-medium text-[#999999] mt-0.5">USD</p>
              </div>
              <div className="border border-[#eaeaea] rounded-lg p-3 bg-[#ffffff]">
                <p className="text-[8px] font-semibold text-[#999999] uppercase tracking-[0.2em]">Base</p>
                <p className="text-[19px] font-extrabold leading-none mt-1 text-[#000000]">
                  +${result.baseUSD.toFixed(0)}
                </p>
                <p className="text-[9px] font-medium text-[#999999] mt-0.5">USD</p>
              </div>
              <div className="border border-[#16a34a]/20 rounded-lg p-3 bg-[#f0faf0]">
                <p className="text-[8px] font-semibold text-[#999999] uppercase tracking-[0.2em]">Optimista</p>
                <p className="text-[19px] font-extrabold leading-none mt-1 text-[#16a34a]">
                  +${result.optimisticUSD.toFixed(0)}
                </p>
                <p className="text-[9px] font-medium text-[#999999] mt-0.5">USD</p>
              </div>
            </div>

            {/* ── Riesgo ── */}
            <div className="grid grid-cols-3 gap-2">
              <div className="border border-[#eaeaea] rounded-lg p-2 text-center">
                <p className="text-[17px] font-extrabold text-[#000000] leading-none">{result.var95.toFixed(1)}%</p>
                <p className="text-[8px] font-semibold text-[#999999] uppercase tracking-[0.15em] mt-1">VaR 95%</p>
              </div>
              <div className="border border-[#eaeaea] rounded-lg p-2 text-center">
                <p className="text-[17px] font-extrabold text-[#000000] leading-none">{result.maxDrawdown.toFixed(1)}%</p>
                <p className="text-[8px] font-semibold text-[#999999] uppercase tracking-[0.15em] mt-1">Drawdown esp.</p>
              </div>
              <div className="border border-[#eaeaea] rounded-lg p-2 text-center">
                <span className={`text-[10px] font-bold px-3 py-1 rounded-full ${RISK_STYLE[result.riskLevel].cls}`}>
                  {RISK_STYLE[result.riskLevel].label}
                </span>
                <p className="text-[8px] font-semibold text-[#999999] uppercase tracking-[0.15em] mt-1">Riesgo</p>
              </div>
            </div>

            {/* ── Acciones sugeridas ── */}
            <div className="border border-[#eaeaea] rounded-lg p-3">
              <p className="text-[9px] font-semibold text-[#999999] uppercase tracking-[0.2em] mb-2">
                Acciones sugeridas
              </p>
              <div className="space-y-1.5">
                {result.actions.map((action, i) => {
                  const impactStyle = IMPACT_STYLE[action.impact] || IMPACT_STYLE.bajo;
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className={`flex items-start gap-2 p-2 rounded-md border ${impactStyle.cls} bg-[#fafafa]`}
                    >
                      <span className="text-[13px] leading-none mt-0.5 flex-shrink-0">{impactStyle.icon}</span>
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold text-[#000000] leading-tight">{action.action}</p>
                        <p className="text-[9px] font-medium text-[#999999] mt-0.5 leading-snug">{action.detail}</p>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>

            {/* ── Aplicar perfil sugerido ── */}
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => applyProfile(result.bestProfile)}
              className={`w-full py-3 rounded-xl flex items-center justify-center gap-2 font-extrabold text-[12px] tracking-[0.12em] transition-all`}
              style={{
                backgroundColor: PROFILE_COLORS[result.bestProfile].accent,
                color: '#ffffff',
              }}
            >
              <Target className="w-4 h-4" />
              APLICAR PERFIL {result.bestProfile}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
