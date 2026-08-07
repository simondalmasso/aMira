// Canonical telemetry: auditable memory buffer with explicit KV durability.

import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { CapitalRegime } from './capital-buckets';
import type { DataLabel } from './live-data';
import type { MacroRegimeX10, VolatilityRegime, LiquidityCondition } from './x10-signal-layer';
import type { StrategicMode } from './x10-strategy-layer';

const BINDING = 'ORACLE_PREDICTIONS' as const;
const PREFIX = {
  decision: 'telemetry:decision:',
  event: 'telemetry:event:',
  metric: 'telemetry:metric:',
} as const;
const TTL = { decision: 90 * 86400, event: 30 * 86400, metric: 90 * 86400 } as const;

type TelemetryEnv = { ORACLE_PREDICTIONS?: KVNamespace };
export type TelemetryStorageState = 'durable' | 'degraded-memory' | 'unavailable';
export interface TelemetryStorageStatus {
  state: TelemetryStorageState;
  binding: typeof BINDING;
  bindingAvailable: boolean;
  pendingWrites: number;
  lastSuccessfulReadAt: string | null;
  lastSuccessfulWriteAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
}

let explicitKv: KVNamespace | null = null;
let storage: Omit<TelemetryStorageStatus, 'pendingWrites'> = {
  state: 'degraded-memory', binding: BINDING, bindingAvailable: false,
  lastSuccessfulReadAt: null, lastSuccessfulWriteAt: null,
  lastErrorAt: null, lastError: null,
};
const pendingWrites = new Set<Promise<void>>();

function message(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
function runtimeKv(): KVNamespace | null {
  if (explicitKv) return explicitKv;
  try {
    const env = getCloudflareContext().env as TelemetryEnv;
    return env.ORACLE_PREDICTIONS ?? null;
  } catch {
    return null;
  }
}
function markBinding(kv: KVNamespace | null): void {
  if (!kv) storage = { ...storage, state: 'degraded-memory', bindingAvailable: false };
  else if (storage.state !== 'unavailable') storage = { ...storage, state: 'durable', bindingAvailable: true };
}
function markSuccess(kind: 'read' | 'write'): void {
  const now = new Date().toISOString();
  storage = {
    ...storage, state: 'durable', bindingAvailable: true,
    lastSuccessfulReadAt: kind === 'read' ? now : storage.lastSuccessfulReadAt,
    lastSuccessfulWriteAt: kind === 'write' ? now : storage.lastSuccessfulWriteAt,
    lastErrorAt: null, lastError: null,
  };
}
function markFailure(error: unknown): void {
  storage = {
    ...storage, state: 'unavailable', bindingAvailable: true,
    lastErrorAt: new Date().toISOString(), lastError: message(error),
  };
}
export function getTelemetryStorageStatus(): TelemetryStorageStatus {
  markBinding(runtimeKv());
  return { ...storage, pendingWrites: pendingWrites.size };
}
export interface PersistentTelemetryConfig { kvNamespace?: KVNamespace }
export function configurePersistentTelemetry(config: PersistentTelemetryConfig): void {
  explicitKv = config.kvNamespace ?? null;
  markBinding(explicitKv);
}

async function writeConfirmed(key: string, value: unknown, ttl: number): Promise<void> {
  const kv = runtimeKv();
  markBinding(kv);
  if (!kv) throw new Error(`TELEMETRY_STORAGE_DEGRADED: ${BINDING} is not available`);
  try {
    await kv.put(key, JSON.stringify(value), { expirationTtl: ttl });
    markSuccess('write');
  } catch (error) {
    markFailure(error);
    throw new Error(`TELEMETRY_PERSIST_FAILED: ${key}: ${message(error)}`);
  }
}
function scheduleWrite(key: string, value: unknown, ttl: number): void {
  const operation = writeConfirmed(key, value, ttl)
    .catch((error) => console.error('[TELEMETRY] durable write failed', key, error))
    .finally(() => pendingWrites.delete(operation));
  pendingWrites.add(operation);
}
export async function flushTelemetryWrites(): Promise<TelemetryStorageStatus> {
  await Promise.allSettled(Array.from(pendingWrites));
  return getTelemetryStorageStatus();
}
async function listRead<T>(prefix: string, limit: number): Promise<T[]> {
  const kv = runtimeKv();
  markBinding(kv);
  if (!kv) return [];
  try {
    const listed = await kv.list({ prefix, limit });
    const values = await Promise.all(listed.keys.map(async ({ name }) => {
      const raw = await kv.get(name);
      return raw ? JSON.parse(raw) as T : null;
    }));
    markSuccess('read');
    return values.flatMap((value) => value === null ? [] : [value]);
  } catch (error) {
    markFailure(error);
    return [];
  }
}

export type DecisionType =
  | 'ALLOCATION_COMPUTED' | 'REGIME_TRANSITION' | 'REBALANCE_EXECUTED'
  | 'KILL_SWITCH_ACTIVATED' | 'EMERGENCY_FREEZE' | 'CAPITAL_PRESERVATION_MODE'
  | 'CONFIDENCE_THROTTLE' | 'DE_RISK_MODE' | 'DATA_INTEGRITY_FAILURE'
  | 'STALE_DEGRADATION' | 'STRATEGY_OVERRIDE' | 'MANUAL_INTERVENTION';
export interface DecisionContext {
  capitalUSD: number;
  portfolioValueUSD: number;
  allocations: { productId: string; weight: number }[];
  signals: {
    regime: MacroRegimeX10;
    aggregateConfidence: number;
    volatilityRegime: VolatilityRegime;
    liquidityCondition: LiquidityCondition;
  };
  macroSource: DataLabel;
  dataAgeMinutes: number;
  realDataPct: number;
  strategicMode: StrategicMode;
  scalingPhase: string;
}
export interface DecisionOutcome {
  resolvedAt: string;
  wasCorrect: boolean | null;
  actualReturn: number | null;
  description: string;
  lesson: string | null;
}
export interface DecisionLogEntry {
  id: string;
  timestamp: string;
  decisionType: DecisionType;
  severity: 'info' | 'warning' | 'critical';
  summary: string;
  context: DecisionContext;
  action: string;
  reasoning: string[];
  alternatives: string[];
  dataQuality: DataLabel;
  confidence: number;
  regime: CapitalRegime;
  activeDirectives: string[];
  outcome: DecisionOutcome | null;
  relatedDecisions: string[];
}
export type EventType =
  | 'PIPELINE_EXECUTION' | 'DATA_FETCH' | 'DATA_DEGRADATION' | 'REGIME_CHANGE'
  | 'REBALANCE_TRIGGERED' | 'RISK_LIMIT_BREACH' | 'USER_ACTION' | 'SYSTEM_ERROR'
  | 'BACKTEST_RUN' | 'INTEGRITY_CHECK' | 'PAPER_TRADE_EXECUTED';
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
export interface MetricsSnapshot {
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

const decisions: DecisionLogEntry[] = [];
const events: EventLogEntry[] = [];
const metrics: MetricsSnapshot[] = [];
let decisionCounter = 0;
let eventCounter = 0;
let counters = {
  pipelineExecutions: 0, regimeTransitions: 0, rebalancesExecuted: 0,
  killSwitchActivations: 0, emergencyFreezes: 0,
  dataIntegrityFailures: 0, staleDegradations: 0,
};

function capitalRegime(regime: MacroRegimeX10): CapitalRegime {
  if (regime === 'CARRY_FAVORABLE') return 'CARRY_FAVORABLE';
  if (regime === 'WARNING') return 'HIGH_VOL';
  if (regime === 'CRISIS' || regime === 'GLOBAL_RISK_OFF') return 'CRISIS';
  return 'NORMAL';
}
function directives(context: DecisionContext): string[] {
  const result: string[] = [];
  if (context.signals.aggregateConfidence < 0.7) result.push('CONFIDENCE_THROTTLE');
  if (context.macroSource === 'STALE' || context.macroSource === 'ERROR') result.push('CAPITAL_PRESERVATION_FALLBACK');
  if (context.macroSource === 'ERROR') result.push('EMERGENCY_FREEZE');
  if (context.realDataPct < 30) result.push('LOW_DATA_QUALITY');
  if (['crisis', 'stressed'].includes(context.signals.volatilityRegime)) result.push('HIGH_VOLATILITY_REGIME');
  if (['stressed', 'frozen'].includes(context.signals.liquidityCondition)) result.push('LIQUIDITY_STRESS');
  return result;
}
function remember<T>(array: T[], value: T, limit: number): void {
  array.push(value);
  if (array.length > limit) array.splice(0, array.length - limit);
}

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
  const entry: DecisionLogEntry = {
    id: `DEC-${++decisionCounter}-${Date.now()}`,
    timestamp: new Date().toISOString(),
    decisionType: params.decisionType,
    severity: params.severity ?? 'info',
    summary: params.summary,
    context: params.context,
    action: params.action,
    reasoning: params.reasoning,
    alternatives: params.alternatives ?? [],
    dataQuality: params.context.macroSource,
    confidence: params.context.signals.aggregateConfidence,
    regime: capitalRegime(params.context.signals.regime),
    activeDirectives: directives(params.context),
    outcome: params.outcome ?? null,
    relatedDecisions: params.relatedDecisions ?? [],
  };
  remember(decisions, entry, 1000);
  scheduleWrite(PREFIX.decision + entry.id, entry, TTL.decision);
  if (entry.decisionType === 'REGIME_TRANSITION') counters.regimeTransitions++;
  if (entry.decisionType === 'REBALANCE_EXECUTED') counters.rebalancesExecuted++;
  if (entry.decisionType === 'KILL_SWITCH_ACTIVATED') counters.killSwitchActivations++;
  if (entry.decisionType === 'EMERGENCY_FREEZE') counters.emergencyFreezes++;
  if (entry.decisionType === 'DATA_INTEGRITY_FAILURE') counters.dataIntegrityFailures++;
  if (entry.decisionType === 'STALE_DEGRADATION') counters.staleDegradations++;
  return entry;
}
export function resolveDecision(id: string, outcome: DecisionOutcome): void {
  const entry = decisions.find((item) => item.id === id);
  if (entry) {
    entry.outcome = outcome;
    scheduleWrite(PREFIX.decision + entry.id, entry, TTL.decision);
  }
}
export function logEvent(params: {
  eventType: EventType;
  source: string;
  data?: Record<string, unknown>;
  durationMs?: number;
  success?: boolean;
  error?: string;
}): EventLogEntry {
  const entry: EventLogEntry = {
    id: `EVT-${++eventCounter}-${Date.now()}`,
    timestamp: new Date().toISOString(), eventType: params.eventType,
    source: params.source, data: params.data ?? {}, durationMs: params.durationMs,
    success: params.success ?? true, error: params.error,
  };
  remember(events, entry, 5000);
  scheduleWrite(PREFIX.event + entry.id, entry, TTL.event);
  if (entry.eventType === 'PIPELINE_EXECUTION') counters.pipelineExecutions++;
  return entry;
}
export function recordMetricsSnapshot(
  avgConfidence: number,
  avgReturnPrediction: number,
  regimeDistribution: Record<CapitalRegime, number>,
): void {
  const snapshot: MetricsSnapshot = {
    timestamp: new Date().toISOString(), ...counters,
    avgConfidence, avgReturnPrediction, regimeDistribution,
  };
  remember(metrics, snapshot, 1000);
  scheduleWrite(PREFIX.metric + snapshot.timestamp, snapshot, TTL.metric);
}

function mergeById<T extends { id: string; timestamp: string }>(durable: T[], memory: T[]): T[] {
  const map = new Map<string, T>();
  durable.forEach((item) => map.set(item.id, item));
  memory.forEach((item) => map.set(item.id, item));
  return [...map.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
export async function getDecisionLog(filters?: {
  decisionType?: DecisionType;
  severity?: 'info' | 'warning' | 'critical';
  regime?: CapitalRegime;
  since?: string;
  limit?: number;
}): Promise<DecisionLogEntry[]> {
  let result = mergeById(await listRead<DecisionLogEntry>(PREFIX.decision, Math.max(filters?.limit ?? 50, 500)), decisions);
  if (filters?.decisionType) result = result.filter((item) => item.decisionType === filters.decisionType);
  if (filters?.severity) result = result.filter((item) => item.severity === filters.severity);
  if (filters?.regime) result = result.filter((item) => item.regime === filters.regime);
  if (filters?.since) result = result.filter((item) => item.timestamp >= filters.since!);
  return result.slice(0, filters?.limit ?? 50);
}
export async function getEventLog(filters?: {
  eventType?: EventType;
  source?: string;
  since?: string;
  limit?: number;
}): Promise<EventLogEntry[]> {
  let result = mergeById(await listRead<EventLogEntry>(PREFIX.event, Math.max(filters?.limit ?? 100, 500)), events);
  if (filters?.eventType) result = result.filter((item) => item.eventType === filters.eventType);
  if (filters?.source) result = result.filter((item) => item.source === filters.source);
  if (filters?.since) result = result.filter((item) => item.timestamp >= filters.since!);
  return result.slice(0, filters?.limit ?? 100);
}
export async function getMetricsHistory(count = 50): Promise<MetricsSnapshot[]> {
  const durable = await listRead<MetricsSnapshot>(PREFIX.metric, count);
  const map = new Map<string, MetricsSnapshot>();
  durable.forEach((item) => map.set(item.timestamp, item));
  metrics.forEach((item) => map.set(item.timestamp, item));
  return [...map.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, count);
}
export async function getTelemetrySummary() {
  const allDecisions = await getDecisionLog({ limit: 1000 });
  const allEvents = await getEventLog({ limit: 1000 });
  const recent = allDecisions.slice(0, 10);
  const outcomes = allDecisions.filter((item) => item.outcome);
  const correct = outcomes.filter((item) => item.outcome?.wasCorrect === true);
  const distribution = {} as Record<DataLabel, number>;
  allDecisions.slice(0, 100).forEach((item) => { distribution[item.dataQuality] = (distribution[item.dataQuality] ?? 0) + 1; });
  const ordered = [...allDecisions].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const oldestDecision = ordered[0]?.timestamp ?? null;
  const newestDecision = ordered.at(-1)?.timestamp ?? null;
  const daysOfHistory = oldestDecision ? Math.floor((Date.now() - Date.parse(oldestDecision)) / 86400000) : null;
  const regimeDecision = allDecisions.find((item) => item.decisionType === 'REGIME_TRANSITION');
  const countDecision = (type: DecisionType) => allDecisions.filter((item) => item.decisionType === type).length;
  const countEvent = (type: EventType) => allEvents.filter((item) => item.eventType === type).length;
  return {
    pipelineExecutions: Math.max(counters.pipelineExecutions, countEvent('PIPELINE_EXECUTION')),
    regimeTransitions: Math.max(counters.regimeTransitions, countDecision('REGIME_TRANSITION')),
    rebalancesExecuted: Math.max(counters.rebalancesExecuted, countDecision('REBALANCE_EXECUTED')),
    killSwitchActivations: Math.max(counters.killSwitchActivations, countDecision('KILL_SWITCH_ACTIVATED')),
    emergencyFreezes: Math.max(counters.emergencyFreezes, countDecision('EMERGENCY_FREEZE')),
    dataIntegrityFailures: Math.max(counters.dataIntegrityFailures, countDecision('DATA_INTEGRITY_FAILURE')),
    staleDegradations: Math.max(counters.staleDegradations, countDecision('STALE_DEGRADATION')),
    recentConfidence: recent.length ? Math.round(recent.reduce((sum, item) => sum + item.confidence, 0) / recent.length * 100) / 100 : 0,
    recentRegime: regimeDecision?.regime ?? null,
    decisionsWithOutcome: outcomes.length,
    correctDecisions: correct.length,
    decisionAccuracy: outcomes.length ? Math.round(correct.length / outcomes.length * 100) / 100 : 0,
    dataQualityDistribution: distribution,
    lastPipelineExecution: allEvents.find((item) => item.eventType === 'PIPELINE_EXECUTION' && item.success)?.timestamp ?? null,
    lastRegimeChange: regimeDecision?.timestamp ?? null,
    totalDecisions: allDecisions.length,
    daysOfHistory, oldestDecision, newestDecision,
    storage: getTelemetryStorageStatus(),
  };
}

export async function persistDecision(entry: DecisionLogEntry): Promise<void> {
  await writeConfirmed(PREFIX.decision + entry.id, entry, TTL.decision);
}
export async function persistEvent(entry: EventLogEntry): Promise<void> {
  await writeConfirmed(PREFIX.event + entry.id, entry, TTL.event);
}
export async function persistMetrics(entry: MetricsSnapshot): Promise<void> {
  await writeConfirmed(PREFIX.metric + entry.timestamp, entry, TTL.metric);
}
export function resetTelemetry(): void {
  decisions.length = 0; events.length = 0; metrics.length = 0;
  decisionCounter = 0; eventCounter = 0;
  counters = {
    pipelineExecutions: 0, regimeTransitions: 0, rebalancesExecuted: 0,
    killSwitchActivations: 0, emergencyFreezes: 0,
    dataIntegrityFailures: 0, staleDegradations: 0,
  };
  pendingWrites.clear();
}
