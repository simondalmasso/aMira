'use client';

import { useHedgeFundStore } from '@/store/hedge-fund-store';
import { type DataLabel } from '@/lib/live-data';
import { AlertTriangle, CheckCircle, Clock, ExternalLink, TrendingUp } from 'lucide-react';

// ============================================================================
// DATA PROVENANCE PANEL — Sources, URLs, timestamps, real data %
// V5: Shows exact source URLs, data dates, and real data percentage
// ============================================================================
export function DataProvenancePanel() {
  const { backtest, provenance, dataLabel, macro } = useHedgeFundStore();

  const avgError90d = backtest.length > 0
    ? backtest.reduce((s, b) => s + b.errorAbs90d, 0) / backtest.length
    : 0;
  const avgError180d = backtest.length > 0
    ? backtest.reduce((s, b) => s + b.errorAbs180d, 0) / backtest.length
    : 0;
  const maxErrorAsset = backtest.length > 0
    ? backtest.reduce((max, b) => b.errorAbs180d > max.errorAbs180d ? b : max, backtest[0])
    : null;

  // Compute real data percentage
  const realPct = macro?.realDataPct ?? 0;

  const labelIcon: Record<DataLabel, React.ReactNode> = {
    OBSERVADO: <CheckCircle className="w-3 h-3 text-[#0066cc]" />,
    REAL: <CheckCircle className="w-3 h-3 text-[#16a34a]" />,
    PARTIAL_FALLBACK: <TrendingUp className="w-3 h-3 text-[#999999]" />,
    SIMULADO: <AlertTriangle className="w-3 h-3 text-[#ca8a04]" />,
    RECONSTRUIDO: <AlertTriangle className="w-3 h-3 text-[#ca8a04]" />,
    STALE: <Clock className="w-3 h-3 text-[#dc2626]" />,
    ERROR: <AlertTriangle className="w-3 h-3 text-[#7f1d1d]" />,
  };

  // Provenance key → Spanish label
  const provLabels: Record<string, string> = {
    mepRate: 'Tipo de Cambio MEP',
    inflation: 'Inflación IPC',
    rates: 'Tasas (BCRA)',
    cer: 'CER Index',
    crawlingPeg: 'Crawling Peg',
    reserves: 'Reservas BCRA',
  };

  return (
    <div className="space-y-3 py-3">
      {/* UI-01: BANNER SIMULADO — Aparece al top del panel siempre */}
      <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-xs text-amber-800">
        <strong className="font-bold">[SIMULADO]</strong> Los resultados de este panel están basados en datos sintéticos generados por modelo de lenguaje (TRAINING_MEMORY_ESTIMATE), no en series históricas reales de APIs. No usar para decisiones de inversión.
      </div>

      {/* Real data percentage — HERO METRIC */}
      <div className={`rounded-lg p-3 border ${
        realPct >= 70 ? 'border-[#16a34a]/30 bg-[#f0faf0]' :
        realPct >= 40 ? 'border-[#ca8a04]/20 bg-[#fefce8]' :
        'border-[#dc2626]/20 bg-[#fef2f2]'
      }`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <TrendingUp className={`w-4 h-4 ${realPct >= 70 ? 'text-[#16a34a]' : realPct >= 40 ? 'text-[#ca8a04]' : 'text-[#dc2626]'}`} />
            <span className="text-[11px] font-extrabold uppercase tracking-[0.15em]">
              Datos REALES
            </span>
          </div>
          <span className={`text-[25px] font-extrabold leading-none ${
            realPct >= 70 ? 'text-[#16a34a]' : realPct >= 40 ? 'text-[#ca8a04]' : 'text-[#dc2626]'
          }`}>
            {realPct}%
          </span>
        </div>
        {/* Progress bar */}
        <div className="w-full bg-[#e5e5e5] rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all duration-500 ${
              realPct >= 70 ? 'bg-[#16a34a]' : realPct >= 40 ? 'bg-[#ca8a04]' : 'bg-[#dc2626]'
            }`}
            style={{ width: `${Math.max(realPct, 2)}%` }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[8px] font-semibold text-[#999999]">0% modelo</span>
          <span className="text-[8px] font-semibold text-[#999999]">META: 70%+</span>
          <span className="text-[8px] font-semibold text-[#999999]">100% real</span>
        </div>
        <p className="text-[9px] font-semibold text-[#666666] leading-snug mt-2">
          {realPct >= 70
            ? 'La mayoría de los parámetros provienen de APIs públicas verificables (BCRA, INDEC, Bluelytics). Las proyecciones tienen base real.'
            : realPct >= 40
            ? 'Algunos datos son reales, pero otros son estimaciones modeladas. Verificar tasas con fuentes oficiales antes de invertir.'
            : 'Los parámetros de tasas, inflación y CER son estimaciones modeladas, no datos observados. Las proyecciones deben interpretarse con cautela.'
          }
        </p>
      </div>

      {/* Data sources with URLs */}
      {provenance && (
        <div className="bg-[#ffffff] border border-[#eaeaea] rounded-lg p-3">
          <h4 className="text-[10px] font-extrabold text-[#000000] uppercase tracking-[0.15em] mb-2">
            Fuentes de datos por parámetro
          </h4>
          <div className="space-y-2">
            {Object.entries(provenance).map(([key, prov]) => (
              <div key={key} className="border-b border-[#f0f0f0] pb-1.5 last:border-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    {labelIcon[prov.label]}
                    <span className="text-[9px] font-bold text-[#000000]">
                      {provLabels[key] || key}
                    </span>
                    <span className={`text-[7px] font-bold px-1 py-0.5 rounded ${
                      prov.label === 'OBSERVADO' ? 'bg-[#0066cc] text-[#ffffff]' :
                      prov.label === 'REAL' ? 'bg-[#16a34a] text-[#ffffff]' :
                      prov.label === 'PARTIAL_FALLBACK' ? 'bg-[#999999] text-[#ffffff]' :
                      prov.label === 'RECONSTRUIDO' ? 'bg-[#ca8a04] text-[#ffffff]' :
                      prov.label === 'STALE' ? 'bg-[#dc2626] text-[#ffffff]' :
                      prov.label === 'ERROR' ? 'bg-[#7f1d1d] text-[#ffffff]' :
                      'bg-[#ca8a04] text-[#ffffff]'
                    }`}>
                      {prov.label}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[8px] font-semibold text-[#666666]">{prov.source}</span>
                </div>
                {/* URL link */}
                {prov.url && prov.url !== 'N/A' && (
                  <a
                    href={prov.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-0.5 mt-0.5 text-[#2563eb] hover:text-[#1d4ed8]"
                  >
                    <span className="text-[7px] font-semibold underline truncate max-w-[180px]">
                      {prov.url.length > 50 ? prov.url.substring(0, 50) + '...' : prov.url}
                    </span>
                    <ExternalLink className="w-2 h-2" />
                  </a>
                )}
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[7px] font-semibold text-[#999999]">
                    Datos del: {prov.dataDate || 'N/A'}
                  </span>
                  {prov.fetchError && (
                    <span className="text-[7px] font-bold text-[#7f1d1d]">
                      ERROR DE FETCH
                    </span>
                  )}
                  {!prov.fetchError && prov.stalenessHours > 0 && prov.stalenessHours < 999 && (
                    <span className="text-[7px] font-semibold text-[#ca8a04]">
                      ({prov.stalenessHours}h sin actualizar)
                    </span>
                  )}
                  {prov.fetchedAt && (
                    <span className="text-[7px] font-medium text-[#bbbbbb]">
                      fetch: {new Date(prov.fetchedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Backtest error summary */}
      <div className="bg-[#ffffff] border border-[#eaeaea] rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[10px] font-extrabold text-[#000000] uppercase tracking-[0.15em]">
            Error histórico de predicción (Simulación)
          </h4>
          {/* UI-02: Badge SIMULADO al lado del título */}
          <span
            className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-[#ca8a04] text-[#ffffff] tracking-[0.08em]"
            title="Calculado contra datos sintéticos (TRAINING_MEMORY_ESTIMATE)"
          >
            SIMULADO
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center">
            <p className="text-[19px] font-extrabold text-[#ca8a04] leading-none">{avgError90d.toFixed(2)}pp</p>
            <p className="text-[8px] font-semibold text-[#999999] uppercase tracking-[0.1em] mt-1">Error medio 90d</p>
          </div>
          <div className="text-center">
            <p className="text-[19px] font-extrabold text-[#dc2626] leading-none">{avgError180d.toFixed(2)}pp</p>
            <p className="text-[8px] font-semibold text-[#999999] uppercase tracking-[0.1em] mt-1">Error medio 180d</p>
          </div>
          <div className="text-center">
            <p className="text-[15px] font-extrabold text-[#dc2626] leading-none">{maxErrorAsset?.assetName || '--'}</p>
            <p className="text-[19px] font-extrabold text-[#dc2626] leading-none">{maxErrorAsset?.errorAbs180d.toFixed(2) || '--'}pp</p>
            <p className="text-[8px] font-semibold text-[#999999] uppercase tracking-[0.1em] mt-1">Mayor error 180d</p>
          </div>
        </div>
      </div>

      {/* Per-asset backtest table */}
      {backtest.length > 0 && (
        <div className="bg-[#ffffff] border border-[#eaeaea] rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[10px] font-extrabold text-[#000000] uppercase tracking-[0.15em]">
              Error por activo (simulación histórica)
            </h4>
            {/* UI-03: Badge SIMULADO al lado del título */}
            <span
              className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-[#ca8a04] text-[#ffffff] tracking-[0.08em]"
              title="Sharpe/Sortino/Calmar/Drawdown derivados de snapshots sintéticos"
            >
              SIMULADO
            </span>
          </div>
          <div className="space-y-1.5">
            {backtest.map(bt => (
              <div key={bt.assetId} className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-bold text-[#000000]">{bt.assetName}</span>
                  <span className="text-[7px] font-bold px-1 py-0.5 rounded bg-[#ca8a04] text-[#ffffff]">SIM</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[9px] font-semibold text-[#666666]">
                    Modelo: {bt.modelReturn30d >= 0 ? '+' : ''}{bt.modelReturn30d.toFixed(2)}%
                  </span>
                  <span className="text-[9px] font-semibold text-[#666666]">
                    Real 90d: {bt.actualReturnAvg90d >= 0 ? '+' : ''}{bt.actualReturnAvg90d.toFixed(2)}%
                  </span>
                  <span className={`text-[9px] font-bold ${bt.errorAbs180d > 0.5 ? 'text-[#dc2626]' : 'text-[#ca8a04]'}`}>
                    Error: {bt.errorAbs180d.toFixed(2)}pp
                  </span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[8px] font-semibold text-[#999999] mt-2 italic">
            Simulación basada en datos construidos Dic 2025 - Mayo 2026. No representa series históricas observadas directamente.
          </p>
        </div>
      )}

      {/* Disclaimer */}
      <div className="bg-[#f5f5f5] rounded-lg p-3">
        <p className="text-[8px] font-bold text-[#999999] leading-snug">
          AVISO: Las proyecciones de retorno, VaR, Sharpe y probabilidades de éxito son [SIMULADO]
          cuando no existen volatilidades históricas reales. No constituyen asesoramiento financiero.
          Antes de invertir, verificar tasas con Santander y datos macro con BCRA/INDEC.
          Fuentes: BCRA API (api.bcra.gob.ar), INDEC (datos.gob.ar), Bluelytics (bluelytics.com.ar).
        </p>
      </div>
    </div>
  );
}
