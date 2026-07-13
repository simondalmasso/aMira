// src/lib/oracle-fci/types.ts
// ORACLE_FCI_AR_V3 — Type definitions

/** Raw record from api.argentinadatos.com /v1/finanzas/fci/{categoria}/ultimo */
export interface ArgentinadatosFund {
  fondo: string;
  horizonte: string;
  fecha: string; // YYYY-MM-DD
  vcp: number;   // valor cuotaparte (NAV)
  ccp: number;   // cantidad cuotapartes
  patrimonio: number; // ARS
}

export type FundCategory =
  | 'rentaVariable'
  | 'rentaFija'
  | 'mercadoDinero'
  | 'rentaMixta';

export const CATEGORY_LABELS: Record<FundCategory, string> = {
  rentaVariable: 'Renta Variable — Acciones / CEDEARs',
  rentaFija: 'Renta Fija — Bonos / Lecaps / CER / Dólar Linked',
  mercadoDinero: 'Mercado de Dinero — Money Market (T+0/T+1)',
  rentaMixta: 'Renta Mixta — Estrategias Combinadas',
};

export const CATEGORY_ENDPOINTS: Record<FundCategory, string> = {
  rentaVariable: 'https://api.argentinadatos.com/v1/finanzas/fci/rentaVariable/ultimo',
  rentaFija: 'https://api.argentinadatos.com/v1/finanzas/fci/rentaFija/ultimo',
  mercadoDinero: 'https://api.argentinadatos.com/v1/finanzas/fci/mercadoDinero/ultimo',
  rentaMixta: 'https://api.argentinadatos.com/v1/finanzas/fci/rentaMixta/ultimo',
};

/** Normalized fund record (internal) */
export interface NormalizedFund {
  name: string;
  category: FundCategory;
  categoryLabel: string;
  horizonte: string;
  date: string; // YYYY-MM-DD
  vcp: number;
  ccp: number;
  patrimonio: number;
  currency: 'ARS' | 'USD';
  manager: string;
}

/** Historical snapshot stored in KV */
export interface FciSnapshot {
  date: string; // YYYY-MM-DD
  fetched_at: string; // ISO8601
  source: string;
  total_funds: number;
  funds: Array<{
    name: string;
    category: FundCategory;
    vcp: number;
    ccp: number;
    patrimonio: number;
    date: string;
  }>;
}

/** Ranking metrics computed per fund */
export interface FundMetrics {
  name: string;
  category: FundCategory;
  categoryLabel: string;
  horizonte: string;
  currency: 'ARS' | 'USD';
  manager: string;
  date: string;
  vcp: number;
  ccp: number;
  patrimonio: number;
  // Computed metrics
  tir_estimada: number | null;     // % mensual estimada (from 30d momentum if available)
  momentum_7d: number | null;      // % change vs 7 days ago
  momentum_30d: number | null;     // % change vs 30 days ago
  stability: number | null;        // 0-1 (inverse of volatility)
  liquidity: number | null;        // 0-1 (normalized log patrimonio)
  oracle_score: number;            // 0-100 composite
  rank_in_category: number;
  // Prediction (only if confidence >= threshold)
  prediction?: FundPrediction;
  // Source
  source: string;
  confidence: number;
}

export interface FundPrediction {
  expected_return_7d: number | null;   // %
  expected_return_30d: number | null;  // %
  expected_return_90d: number | null;  // %
  confidence: number;                   // 0-1
  bull_probability: number;             // 0-1
  bear_probability: number;             // 0-1
  volatility_score: number;             // 0-1
  models_used: string[];                // which models contributed
}

export interface OracleFciResponse {
  generated_at: string;
  snapshot_date: string;
  source: string;
  source_status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'DEGRADED' | 'ERROR';
  total_funds: number;
  funds_in_output: number;
  rankings: {
    top10_by_oracle_score: FundMetrics[];
    top10_by_patrimonio: FundMetrics[];
    top10_predicted_30d: FundMetrics[];
    top10_most_stable: FundMetrics[];
  };
  by_category: Record<FundCategory, FundMetrics[]>;
  metadata: {
    categories_fetched: FundCategory[];
    history_days_available: number;
    prediction_engine_active: boolean;
    guards: {
      never_invent_data: boolean;
      source_required: boolean;
      confidence_threshold: number;
    };
    fallback_chain_used: string[];
  };
  errors: string[];
  evidence: string[];
}
