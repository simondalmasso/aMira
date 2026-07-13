// ============================================================================
// CarryPanel — Rendimiento real por producto individual
// Muestra carry neto por producto usando la fórmula de Fisher:
//   carry_real_mensual = ((1 + TNA/100/12) / (1 + IPC_mensual/100)) - 1
//   carry_real_anual   = ((1 + carry_real_mensual) ^ 12 - 1) * 100
//
// Datos de entrada:
//   - TNA nominales: del store (macroState.rates) — REAL cuando viene del proxy
//   - IPC mensual:   macroState.inflation.monthly — REAL (vía proxy INDEC)
//   - Brecha MEP/Oficial: macroState.mep.gap — REAL (vía proxy DolarAPI)
//
// Reglas de display:
//   - Carry positivo → texto verde
//   - Carry negativo → texto rojo
//   - FX hedge (Ahorro USD, MEP) → "Cobertura TC" en lugar de número
//   - TNA sin dato → [STALE] y N/D
//   - IPC siempre [REAL] si viene del proxy
//   - Carry siempre [MODELO] (derivado de REAL)
// ============================================================================

'use client';

import { useHedgeFundStore } from '@/store/hedge-fund-store';
import { type MacroState } from '@/lib/live-data';

// ─── Local DataBadge (no importar de main-dashboard para evitar circular) ───
type DataLabel = 'OBSERVADO' | 'REAL' | 'PARTIAL_FALLBACK' | 'ERROR' | 'STALE' | 'SIMULADO' | 'RECONSTRUIDO' | 'MODELO';

function MiniBadge({ label }: { label: DataLabel }) {
  const cfg: Record<DataLabel, { bg: string; text: string; tooltip: string }> = {
    OBSERVADO: { bg: 'bg-[#0066cc]', text: 'text-[#ffffff]', tooltip: 'Retorno efectivamente ocurrido' },
    REAL: { bg: 'bg-[#16a34a]', text: 'text-[#ffffff]', tooltip: 'Dato obtenido de API real' },
    PARTIAL_FALLBACK: { bg: 'bg-[#999999]', text: 'text-[#ffffff]', tooltip: 'Calculado a partir de inputs reales' },
    SIMULADO: { bg: 'bg-[#ca8a04]', text: 'text-[#ffffff]', tooltip: 'Estimado/simulado' },
    RECONSTRUIDO: { bg: 'bg-[#ca8a04]', text: 'text-[#ffffff]', tooltip: 'Reconstruido de memoria' },
    STALE: { bg: 'bg-[#dc2626]', text: 'text-[#ffffff]', tooltip: 'Dato desactualizado' },
    ERROR: { bg: 'bg-[#7f1d1d]', text: 'text-[#ffffff]', tooltip: 'Error al obtener dato' },
    MODELO: { bg: 'bg-[#7c3aed]', text: 'text-[#ffffff]', tooltip: 'Calculado de inputs reales — fórmula Fisher' },
  };
  const c = cfg[label];
  return (
    <span
      className={`text-[8px] font-bold px-1 py-0.5 rounded tracking-[0.05em] ${c.bg} ${c.text}`}
      title={c.tooltip}
    >
      {label}
    </span>
  );
}

// ─── Tipo de bucket para mostrar ───
type Bucket = 'LIQUIDITY' | 'FX_HEDGE' | 'YIELD' | 'INFLATION_HEDGE';

const BUCKET_COLORS: Record<Bucket, string> = {
  LIQUIDITY: 'bg-[#dbeafe] text-[#1e40af]',
  FX_HEDGE: 'bg-[#dcfce7] text-[#166534]',
  YIELD: 'bg-[#fef3c7] text-[#92400e]',
  INFLATION_HEDGE: 'bg-[#fce7f3] text-[#9f1239]',
};

// ─── Definición de cada producto ───
interface ProductDef {
  id: string;
  nombre: string;
  bucket: Bucket;
  categoria: 'liquidity' | 'fx_hedge' | 'yield' | 'inflation_hedge';
  // TNA extractor — retorna { tna, label } a partir del macroState
  getTna: (m: MacroState) => { tna: number | null; label: DataLabel; fuente: string };
  // Para fx_hedge: mostrar cobertura TC en lugar de carry numérico
  esCoberturaTC?: boolean;
  nota?: string;
}

const PRODUCTS: ProductDef[] = [
  {
    id: 'mix_vi',
    nombre: 'Mix VI',
    bucket: 'LIQUIDITY',
    categoria: 'liquidity',
    getTna: (m) => ({
      tna: m.rates?.moneyMarket ?? null,
      label: m.rates?.moneyMarket ? 'REAL' : 'STALE',
      fuente: 'moneyMarket (BADLAR−2pp via proxy)',
    }),
  },
  {
    id: 'corto_plazo',
    nombre: 'Corto Plazo',
    bucket: 'LIQUIDITY',
    categoria: 'liquidity',
    getTna: (m) => ({
      tna: m.rates?.moneyMarket ?? null,
      label: m.rates?.moneyMarket ? 'REAL' : 'STALE',
      fuente: 'moneyMarket (BADLAR−2pp via proxy)',
    }),
  },
  {
    id: 'pf_trad',
    nombre: 'PF Tradicional',
    bucket: 'YIELD',
    categoria: 'yield',
    getTna: (m) => ({
      tna: m.rates?.plazoFijo ?? null,
      label: m.rates?.plazoFijo ? 'REAL' : 'STALE',
      fuente: 'plazoFijo (derivado BADLAR via proxy)',
    }),
  },
  {
    id: 'lecaps',
    nombre: 'Lecaps',
    bucket: 'YIELD',
    categoria: 'yield',
    getTna: (m) => ({
      tna: m.rates?.lecaps ?? null,
      label: m.rates?.lecaps ? 'REAL' : 'STALE',
      fuente: 'lecaps (BADLAR+4pp via proxy)',
    }),
  },
  {
    id: 'pf_uva',
    nombre: 'PF UVA',
    bucket: 'INFLATION_HEDGE',
    categoria: 'inflation_hedge',
    getTna: (m) => ({
      // PF UVA = CER + spread (~150-200 bps). Aproximamos spread=2pp sobre CER mensual.
      // TNA nominal no es comparable directamente — usamos CER mensual + 2pp spread
      tna: m.cer?.monthlyChange ? (m.cer.monthlyChange * 12 + 2) : null,
      label: m.cer?.monthlyChange ? 'PARTIAL_FALLBACK' : 'STALE',
      fuente: 'CER mensual × 12 + spread 2pp (aproximación)',
    }),
    nota: 'PF UVA sigue CER. Carry real ≈ spread sobre inflación, no TNA nominal.',
  },
  {
    id: 'renta_fija_cer',
    nombre: 'Renta Fija CER',
    bucket: 'INFLATION_HEDGE',
    categoria: 'inflation_hedge',
    getTna: (m) => ({
      // Similar al PF UVA pero con spread más alto típico de bonos CER (~3-5pp)
      tna: m.cer?.monthlyChange ? (m.cer.monthlyChange * 12 + 4) : null,
      label: m.cer?.monthlyChange ? 'PARTIAL_FALLBACK' : 'STALE',
      fuente: 'CER mensual × 12 + spread 4pp (aproximación bono CER)',
    }),
    nota: 'Bono CER. Carry real ≈ spread sobre CER (típicamente 3-5pp).',
  },
  {
    id: 'ahorro_usd',
    nombre: 'Ahorro USD',
    bucket: 'FX_HEDGE',
    categoria: 'fx_hedge',
    getTna: () => ({
      tna: null,
      label: 'STALE',
      fuente: 'Sin carry en ARS — es cobertura cambiaria',
    }),
    esCoberturaTC: true,
    nota: 'No tiene carry en ARS. Preserva paridad cambiaria.',
  },
  {
    id: 'mep',
    nombre: 'MEP / Bolsa',
    bucket: 'FX_HEDGE',
    categoria: 'fx_hedge',
    getTna: (m) => ({
      tna: m.mep?.gap ?? null,
      label: m.mep?.gap ? 'REAL' : 'STALE',
      fuente: 'brecha cambiaria MEP/Oficial (proxy)',
    }),
    esCoberturaTC: true,
    nota: 'Carry implícito = variación de brecha. Mostrar brecha_pct como referencia.',
  },
];

// ─── Cálculo de carry con Fisher ───
function calcularCarryMensual(tnaAnual: number, ipcMensual: number): number {
  // Fisher mensual: ((1 + TNA/100/12) / (1 + IPC_mensual/100)) - 1
  return (1 + tnaAnual / 100 / 12) / (1 + ipcMensual / 100) - 1;
}

function calcularCarryAnual(carryMensual: number): number {
  // Anualizado: ((1 + carry_mensual) ^ 12 - 1) * 100
  return (Math.pow(1 + carryMensual, 12) - 1) * 100;
}

function formatPct(n: number | null, decimals = 2): string {
  if (n === null || Number.isNaN(n)) return 'N/D';
  return `${n >= 0 ? '+' : ''}${n.toFixed(decimals)}%`;
}

// ============================================================================
// Componente principal
// ============================================================================
export function CarryPanel() {
  const macro = useHedgeFundStore((s) => s.macro);

  if (!macro) {
    return (
      <div className="py-6 px-4 text-center">
        <p className="text-[11px] text-[#999999]">Cargando datos macro…</p>
      </div>
    );
  }

  const ipcMensual = macro.inflation?.monthly ?? null;
  const ipcLabel: DataLabel = ipcMensual !== null ? 'REAL' : 'STALE';
  const brechaMEP = macro.mep?.gap ?? null;

  // ─── Construir filas y ordenar por carry mensual descendente ───
  const filas = PRODUCTS.map((p) => {
    const { tna, label: tnaLabel, fuente } = p.getTna(macro);
    let carryMensual: number | null = null;
    let carryAnual: number | null = null;

    if (!p.esCoberturaTC && tna !== null && ipcMensual !== null) {
      carryMensual = calcularCarryMensual(tna, ipcMensual) * 100;
      carryAnual = calcularCarryAnual(carryMensual / 100);
    }

    return {
      ...p,
      tna,
      tnaLabel,
      fuente,
      carryMensual,
      carryAnual,
    };
  });

  // Ordenar: coberturas TC al final; el resto por carry mensual descendente
  const filasOrdenadas = [...filas].sort((a, b) => {
    if (a.esCoberturaTC && !b.esCoberturaTC) return 1;
    if (!a.esCoberturaTC && b.esCoberturaTC) return -1;
    const aVal = a.carryMensual ?? -Infinity;
    const bVal = b.carryMensual ?? -Infinity;
    return bVal - aVal;
  });

  return (
    <div className="py-3">
      {/* ─── Header con datos clave ─── */}
      <div className="bg-[#f9fafb] border border-[#eaeaea] rounded-lg p-3 mb-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <p className="text-[8px] font-bold text-[#999999] tracking-[0.1em] uppercase">IPC mensual</p>
              <p className="text-[15px] font-extrabold text-[#000000]">
                {ipcMensual !== null ? `${ipcMensual.toFixed(2)}%` : 'N/D'}
              </p>
            </div>
            <MiniBadge label={ipcLabel} />
            <span className="text-[8px] text-[#999999]">vía proxy INDEC</span>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <p className="text-[8px] font-bold text-[#999999] tracking-[0.1em] uppercase">Brecha MEP</p>
              <p className="text-[15px] font-extrabold text-[#000000]">
                {brechaMEP !== null ? `${brechaMEP.toFixed(2)}%` : 'N/D'}
              </p>
            </div>
            <MiniBadge label={brechaMEP !== null ? 'REAL' : 'STALE'} />
            <span className="text-[8px] text-[#999999]">vía proxy DolarAPI</span>
          </div>
        </div>
      </div>

      {/* ─── Tabla ─── */}
      <div className="overflow-x-auto -mx-1">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[#f3f4f6]">
              <th className="text-[9px] font-bold text-[#666666] uppercase tracking-[0.1em] text-left py-2 px-2">Producto</th>
              <th className="text-[9px] font-bold text-[#666666] uppercase tracking-[0.1em] text-right py-2 px-2">TNA nominal</th>
              <th className="text-[9px] font-bold text-[#666666] uppercase tracking-[0.1em] text-right py-2 px-2">IPC mensual</th>
              <th className="text-[9px] font-bold text-[#666666] uppercase tracking-[0.1em] text-right py-2 px-2">Carry real mensual</th>
              <th className="text-[9px] font-bold text-[#666666] uppercase tracking-[0.1em] text-right py-2 px-2">Carry real anual</th>
              <th className="text-[9px] font-bold text-[#666666] uppercase tracking-[0.1em] text-center py-2 px-2">Bucket</th>
              <th className="text-[9px] font-bold text-[#666666] uppercase tracking-[0.1em] text-center py-2 px-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {filasOrdenadas.map((f, idx) => (
              <tr
                key={f.id}
                className={`${idx % 2 === 0 ? 'bg-[#ffffff]' : 'bg-[#fafafa]'} border-b border-[#f0f0f0]`}
              >
                {/* Producto */}
                <td className="py-2 px-2">
                  <div className="flex flex-col">
                    <span className="text-[11px] font-bold text-[#000000]">{f.nombre}</span>
                    {f.nota && (
                      <span className="text-[8px] text-[#999999] leading-tight mt-0.5" title={f.nota}>
                        {f.nota}
                      </span>
                    )}
                  </div>
                </td>

                {/* TNA nominal */}
                <td className="py-2 px-2 text-right">
                  {f.esCoberturaTC ? (
                    <span className="text-[10px] text-[#999999] italic">N/A</span>
                  ) : f.tna !== null ? (
                    <div className="flex flex-col items-end">
                      <span className="text-[11px] font-semibold text-[#000000]">{f.tna.toFixed(2)}%</span>
                      <span className="text-[7px] text-[#999999] truncate max-w-[120px]" title={f.fuente}>
                        {f.fuente}
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-[11px] font-bold text-[#dc2626]">N/D</span>
                      <MiniBadge label="STALE" />
                    </div>
                  )}
                </td>

                {/* IPC mensual */}
                <td className="py-2 px-2 text-right">
                  <div className="flex flex-col items-end">
                    <span className="text-[11px] font-semibold text-[#000000]">
                      {ipcMensual !== null ? `${ipcMensual.toFixed(2)}%` : 'N/D'}
                    </span>
                    <MiniBadge label={ipcLabel} />
                  </div>
                </td>

                {/* Carry real mensual */}
                <td className="py-2 px-2 text-right">
                  {f.esCoberturaTC ? (
                    <span className="text-[10px] font-bold text-[#7c3aed] italic">Cobertura TC</span>
                  ) : f.carryMensual !== null ? (
                    <div className="flex flex-col items-end">
                      <span className={`text-[12px] font-extrabold ${f.carryMensual >= 0 ? 'text-[#16a34a]' : 'text-[#dc2626]'}`}>
                        {formatPct(f.carryMensual)}
                      </span>
                      <MiniBadge label="MODELO" />
                    </div>
                  ) : (
                    <span className="text-[11px] text-[#dc2626]">N/D</span>
                  )}
                </td>

                {/* Carry real anual */}
                <td className="py-2 px-2 text-right">
                  {f.esCoberturaTC ? (
                    <span className="text-[10px] text-[#999999] italic">—</span>
                  ) : f.carryAnual !== null ? (
                    <span className={`text-[12px] font-extrabold ${f.carryAnual >= 0 ? 'text-[#16a34a]' : 'text-[#dc2626]'}`}>
                      {formatPct(f.carryAnual)}
                    </span>
                  ) : (
                    <span className="text-[11px] text-[#dc2626]">N/D</span>
                  )}
                </td>

                {/* Bucket */}
                <td className="py-2 px-2 text-center">
                  <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${BUCKET_COLORS[f.bucket]}`}>
                    {f.bucket}
                  </span>
                </td>

                {/* Estado */}
                <td className="py-2 px-2 text-center">
                  {f.esCoberturaTC ? (
                    <MiniBadge label="REAL" />
                  ) : (
                    <MiniBadge label={f.tnaLabel} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ─── Footer explicativo ─── */}
      <div className="mt-3 bg-[#f9fafb] border border-[#eaeaea] rounded-lg p-2.5">
        <p className="text-[8px] text-[#666666] leading-relaxed">
          <span className="font-bold text-[#000000]">Fórmula:</span>{' '}
          Carry real = Fisher →{' '}
          <code className="bg-[#eaeaea] px-1 rounded text-[7px]">
            ((1+TNA/12) / (1+IPC_m)) − 1
          </code>
          . Anualizado:{' '}
          <code className="bg-[#eaeaea] px-1 rounded text-[7px]">
            ((1+carry_m)^12 − 1) × 100
          </code>
          .
        </p>
        <p className="text-[8px] text-[#666666] leading-relaxed mt-1">
          <span className="font-bold text-[#16a34a]">IPC:</span> BCRA via proxy [REAL].{' '}
          <span className="font-bold text-[#7c3aed]">Carry:</span> calculado de inputs reales [MODELO].{' '}
          <span className="font-bold text-[#000000]">TNA:</span> Santander/BCRA [fuente por producto].
        </p>
        <p className="text-[8px] text-[#999999] leading-relaxed mt-1">
          Cobertura TC = producto de preservación cambiaria (FX hedge), no yield en ARS. No aplica carry real.
        </p>
      </div>
    </div>
  );
}
