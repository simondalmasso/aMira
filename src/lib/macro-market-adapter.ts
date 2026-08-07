// ============================================================================
// MACRO STATE → CANONICAL MARKET STATE ADAPTER
// ----------------------------------------------------------------------------
// This is the only translation boundary between live-data.ts (percent-based,
// source-rich MacroState) and single-market-state.ts (fraction-based model
// inputs). It performs each unit conversion exactly once and preserves the
// provenance limitations used by the canonical oracle endpoint.
// ============================================================================

import {
  getOverallDataLabel,
  type DataClass,
  type DataLabel,
  type DataProvenance,
  type MacroState,
} from './live-data';
import type { MarketState, MarketStateInput } from './single-market-state';

type ExtendedProvenance = DataProvenance & {
  observedAt?: string | null;
  limitations?: string[];
  transformations?: string[];
};

const RECONSTRUCTED_RESERVES_USD_MILLIONS = 26_000;
const RECONSTRUCTED_MARKET_BREADTH = 0.5;

export interface CanonicalMarketFieldProvenance {
  field: keyof Pick<
    MarketStateInput,
    | 'fx_mep'
    | 'inflation_monthly'
    | 'rates_tna'
    | 'reserves_usd'
    | 'reserves_usd_prev'
    | 'fx_gap_pct'
    | 'market_breadth'
  >;
  label: DataLabel;
  dataClass: DataClass;
  source: string;
  observedAt: string | null;
  fetchedAt: string;
  limitations: string[];
  transformations: string[];
}

export interface CanonicalMarketAdapterResult {
  input: MarketStateInput;
  overallLabel: DataLabel;
  quality: MarketState['quality'];
  fieldProvenance: CanonicalMarketFieldProvenance[];
  limitations: string[];
}

function qualityFromLabel(label: DataLabel): MarketState['quality'] {
  switch (label) {
    case 'REAL':
    case 'OBSERVADO':
      return 'REAL';
    case 'STALE':
      return 'STALE';
    case 'ERROR':
      return 'ERROR';
    case 'PARTIAL_FALLBACK':
    case 'RECONSTRUIDO':
    case 'SIMULADO':
      return 'PARTIAL_FALLBACK';
  }
}

function provenanceFor(
  field: CanonicalMarketFieldProvenance['field'],
  rawProvenance: DataProvenance,
  extraTransformations: string[] = [],
): CanonicalMarketFieldProvenance {
  const provenance = rawProvenance as ExtendedProvenance;
  return {
    field,
    label: provenance.label,
    dataClass: provenance.dataClass,
    source: provenance.source,
    observedAt: provenance.observedAt ?? null,
    fetchedAt: provenance.fetchedAt,
    limitations: [...(provenance.limitations ?? [])],
    transformations: [...(provenance.transformations ?? []), ...extraTransformations],
  };
}

/**
 * Convert MacroState values into the exact units expected by the single-pass
 * oracle. No network request occurs here; this adapter is pure and auditable.
 */
export function macroStateToMarketInput(macro: MacroState): CanonicalMarketAdapterResult {
  const overallLabel = getOverallDataLabel(macro);
  const quality = qualityFromLabel(overallLabel);

  const fieldProvenance: CanonicalMarketFieldProvenance[] = [
    provenanceFor('fx_mep', macro.provenance.mepRate),
    provenanceFor('inflation_monthly', macro.provenance.inflation, [
      'Conversión única de porcentaje mensual a fracción: valor / 100.',
    ]),
    provenanceFor('rates_tna', macro.provenance.rates, [
      'Conversión única de TNA porcentual a fracción: valor / 100.',
    ]),
    provenanceFor('fx_gap_pct', macro.provenance.mepRate, [
      'Brecha porcentual MEP/oficial calculada en live-data.ts.',
    ]),
    {
      field: 'reserves_usd',
      label: 'RECONSTRUIDO',
      dataClass: 'RECONSTRUCTED',
      source: macro.provenance.reserves.source,
      observedAt: null,
      fetchedAt: macro.fetchedAt,
      limitations: [
        ...((macro.provenance.reserves as ExtendedProvenance).limitations ?? []),
        'No existe una observación anterior en este contrato; el delta se mantiene neutral.',
      ],
      transformations: [
        `Compatibilidad temporal: ${RECONSTRUCTED_RESERVES_USD_MILLIONS} USD millones.`,
      ],
    },
    {
      field: 'reserves_usd_prev',
      label: 'RECONSTRUIDO',
      dataClass: 'RECONSTRUCTED',
      source: 'Misma estimación de reservas usada como lectura anterior',
      observedAt: null,
      fetchedAt: macro.fetchedAt,
      limitations: ['Delta de reservas neutral hasta integrar una serie temporal observada.'],
      transformations: ['reserves_usd_prev = reserves_usd; no se inventa variación.'],
    },
    {
      field: 'market_breadth',
      label: 'RECONSTRUIDO',
      dataClass: 'RECONSTRUCTED',
      source: 'Neutral market-breadth compatibility value',
      observedAt: null,
      fetchedAt: macro.fetchedAt,
      limitations: ['No hay feed observado de avance/descenso conectado al pipeline canónico.'],
      transformations: [`Valor neutral fijo ${RECONSTRUCTED_MARKET_BREADTH}; no se presenta como observado.`],
    },
  ];

  const sources = Array.from(new Set(fieldProvenance.map((item) => `${item.dataClass}:${item.label}:${item.source}`)));
  const limitations = fieldProvenance.flatMap((item) => item.limitations);

  return {
    input: {
      fx_mep: macro.mep.rate,
      inflation_monthly: macro.inflation.monthly / 100,
      rates_tna: macro.rates.bcraPolicy / 100,
      reserves_usd: RECONSTRUCTED_RESERVES_USD_MILLIONS,
      reserves_usd_prev: RECONSTRUCTED_RESERVES_USD_MILLIONS,
      fx_gap_pct: macro.mep.gap,
      market_breadth: RECONSTRUCTED_MARKET_BREADTH,
      sources,
      quality,
    },
    overallLabel,
    quality,
    fieldProvenance,
    limitations,
  };
}
