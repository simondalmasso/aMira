// ============================================================================
// Ω-X10 DATA INTEGRITY PIPELINE — typed validation, auditing and failure probes
// ============================================================================

import { z } from 'zod';
import type { DataLabel } from './live-data';

export const BluelyticsSchema = z.object({
  oficial: z.object({
    value_avg: z.number().min(100).max(5000),
    value_sell: z.number().min(100).max(5000),
    value_buy: z.number().min(100).max(5000),
  }),
  blue: z.object({
    value_avg: z.number().min(100).max(5000),
    value_sell: z.number().min(100).max(5000),
    value_buy: z.number().min(100).max(5000),
  }),
  last_update: z.string().min(1),
}).passthrough();

export const BCRARatesSchema = z.object({
  badlarTNA: z.number().min(-10).max(200),
  bcraPolicyTNA: z.number().min(-10).max(200),
  lecapsTNA: z.number().min(-10).max(200),
  officialRate: z.number().min(100).max(5000),
  isReal: z.boolean(),
  sourceUrl: z.string().min(1),
  dataDate: z.string().min(1),
}).passthrough();

export const CERDataSchema = z.object({
  index: z.number().min(1).max(100000),
  monthlyChange: z.number().min(-10).max(50),
  dailyChange: z.number().min(-5).max(5),
  isReal: z.boolean(),
  sourceUrl: z.string().min(1),
  dataDate: z.string().min(1),
}).passthrough();

export const INDECInflationSchema = z.object({
  lastMonthInflation: z.number().min(-5).max(30),
  projected30d: z.number().min(-5).max(30).optional(),
  projected90d: z.number().min(-5).max(30).optional(),
  twelveMonthAccum: z.number().min(-50).max(400).optional(),
  isReal: z.boolean(),
  sourceUrl: z.string().min(1),
  dataDate: z.string().min(1),
}).passthrough();

export const MEPDataSchema = z.object({
  rate: z.number().min(100).max(5000),
  officialRate: z.number().min(100).max(5000),
  gap: z.number().min(-50).max(200),
  sell: z.number().min(100).max(5000),
  buy: z.number().min(100).max(5000),
});

export const InflationDataSchema = z.object({
  monthly: z.number().min(-5).max(30),
  expected30d: z.number().min(-5).max(30),
  expected90d: z.number().min(-5).max(30),
  yearly: z.number().min(-50).max(400),
});

export const RatesDataSchema = z.object({
  bcraPolicy: z.number().min(-10).max(200),
  moneyMarket: z.number().min(-10).max(200),
  plazoFijo: z.number().min(-10).max(200),
  plazoFijoUVA: z.number().min(-10).max(50),
  lecaps: z.number().min(-10).max(200),
  badlar: z.number().min(-10).max(200),
  leliq: z.number().min(-10).max(200),
  tml: z.number().min(-10).max(200),
});

export const CERDataMacroSchema = z.object({
  index: z.number().min(1).max(100000),
  monthlyChange: z.number().min(-10).max(50),
  dailyChange: z.number().min(-5).max(5),
});

export const DataProvenanceSchema = z.object({
  label: z.enum(['OBSERVADO', 'REAL', 'STALE', 'ERROR', 'PARTIAL_FALLBACK', 'SIMULADO', 'RECONSTRUIDO']),
  dataClass: z.enum(['OBSERVED', 'RECONSTRUCTED', 'SYNTHETIC']),
  source: z.string().min(1),
  url: z.string(),
  lastUpdate: z.string().min(1),
  dataDate: z.string().min(1),
  stalenessHours: z.number().min(0).max(99999),
  fetchedAt: z.string().min(1),
  ageMinutes: z.number().min(0).max(99999),
  fetchError: z.boolean(),
  observedAt: z.string().nullable().optional(),
  coverage: z.string().optional(),
  limitations: z.array(z.string()).optional(),
  transformations: z.array(z.string()).optional(),
}).passthrough();

export const MacroStateSchema = z.object({
  lastUpdate: z.string().min(1),
  fetchedAt: z.string().min(1),
  ageMinutes: z.number().min(0),
  lastSuccessfulFetch: z.string().nullable(),
  source: z.enum(['OBSERVADO', 'REAL', 'STALE', 'ERROR', 'PARTIAL_FALLBACK']),
  mep: MEPDataSchema,
  inflation: InflationDataSchema,
  rates: RatesDataSchema,
  cer: CERDataMacroSchema,
  crawlingPeg: z.number().min(-5).max(50),
  realDataPct: z.number().min(0).max(100),
  provenance: z.object({
    mepRate: DataProvenanceSchema,
    inflation: DataProvenanceSchema,
    rates: DataProvenanceSchema,
    cer: DataProvenanceSchema,
    crawlingPeg: DataProvenanceSchema,
    reserves: DataProvenanceSchema,
  }),
}).passthrough();

export interface ValidationResult<T> {
  success: boolean;
  data: T | null;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  timestamp: string;
  schemaName: string;
}

export interface ValidationError {
  path: string;
  message: string;
  code: string;
  received?: unknown;
}

export interface ValidationWarning {
  path: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
}

export function validateData<T>(
  data: unknown,
  schema: z.ZodType<T>,
  schemaName: string,
): ValidationResult<T> {
  const timestamp = new Date().toISOString();
  try {
    const result = schema.safeParse(data);
    if (result.success) {
      return {
        success: true,
        data: result.data,
        errors: [],
        warnings: generateWarnings(result.data, schemaName),
        timestamp,
        schemaName,
      };
    }
    return {
      success: false,
      data: null,
      errors: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      })),
      warnings: [],
      timestamp,
      schemaName,
    };
  } catch (error) {
    console.error(`[data-integrity] ${schemaName} validator failed`, error);
    return {
      success: false,
      data: null,
      errors: [{ path: 'root', message: 'Validation failed unexpectedly', code: 'UNEXPECTED_ERROR' }],
      warnings: [],
      timestamp,
      schemaName,
    };
  }
}

function generateWarnings(data: unknown, schemaName: string): ValidationWarning[] {
  if (schemaName !== 'MacroState') return [];
  const parsed = MacroStateSchema.safeParse(data);
  if (!parsed.success) return [];
  const d = parsed.data;
  const warnings: ValidationWarning[] = [];

  if (d.mep.gap < 0) {
    warnings.push({ path: 'mep.gap', message: `MEP gap is negative (${d.mep.gap.toFixed(2)}%) — verify source integrity.`, severity: 'high' });
  }
  if (d.mep.gap > 100) {
    warnings.push({ path: 'mep.gap', message: `MEP gap is extremely wide (${d.mep.gap.toFixed(2)}%) — verify source integrity.`, severity: 'high' });
  }
  if (d.inflation.expected30d > 10) {
    warnings.push({ path: 'inflation.expected30d', message: `Monthly inflation expectation ${d.inflation.expected30d.toFixed(1)}% is extreme.`, severity: 'medium' });
  }
  if (d.rates.bcraPolicy < 0) {
    warnings.push({ path: 'rates.bcraPolicy', message: `BCRA policy rate is negative (${d.rates.bcraPolicy}%) — verify source integrity.`, severity: 'high' });
  }
  if (d.cer.monthlyChange !== 0 && d.inflation.monthly !== 0) {
    const gap = Math.abs(d.cer.monthlyChange - d.inflation.monthly);
    if (gap > 3) {
      warnings.push({ path: 'cer.monthlyChange', message: `CER/inflation divergence is ${gap.toFixed(1)}pp — verify both sources.`, severity: 'medium' });
    }
  }
  if (d.crawlingPeg > 3) {
    warnings.push({ path: 'crawlingPeg', message: `Crawling peg ${d.crawlingPeg.toFixed(1)}%/month is high — verify source/model state.`, severity: 'medium' });
  }
  if (d.source === 'REAL' && d.realDataPct < 30) {
    warnings.push({ path: 'realDataPct', message: `Source claims REAL but realDataPct is ${d.realDataPct}% — inconsistent labeling.`, severity: 'high' });
  }
  return warnings;
}

export interface APIAuditEntry {
  source: string;
  url: string;
  timestamp: string;
  validationSuccess: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  responseTimeMs: number | null;
  dataLabel: DataLabel;
  dataDate: string | null;
}

const auditLog: APIAuditEntry[] = [];
const MAX_AUDIT_LOG_SIZE = 1000;

export function auditAPIResponse<T>(
  source: string,
  url: string,
  data: unknown,
  schema: z.ZodType<T>,
  schemaName: string,
  responseTimeMs: number | null = null,
  dataLabel: DataLabel = 'ERROR',
  dataDate: string | null = null,
): ValidationResult<T> {
  const result = validateData(data, schema, schemaName);
  auditLog.push({
    source,
    url,
    timestamp: new Date().toISOString(),
    validationSuccess: result.success,
    errors: result.errors,
    warnings: result.warnings,
    responseTimeMs,
    dataLabel,
    dataDate,
  });
  if (auditLog.length > MAX_AUDIT_LOG_SIZE) auditLog.shift();
  return result;
}

export function getAuditLog(count = 50): APIAuditEntry[] {
  const bounded = Number.isFinite(count) ? Math.min(Math.max(Math.trunc(count), 1), MAX_AUDIT_LOG_SIZE) : 50;
  return auditLog.slice(-bounded);
}

export function getAuditStats(): {
  totalEntries: number;
  validationSuccessRate: number;
  recentErrors: number;
  recentWarnings: number;
  sourceBreakdown: Record<string, { total: number; success: number; failed: number }>;
} {
  const recent = auditLog.slice(-100);
  const sourceBreakdown: Record<string, { total: number; success: number; failed: number }> = {};
  for (const entry of recent) {
    const current = sourceBreakdown[entry.source] ?? { total: 0, success: 0, failed: 0 };
    current.total += 1;
    if (entry.validationSuccess) current.success += 1;
    else current.failed += 1;
    sourceBreakdown[entry.source] = current;
  }
  return {
    totalEntries: auditLog.length,
    validationSuccessRate: recent.length > 0 ? recent.filter((entry) => entry.validationSuccess).length / recent.length : 0,
    recentErrors: recent.filter((entry) => entry.errors.length > 0).length,
    recentWarnings: recent.filter((entry) => entry.warnings.length > 0).length,
    sourceBreakdown,
  };
}

export type FailureType =
  | 'NULL_RESPONSE'
  | 'EMPTY_OBJECT'
  | 'WRONG_TYPES'
  | 'EXTREME_VALUES'
  | 'STALE_DATA'
  | 'PARTIAL_FAILURE'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR';

export interface FailureSimulationResult {
  failureType: FailureType;
  component: string;
  result: 'PASSED' | 'DEGRADED' | 'FAILED' | 'FROZEN';
  dataLabel: string;
  confidenceScore: number;
  capitalPreservationMode: boolean;
  emergencyFreeze: boolean;
  details: string;
  timestamp: string;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function childRecord(record: UnknownRecord, key: string): UnknownRecord | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

function cloneRecord(input: UnknownRecord): UnknownRecord {
  const cloned: unknown = JSON.parse(JSON.stringify(input));
  return isRecord(cloned) ? cloned : {};
}

function markProvenance(record: UnknownRecord, label: 'STALE' | 'ERROR', ageMinutes?: number, stalenessHours?: number): void {
  const provenance = childRecord(record, 'provenance');
  if (!provenance) return;
  for (const key of Object.keys(provenance)) {
    const entry = childRecord(provenance, key);
    if (!entry) continue;
    entry.label = label;
    if (label === 'ERROR') entry.fetchError = true;
    if (ageMinutes !== undefined) entry.ageMinutes = ageMinutes;
    if (stalenessHours !== undefined) entry.stalenessHours = stalenessHours;
  }
}

export function generateCorruptedMacro(baseMacro: UnknownRecord, failureType: FailureType): UnknownRecord {
  const corrupted = cloneRecord(baseMacro);
  const mep = childRecord(corrupted, 'mep');
  const inflation = childRecord(corrupted, 'inflation');
  const rates = childRecord(corrupted, 'rates');

  switch (failureType) {
    case 'NULL_RESPONSE':
    case 'NETWORK_ERROR':
      return {};
    case 'EMPTY_OBJECT':
      return {
        lastUpdate: new Date().toISOString(), fetchedAt: new Date().toISOString(), ageMinutes: 0,
        lastSuccessfulFetch: null, source: 'ERROR',
        mep: { rate: 0, officialRate: 0, gap: 0, sell: 0, buy: 0 },
        inflation: { monthly: 0, expected30d: 0, expected90d: 0, yearly: 0 },
        rates: { bcraPolicy: 0, moneyMarket: 0, plazoFijo: 0, plazoFijoUVA: 0, lecaps: 0, badlar: 0, leliq: 0, tml: 0 },
        cer: { index: 0, monthlyChange: 0, dailyChange: 0 }, crawlingPeg: 0, realDataPct: 0, provenance: {},
      };
    case 'WRONG_TYPES':
      if (mep) mep.rate = 'not_a_number';
      if (inflation) inflation.monthly = 'high';
      if (rates) rates.bcraPolicy = null;
      return corrupted;
    case 'EXTREME_VALUES':
      if (mep) { mep.rate = 99999; mep.gap = 500; }
      if (inflation) { inflation.monthly = 50; inflation.expected30d = 80; }
      if (rates) { rates.bcraPolicy = -50; rates.moneyMarket = 500; }
      return corrupted;
    case 'STALE_DATA': {
      const stale = new Date();
      stale.setFullYear(stale.getFullYear() - 1);
      corrupted.fetchedAt = stale.toISOString();
      corrupted.ageMinutes = 525600;
      corrupted.source = 'STALE';
      markProvenance(corrupted, 'STALE', 525600, 8760);
      return corrupted;
    }
    case 'PARTIAL_FAILURE': {
      const provenance = childRecord(corrupted, 'provenance');
      if (provenance) {
        for (const key of ['mepRate', 'inflation']) {
          const entry = childRecord(provenance, key);
          if (entry) { entry.label = 'ERROR'; entry.fetchError = true; }
        }
      }
      corrupted.source = 'ERROR';
      corrupted.realDataPct = 30;
      return corrupted;
    }
    case 'RATE_LIMITED':
      corrupted.source = 'ERROR';
      corrupted.realDataPct = 0;
      markProvenance(corrupted, 'ERROR');
      return corrupted;
  }
}

export function runFailureSimulationSuite(
  baseMacro: UnknownRecord,
  x10EngineRunner: (macro: unknown) => {
    confidence: number;
    source: string;
    isCapitalPreservation: boolean;
    isEmergencyFreeze: boolean;
  },
): FailureSimulationResult[] {
  const failureTypes: FailureType[] = [
    'NULL_RESPONSE', 'EMPTY_OBJECT', 'WRONG_TYPES', 'EXTREME_VALUES',
    'STALE_DATA', 'PARTIAL_FAILURE', 'RATE_LIMITED', 'NETWORK_ERROR',
  ];

  return failureTypes.map((failureType) => {
    const corrupted = generateCorruptedMacro(baseMacro, failureType);
    const validation = validateData(corrupted, MacroStateSchema, 'MacroState');
    let result: FailureSimulationResult['result'] = 'FAILED';
    let confidence = 0;
    let source = 'ERROR';
    let capitalPreservation = true;
    let emergencyFreeze = true;
    let details = 'Input rejected by integrity gate';

    try {
      if (!validation.success && ['NULL_RESPONSE', 'NETWORK_ERROR', 'WRONG_TYPES'].includes(failureType)) {
        result = 'FROZEN';
      } else {
        const engine = x10EngineRunner(corrupted);
        confidence = engine.confidence;
        source = engine.source;
        capitalPreservation = engine.isCapitalPreservation;
        emergencyFreeze = engine.isEmergencyFreeze;
        result = emergencyFreeze ? 'FROZEN' : capitalPreservation || confidence < 0.5 ? 'DEGRADED' : 'PASSED';
        details = emergencyFreeze ? 'Emergency freeze activated' : capitalPreservation ? 'Capital preservation activated' : 'Failure handled without unhandled exception';
        if (failureType === 'EXTREME_VALUES' && result === 'PASSED') {
          result = 'FAILED';
          details = 'Extreme invalid values were accepted without degradation';
        }
      }
    } catch (error) {
      console.error(`[data-integrity] failure probe ${failureType} rejected`, error);
      result = 'FROZEN';
      confidence = 0;
      source = 'ERROR';
      capitalPreservation = true;
      emergencyFreeze = true;
      details = 'Failure probe rejected safely';
    }

    return {
      failureType,
      component: 'X10_Pipeline',
      result,
      dataLabel: source,
      confidenceScore: Math.round(confidence * 100) / 100,
      capitalPreservationMode: capitalPreservation,
      emergencyFreeze,
      details,
      timestamp: new Date().toISOString(),
    };
  });
}

export interface IntegrityGateResult {
  passed: boolean;
  macroValid: boolean;
  warnings: ValidationWarning[];
  criticalErrors: ValidationError[];
  dataQualityScore: number;
  recommendation: 'PROCEED' | 'PROCEED_WITH_CAUTION' | 'DEGRADED_MODE' | 'FREEZE';
  timestamp: string;
}

export function runIntegrityGate(macro: unknown): IntegrityGateResult {
  const timestamp = new Date().toISOString();
  const schemaResult = validateData(macro, MacroStateSchema, 'MacroState');
  if (!schemaResult.success || !schemaResult.data) {
    return {
      passed: false,
      macroValid: false,
      warnings: schemaResult.warnings,
      criticalErrors: schemaResult.errors,
      dataQualityScore: 0,
      recommendation: 'FREEZE',
      timestamp,
    };
  }

  const data = schemaResult.data;
  let qualityScore = 100 - (100 - data.realDataPct) * 0.3;
  if (data.source === 'STALE') qualityScore -= 20;
  else if (data.source === 'PARTIAL_FALLBACK') qualityScore -= 30;
  else if (data.source === 'ERROR') qualityScore -= 50;
  if (data.ageMinutes > 60) qualityScore -= 10;
  if (data.ageMinutes > 360) qualityScore -= 20;
  qualityScore -= schemaResult.warnings.length * 5;
  qualityScore = Math.max(0, Math.min(100, Math.round(qualityScore)));

  const recommendation: IntegrityGateResult['recommendation'] =
    qualityScore >= 80 && data.source === 'REAL' ? 'PROCEED'
      : qualityScore >= 60 ? 'PROCEED_WITH_CAUTION'
        : qualityScore >= 30 ? 'DEGRADED_MODE'
          : 'FREEZE';

  return {
    passed: recommendation !== 'FREEZE',
    macroValid: true,
    warnings: schemaResult.warnings,
    criticalErrors: [],
    dataQualityScore: qualityScore,
    recommendation,
    timestamp,
  };
}
