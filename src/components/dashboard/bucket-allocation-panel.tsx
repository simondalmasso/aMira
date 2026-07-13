'use client';

import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useHedgeFundStore } from '@/store/hedge-fund-store';
import {
  type BucketId,
  BUCKET_METADATA,
  HARD_RISK_LIMITS,
  computeCapitalAdequacy,
  computeRealisticReturns,
  SCALING_PATHS,
  REGIME_BUCKET_RULES,
} from '@/lib/capital-buckets';

// ============================================================================
// REGIME BADGE CONFIG — Color-coded per CapitalRegime
// ============================================================================
const REGIME_BADGE: Record<string, { bg: string; label: string; icon: string }> = {
  CRISIS: { bg: 'bg-[#dc2626] text-[#ffffff]', label: 'CRISIS', icon: '🔴' },
  HIGH_VOL: { bg: 'bg-[#ea580c] text-[#ffffff]', label: 'ALTA VOL', icon: '🟠' },
  NORMAL: { bg: 'bg-[#6b7280] text-[#ffffff]', label: 'NORMAL', icon: '⚪' },
  CARRY_FAVORABLE: { bg: 'bg-[#16a34a] text-[#ffffff]', label: 'CARRY FAV', icon: '🟢' },
};

const PHASE_BADGE: Record<string, { bg: string; label: string }> = {
  SURVIVAL: { bg: 'bg-[#dc2626]/10 text-[#dc2626]', label: 'SUPERVIVENCIA' },
  COMPOUNDING: { bg: 'bg-[#ca8a04]/10 text-[#ca8a04]', label: 'COMPUESTO' },
  INCOME: { bg: 'bg-[#16a34a]/10 text-[#16a34a]', label: 'INGRESOS' },
};

// Bucket order for display
const BUCKET_ORDER: BucketId[] = [
  'CAPITAL_PRESERVATION',
  'INFLATION_HEDGE',
  'CARRY_OPPORTUNISTIC',
  'USD_HEDGE_GROWTH',
  'OPPORTUNISTIC_TACTICAL',
];

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export function BucketAllocationPanel() {
  const {
    bucketResult,
    scalingPhase,
    capitalUSD,
    dataLabel,
    macro,
  } = useHedgeFundStore();

  // Compute realistic returns from bucket result
  const returnExpectation = useMemo(() => {
    if (!bucketResult) return null;
    return computeRealisticReturns(
      bucketResult.buckets,
      bucketResult.regime.regime,
    );
  }, [bucketResult]);

  // Compute capital adequacy for $500/month target
  const capitalAdequacy = useMemo(() => {
    return computeCapitalAdequacy(500, capitalUSD);
  }, [capitalUSD]);

  // Loading state
  if (!bucketResult || !macro) {
    return (
      <div className="py-4 space-y-3 animate-pulse">
        <div className="h-24 bg-[#f5f5f5] rounded-xl" />
        <div className="h-12 bg-[#f5f5f5] rounded-lg" />
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="h-10 bg-[#f5f5f5] rounded-lg" />
        ))}
      </div>
    );
  }

  const { buckets, regime, riskViolations } = bucketResult;
  const regimeConfig = REGIME_BADGE[regime.regime] || REGIME_BADGE.NORMAL;
  const phaseConfig = PHASE_BADGE[scalingPhase || 'SURVIVAL'] || PHASE_BADGE.SURVIVAL;
  const currentScaling = SCALING_PATHS[scalingPhase || 'SURVIVAL'];
  const isSimulated = dataLabel === 'ERROR' || dataLabel === 'PARTIAL_FALLBACK';

  return (
    <div className="space-y-4">
      {/* ═══════════════════════════════════════════════════════════
          REGIME + SCALING PHASE HEADER
      ═══════════════════════════════════════════════════════════ */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex items-center justify-between"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-[10px] font-semibold text-[#999999] uppercase tracking-[0.2em]">
            Régimen capital
          </span>
          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full tracking-[0.08em] ${regimeConfig.bg}`}>
            {regimeConfig.icon} {regimeConfig.label}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full tracking-[0.08em] ${phaseConfig.bg}`}>
            {phaseConfig.label}
          </span>
          <span className="text-[9px] font-semibold text-[#999999]">
            ${currentScaling.capitalRangeMin.toLocaleString()}–${currentScaling.capitalRangeMax.toLocaleString()} USD
          </span>
        </div>
      </motion.div>

      {/* ═══════════════════════════════════════════════════════════
          5 BUCKET BARS
      ═══════════════════════════════════════════════════════════ */}
      <div className="space-y-2">
        {BUCKET_ORDER.map((bucketId, i) => {
          const bucket = buckets.find(b => b.id === bucketId);
          if (!bucket) return null;
          const meta = BUCKET_METADATA[bucketId];
          const isDeactivated = !bucket.isActive || bucket.allocation < 0.01;

          return (
            <motion.div
              key={bucketId}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25, delay: i * 0.04 }}
              className={`rounded-lg p-3 border transition-all ${
                isDeactivated
                  ? 'border-[#eaeaea] bg-[#fafafa] opacity-50'
                  : 'border-[#eaeaea] bg-[#ffffff]'
              }`}
            >
              {/* Bucket header */}
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      isDeactivated ? 'bg-[#cccccc]' : ''
                    }`}
                    style={isDeactivated ? undefined : { backgroundColor: meta.color }}
                  />
                  <span className={`text-[11px] font-bold truncate ${
                    isDeactivated ? 'text-[#999999] line-through' : 'text-[#000000]'
                  }`}>
                    {meta.name}
                  </span>
                  {isDeactivated && (
                    <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-[#eaeaea] text-[#999999] uppercase tracking-[0.08em] flex-shrink-0">
                      Desactivado
                    </span>
                  )}
                  <span className={`text-[8px] font-bold px-1 py-0.5 rounded tracking-[0.08em] flex-shrink-0 ${
                    isSimulated ? 'bg-[#ca8a04] text-[#ffffff]' : 'bg-[#16a34a] text-[#ffffff]'
                  }`}>
                    {isSimulated ? 'SIM' : 'REAL'}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-[13px] font-extrabold ${
                    isDeactivated ? 'text-[#cccccc]' : 'text-[#000000]'
                  }`}>
                    {(bucket.allocation * 100).toFixed(1)}%
                  </span>
                  <span className="text-[9px] font-semibold text-[#999999]">
                    base {(bucket.baseAllocation * 100).toFixed(0)}%
                  </span>
                </div>
              </div>

              {/* Allocation bar */}
              <div className="relative h-2 bg-[#f0f0f0] rounded-full overflow-hidden">
                {/* Base allocation marker */}
                <div
                  className="absolute top-0 bottom-0 bg-[#eaeaea] rounded-full"
                  style={{ width: `${bucket.baseAllocation * 100}%` }}
                />
                {/* Current allocation */}
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${bucket.allocation * 100}%` }}
                  transition={{ duration: 0.6, delay: i * 0.06 }}
                  className="absolute top-0 bottom-0 rounded-full"
                  style={{
                    backgroundColor: isDeactivated ? '#cccccc' : meta.color,
                    opacity: isDeactivated ? 0.4 : 0.85,
                  }}
                />
              </div>

              {/* Role + risk level */}
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[8px] font-medium text-[#999999] truncate pr-2">
                  {meta.role}
                </span>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className={`text-[8px] font-bold px-1 py-0.5 rounded ${
                    meta.riskLevel === 'LOW' ? 'bg-[#16a34a]/10 text-[#16a34a]' :
                    meta.riskLevel === 'MEDIUM' ? 'bg-[#ca8a04]/10 text-[#ca8a04]' :
                    meta.riskLevel === 'HIGH' ? 'bg-[#ea580c]/10 text-[#ea580c]' :
                    'bg-[#dc2626]/10 text-[#dc2626]'
                  }`}>
                    {meta.riskLevel === 'LOW' ? 'RIESGO BAJO' :
                     meta.riskLevel === 'MEDIUM' ? 'RIESGO MEDIO' :
                     meta.riskLevel === 'HIGH' ? 'RIESGO ALTO' : 'RIESGO MUY ALTO'}
                  </span>
                  <span className="text-[8px] font-semibold text-[#999999]">
                    ~{(meta.expectedReturnMonthly * 100).toFixed(1)}%/mes
                  </span>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* ═══════════════════════════════════════════════════════════
          REALISTIC RETURN BANNER
      ═══════════════════════════════════════════════════════════ */}
      {returnExpectation && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.25 }}
          className="bg-[#000000] rounded-xl p-4 text-[#ffffff]"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[9px] font-semibold text-[#666666] uppercase tracking-[0.2em]">
              Retorno esperado mensual
            </span>
            <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded tracking-[0.08em] ${
              isSimulated ? 'bg-[#ca8a04] text-[#ffffff]' : 'bg-[#16a34a] text-[#ffffff]'
            }`}>
              {isSimulated ? 'ERROR' : 'REAL'}
            </span>
          </div>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-[23px] font-extrabold leading-none">
              {returnExpectation.monthlyBlended.toFixed(2)}%
            </span>
            <span className="text-[11px] font-bold text-[#666666]">
              ±2% dispersión
            </span>
          </div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[11px] font-semibold text-[#999999]">
              Rango: {returnExpectation.monthlyRange.min.toFixed(2)}% a {returnExpectation.monthlyRange.max.toFixed(2)}%
            </span>
            <span className="text-[9px] font-medium text-[#666666]">
              | Anualizado: {returnExpectation.annualized.toFixed(1)}%
            </span>
          </div>
          <div className="h-2 bg-[#333333] rounded-full overflow-hidden mb-2">
            {/* Min marker */}
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.max(0, (returnExpectation.monthlyBlended + 2)) * 5}%` }}
              transition={{ duration: 0.8, delay: 0.3 }}
              className="h-full rounded-full bg-gradient-to-r from-[#dc2626] via-[#ca8a04] to-[#16a34a]"
              style={{ opacity: 0.6 }}
            />
          </div>
          <p className="text-[9px] font-bold text-[#dc2626] tracking-[0.05em]">
            ⚠ Retornos no lineales ni garantizados
          </p>
          <p className="text-[8px] text-[#666666] mt-0.5">
            {returnExpectation.note}
          </p>
        </motion.div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          RISK VIOLATIONS
      ═══════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {riskViolations.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="space-y-1.5"
          >
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold text-[#999999] uppercase tracking-[0.2em]">
                Violaciones de riesgo
              </span>
              <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-[#dc2626] text-[#ffffff] tracking-[0.08em]">
                LÍMITES DUROS
              </span>
            </div>
            {riskViolations.map((violation, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="bg-[#fef2f2] border border-[#dc2626]/20 rounded-lg px-3 py-2 flex items-start gap-2"
              >
                <motion.div
                  animate={{ opacity: [1, 0.4, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  className="w-2 h-2 rounded-full bg-[#dc2626] flex-shrink-0 mt-0.5"
                />
                <p className="text-[10px] font-bold text-[#dc2626] leading-snug">
                  {violation}
                </p>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══════════════════════════════════════════════════════════
          HARD RISK LIMITS STATUS
      ═══════════════════════════════════════════════════════════ */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.3 }}
        className="border border-[#eaeaea] rounded-lg p-3"
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold text-[#999999] uppercase tracking-[0.2em]">
            Límites duros de riesgo
          </span>
          <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-[#999999] text-[#ffffff] tracking-[0.08em]">
            NO NEGOCIABLES
          </span>
        </div>
        <div className="space-y-1.5">
          <RiskLimitRow
            label="Máx. drawdown"
            value={`${(HARD_RISK_LIMITS.maxDrawdown * 100).toFixed(0)}%`}
            current={bucketResult.maxDrawdownEstimate != null ? `${(bucketResult.maxDrawdownEstimate * 100).toFixed(1)}%` : '--'}
            ok={bucketResult.maxDrawdownEstimate <= HARD_RISK_LIMITS.maxDrawdown}
          />
          <RiskLimitRow
            label="VaR diario"
            value={`${(HARD_RISK_LIMITS.dailyVaRLimit * 100).toFixed(0)}%`}
            current="--"
            ok={true}
          />
          <RiskLimitRow
            label="Apalancamiento máx."
            value={`${HARD_RISK_LIMITS.maxLeverage.toFixed(1)}x`}
            current="0x"
            ok={true}
          />
          <RiskLimitRow
            label="Capital en riesgo"
            value={`≤${(bucketResult.capitalAtRisk * 100).toFixed(0)}%`}
            current={`${(bucketResult.capitalAtRisk * 100).toFixed(1)}%`}
            ok={bucketResult.capitalAtRisk <= 0.30}
          />
          <RiskLimitRow
            label="Preservación min."
            value={`≥${(HARD_RISK_LIMITS.capitalPreservationPriority * 50).toFixed(0)}%`}
            current={`${((buckets.find(b => b.id === 'CAPITAL_PRESERVATION')?.allocation ?? 0) * 100).toFixed(0)}%`}
            ok={(() => { const presAlloc = buckets.find(b => b.id === 'CAPITAL_PRESERVATION')?.allocation ?? 0; return presAlloc >= HARD_RISK_LIMITS.capitalPreservationPriority * 0.5; })()}
          />
        </div>
      </motion.div>

      {/* ═══════════════════════════════════════════════════════════
          CAPITAL ADEQUACY — $500/month target
      ═══════════════════════════════════════════════════════════ */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.35 }}
        className="border border-[#eaeaea] rounded-lg p-4"
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] font-semibold text-[#999999] uppercase tracking-[0.2em]">
            Adecuación de capital
          </span>
          <span className="text-[9px] font-bold text-[#000000]">
            Objetivo: $500/mes
          </span>
        </div>

        {/* Capital needed at different return rates */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <AdequacyCard
            label="Conservador"
            returnRate="0.5%/mes"
            capital={capitalAdequacy.requiredCapitalConservative}
            isCurrent={capitalUSD >= capitalAdequacy.requiredCapitalConservative && capitalUSD < capitalAdequacy.requiredCapitalBase}
          />
          <AdequacyCard
            label="Base"
            returnRate="1.0%/mes"
            capital={capitalAdequacy.requiredCapitalBase}
            highlight
            isCurrent={capitalUSD >= capitalAdequacy.requiredCapitalBase}
          />
          <AdequacyCard
            label="Agresivo"
            returnRate="1.5%/mes"
            capital={capitalAdequacy.requiredCapitalAggressive}
            isCurrent={capitalUSD >= capitalAdequacy.requiredCapitalAggressive && capitalUSD < capitalAdequacy.requiredCapitalBase}
          />
        </div>

        {/* Current capital vs target */}
        <div className="bg-[#f5f5f5] rounded-lg p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[9px] font-semibold text-[#999999] uppercase tracking-[0.15em]">
              Capital actual
            </span>
            <span className="text-[15px] font-extrabold text-[#000000]">
              ${capitalUSD.toLocaleString()} USD
            </span>
          </div>
          {/* Progress bar toward base target */}
          <div className="h-2 bg-[#eaeaea] rounded-full overflow-hidden mb-1.5">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100, (capitalUSD / capitalAdequacy.requiredCapitalBase) * 100)}%` }}
              transition={{ duration: 0.8, delay: 0.4 }}
              className={`h-full rounded-full ${
                capitalUSD >= capitalAdequacy.requiredCapitalBase
                  ? 'bg-[#16a34a]'
                  : capitalUSD >= capitalAdequacy.requiredCapitalAggressive
                    ? 'bg-[#ca8a04]'
                    : 'bg-[#dc2626]'
              }`}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-semibold text-[#999999]">
              {((capitalUSD / capitalAdequacy.requiredCapitalBase) * 100).toFixed(0)}% del objetivo base
            </span>
            {capitalAdequacy.gapToBase > 0 && (
              <span className="text-[9px] font-bold text-[#dc2626]">
                Brecha: ${capitalAdequacy.gapToBase.toLocaleString()} USD
              </span>
            )}
          </div>
        </div>

        {/* Feasibility note */}
        <p className="text-[9px] font-medium text-[#999999] mt-2 leading-snug">
          {capitalAdequacy.feasibilityNote}
        </p>
      </motion.div>

      {/* ═══════════════════════════════════════════════════════════
          SCALING PATH DETAIL
      ═══════════════════════════════════════════════════════════ */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.4 }}
        className="border border-[#eaeaea] rounded-lg p-3"
      >
        <span className="text-[10px] font-semibold text-[#999999] uppercase tracking-[0.2em] block mb-2">
          Ruta de escala
        </span>
        <div className="space-y-1.5">
          {(Object.values(SCALING_PATHS)).map((phase) => {
            const isCurrentPhase = phase.phase === scalingPhase;
            return (
              <div
                key={phase.phase}
                className={`flex items-center justify-between px-2.5 py-2 rounded-md transition-all ${
                  isCurrentPhase
                    ? 'bg-[#000000] text-[#ffffff]'
                    : 'bg-[#fafafa] text-[#000000]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${
                    isCurrentPhase ? 'bg-[#ffffff]' : 'bg-[#cccccc]'
                  }`} />
                  <span className={`text-[11px] font-bold ${
                    isCurrentPhase ? 'text-[#ffffff]' : 'text-[#999999]'
                  }`}>
                    {phase.phase === 'SURVIVAL' ? 'Supervivencia' :
                     phase.phase === 'COMPOUNDING' ? 'Compuesto' : 'Ingresos'}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-[9px] font-semibold ${
                    isCurrentPhase ? 'text-[#999999]' : 'text-[#999999]'
                  }`}>
                    ${phase.capitalRangeMin.toLocaleString()}–${phase.capitalRangeMax.toLocaleString()} USD
                  </span>
                  <span className={`text-[9px] font-semibold ${
                    isCurrentPhase ? 'text-[#999999]' : 'text-[#cccccc]'
                  }`}>
                    ${phase.incomeTargetMin}–${phase.incomeTargetMax}/mes
                  </span>
                  <span className={`text-[8px] font-bold px-1 py-0.5 rounded ${
                    isCurrentPhase ? 'bg-[#ffffff]/20 text-[#ffffff]' : 'bg-[#eaeaea] text-[#999999]'
                  }`}>
                    Riesgo máx. {(phase.maxRiskCap * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>

      {/* ═══════════════════════════════════════════════════════════
          DEACTIVATED BUCKETS EXPLANATION
      ═══════════════════════════════════════════════════════════ */}
      {(regime.regime === 'CRISIS' || regime.regime === 'HIGH_VOL' || regime.confidence < 0.75) && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.45 }}
          className="bg-[#fefce8] border border-[#ca8a04]/20 rounded-lg p-3"
        >
          <span className="text-[9px] font-bold text-[#854d0e] uppercase tracking-[0.1em] block mb-1.5">
            Buckets desactivados
          </span>
          <div className="space-y-1">
            {(regime.regime === 'CRISIS' || regime.regime === 'HIGH_VOL') && (
              <p className="text-[9px] text-[#854d0e] leading-snug">
                <span className="font-bold">Carry Oportunista</span> — Desactivado en régimen {regime.regime === 'CRISIS' ? 'CRISIS' : 'ALTA VOL'}. {REGIME_BUCKET_RULES[regime.regime].description}
              </p>
            )}
            {regime.confidence < 0.75 && (
              <p className="text-[9px] text-[#854d0e] leading-snug">
                <span className="font-bold">Táctico Oportunista</span> — Desactivado por confianza insuficiente ({(regime.confidence * 100).toFixed(0)}% &lt; 75%). Solo se activa cuando el oráculo tiene alta convicción.
              </p>
            )}
          </div>
        </motion.div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          REGIME DESCRIPTION
      ═══════════════════════════════════════════════════════════ */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.5 }}
        className="flex items-center gap-2 px-1"
      >
        <div
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            regime.regime === 'CRISIS' ? 'bg-[#dc2626] animate-pulse' :
            regime.regime === 'HIGH_VOL' ? 'bg-[#ea580c] animate-pulse' :
            regime.regime === 'CARRY_FAVORABLE' ? 'bg-[#16a34a]' :
            'bg-[#6b7280]'
          }`}
        />
        <div className="flex-1 h-px bg-[#eaeaea]" />
        <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded tracking-[0.08em] ${
          isSimulated ? 'bg-[#ca8a04] text-[#ffffff]' : 'bg-[#16a34a] text-[#ffffff]'
        }`}>
          {isSimulated ? 'ERROR' : 'REAL'}
        </span>
        <span className="text-[8px] text-[#999999]">
          Confianza: {(regime.confidence * 100).toFixed(0)}%
        </span>
      </motion.div>
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

/** Risk limit row — checkmark or X */
function RiskLimitRow({ label, value, current, ok }: {
  label: string;
  value: string;
  current: string;
  ok: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-[11px] font-semibold text-[#000000]">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold text-[#000000]">{current}</span>
        <span className="text-[9px] font-semibold text-[#999999]">/ {value}</span>
        <div className={`w-4 h-4 rounded-full flex items-center justify-center ${
          ok ? 'bg-[#16a34a]' : 'bg-[#dc2626]'
        }`}>
          <span className="text-[9px] font-bold text-[#ffffff]">
            {ok ? '✓' : '✗'}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Capital adequacy card — one of 3 return scenarios */
function AdequacyCard({ label, returnRate, capital, highlight, isCurrent }: {
  label: string;
  returnRate: string;
  capital: number;
  highlight?: boolean;
  isCurrent?: boolean;
}) {
  return (
    <div className={`rounded-lg p-2.5 text-center border transition-all ${
      highlight
        ? 'border-[#000000] bg-[#000000] text-[#ffffff]'
        : isCurrent
          ? 'border-[#16a34a]/30 bg-[#f0faf0]'
          : 'border-[#eaeaea] bg-[#fafafa]'
    }`}>
      <p className={`text-[8px] font-semibold uppercase tracking-[0.12em] mb-0.5 ${
        highlight ? 'text-[#999999]' : 'text-[#999999]'
      }`}>
        {label}
      </p>
      <p className={`text-[17px] font-extrabold leading-none ${
        highlight ? 'text-[#ffffff]' : 'text-[#000000]'
      }`}>
        ${capital.toLocaleString()}
      </p>
      <p className={`text-[8px] font-medium mt-0.5 ${
        highlight ? 'text-[#666666]' : 'text-[#999999]'
      }`}>
        {returnRate}
      </p>
    </div>
  );
}
