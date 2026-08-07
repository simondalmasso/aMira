// src/lib/oracle/v2/foundation-model-adapter.ts
// ============================================================================
// R10 — FOUNDATION MODEL INTEGRATION LAYER (append-only, pluggable)
// ============================================================================
// MISSION (per ORACLE_V2_SYSTEMIC_ROBUSTNESS spec, R10):
//   "Preparar la arquitectura para integrar TimesFM o cualquier Foundation
//    Model SIN modificar el Oracle."
//
// RULES (per spec R10.rules):
//   1. TimesFM NO reemplaza Oracle        — Oracle is final authority
//   2. TimesFM es advisor                 — produces a side-channel forecast
//   3. Oracle sigue siendo autoridad final— ensemble must respect Oracle score
//   4. pluggable adapters                 — register/unregister adapters at runtime
//   5. ensemble optional                  — ensemble only when ≥1 adapter returns data
//
// DESIGN:
//   - FoundationModelAdapter interface: implement this to plug in any model
//     (TimesFM, MAPIE, ruptures, custom models).
//   - The Oracle does NOT call adapters directly. The orchestrator calls
//     adapters in parallel with the Oracle and exposes an "advisor panel"
//     that the UI renders separately. The Oracle's score is unchanged.
//   - Ensemble (if enabled) = weighted average of Oracle + advisors. The
//     ensemble result is advisory only and does NOT replace the Oracle score.
//
// ANTI-FRANKENSTEIN:
//   - Does NOT modify single-pass-oracle-engine.
//   - Does NOT replace the deterministic scoring pipeline.
//   - Adapters are READ-ONLY consumers of MarketState.
// ============================================================================

import type { MarketState } from '@/lib/single-market-state';

// ─── Public Types ──────────────────────────────────────────────────────────

export interface AdvisorForecast {
  /** Adapter that produced this forecast */
  adapter_id: string;
  /** Display name */
  adapter_name: string;
  /** Adapter version */
  adapter_version: string;
  /** 30d expected return forecast (fractional) */
  expected_return: number;
  /** Forecast confidence 0..100 (adapter-specific) */
  confidence: number;
  /** Optional uncertainty band */
  uncertainty_band?: { p5: number; p50: number; p95: number; width: number };
  /** ISO-8601 timestamp of forecast */
  timestamp: string;
  /** Method description */
  method: string;
  /** Whether this forecast is from a real adapter or a stub */
  is_stub: boolean;
  /** Explicit truth classification; built-in placeholders are never observed model inference. */
  data_class: 'SYNTHETIC' | 'OBSERVED';
  provider_kind: 'STUB' | 'REAL_ADAPTER';
}

export interface EnsembleResult {
  /** Ensemble forecast (advisory only — does NOT replace Oracle) */
  expected_return: number;
  /** Composite confidence 0..100 */
  confidence: number;
  /** Per-adapter contributions to the ensemble */
  contributions: Array<{
    adapter_id: string;
    weight: number;
    forecast: AdvisorForecast;
  }>;
  /** Oracle's forecast (always included as the highest-weight member) */
  oracle_forecast: {
    expected_return: number;
    confidence: number;
    weight: number;
  };
  /** Notes / caveats */
  notes: string;
  /** ISO-8601 */
  computed_at: string;
}

export interface AdvisorReport {
  /** All registered adapters (with metadata) */
  registered_adapters: Array<{
    id: string;
    name: string;
    version: string;
    is_stub: boolean;
    enabled: boolean;
    data_class: 'SYNTHETIC' | 'OBSERVED';
  }>;
  /** Forecasts produced this cycle (one per enabled adapter) */
  forecasts: AdvisorForecast[];
  /** Ensemble result (if ≥1 adapter produced a forecast) */
  ensemble: EnsembleResult | null;
  /** Engine version */
  engine_version: string;
}

export const FOUNDATION_MODEL_VERSION = 'foundation_model_adapter_v2_r10';

// ─── Adapter Interface ─────────────────────────────────────────────────────

export interface FoundationModelAdapter {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  is_stub: boolean;
  /** Produce a 30d forecast given the current MarketState */
  forecast(state: MarketState): Promise<AdvisorForecast> | AdvisorForecast;
}

// ─── Adapter Registry (in-memory, pluggable) ──────────────────────────────

const _adapters: Map<string, FoundationModelAdapter> = new Map();

export function registerAdapter(adapter: FoundationModelAdapter): void {
  _adapters.set(adapter.id, adapter);
}

export function unregisterAdapter(adapter_id: string): boolean {
  return _adapters.delete(adapter_id);
}

export function listAdapters(): FoundationModelAdapter[] {
  return Array.from(_adapters.values());
}

export function getAdapter(adapter_id: string): FoundationModelAdapter | null {
  return _adapters.get(adapter_id) ?? null;
}

// ─── Built-in Stub Adapters ────────────────────────────────────────────────
//
// Per spec R10 goal: "Preparar la arquitectura". We ship two stub adapters
// that demonstrate the pluggable interface without requiring external deps.
// Real TimesFM/MAPIE adapters can be registered later without modifying
// any code that consumes AdvisorReport.

const timesfmStub: FoundationModelAdapter = {
  id: 'timesfm-stub',
  name: 'TimesFM (Stub)',
  version: 'stub-v1',
  enabled: true,
  is_stub: true,
  forecast(state: MarketState): AdvisorForecast {
    // Stub: simple momentum-based forecast
    const momentum = -state.risk_sentiment; // risk-off → devaluation → positive ARS return
    const expected = momentum * 0.02 + (state.rates_tna - 0.30) * 0.05;
    const confidence = 55; // stubs are moderately confident
    return {
      adapter_id: 'timesfm-stub',
      adapter_name: 'TimesFM (Stub)',
      adapter_version: 'stub-v1',
      expected_return: Math.round(expected * 1e4) / 1e4,
      confidence,
      uncertainty_band: {
        p5: expected - 0.03,
        p50: expected,
        p95: expected + 0.04,
        width: 0.07,
      },
      timestamp: new Date().toISOString(),
      method: 'stub: momentum-based placeholder for TimesFM foundation model',
      is_stub: true,
      data_class: 'SYNTHETIC',
      provider_kind: 'STUB',
    };
  },
};

const mapieStub: FoundationModelAdapter = {
  id: 'mapie-stub',
  name: 'MAPIE (Stub)',
  version: 'stub-v1',
  enabled: true,
  is_stub: true,
  forecast(state: MarketState): AdvisorForecast {
    // Stub: conformal prediction placeholder
    const baseRate = state.rates_tna / 12; // monthly rate
    const expected = baseRate * 0.4; // conservative
    return {
      adapter_id: 'mapie-stub',
      adapter_name: 'MAPIE (Stub)',
      adapter_version: 'stub-v1',
      expected_return: Math.round(expected * 1e4) / 1e4,
      confidence: 60,
      uncertainty_band: {
        p5: expected - 0.025,
        p50: expected,
        p95: expected + 0.035,
        width: 0.06,
      },
      timestamp: new Date().toISOString(),
      method: 'stub: conformal prediction placeholder for MAPIE',
      is_stub: true,
      data_class: 'SYNTHETIC',
      provider_kind: 'STUB',
    };
  },
};

// Auto-register stubs on module import
registerAdapter(timesfmStub);
registerAdapter(mapieStub);

// ─── Orchestrator: Run All Enabled Adapters + Compute Ensemble ─────────────

export interface AdvisorRunInput {
  market_state: MarketState;
  /** Oracle's own 30d forecast (from canonical single-pass engine) */
  oracle_forecast: {
    expected_return: number;
    confidence: number; // 0..1 (legacy AssetPrediction.confidence)
  } | null;
  /** Weight given to Oracle in the ensemble (default 0.60) */
  oracle_weight?: number;
}

export async function runAdvisors(input: AdvisorRunInput): Promise<AdvisorReport> {
  const oracle_weight = input.oracle_weight ?? 0.60;

  // Run all enabled adapters in parallel
  const enabled = listAdapters().filter((a) => a.enabled);
  const forecastPromises = enabled.map((a) =>
    Promise.resolve(a.forecast(input.market_state))
  );
  const forecasts = await Promise.all(forecastPromises);

  // Compute ensemble only when a canonical Oracle forecast exists. Stub forecasts
  // remain visible as SYNTHETIC side-channel data but never become authority.
  if (input.oracle_forecast === null) {
    return {
      registered_adapters: listAdapters().map((a) => ({
        id: a.id,
        name: a.name,
        version: a.version,
        is_stub: a.is_stub,
        enabled: a.enabled,
        data_class: a.is_stub ? 'SYNTHETIC' as const : 'OBSERVED' as const,
      })),
      forecasts,
      ensemble: null,
      engine_version: FOUNDATION_MODEL_VERSION,
    };
  }

  const advisorWeight = forecasts.length > 0 ? (1 - oracle_weight) / forecasts.length : 0;

  const contributions = forecasts.map((f) => ({
    adapter_id: f.adapter_id,
    weight: advisorWeight,
    forecast: f,
  }));

  // Ensemble expected_return = oracle_weight * oracle + Σ(advisor_weight * advisor)
  const oracleER = input.oracle_forecast.expected_return;
  const oracleConf = input.oracle_forecast.confidence * 100; // convert 0..1 → 0..100

  const ensembleER = oracle_weight * oracleER +
    contributions.reduce((s, c) => s + c.weight * c.forecast.expected_return, 0);

  const ensembleConf = oracle_weight * oracleConf +
    contributions.reduce((s, c) => s + c.weight * c.forecast.confidence, 0);

  const ensemble: EnsembleResult | null = forecasts.length > 0 ? {
    expected_return: Math.round(ensembleER * 1e4) / 1e4,
    confidence: Math.round(ensembleConf * 10) / 10,
    contributions,
    oracle_forecast: {
      expected_return: oracleER,
      confidence: oracleConf,
      weight: oracle_weight,
    },
    notes: 'Ensemble is ADVISORY ONLY — Oracle score remains authoritative (per R10 rule 3).',
    computed_at: new Date().toISOString(),
  } : null;

  return {
    registered_adapters: listAdapters().map((a) => ({
      id: a.id,
      name: a.name,
      version: a.version,
      is_stub: a.is_stub,
      enabled: a.enabled,
      data_class: a.is_stub ? 'SYNTHETIC' as const : 'OBSERVED' as const,
    })),
    forecasts,
    ensemble,
    engine_version: FOUNDATION_MODEL_VERSION,
  };
}
