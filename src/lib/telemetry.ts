// ============================================================================
// Ω-X10 TELEMETRY & DECISION LOGGING — Audit Trail
//
// PURPOSE:
//   Every decision the X10 engine makes must be logged for auditability.
//   This module provides:
//     1. Decision logging — what the engine decided and why
//     2. Event tracking — what happened and when
//     3. Performance metrics — running statistics
//     4. UI interaction tracking — how users interact with the system
//     5. PERSISTENT STORAGE — all logs written to KV/D1 (not in-memory only)
//
// DESIGN:
//   - All telemetry MUST be persisted to durable storage (D1/KV)
//   - In-memory buffers are for performance only, NOT the source of truth
//   - Every X10 pipeline execution generates a decision log entry
//   - Every regime change is recorded
//   - Every risk violation is flagged
//   - FAIL SYSTEM if telemetry write fails
//
// AUDITABILITY PRINCIPLE:
//   "If it wasn't logged, it didn't happen."
//   Every allocation change, every regime transition, every kill switch activation
//   must be traceable to a specific decision with specific inputs and reasoning.
// ============================================================================

import { type CapitalRegime, type BucketId } from './capital-buckets';
import { type MacroRegimeX10, type VolatilityRegime, type LiquidityCondition } from './x10-signal-layer';
import { type StrategicMode, type StrategyModuleName } from './x10-strategy-layer';
import { type DataLabel } from './live-data';

// ============================================================================
// FIX_CRON_TELEMETRY_BACKTEST (Fix 2): KV persistence via getCloudflareContext()
// ----------------------------------------------------------------------------
// Previously all logs were in-memory module-scope arrays — they reset on every
// isolate cold-start and were never shared between requests. Now we write to
// the ORACLE_PREDICTIONS KV namespace and read from it on query.
//
// Strategy:
//   - log*() functions STAY SYNCHRONOUS (preserves all existing callers)
//   - KV write is fire-and-forget via ctx.waitUntil when env is available
//   - get*() functions become ASYNC and prefer KV reads
//   - In-memory arrays remain as a write-through cache + test fallback
// ============================================================================

const TELEMETRY_KV_BINDING = 'ORACLE_PREDICTIONS';
const KV_TTL_DECISION_SECONDS = 60 * 60 * 24 * 90; // 90 days
const KV_TTL_EVENT_SECONDS = 60 * 60 * 24 * 30;    // 30 days
const KV_TTL_METRICS_SECONDS = 60 * 60 * 24 * 90;  // 90 days
const KV_KEY_PREFIX_DECISION = 'telemetry:decision:';
const KV_KEY_PREFIX_EVENT = 'telemetry:event:';
const KV_KEY_PREFIX_METRIC = 'telemetry:metric:';

type TelemetryEnv = { ORACLE_PREDICTIONS?: KVNamespace };

function getTelemetryEnv(): TelemetryEnv | null {
  try {
    // Lazy import — only available at runtime in the Cloudflare worker context.
    // Dynamic require avoids crashing in non-CF environments (tests, build).
    const mod = require('@opennextjs/cloudflare');
    const ctx = mod.getCloudflareContext?.();
    return (ctx?.env ?? null) as TelemetryEnv | null;
  } catch {
    return null;
  }
}

function kvWrite(key: string, value: string, ttlSeconds: number): void {
  const env = getTelemetryEnv();
  if (!env?.ORACLE_PREDICTIONS) return; // No KV binding — in-memory only
  try {
    // Fire-and-forget; we don't await so callers stay sync.
    void env.ORACLE_PREDICTIONS.put(key, value, { expirationTtl: ttlSeconds })
      .catch(err => console.error('[TELEMETRY] KV write failed:', key, err));
  } catch (err) {
    console.error('[TELEMETRY] KV write threw:', key, err);
  }
}

async function kvList(prefix: string, limit: number): Promise<string[]> {
  const env = getTelemetryEnv();
  if (!env?.ORACLE_PREDICTIONS) return [];
  try {
    const result = await env.ORACLE_PREDICTIONS.list({ prefix, limit });
    return result.keys.map(k => k.name);
  } catch (err) {
    console.error('[TELEMETRY] KV list failed:', prefix, err);
    return [];
  }
}

async function kvRead<T>(key: string): Promise<T | null> {
  const env = getTelemetryEnv();
  if (!env?.ORACLE_PREDICTIONS) return null;
  try {
    const raw = await env.ORACLE_PREDICTIONS.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (err) {
    console.error('[TELEMETRY] KV read failed:', key, err);
    return null;
  }
}

// ============================================================================
// DECISION LOG TYPES
// ============================================================================

export type DecisionType =
  | 'ALLOCATION_COMPUTED'
  | 'REGIME_TRANSITION'
  | 'REBALANCE_EXECUTED'
  | 'KILL_SWITCH_ACTIVATED'
  | 'EMERGENCY_FREEZE'
  | 'CAPITAL_PRESERVATION_MODE'
  | 'CONFIDENCE_THROTTLE'
  | 'DE_RISK_MODE'
  | 'DATA_INTEGRITY_FAILURE'
  | 'STALE_DEGRADATION'
  | 'STRATEGY_OVERRIDE'
  | 'MANUAL_INTERVENTION';

export interface DecisionLogEntry {
  /** Unique ID */
  id: string;
  /** Timestamp */
  timestamp: string;
  /** Type of decision */
  decisionType: DecisionType;
  /** Severity level */
  severity: 'info' | 'warning' | 'critical';
  /** Human-readable summary */
  summary: string;
  /** Detailed decision context */
  context: DecisionContext;
  /** What action was taken */
  action: string;
  /** Why this action was taken */
  reasoning: string[];
  /** What the alternatives were */
  alternatives: string[];
  /** Data quality at decision time */
  dataQuality: DataLabel;
  /** Confidence at decision time */
  confidence: number;
  /** Regime at decision time */
  regime: CapitalRegime;
  /** Which X10 directives were active */
  activeDirectives: string[];
  /** Outcome tracking (filled later) */
  outcome: DecisionOutcome | null;
  /** Related decision IDs */
  relatedDecisions: string[];
}

export interface DecisionContext {
  /** Capital at time of decision */
  capitalUSD: number;
  /** Portfolio value */
  portfolioValueUSD: number;
  /** Current allocations (summary) */
  allocations: { productId: string; weight: number }[];
  /** Signal summary */
  signals: {
    regime: MacroRegimeX10;
    aggregateConfidence: number;
    volatilityRegime: VolatilityRegime;
    liquidityCondition: LiquidityCondition;
  };
  /** Macro data source */
  macroSource: DataLabel;
  /** Data age in minutes */
  dataAgeMinutes: number;
  /** Real data percentage */
  realDataPct: number;
  /** Strategic mode */
  strategicMode: StrategicMode;
  /** Scaling phase */
  scalingPhase: string;
}

export interface DecisionOutcome {
  /** When the outcome was determined */
  resolvedAt: string;
  /** Was the decision correct in hindsight? */
  wasCorrect: boolean | null;
  /** Actual return after the decision */
  actualReturn: number | null;
  /** Human-readable outcome description */
  description: string;
  /** Lessons learned (optional) */
  lesson: string | null;
}

// ============================================================================
// EVENT TRACKING
// ============================================================================

export type EventType =
  | 'PIPELINE_EXECUTION'
  | 'DATA_FETCH'
  | 'DATA_DEGRADATION'
  | 'REGIME_CHANGE'
  | 'REBALANCE_TRIGGERED'
  | 'RISK_LIMIT_BREACH'
  | 'USER_ACTION'
  | 'SYSTEM_ERROR'
  | 'BACKTEST_RUN'
  | 'INTEGRITY_CHECK'
  | 'PAPER_TRADE_EXECUTED';

export interface EventLogEntry {
  id: string;
  timestamp: string;
  eventType: EventType;
  source: string;
  data: Record<string, unknown>;
  durationMs?: number;
  success: boolean;
  error?: string;
}

// ============================================================================
// TELEMETRY STORE
// ============================================================================

const MAX_DECISION_LOG = 1000;
const MAX_EVENT_LOG = 5000;
const MAX_METRICS_HISTORY = 1000;

let decisionLog: DecisionLogEntry[] = [];
let eventLog: EventLogEntry[] = [];
let metricsHistory: MetricsSnapshot[] = [];

// Running counters
let pipelineExecutions = 0;
let regimeTransitions = 0;
let rebalancesExecuted = 0;
let killSwitchActivations = 0;
let emergencyFreezes = 0;
let dataIntegrityFailures = 0;
let staleDegradations = 0;

interface MetricsSnapshot {
  timestamp: string;
  pipelineExecutions: number;
  regimeTransitions: number;
  rebalancesExecuted: number;
  killSwitchActivations: number;
  emergencyFreezes: number;
  dataIntegrityFailures: number;
  staleDegradations: number;
  avgConfidence: number;
  avgReturnPrediction: number;
  regimeDistribution: Record<CapitalRegime, number>;
}

// ============================================================================
// DECISION LOGGING API
// ============================================================================

let decisionCounter = 0;

export function logDecision(params: {
  decisionType: DecisionType;
  severity?: 'info' | 'warning' | 'critical';
  summary: string;
  context: DecisionContext;
  action: string;
  reasoning: string[];
  alternatives?: string[];
  outcome?: DecisionOutcome | null;
  relatedDecisions?: string[];
}): DecisionLogEntry {
  const id = `DEC-${++decisionCounter}-${Date.now()}`;
  const timestamp = new Date().toISOString();

  const entry: DecisionLogEntry = {
    id,
    timestamp,
    decisionType: params.decisionType,
    severity: params.severity ?? 'info',
    summary: params.summary,
    context: params.context,
    action: params.action,
    reasoning: params.reasoning,
    alternatives: params.alternatives ?? [],
    dataQuality: params.context.macroSource,
    confidence: params.context.signals.aggregateConfidence,
    regime: mapRegimeToCapital(params.context.signals.regime),
    activeDirectives: computeActiveDirectives(params.context),
    outcome: params.outcome ?? null,
    relatedDecisions: params.relatedDecisions ?? [],
  };

  decisionLog.push(entry);
  if (decisionLog.length > MAX_DECISION_LOG) {
    decisionLog = decisionLog.slice(-MAX_DECISION_LOG);
  }

  // FIX_CRON_TELEMETRY_BACKTEST (Fix 2): persist to KV (fire-and-forget)
  kvWrite(
    KV_KEY_PREFIX_DECISION + entry.id,
    JSON.stringify(entry),
    KV_TTL_DECISION_SECONDS,
  );

  // Update counters
  switch (params.decisionType) {
    case 'REGIME_TRANSITION': regimeTransitions++; break;
    case 'REBALANCE_EXECUTED': rebalancesExecuted++; break;
    case 'KILL_SWITCH_ACTIVATED': killSwitchActivations++; break;
    case 'EMERGENCY_FREEZE': emergencyFreezes++; break;
    case 'DATA_INTEGRITY_FAILURE': dataIntegrityFailures++; break;
    case 'STALE_DEGRADATION': staleDegradations++; break;
  }

  return entry;
}

export function resolveDecision(
  decisionId: string,
  outcome: DecisionOutcome,
): void {
  const entry = decisionLog.find(d => d.id === decisionId);
  if (entry) {
    entry.outcome = outcome;
  }
}

// ============================================================================
// EVENT LOGGING API
// ============================================================================

let eventCounter = 0;

export function logEvent(params: {
  eventType: EventType;
  source: string;
  data?: Record<string, unknown>;
  durationMs?: number;
  success?: boolean;
  error?: string;
}): EventLogEntry {
  const id = `EVT-${++eventCounter}-${Date.now()}`;

  const entry: EventLogEntry = {
    id,
    timestamp: new Date().toISOString(),
    eventType: params.eventType,
    source: params.source,
    data: params.data ?? {},
    durationMs: params.durationMs,
    success: params.success ?? true,
    error: params.error,
  };

  eventLog.push(entry);
  if (eventLog.length > MAX_EVENT_LOG) {
    eventLog = eventLog.slice(-MAX_EVENT_LOG);
  }

  // FIX_CRON_TELEMETRY_BACKTEST (Fix 2): persist to KV (fire-and-forget)
  kvWrite(
    KV_KEY_PREFIX_EVENT + entry.id,
    JSON.stringify(entry),
    KV_TTL_EVENT_SECONDS,
  );

  // Update counters
  if (params.eventType === 'PIPELINE_EXECUTION') {
    pipelineExecutions++;
  }

  return entry;
}

// ============================================================================
// METRICS SNAPSHOT
// ============================================================================

export function recordMetricsSnapshot(
  avgConfidence: number,
  avgReturnPrediction: number,
  regimeDistribution: Record<CapitalRegime, number>,
): void {
  const snapshot: MetricsSnapshot = {
    timestamp: new Date().toISOString(),
    pipelineExecutions,
    regimeTransitions,
    rebalancesExecuted,
    killSwitchActivations,
    emergencyFreezes,
    dataIntegrityFailures,
    staleDegradations,
    avgConfidence,
    avgReturnPrediction,
    regimeDistribution,
  };

  metricsHistory.push(snapshot);
  if (metricsHistory.length > MAX_METRICS_HISTORY) {
    metricsHistory = metricsHistory.slice(-MAX_METRICS_HISTORY);
  }

  // FIX_CRON_TELEMETRY_BACKTEST (Fix 2): persist to KV (fire-and-forget)
  kvWrite(
    KV_KEY_PREFIX_METRIC + snapshot.timestamp,
    JSON.stringify(snapshot),
    KV_TTL_METRICS_SECONDS,
  );
}

// ============================================================================
// QUERY API
// FIX_CRON_TELEMETRY_BACKTEST (Fix 2): all query functions are now ASYNC
// and prefer KV reads. In-memory arrays remain as fallback for tests / when
// KV binding is unavailable.
// ============================================================================

export async function getDecisionLog(filters?: {
  decisionType?: DecisionType;
  severity?: 'info' | 'warning' | 'critical';
  regime?: CapitalRegime;
  since?: string;
  limit?: number;
}): Promise<DecisionLogEntry[]> {
  const limit = filters?.limit ?? 50;

  // Try KV first — source of truth across isolates
  const env = getTelemetryEnv();
  let kvEntries: DecisionLogEntry[] = [];
  if (env?.ORACLE_PREDICTIONS) {
    try {
      const listLimit = Math.max(limit, 500); // fetch more so filters have room
      const keys = await kvList(KV_KEY_PREFIX_DECISION, listLimit);
      const reads = await Promise.all(keys.map(k => kvRead<DecisionLogEntry>(k)));
      kvEntries = reads.filter((e): e is DecisionLogEntry => e !== null);
    } catch (err) {
      console.error('[TELEMETRY] getDecisionLog KV read failed:', err);
    }
  }

  // Merge with in-memory (in case the most recent write hasn't propagated yet)
  const merged = new Map<string, DecisionLogEntry>();
  for (const e of kvEntries) merged.set(e.id, e);
  for (const e of decisionLog) merged.set(e.id, e);

  let entries = Array.from(merged.values());

  if (filters?.decisionType) {
    entries = entries.filter(e => e.decisionType === filters.decisionType);
  }
  if (filters?.severity) {
    entries = entries.filter(e => e.severity === filters.severity);
  }
  if (filters?.regime) {
    entries = entries.filter(e => e.regime === filters.regime);
  }
  if (filters?.since) {
    entries = entries.filter(e => e.timestamp >= filters.since!);
  }

  // Sort newest first, then slice to limit
  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return entries.slice(0, limit);
}

export async function getEventLog(filters?: {
  eventType?: EventType;
  source?: string;
  since?: string;
  limit?: number;
}): Promise<EventLogEntry[]> {
  const limit = filters?.limit ?? 100;

  const env = getTelemetryEnv();
  let kvEntries: EventLogEntry[] = [];
  if (env?.ORACLE_PREDICTIONS) {
    try {
      const listLimit = Math.max(limit, 500);
      const keys = await kvList(KV_KEY_PREFIX_EVENT, listLimit);
      const reads = await Promise.all(keys.map(k => kvRead<EventLogEntry>(k)));
      kvEntries = reads.filter((e): e is EventLogEntry => e !== null);
    } catch (err) {
      console.error('[TELEMETRY] getEventLog KV read failed:', err);
    }
  }

  const merged = new Map<string, EventLogEntry>();
  for (const e of kvEntries) merged.set(e.id, e);
  for (const e of eventLog) merged.set(e.id, e);

  let entries = Array.from(merged.values());

  if (filters?.eventType) {
    entries = entries.filter(e => e.eventType === filters.eventType);
  }
  if (filters?.source) {
    entries = entries.filter(e => e.source === filters.source);
  }
  if (filters?.since) {
    entries = entries.filter(e => e.timestamp >= filters.since!);
  }

  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return entries.slice(0, limit);
}

export async function getTelemetrySummary(): Promise<{
  // Counters
  pipelineExecutions: number;
  regimeTransitions: number;
  rebalancesExecuted: number;
  killSwitchActivations: number;
  emergencyFreezes: number;
  dataIntegrityFailures: number;
  staleDegradations: number;
  // Recent metrics
  recentConfidence: number;
  recentRegime: CapitalRegime | null;
  // Decision quality
  decisionsWithOutcome: number;
  correctDecisions: number;
  decisionAccuracy: number;
  // Data quality
  dataQualityDistribution: Record<DataLabel, number>;
  // Last execution
  lastPipelineExecution: string | null;
  lastRegimeChange: string | null;
  // FIX_CRON_TELEMETRY_BACKTEST (Fix 2): KV-backed persistence stats
  totalDecisions: number;
  daysOfHistory: number | null;
  oldestDecision: string | null;
  newestDecision: string | null;
}> {
  // Pull all decisions (KV-first) so we can compute aggregate stats
  const allDecisions = await getDecisionLog({ limit: 1000 });

  // Recent confidence (last 10)
  const recentDecisions = allDecisions.slice(0, 10);
  const recentConfidence = recentDecisions.length > 0
    ? recentDecisions.reduce((s, d) => s + d.confidence, 0) / recentDecisions.length
    : 0;

  // Recent regime (last REGIME_TRANSITION)
  const regimeDecisions = allDecisions.filter(d => d.decisionType === 'REGIME_TRANSITION');
  const recentRegime = regimeDecisions.length > 0
    ? regimeDecisions[0].regime
    : null;

  // Decision quality
  const withOutcome = allDecisions.filter(d => d.outcome !== null);
  const correct = withOutcome.filter(d => d.outcome?.wasCorrect === true);
  const decisionAccuracy = withOutcome.length > 0 ? correct.length / withOutcome.length : 0;

  // Data quality distribution (last 100)
  const dataQualityDistribution: Record<string, number> = {};
  for (const d of allDecisions.slice(0, 100)) {
    dataQualityDistribution[d.dataQuality] = (dataQualityDistribution[d.dataQuality] ?? 0) + 1;
  }

  // Persistence stats
  const totalDecisions = allDecisions.length;
  const sortedByTime = [...allDecisions].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const oldest = sortedByTime[0];
  const newest = sortedByTime[sortedByTime.length - 1];
  const oldestDecision = oldest?.timestamp ?? null;
  const newestDecision = newest?.timestamp ?? null;
  let daysOfHistory: number | null = null;
  if (oldest) {
    const ms = Date.now() - new Date(oldest.timestamp).getTime();
    daysOfHistory = Math.floor(ms / (1000 * 60 * 60 * 24));
  }

  // Pull all events for lastPipelineExecution
  const allEvents = await getEventLog({ limit: 1000 });

  // U3_2026_07_09_GEMINI: dynamic counters from KV logs to survive cold starts.
  // Pre-fix: pipelineExecutions, regimeTransitions, etc. were module-scope
  // `let` variables that reset to 0 on every isolate cold start. The counter
  // never persisted across invocations, making telemetry numbers meaningless
  // for trend analysis. Now we derive them dynamically from the loaded KV logs.
  // Math.max(memoryCounter, dynamicCounter) preserves any hot execution that
  // occurred before the latest KV write flushed.
  const dynamicPipelineExecutions = allEvents.filter(e => e.eventType === 'PIPELINE_EXECUTION').length;
  const dynamicRegimeTransitions = allDecisions.filter(d => d.decisionType === 'REGIME_TRANSITION').length;
  const dynamicRebalancesExecuted = allDecisions.filter(d => d.decisionType === 'REBALANCE_EXECUTED').length;
  const dynamicKillSwitchActivations = allDecisions.filter(d => d.decisionType === 'KILL_SWITCH_ACTIVATED').length;
  const dynamicEmergencyFreezes = allDecisions.filter(d => d.decisionType === 'EMERGENCY_FREEZE').length;
  const dynamicDataIntegrityFailures = allDecisions.filter(d => d.decisionType === 'DATA_INTEGRITY_FAILURE').length;
  const dynamicStaleDegradations = allDecisions.filter(d => d.decisionType === 'STALE_DEGRADATION').length;

  return {
    pipelineExecutions: Math.max(pipelineExecutions, dynamicPipelineExecutions),
    regimeTransitions: Math.max(regimeTransitions, dynamicRegimeTransitions),
    rebalancesExecuted: Math.max(rebalancesExecuted, dynamicRebalancesExecuted),
    killSwitchActivations: Math.max(killSwitchActivations, dynamicKillSwitchActivations),
    emergencyFreezes: Math.max(emergencyFreezes, dynamicEmergencyFreezes),
    dataIntegrityFailures: Math.max(dataIntegrityFailures, dynamicDataIntegrityFailures),
    staleDegradations: Math.max(staleDegradations, dynamicStaleDegradations),
    recentConfidence: Math.round(recentConfidence * 100) / 100,
    recentRegime,
    decisionsWithOutcome: withOutcome.length,
    correctDecisions: correct.length,
    decisionAccuracy: Math.round(decisionAccuracy * 100) / 100,
    dataQualityDistribution: dataQualityDistribution as Record<DataLabel, number>,
    // FIX_CRON_RECURSION_2026_07_09 (Fix C): only advance lastPipelineExecution
    // when the cron event was successful (persistence_verified && jobs_failed=0).
    // Pre-fix, this counter advanced even on silent-failure crons (jobs_ok>0 but
    // 0 KV writes), making the timestamp misleading. Now it only advances on
    // genuine success — stale timestamps surface real problems.
    lastPipelineExecution: allEvents.find(
      e => e.eventType === 'PIPELINE_EXECUTION' && e.success === true,
    )?.timestamp ?? null,
    lastRegimeChange: regimeDecisions[0]?.timestamp ?? null,
    totalDecisions,
    daysOfHistory,
    oldestDecision,
    newestDecision,
  };
}

export async function getMetricsHistory(count: number = 50): Promise<MetricsSnapshot[]> {
  const env = getTelemetryEnv();
  let kvEntries: MetricsSnapshot[] = [];
  if (env?.ORACLE_PREDICTIONS) {
    try {
      const keys = await kvList(KV_KEY_PREFIX_METRIC, count);
      const reads = await Promise.all(keys.map(k => kvRead<MetricsSnapshot>(k)));
      kvEntries = reads.filter((e): e is MetricsSnapshot => e !== null);
    } catch (err) {
      console.error('[TELEMETRY] getMetricsHistory KV read failed:', err);
    }
  }

  const merged = new Map<string, MetricsSnapshot>();
  for (const e of kvEntries) merged.set(e.timestamp, e);
  for (const e of metricsHistory) merged.set(e.timestamp, e);

  const all = Array.from(merged.values());
  all.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return all.slice(0, count);
}

// ============================================================================
// HELPERS
// ============================================================================

function mapRegimeToCapital(regime: MacroRegimeX10): CapitalRegime {
  switch (regime) {
    case 'CARRY_FAVORABLE': return 'CARRY_FAVORABLE';
    case 'CARRY_NEUTRAL': return 'NORMAL';
    case 'WARNING': return 'HIGH_VOL';
    case 'CRISIS': return 'CRISIS';
    case 'GLOBAL_RISK_OFF': return 'CRISIS';
    default: return 'NORMAL';
  }
}

function computeActiveDirectives(context: DecisionContext): string[] {
  const directives: string[] = [];
  if (context.signals.aggregateConfidence < 0.7) {
    directives.push('CONFIDENCE_THROTTLE');
  }
  if (context.macroSource === 'STALE' || context.macroSource === 'ERROR') {
    directives.push('CAPITAL_PRESERVATION_FALLBACK');
  }
  if (context.macroSource === 'ERROR') {
    directives.push('EMERGENCY_FREEZE');
  }
  if (context.realDataPct < 30) {
    directives.push('LOW_DATA_QUALITY');
  }
  if (context.signals.volatilityRegime === 'crisis' || context.signals.volatilityRegime === 'stressed') {
    directives.push('HIGH_VOLATILITY_REGIME');
  }
  if (context.signals.liquidityCondition === 'stressed' || context.signals.liquidityCondition === 'frozen') {
    directives.push('LIQUIDITY_STRESS');
  }
  return directives;
}

/** Reset telemetry state (for testing) */
export function resetTelemetry(): void {
  decisionLog = [];
  eventLog = [];
  metricsHistory = [];
  pipelineExecutions = 0;
  regimeTransitions = 0;
  rebalancesExecuted = 0;
  killSwitchActivations = 0;
  emergencyFreezes = 0;
  dataIntegrityFailures = 0;
  staleDegradations = 0;
  decisionCounter = 0;
  eventCounter = 0;
}

// ============================================================================
// PERSISTENT STORAGE — KV/D1 write for durable telemetry
// FAIL SYSTEM if telemetry write fails
// ============================================================================

export interface PersistentTelemetryConfig {
  kvNamespace?: KVNamespace;
  d1Database?: D1Database;
}

let persistentConfig: PersistentTelemetryConfig = {};

/** Configure persistent storage for telemetry */
export function configurePersistentTelemetry(config: PersistentTelemetryConfig): void {
  persistentConfig = config;
}

/** Persist a decision log entry to KV — FAIL if write fails */
export async function persistDecision(entry: DecisionLogEntry): Promise<void> {
  if (!persistentConfig.kvNamespace) return; // No KV configured — skip
  try {
    const key = `decision:${entry.id}`;
    await persistentConfig.kvNamespace.put(key, JSON.stringify(entry), { expirationTtl: 86400 * 90 }); // 90 days
  } catch (err) {
    // TELEMETRY PERSISTENCE FAILURE — this is a critical error
    console.error('CRITICAL: Telemetry persist failed for decision', entry.id, err);
    throw new Error(`TELEMETRY_PERSIST_FAILED: Decision ${entry.id} could not be persisted — ${err}`);
  }
}

/** Persist an event log entry to KV — FAIL if write fails */
export async function persistEvent(entry: EventLogEntry): Promise<void> {
  if (!persistentConfig.kvNamespace) return; // No KV configured — skip
  try {
    const key = `event:${entry.id}`;
    await persistentConfig.kvNamespace.put(key, JSON.stringify(entry), { expirationTtl: 86400 * 30 }); // 30 days
  } catch (err) {
    console.error('CRITICAL: Telemetry persist failed for event', entry.id, err);
    throw new Error(`TELEMETRY_PERSIST_FAILED: Event ${entry.id} could not be persisted — ${err}`);
  }
}

/** Persist metrics snapshot to D1 — FAIL if write fails */
export async function persistMetrics(snapshot: MetricsSnapshot): Promise<void> {
  if (!persistentConfig.d1Database) return; // No D1 configured — skip
  try {
    await persistentConfig.d1Database.prepare(
      'INSERT INTO metrics_history (id, timestamp, pipeline_executions, regime_transitions, rebalances, avg_confidence) VALUES (?,?,?,?,?,?)'
    ).bind(
      `MH-${Date.now()}`,
      snapshot.timestamp,
      snapshot.pipelineExecutions,
      snapshot.regimeTransitions,
      snapshot.rebalancesExecuted,
      snapshot.avgConfidence
    ).run();
  } catch (err) {
    console.error('CRITICAL: Metrics persist failed', err);
    throw new Error(`TELEMETRY_PERSIST_FAILED: Metrics could not be persisted — ${err}`);
  }
}
