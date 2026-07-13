// src/lib/amira-event-bus.ts
// V8 ARCHITECTURE UPGRADE — multi-source consensus observability layer
//
// This module provides a lightweight event bus and source-health tracker
// that runs ALONGSIDE the existing decision engine (no math changes).
// It is purely additive — the decision engine core remains the single
// source of truth for portfolio math; this layer adds observability
// for ingestion/validation/fallback decisions.
//
// Design constraints (from spec `risk_control.do_not_break`):
//   - existing API contracts: PRESERVED (no API signature changes)
//   - decision engine core math: PRESERVED (no formula changes)
//   - portfolio weighting logic: PRESERVED (no allocation changes)
//   - historical backtest data: PRESERVED (no KV schema changes)
//
// Events (per `event_system_fix.solution.events` + V9 `ui_fixes.buttons_issue.fix.event_mapping`):
//   - amira:asset-filter-changed       (dispatched by Top Oportunidades buttons — V8)
//   - amira:filter_asset_class_fci     (V9 AmiraVisionEvent — FCI button)
//   - amira:filter_asset_class_pf      (V9 AmiraVisionEvent — Plazo Fijo button)
//   - amira:filter_asset_class_equities (V9 AmiraVisionEvent — Acciones button)
//   - amira:filter_asset_class_bonds   (V9 AmiraVisionEvent — Bonos button)
//   - amira:filter_asset_class_cef     (V9 AmiraVisionEvent — CEDEARs button)
//   - amira:filter_asset_class_etf     (V9 AmiraVisionEvent — ETF CEDEARs button)
//   - amira:portfolio-rebalance-requested  (dispatched by REBALANCEAR button)
//   - amira:source-sync-requested      (dispatched by SINCRONIZAR button)
//   - amira:export-requested           (dispatched by COPIAR/EXPORTAR buttons)
//   - amira:source-health-changed      (dispatched by ingestion layer after fetch)
//   - amira:circuit-breaker-tripped    (dispatched when a source exceeds threshold)
//   - amira:regime-changed             (V9 — dispatched when unified regime changes)
//   - amira:prediction-composed        (V9 — dispatched when AmiraVisionPrediction is composed)

export type AmiraVisionFilterEvent =
  | 'filter_asset_class_fci'
  | 'filter_asset_class_pf'
  | 'filter_asset_class_equities'
  | 'filter_asset_class_bonds'
  | 'filter_asset_class_cef'
  | 'filter_asset_class_etf';

export type AmiraEventName =
  | AmiraVisionFilterEvent
  | 'asset-filter-changed'
  | 'portfolio-rebalance-requested'
  | 'source-sync-requested'
  | 'export-requested'
  | 'source-health-changed'
  | 'circuit-breaker-tripped'
  | 'regime-changed'
  | 'prediction-composed';

/**
 * V9 — Mapping from asset class ID (TabId used in UI) to the corresponding
 * AmiraVisionEvent name. Per spec `ui_fixes.buttons_issue.fix.event_mapping`.
 */
export const ASSET_CLASS_FILTER_EVENT_MAP: Record<string, AmiraVisionFilterEvent> = {
  FCI: 'filter_asset_class_fci',
  PLAZO_FIJO: 'filter_asset_class_pf',
  ACCIONES: 'filter_asset_class_equities',
  BONOS: 'filter_asset_class_bonds',
  CEDEARS: 'filter_asset_class_cef',
  ETF_CEDEARS: 'filter_asset_class_etf',
};

export interface SourceHealthRecord {
  sourceId: string;            // e.g. 'BCRA', 'DolarAPI', 'INDEC', 'Cronista'
  status: 'healthy' | 'degraded' | 'error' | 'circuit-open';
  lastFetchISO: string | null;
  lastSuccessISO: string | null;
  failureCount: number;        // resets to 0 on success
  latencyMs: number | null;    // last fetch latency
  confidence: number;          // 0..1, used by decision layer weighting
  staleHours: number | null;   // hours since lastSuccessISO (null if never)
}

export interface CircuitBreakerConfig {
  enabled: boolean;
  thresholdFailures: number;   // spec: 3
  cooldownSeconds: number;     // spec: 60
}

const DEFAULT_CB_CONFIG: CircuitBreakerConfig = {
  enabled: true,
  thresholdFailures: 3,
  cooldownSeconds: 60,
};

// In-memory source health registry (client-side only; telemetry-only, no
// effect on engine math). Persists for the lifetime of the page session.
const sourceHealthMap = new Map<string, SourceHealthRecord>();
const circuitOpenUntilMap = new Map<string, number>(); // sourceId -> epoch ms

/**
 * Record the result of a source fetch for observability.
 * Pure side-effect: updates the in-memory registry + dispatches events.
 * Does NOT throw, does NOT block, does NOT influence the decision engine.
 */
export function recordSourceFetch(
  sourceId: string,
  result: { ok: boolean; latencyMs?: number; confidence?: number },
  config: CircuitBreakerConfig = DEFAULT_CB_CONFIG,
): SourceHealthRecord {
  const now = Date.now();
  const prev = sourceHealthMap.get(sourceId);
  const next: SourceHealthRecord = {
    sourceId,
    status: result.ok ? 'healthy' : 'error',
    lastFetchISO: new Date(now).toISOString(),
    lastSuccessISO: result.ok ? new Date(now).toISOString() : (prev?.lastSuccessISO ?? null),
    failureCount: result.ok ? 0 : (prev?.failureCount ?? 0) + 1,
    latencyMs: result.latencyMs ?? prev?.latencyMs ?? null,
    confidence: result.confidence ?? (result.ok ? 0.85 : 0),
    staleHours: null,
  };
  if (next.lastSuccessISO) {
    next.staleHours = (now - new Date(next.lastSuccessISO).getTime()) / 3_600_000;
  }
  // Staleness scoring (spec: validation_layer.staleness_scoring)
  if (next.staleHours !== null) {
    if (next.staleHours > 24) next.status = next.status === 'healthy' ? 'degraded' : next.status;
    if (next.staleHours > 168) next.confidence = Math.min(next.confidence, 0.4);
  }
  // Circuit breaker (spec: resilience_mechanisms.circuit_breaker)
  if (
    config.enabled &&
    next.failureCount >= config.thresholdFailures
  ) {
    next.status = 'circuit-open';
    circuitOpenUntilMap.set(sourceId, now + config.cooldownSeconds * 1000);
    dispatchAmiraEvent('circuit-breaker-tripped', {
      sourceId,
      failureCount: next.failureCount,
      cooldownSeconds: config.cooldownSeconds,
      timestamp: now,
    });
  }
  // Auto-recover after cooldown
  const openUntil = circuitOpenUntilMap.get(sourceId);
  if (openUntil && now > openUntil && result.ok) {
    circuitOpenUntilMap.delete(sourceId);
    next.status = 'healthy';
    next.failureCount = 0;
  }
  sourceHealthMap.set(sourceId, next);
  dispatchAmiraEvent('source-health-changed', { record: next, timestamp: now });
  return next;
}

/**
 * Returns the current health record for a source, or null if never recorded.
 */
export function getSourceHealth(sourceId: string): SourceHealthRecord | null {
  return sourceHealthMap.get(sourceId) ?? null;
}

/**
 * Returns a snapshot of all source health records (for the observability layer).
 */
export function getAllSourceHealth(): SourceHealthRecord[] {
  return Array.from(sourceHealthMap.values());
}

/**
 * Computes the aggregate system confidence (weighted average by source confidence).
 * Used by the validation_layer for the "confidence_threshold: 0.72" gate
 * (advisory only — the decision engine itself does not consult this value).
 */
export function getSystemConfidence(): number {
  const records = getAllSourceHealth();
  if (records.length === 0) return 0;
  const totalConf = records.reduce((sum, r) => sum + r.confidence, 0);
  return totalConf / records.length;
}

/**
 * Dispatches an Amira event on the global window (client-side only).
 * Safe to call from SSR — silently no-ops if window is undefined.
 */
export function dispatchAmiraEvent(name: AmiraEventName, detail: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(`amira:${name}`, { detail }));
}

/**
 * Subscribes to an Amira event. Returns an unsubscribe function.
 * Safe to call from SSR — no-ops and returns a no-op unsubscribe.
 */
export function onAmiraEvent(
  name: AmiraEventName,
  handler: (detail: Record<string, unknown>) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (e: Event) => {
    const ce = e as CustomEvent;
    handler(ce.detail ?? {});
  };
  window.addEventListener(`amira:${name}`, listener);
  return () => window.removeEventListener(`amira:${name}`, listener);
}

// ═══════════════════════════════════════════════════════════════════════
// CACHE STRATEGY (spec: resilience_mechanisms.cache_strategy)
// stale-while-revalidate semantics, advisory only (does NOT replace the
// existing KV-backed cache in /api/oracle/* routes — those remain the
// authoritative cache layer for the engine).
// ═══════════════════════════════════════════════════════════════════════

export const CACHE_TTL_SECONDS: Record<string, number> = {
  MEP: 5 * 60,           // 5m
  IPC: 24 * 60 * 60,     // 24h
  CER: 12 * 60 * 60,     // 12h
  RATES: 5 * 60,         // 5m
  RESERVES: 6 * 60 * 60, // 6h
};

/**
 * Returns true if a cached value is still fresh per the cache_strategy TTL.
 * Pure function — does NOT perform any fetch or storage.
 */
export function isCacheFresh(signal: string, cachedAtISO: string): boolean {
  const ttl = CACHE_TTL_SECONDS[signal];
  if (!ttl) return false;
  const ageSec = (Date.now() - new Date(cachedAtISO).getTime()) / 1000;
  return ageSec < ttl;
}

/**
 * Returns true if a cached value is stale but still usable (stale-while-revalidate).
 * Stale = older than TTL but younger than 2× TTL.
 */
export function isCacheStaleButUsable(signal: string, cachedAtISO: string): boolean {
  const ttl = CACHE_TTL_SECONDS[signal];
  if (!ttl) return false;
  const ageSec = (Date.now() - new Date(cachedAtISO).getTime()) / 1000;
  return ageSec >= ttl && ageSec < ttl * 2;
}

// ═══════════════════════════════════════════════════════════════════════
// DATA INTEGRITY RULES (spec: data_integrity_rules)
// Advisory helpers — the actual enforcement happens in /api/oracle/* and
// /api/macro routes; these functions exist to expose the rules to the
// observability layer.
// ═══════════════════════════════════════════════════════════════════════

export const DATA_INTEGRITY_RULES = {
  multi_source_required: true,
  min_sources_per_signal: 2,
  confidence_threshold: 0.72,
  reject_if_divergence_gt: 0.15,
} as const;

export const SOURCE_STALENESS_LIMITS_HOURS: Record<string, number> = {
  MEP: 6,
  RATES: 24,
  IPC: 720, // 30 days
};

/**
 * Returns true if a signal value meets the data integrity rules
 * (multi-source + min sources + confidence threshold + divergence check).
 */
export function meetsDataIntegrityRules(input: {
  sourceCount: number;
  confidence: number;
  divergence: number; // max pairwise divergence, 0..1
}): { ok: boolean; reason?: string } {
  if (DATA_INTEGRITY_RULES.multi_source_required && input.sourceCount < DATA_INTEGRITY_RULES.min_sources_per_signal) {
    return { ok: false, reason: `min_sources_per_signal (${DATA_INTEGRITY_RULES.min_sources_per_signal}) not met` };
  }
  if (input.confidence < DATA_INTEGRITY_RULES.confidence_threshold) {
    return { ok: false, reason: `confidence ${input.confidence.toFixed(2)} < threshold ${DATA_INTEGRITY_RULES.confidence_threshold}` };
  }
  if (input.divergence > DATA_INTEGRITY_RULES.reject_if_divergence_gt) {
    return { ok: false, reason: `divergence ${(input.divergence * 100).toFixed(1)}% > limit ${(DATA_INTEGRITY_RULES.reject_if_divergence_gt * 100).toFixed(0)}%` };
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════
// FALLBACK LOGIC (spec: resilience_mechanisms.fallback_logic)
// Priority order: primary_api → secondary_api → cached_last_good → model_estimation
// ═══════════════════════════════════════════════════════════════════════

export const FALLBACK_PRIORITY = [
  'primary_api',
  'secondary_api',
  'cached_last_good',
  'model_estimation_with_penalty',
] as const;

export type FallbackTier = (typeof FALLBACK_PRIORITY)[number];

/**
 * Returns the fallback tier that should be used given the state of available
 * sources. Advisory only — the actual fetch logic lives in /api/* routes.
 */
export function pickFallbackTier(input: {
  primaryOk: boolean;
  secondaryOk: boolean;
  cachedOk: boolean;
}): FallbackTier {
  if (input.primaryOk) return 'primary_api';
  if (input.secondaryOk) return 'secondary_api';
  if (input.cachedOk) return 'cached_last_good';
  return 'model_estimation_with_penalty';
}
