'use client';

import { useHedgeFundStore } from '@/store/hedge-fund-store';
import { motion } from 'framer-motion';

export function RiskPanel() {
  const { metrics, scenarioResults } = useHedgeFundStore();

  if (!metrics) return <div className="py-4 text-[#999999] text-[13px] font-semibold">Cargando datos de riesgo...</div>;

  const safetyScore = metrics.capitalSafetyScore;
  const circumference = 2 * Math.PI * 42;
  const dashOffset = circumference - (safetyScore / 100) * circumference;

  return (
    <div className="py-4 space-y-5">
      {/* Gauge Seguridad — compacto */}
      <div className="flex items-center gap-6">
        <div className="relative w-28 h-28 flex-shrink-0">
          <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="42" fill="none" stroke="#eaeaea" strokeWidth="3" />
            <circle
              cx="50" cy="50" r="42"
              fill="none"
              stroke="#000000"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              style={{ transition: 'stroke-dashoffset 0.7s ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <p className="text-[27px] font-extrabold text-[#000000] leading-none">{safetyScore}</p>
              <p className="text-[9px] text-[#999999] uppercase font-semibold tracking-[0.25em] mt-0.5">Seguridad</p>
            </div>
          </div>
        </div>
        <div className="space-y-3 flex-1">
          <MiniBar label="Exposición TC" value={metrics.fxExposure} max={100} />
          <MiniBar label="Cobertura inflación" value={metrics.inflationExposure} max={100} />
          <MiniBar label="Liquidez" value={metrics.liquidityScore} max={100} />
          <MiniBar label="Sensibilidad tasa" value={Math.min(100, metrics.rateSensitivity * 500)} max={100} />
        </div>
      </div>

      {/* Análisis Escenarios — compacto */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-semibold text-[#999999] uppercase tracking-[0.2em]">
            Análisis de escenarios
          </p>
          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-[#2563eb] text-[#ffffff]">PROYECCIÓN</span>
        </div>
        <div className="space-y-2">
          {scenarioResults.map((result, i) => (
            <motion.div
              key={result.scenarioId}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="rounded-lg p-3 border border-[#eaeaea] bg-[#ffffff]"
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-[13px] font-bold text-[#000000]">
                  {result.scenarioEmoji} {result.scenarioName}
                </p>
                <span className="text-[11px] font-bold text-[#999999]">
                  {(result.probability * 100).toFixed(0)}%
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="text-[15px] font-extrabold text-[#000000] leading-tight">
                    {result.portfolioReturn30d >= 0 ? '+' : ''}{result.portfolioReturn30d.toFixed(2)}%
                  </p>
                  <p className="text-[10px] font-semibold text-[#999999] uppercase tracking-[0.15em] mt-0.5">Retorno</p>
                </div>
                <div>
                  <p className="text-[15px] font-extrabold text-[#000000] leading-tight">
                    {result.maxDrawdown.toFixed(2)}%
                  </p>
                  <p className="text-[10px] font-semibold text-[#999999] uppercase tracking-[0.15em] mt-0.5">Máx. DD</p>
                </div>
                <div>
                  <p className={`text-[15px] font-extrabold leading-tight ${
                    result.capitalPreserved ? 'text-[#16a34a]' : 'text-[#dc2626]'
                  }`}>
                    {result.capitalPreserved ? 'Seguro' : 'En riesgo'}
                  </p>
                  <p className="text-[10px] font-semibold text-[#999999] uppercase tracking-[0.15em] mt-0.5">Capital</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Restricciones — denso */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] font-semibold text-[#999999] uppercase tracking-[0.2em]">
            Restricciones
          </p>
          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-[#999999] text-[#ffffff]">PARTIAL_FALLBACK</span>
        </div>
        <div className="space-y-1">
          <ConstraintCheck label="Máx. drawdown ≤ 1%" value={`${metrics.maxDrawdown30d.toFixed(2)}%`} ok={metrics.maxDrawdown30d <= 1.0} />
          <ConstraintCheck label="Sin apalancamiento" value="0x" ok={true} />
          <ConstraintCheck label="Sin acciones" value="0%" ok={true} />
          <ConstraintCheck label="Liquidez ≥ T+1" value={`${metrics.liquidityScore}/100`} ok={metrics.liquidityScore >= 60} />
          <ConstraintCheck label="Exposición TC ≤ 20%" value={`${metrics.fxExposure}%`} ok={metrics.fxExposure <= 20} />
          <ConstraintCheck label="Carry viable" value={metrics.carryViability ? 'Sí' : 'No'} ok={metrics.carryViability} />
        </div>
      </div>
    </div>
  );
}

function MiniBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-semibold text-[#000000]">{label}</span>
        <span className="text-[11px] font-bold text-[#000000]">{value.toFixed(0)}%</span>
      </div>
      <div className="h-1.5 bg-[#f0f0f0] rounded-full overflow-hidden">
        <div
          className="h-full bg-[#000000] rounded-full transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ConstraintCheck({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-[12px] font-semibold text-[#000000]">{label}</span>
      <div className="flex items-center gap-3">
        <span className="text-[12px] font-bold text-[#000000]">{value}</span>
        <div className={`w-5 h-5 rounded-full flex items-center justify-center ${
          ok ? 'bg-[#16a34a]' : 'bg-[#f5f5f5]'
        }`}>
          <span className={`text-[10px] font-bold ${ok ? 'text-[#ffffff]' : 'text-[#999999]'}`}>
            {ok ? '✓' : '✗'}
          </span>
        </div>
      </div>
    </div>
  );
}
