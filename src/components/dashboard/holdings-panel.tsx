'use client';

import { useHedgeFundStore } from '@/store/hedge-fund-store';
import { motion } from 'framer-motion';
import { type MacroRegime, RETURN_TARGETS } from '@/lib/macroOracle';

export function HoldingsPanel() {
  const { allocations, metrics, oracle, returnTargetMode, selectedProfile, backtest } = useHedgeFundStore();

  const totalUSD = allocations.reduce((s, a) => s + a.amountUSD, 0);
  const regime = oracle?.regime || 'CARRY';

  // Etiqueta de riesgo dinámica según régimen + categoría
  const getRiskBadge = (score: number, category: string, regime: MacroRegime) => {
    let adjustedScore = score;
    if (regime === 'CRISIS') {
      if (category === 'liquidity') adjustedScore += 5;
      if (category === 'fx_hedge') adjustedScore -= 10;
    } else if (regime === 'WARNING') {
      if (category === 'liquidity') adjustedScore += 3;
    } else if (regime === 'CARRY') {
      if (category === 'fx_hedge') adjustedScore += 3;
      if (category === 'liquidity') adjustedScore -= 2;
    }

    if (adjustedScore <= 5) return { label: 'MÍNIMO', cls: 'bg-[#16a34a] text-[#ffffff]' };
    if (adjustedScore <= 15) return { label: 'BAJO', cls: 'bg-[#16a34a] text-[#ffffff]' };
    if (adjustedScore <= 35) return { label: 'MEDIO', cls: 'bg-[#ca8a04] text-[#ffffff]' };
    return { label: 'ALTO', cls: 'bg-[#dc2626] text-[#ffffff]' };
  };

  // Contexto por régimen para cada categoría de activo
  const getCategoryContext = (category: string, regime: MacroRegime): string => {
    if (category === 'liquidity') {
      return regime === 'CRISIS' ? 'riesgo: salto TC' : regime === 'WARNING' ? 'atención: inflación' : 'seguro: carry +';
    }
    if (category === 'inflation_hedge') {
      return regime === 'CRISIS' ? 'moderado' : regime === 'WARNING' ? 'fuerte: inflación sube' : 'estable: diversificador';
    }
    if (category === 'fx_hedge') {
      return regime === 'CRISIS' ? 'FUERTE: cobertura' : regime === 'WARNING' ? 'útil: proteger' : 'drag: bajo riesgo TC';
    }
    if (category === 'yield') {
      return regime === 'CRISIS' ? 'riesgo: lock ARS' : regime === 'WARNING' ? 'precaución' : 'ok: carry +';
    }
    return category;
  };

  const barColorMap: Record<string, string> = {
    'super-ahorro': 'bg-[#000000]',
    'renta-fija-cer': 'bg-[#666666]',
    'dolar-mep': 'bg-[#2563eb]',
    'super-ahorro-usd': 'bg-[#999999]',
    'plazo-fijo-uva': 'bg-[#16a34a]',
    'supergestion-mix-vi': 'bg-[#cccccc]',
    'plazo-fijo': 'bg-[#bbbbbb]',
    'lecaps': 'bg-[#ca8a04]',
    'fondo-corto-plazo': 'bg-[#888888]',
  };

  // Sort: asignados primero (por peso desc), luego sin asignar
  const sorted = [...allocations].sort((a, b) => {
    if (a.weight > 0 && b.weight === 0) return -1;
    if (a.weight === 0 && b.weight > 0) return 1;
    return b.weight - a.weight;
  });

  return (
    <div className="space-y-2">
      {/* Encabezado Tabla */}
      <div className="grid grid-cols-12 gap-2 px-2 py-1.5">
        <span className="col-span-3 text-[10px] font-semibold text-[#999999] uppercase tracking-[0.12em]">Activo</span>
        <span className="col-span-2 text-[10px] font-semibold text-[#999999] uppercase tracking-[0.12em] text-right">Peso</span>
        <span className="col-span-2 text-[10px] font-semibold text-[#999999] uppercase tracking-[0.12em] text-right">USD</span>
        <span className="col-span-3 text-[10px] font-semibold text-[#999999] uppercase tracking-[0.12em] text-right">Real 30d</span>
        <span className="col-span-2 text-[10px] font-semibold text-[#999999] uppercase tracking-[0.12em] text-right">Riesgo</span>
      </div>

      {/* Filas Holdings — denso, compacto */}
      {sorted.map((alloc, i) => {
        const isActive = alloc.weight > 0;
        const riskScore = alloc.category === 'liquidity' ? 2
          : alloc.category === 'inflation_hedge' ? 12
          : alloc.category === 'fx_hedge' ? 25
          : 35;
        const riskBadge = getRiskBadge(riskScore, alloc.category, regime);
        const realRate = metrics?.expectedRealReturn30d || 0;
        const estimatedRealRate = alloc.category === 'liquidity'
          ? realRate - 0.5
          : alloc.category === 'inflation_hedge'
          ? realRate + 0.3
          : alloc.category === 'fx_hedge'
          ? realRate + 0.1
          : realRate - 0.2;

        const usdGain = alloc.amountUSD * (estimatedRealRate / 100);
        const categoryContext = getCategoryContext(alloc.category, regime);

        // vs objetivo
        const target = RETURN_TARGETS[returnTargetMode];
        const assetVsObj = estimatedRealRate - ((target.monthlyMin + target.monthlyMax) / 2);

        // Backtest error for this asset
        const btError = backtest.find(b => b.assetId === alloc.productId);

        return (
          <motion.div
            key={alloc.productId}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.12, delay: i * 0.02 }}
            className={`grid grid-cols-12 gap-2 items-center px-2 py-2.5 rounded-md transition-colors border border-transparent ${
              isActive
                ? 'hover:bg-[#fafafa] hover:border-[#eaeaea]'
                : 'opacity-40'
            }`}
          >
            <div className="col-span-3">
              <p className={`text-[13px] leading-tight ${isActive ? 'font-bold text-[#000000]' : 'font-semibold text-[#999999]'}`}>
                {alloc.productName}
              </p>
              <p className="text-[9px] font-medium text-[#999999] mt-0.5 truncate">
                {categoryContext}
              </p>
            </div>

            <div className="col-span-2 text-right">
              <p className={`text-[14px] ${isActive ? 'font-bold text-[#000000]' : 'font-semibold text-[#cccccc]'}`}>
                {isActive ? `${(alloc.weight * 100).toFixed(0)}%` : '—'}
              </p>
            </div>

            <div className="col-span-2 text-right">
              <p className={`text-[13px] ${isActive ? 'font-bold text-[#000000]' : 'font-semibold text-[#cccccc]'}`}>
                {isActive ? `$${alloc.amountUSD.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}
              </p>
            </div>

            <div className="col-span-3 text-right">
              {isActive ? (
                <div>
                  <p className="text-[12px] font-bold text-[#000000]">
                    {estimatedRealRate >= 0 ? '+' : ''}{estimatedRealRate.toFixed(2)}% / {estimatedRealRate >= 0 ? '+' : ''}${usdGain.toFixed(1)} USD
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[7px] font-bold px-1 py-0.5 rounded bg-[#ca8a04] text-[#ffffff]">SIMULADO</span>
                    <span className="text-[8px] font-semibold">
                      vs obj.: <span className={assetVsObj >= 0 ? 'text-[#16a34a]' : 'text-[#dc2626]'}>
                        {assetVsObj >= 0 ? '+' : ''}{assetVsObj.toFixed(2)}%
                      </span>
                    </span>
                  </div>
                  {btError && btError.errorAbs180d > 0.1 && (
                    <p className="text-[7px] font-semibold text-[#ca8a04] mt-0.5">
                      err simul: {btError.errorAbs180d.toFixed(2)}pp
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-[12px] font-semibold text-[#cccccc]">—</p>
              )}
            </div>

            <div className="col-span-2 text-right">
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full tracking-[0.1em] ${isActive ? riskBadge.cls : 'bg-[#f5f5f5] text-[#cccccc]'}`}>
                {isActive ? riskBadge.label : '—'}
              </span>
            </div>
          </motion.div>
        );
      })}

      {/* Barra Asignación — solo activos */}
      <div className="mt-3 px-2">
        <div className="flex h-2 rounded-full overflow-hidden bg-[#f0f0f0]">
          {allocations.filter(a => a.weight > 0).map((alloc) => (
            <div
              key={alloc.productId}
              className={`${barColorMap[alloc.productId] || 'bg-[#eaeaea]'} transition-all duration-700`}
              style={{ width: `${alloc.weight * 100}%` }}
            />
          ))}
        </div>
        {/* Profile indicator */}
        <div className="flex items-center justify-center gap-1.5 mt-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${
            selectedProfile === 'CONSERVADOR' ? 'bg-[#16a34a]' :
            selectedProfile === 'MODERADO' ? 'bg-[#ca8a04]' :
            'bg-[#dc2626]'
          }`} />
          <span className="text-[8px] font-bold text-[#999999] uppercase tracking-[0.15em]">
            Perfil {selectedProfile.toLowerCase()}
          </span>
        </div>
      </div>

      {/* Estadísticas Resumen — estilo KPI compacto */}
      <div className="grid grid-cols-4 gap-2 mt-3">
        <div className="border border-[#eaeaea] rounded-md p-2 text-center">
          <p className="text-[19px] font-extrabold text-[#000000] leading-none">{metrics?.inflationExposure ?? 0}%</p>
          <p className="text-[9px] font-semibold text-[#999999] uppercase tracking-[0.15em] mt-1">Cob. inflación</p>
        </div>
        <div className="border border-[#eaeaea] rounded-md p-2 text-center">
          <p className="text-[19px] font-extrabold text-[#000000] leading-none">{metrics?.fxExposure ?? 0}%</p>
          <p className="text-[9px] font-semibold text-[#999999] uppercase tracking-[0.15em] mt-1">Exposición TC</p>
        </div>
        <div className="border border-[#eaeaea] rounded-md p-2 text-center">
          <p className="text-[19px] font-extrabold text-[#000000] leading-none">{metrics?.liquidityScore ?? 0}/100</p>
          <p className="text-[9px] font-semibold text-[#999999] uppercase tracking-[0.15em] mt-1">Liquidez</p>
        </div>
        <div className="border border-[#eaeaea] rounded-md p-2 text-center">
          <p className="text-[19px] font-extrabold text-[#000000] leading-none">{allocations.filter(a => a.weight > 0).length}/{allocations.length}</p>
          <p className="text-[9px] font-semibold text-[#999999] uppercase tracking-[0.15em] mt-1">Activos</p>
        </div>
      </div>
    </div>
  );
}
