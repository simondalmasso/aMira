// src/components/dashboard/data-label-badge.tsx
// V10.2 CONSOLIDATION (per P4-P5-P6-CONSOLIDATION): single source of truth for
// the DataLabel badge visual style. Previously duplicated (with minor
// variations in colors + size classes) across 6+ locations:
//   - main-dashboard.tsx:DataBadge (config map)
//   - macro-engine-panel.tsx:TAG_STYLE (string-class map)
//   - macro-weather-oracle.tsx:DATA_LABEL_STYLE (cls/text map)
//   - carry-panel.tsx:MiniBadge (cfg map — included MODELO)
//   - inline ternaries in macro-weather-oracle.tsx (status bar, projections footer)
//
// All those callsites should import this component instead. Per spec rules:
// NO new features — only consolidation. The 7 DataLabel values + the special
// 'MODELO' tag (used by carry-panel for derived/calculated values) cover all
// existing usage. The colors are the canonical palette (matches the most
// recent main-dashboard.tsx:DataBadge + carry-panel.tsx:MiniBadge mappings).

import type { DataLabel } from '@/lib/live-data';

// ============================================================================
// Style map — single source of truth for all 7 DataLabel values + MODELO
// ============================================================================
const DATA_LABEL_STYLES: Record<DataLabel, { bg: string; text: string; tooltip: string }> = {
  OBSERVADO:        { bg: 'bg-[#0066cc]', text: 'text-[#ffffff]', tooltip: 'Dato observado en tiempo real' },
  REAL:             { bg: 'bg-[#16a34a]', text: 'text-[#ffffff]', tooltip: 'Dato real desde API' },
  PARTIAL_FALLBACK: { bg: 'bg-[#999999]', text: 'text-[#ffffff]', tooltip: 'Mix de real + modelo' },
  SIMULADO:         { bg: 'bg-[#ca8a04]', text: 'text-[#ffffff]', tooltip: 'Proyección de modelo' },
  STALE:            { bg: 'bg-[#dc2626]', text: 'text-[#ffffff]', tooltip: 'Fetch falló — sirviendo valor stale' },
  RECONSTRUIDO:     { bg: 'bg-[#0891b2]', text: 'text-[#ffffff]', tooltip: 'Serie reconstruida' },
  ERROR:            { bg: 'bg-[#7f1d1d]', text: 'text-[#ffffff]', tooltip: 'Sin datos' },
};

// MODELO is a "derived/calculated" label used by carry-panel.tsx for values
// computed from real inputs (e.g., Fisher equation on REAL rates + inflation).
// It's NOT a DataLabel — it's a separate display concept. We keep it as an
// optional extension to the badge so callers don't need a second component.
const MODELO_STYLE = { bg: 'bg-[#7c3aed]', text: 'text-[#ffffff]', tooltip: 'Calculado de inputs reales' };

// ============================================================================
// DataLabelBadge — single badge component for DataLabel + 'MODELO'
// ============================================================================
export function DataLabelBadge({
  label,
  size = 'xs',
}: {
  label: DataLabel | 'MODELO';
  size?: 'xs' | 'sm';
}) {
  const style = label === 'MODELO'
    ? MODELO_STYLE
    : DATA_LABEL_STYLES[label as DataLabel] ?? DATA_LABEL_STYLES.ERROR;
  const sizeCls = size === 'sm'
    ? 'text-[11px] px-2.5 py-1'
    : 'text-[9px] px-1.5 py-0.5';
  return (
    <span
      title={style.tooltip}
      className={`font-bold rounded ${sizeCls} ${style.bg} ${style.text}`}
    >
      {label}
    </span>
  );
}
