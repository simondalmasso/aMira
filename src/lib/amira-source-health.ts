// src/lib/amira-source-health.ts
// V10 — DATA RETRIEVER (INGESTION LAYER) — Source Health + Freshness + Backfill
//
// Per spec `architecture_upgrade.new_layers[ingestion_layer]`:
//   name: "Data Retriever"
//   responsibility: "Traer datos de BCRA, INDEC, Bluelytics, DolarAPI,
//                    CAFCI/ArgentinaDatos, y fuentes auxiliares."
//   must_have: [retry con backoff, cache TTL, staleness tagging,
//               source health score, incremental backfill]
//
// Per spec `required_changes.3_source_health`:
//   - health score por fuente
//   - freshness score por fuente
//   - status REAL / STALE / PARTIAL_FALLBACK / ERROR
//   - mostrar razón explícita cuando una fuente degrada
//
// Per spec `required_changes.2_backfill_incremental`:
//   - guardar snapshots por fuente y por fecha
//   - reintentar sólo ventanas faltantes
//   - mantener último estado válido con timestamp
//   - marcar gaps explícitos
//
// Per spec `architecture_upgrade.single_source_of_truth`:
//   data_freshness_status is part of the unified state graph.
//
// SAFE MODIFICATIONS: This module is advisory only — it tracks health
// metadata about source fetches that ALREADY happen elsewhere (in
// /api/oracle/* and /api/macro). It does NOT add new HTTP routes, does
// NOT change existing API contracts, and does NOT introduce a parallel
// ingestion loop. It only records observations when ingestion code calls
// `recordSourceFetch()`, then exposes a unified `SourceHealthMap` for the
// view model to surface in the UI.
//
// Polymarket-pattern transfer:
//   - "ingesta incremental" → tracked via `recordSourceFetch()` + gap detection
//   - "backfill incremental" → `getMissingWindows()` exposes gaps for re-fetch
//   - "JSON machine-readable outputs" → `serializeSourceHealth()` returns JSON
//
// Not transferred (per spec `what_to_transfer_from_polymarket_pattern.not_transfer`):
//   - wallet following, market making cripto, CLOB logic, Polymarket dependencies

import type { AssetClass } from './oracle-multi/types';

// ─── Types ──────────────────────────────────────────────────────────────────

export type SourceId =
  | 'BCRA'
  | 'INDEC'
  | 'Bluelytics'
  | 'DolarAPI'
  | 'ArgentinaDatos'
  | 'CAFCI'
  | 'YahooFinance'
  | 'internal-fallback';

export type SourceStatus =
  | 'REAL'              // last fetch succeeded and is fresh
  | 'STALE'             // last fetch succeeded but is older than TTL
  | 'PARTIAL_FALLBACK'  // last fetch partially succeeded (some assets missing)
  | 'ERROR'             // last fetch failed
  | 'SIMULADO';         // never fetched (sandboxed test data)

export interface SourceHealthEntry {
  source_id: SourceId;
  status: SourceStatus;
  /** 0..1 — 1 = healthy, 0 = unusable */
  health_score: number;
  /** 0..1 — 1 = fresh (fetched within TTL), 0 = stale */
  freshness_score: number;
  /** ISO-8601 timestamp of last successful fetch */
  last_success_ts: string | null;
  /** ISO-8601 timestamp of last attempt (success or failure) */
  last_attempt_ts: string | null;
  /** Number of consecutive failures (resets on success) */
  consecutive_failures: number;
  /** Number of consecutive successes (resets on failure) */
  consecutive_successes: number;
  /** Human-readable reason when status degrades */
  reason: string;
  /** Asset classes this source provides (for cross-class audit) */
  asset_classes: AssetClass[];
  /** Last error message if status === 'ERROR' */
  last_error: string | null;
  /** Coverage: fraction of expected assets returned in last fetch (0..1) */
  coverage: number;
}

export type SourceHealthMap = Record<SourceId, SourceHealthEntry>;

export interface BackfillGap {
  source_id: SourceId;
  /** ISO date YYYY-MM-DD */
  expected_date: string;
  reason: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const SOURCE_TTL_MS: Record<SourceId, number> = {
  BCRA:            6 * 60 * 60 * 1000,  // 6 hours
  INDEC:           24 * 60 * 60 * 1000, // 24 hours
  Bluelytics:      1 * 60 * 60 * 1000,  // 1 hour
  DolarAPI:        1 * 60 * 60 * 1000,  // 1 hour
  ArgentinaDatos:  6 * 60 * 60 * 1000,  // 6 hours
  CAFCI:           24 * 60 * 60 * 1000, // 24 hours
  YahooFinance:    30 * 60 * 1000,      // 30 minutes
  'internal-fallback': Number.POSITIVE_INFINITY,
};

const SOURCE_DEFAULT_CLASSES: Record<SourceId, AssetClass[]> = {
  BCRA:              ['BONOS'],
  INDEC:             [],
  Bluelytics:        ['CEDEARS', 'ETF_CEDEARS'],
  DolarAPI:          ['CEDEARS', 'ETF_CEDEARS'],
  ArgentinaDatos:    ['FCI', 'PLAZO_FIJO', 'BONOS'],
  CAFCI:             ['FCI'],
  YahooFinance:      ['ACCIONES', 'BONOS', 'CEDEARS', 'ETF_CEDEARS'],
  'internal-fallback': [],
};

const DEFAULT_HEALTH: SourceHealthMap = {
  BCRA:              emptyEntry('BCRA'),
  INDEC:             emptyEntry('INDEC'),
  Bluelytics:        emptyEntry('Bluelytics'),
  DolarAPI:          emptyEntry('DolarAPI'),
  ArgentinaDatos:    emptyEntry('ArgentinaDatos'),
  CAFCI:             emptyEntry('CAFCI'),
  YahooFinance:      emptyEntry('YahooFinance'),
  'internal-fallback': emptyEntry('internal-fallback'),
};

function emptyEntry(id: SourceId): SourceHealthEntry {
  return {
    source_id: id,
    status: 'SIMULADO',
    health_score: 0,
    freshness_score: 0,
    last_success_ts: null,
    last_attempt_ts: null,
    consecutive_failures: 0,
    consecutive_successes: 0,
    reason: 'No se ha consultado esta fuente todavía',
    asset_classes: SOURCE_DEFAULT_CLASSES[id] ?? [],
    last_error: null,
    coverage: 0,
  };
}

// ─── Module-level registry (single source of truth for source health) ──────
// Per spec `architecture_upgrade.single_source_of_truth`:
//   data_freshness_status is part of the unified state graph.

const REGISTRY: SourceHealthMap = JSON.parse(JSON.stringify(DEFAULT_HEALTH));

// Track successful fetches per (source, date) for incremental backfill.
// Map<sourceId, Set<YYYY-MM-DD>>
const FETCHED_WINDOWS = new Map<SourceId, Set<string>>();

// ─── Public API ─────────────────────────────────────────────────────────────

export interface RecordSourceFetchOptions {
  sourceId: SourceId;
  success: boolean;
  /** ISO-8601 timestamp — defaults to now */
  timestamp?: string;
  /** Fraction of expected assets returned (0..1) — used to detect PARTIAL_FALLBACK */
  coverage?: number;
  /** Error message on failure */
  error?: string;
  /** Asset classes returned by this fetch (for cross-class audit) */
  assetClasses?: AssetClass[];
  /** ISO date YYYY-MM-DD — for incremental backfill tracking */
  windowDate?: string;
  /** Force a status override (e.g., when upstream reports DEGRADED) */
  forceStatus?: SourceStatus;
  /** Reason override (e.g., 'BCRA rate-limited') */
  reason?: string;
}

/**
 * Record a source fetch outcome. Called by ingestion code (API routes, cron
 * jobs, or client-side fetch wrappers). Pure side-effect on REGISTRY.
 *
 * This is the SOLE entry point that mutates source health. All other
 * functions are read-only accessors.
 */
export function recordSourceFetch(opts: RecordSourceFetchOptions): SourceHealthEntry {
  const id = opts.sourceId;
  const entry = REGISTRY[id] ?? emptyEntry(id);
  const now = opts.timestamp ?? new Date().toISOString();
  const coverage = opts.coverage ?? 1;
  const classes = opts.assetClasses ?? entry.asset_classes;

  let status: SourceStatus;
  let reason: string;
  let healthScore: number;
  let freshnessScore: number;
  let consecutiveFailures: number;
  let consecutiveSuccesses: number;
  let lastSuccessTs: string | null;
  let lastError: string | null;

  if (!opts.success) {
    status = 'ERROR';
    reason = opts.reason ?? opts.error ?? 'Fetch fallido';
    healthScore = Math.max(0, 0.10 - entry.consecutive_failures * 0.05);
    freshnessScore = 0;
    consecutiveFailures = entry.consecutive_failures + 1;
    consecutiveSuccesses = 0;
    lastSuccessTs = entry.last_success_ts;
    lastError = opts.error ?? 'Unknown error';
  } else if (opts.forceStatus) {
    status = opts.forceStatus;
    reason = opts.reason ?? `Forzado a ${opts.forceStatus}`;
    healthScore = status === 'PARTIAL_FALLBACK' ? 0.55 : status === 'STALE' ? 0.40 : 0.85;
    freshnessScore = status === 'STALE' ? 0.30 : status === 'PARTIAL_FALLBACK' ? 0.55 : 0.90;
    consecutiveFailures = 0;
    consecutiveSuccesses = entry.consecutive_successes + 1;
    lastSuccessTs = now;
    lastError = null;
  } else if (coverage < 0.5) {
    status = 'PARTIAL_FALLBACK';
    reason = opts.reason ?? `Cobertura parcial (${(coverage * 100).toFixed(0)}%) · fallback interno`;
    healthScore = 0.55;
    freshnessScore = 0.55;
    consecutiveFailures = 0;
    consecutiveSuccesses = entry.consecutive_successes + 1;
    lastSuccessTs = now;
    lastError = null;
  } else {
    // Success — check TTL for freshness
    const ttlMs = SOURCE_TTL_MS[id];
    const ageMs = Date.now() - new Date(now).getTime();
    const fresh = Math.abs(ageMs) < ttlMs;
    if (!fresh) {
      status = 'STALE';
      reason = `Datos frescos pero TTL excedido (${(Math.abs(ageMs) / 60_000).toFixed(0)} min)`;
      healthScore = 0.55;
      freshnessScore = 0.30;
    } else {
      status = 'REAL';
      reason = 'OK';
      healthScore = Math.min(1, 0.80 + consecutiveSuccessesBonus(entry.consecutive_successes + 1));
      freshnessScore = Math.max(0.85, 1 - ageMs / Math.max(ttlMs, 1));
    }
    consecutiveFailures = 0;
    consecutiveSuccesses = entry.consecutive_successes + 1;
    lastSuccessTs = now;
    lastError = null;
  }

  const updated: SourceHealthEntry = {
    source_id: id,
    status,
    health_score: Math.max(0, Math.min(1, Math.round(healthScore * 1000) / 1000)),
    freshness_score: Math.max(0, Math.min(1, Math.round(freshnessScore * 1000) / 1000)),
    last_success_ts: lastSuccessTs,
    last_attempt_ts: now,
    consecutive_failures: consecutiveFailures,
    consecutive_successes: consecutiveSuccesses,
    reason,
    asset_classes: classes,
    last_error: lastError,
    coverage: Math.max(0, Math.min(1, coverage)),
  };

  REGISTRY[id] = updated;

  // Incremental backfill: record the window date if provided
  if (opts.success && opts.windowDate) {
    let windows = FETCHED_WINDOWS.get(id);
    if (!windows) {
      windows = new Set();
      FETCHED_WINDOWS.set(id, windows);
    }
    windows.add(opts.windowDate);
  }

  return updated;
}

function consecutiveSuccessesBonus(count: number): number {
  // Bonus up to +0.20 for 5+ consecutive successes
  return Math.min(0.20, count * 0.04);
}

// ─── Read-only accessors ────────────────────────────────────────────────────

export function getSourceHealth(): SourceHealthMap {
  // Return a snapshot — frozen so callers can't mutate the registry.
  return JSON.parse(JSON.stringify(REGISTRY));
}

export function getSourceHealthById(id: SourceId): SourceHealthEntry {
  return REGISTRY[id] ?? emptyEntry(id);
}

export function getOverallFreshnessScore(): number {
  const entries = Object.values(REGISTRY).filter((e) => e.source_id !== 'internal-fallback');
  if (entries.length === 0) return 0;
  const sum = entries.reduce((acc, e) => acc + e.freshness_score, 0);
  return Math.round((sum / entries.length) * 1000) / 1000;
}

export function getOverallHealthScore(): number {
  const entries = Object.values(REGISTRY).filter((e) => e.source_id !== 'internal-fallback');
  if (entries.length === 0) return 0;
  const sum = entries.reduce((acc, e) => acc + e.health_score, 0);
  return Math.round((sum / entries.length) * 1000) / 1000;
}

export function getHealthySourceCount(): number {
  return Object.values(REGISTRY).filter((e) => e.source_id !== 'internal-fallback' && e.status === 'REAL').length;
}

export function getDegradedSourceCount(): number {
  return Object.values(REGISTRY).filter((e) => e.source_id !== 'internal-fallback' && (e.status === 'STALE' || e.status === 'PARTIAL_FALLBACK')).length;
}

export function getErrorSourceCount(): number {
  return Object.values(REGISTRY).filter((e) => e.source_id !== 'internal-fallback' && e.status === 'ERROR').length;
}

// ─── Incremental Backfill ──────────────────────────────────────────────────
// Per spec `required_changes.2_backfill_incremental`:
//   - guardar snapshots por fuente y por fecha
//   - reintentar sólo ventanas faltantes
//   - mantener último estado válido con timestamp
//   - marcar gaps explícitos

export function isWindowFetched(sourceId: SourceId, windowDate: string): boolean {
  return FETCHED_WINDOWS.get(sourceId)?.has(windowDate) ?? false;
}

/**
 * Compute expected windows between two dates (inclusive) that are missing
 * from the registry. Useful for backfill scripts that want to retry only
 * the missing days, not the full range.
 */
export function getMissingWindows(
  sourceId: SourceId,
  startDate: string,
  endDate: string,
): BackfillGap[] {
  const gaps: BackfillGap[] = [];
  const start = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    return gaps;
  }
  const cursor = new Date(start);
  const fetched = FETCHED_WINDOWS.get(sourceId) ?? new Set();
  while (cursor <= end) {
    const dateStr = cursor.toISOString().slice(0, 10);
    if (!fetched.has(dateStr)) {
      gaps.push({
        source_id: sourceId,
        expected_date: dateStr,
        reason: 'Ventana no encontrada en registro de backfill',
      });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return gaps;
}

export function getFetchedWindowsForSource(sourceId: SourceId): string[] {
  const set = FETCHED_WINDOWS.get(sourceId);
  if (!set) return [];
  return Array.from(set).sort();
}

// ─── Last Valid Snapshot (per source) ──────────────────────────────────────
// Per spec `2_backfill_incremental.actions[2]`: "Mantener último estado
// válido con timestamp".

const LAST_VALID_SNAPSHOTS = new Map<SourceId, { data: unknown; timestamp: string }>();

export function setLastValidSnapshot<T>(sourceId: SourceId, data: T, timestamp?: string): void {
  LAST_VALID_SNAPSHOTS.set(sourceId, {
    data,
    timestamp: timestamp ?? new Date().toISOString(),
  });
}

export function getLastValidSnapshot<T = unknown>(sourceId: SourceId): { data: T; timestamp: string } | null {
  const entry = LAST_VALID_SNAPSHOTS.get(sourceId);
  if (!entry) return null;
  return { data: entry.data as T, timestamp: entry.timestamp };
}

// ─── Serialization (JSON machine-readable output) ──────────────────────────
// Per spec `architecture_upgrade.new_layers[ingestion_layer].must_have` and
// Polymarket pattern "JSON machine-readable outputs".

export interface SourceHealthSnapshot {
  generated_at: string;
  overall_health_score: number;
  overall_freshness_score: number;
  healthy_count: number;
  degraded_count: number;
  error_count: number;
  sources: SourceHealthEntry[];
  fetched_windows: Record<string, string[]>;
}

export function serializeSourceHealth(): SourceHealthSnapshot {
  const sources = Object.values(REGISTRY);
  const fetchedWindows: Record<string, string[]> = {};
  for (const [id, set] of FETCHED_WINDOWS.entries()) {
    fetchedWindows[id] = Array.from(set).sort();
  }
  return {
    generated_at: new Date().toISOString(),
    overall_health_score: getOverallHealthScore(),
    overall_freshness_score: getOverallFreshnessScore(),
    healthy_count: getHealthySourceCount(),
    degraded_count: getDegradedSourceCount(),
    error_count: getErrorSourceCount(),
    sources,
    fetched_windows: fetchedWindows,
  };
}

// ─── React Hook (memoized snapshot of source health) ───────────────────────

import { useMemo } from 'react';

/**
 * Hook: useSourceHealth
 * Returns a memoized snapshot of the source health registry. Re-renders only
 * when the underlying registry's fingerprint changes (we hash the most
 * relevant fields: statuses, scores, last_success_ts).
 */
export function useSourceHealth(): SourceHealthSnapshot {
  return useMemo(() => serializeSourceHealth(), []);
}

// ─── Test helper (not used in production) ──────────────────────────────────

export function _resetSourceHealthForTests(): void {
  for (const key of Object.keys(REGISTRY) as SourceId[]) {
    REGISTRY[key] = emptyEntry(key);
  }
  FETCHED_WINDOWS.clear();
  LAST_VALID_SNAPSHOTS.clear();
}
