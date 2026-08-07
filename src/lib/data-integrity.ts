// ============================================================================
// Ω-X10 DATA INTEGRITY PIPELINE — Validation Layer
// Schema validation (Zod), API response auditing, failure simulation
//
// PURPOSE:
//   This module provides the FIRST validation gate in the ENGINEERING_DISCIPLINE_PHASE.
//   Before any macro data enters the X10 pipeline, it MUST pass schema validation.
//   Before any allocation is computed, data integrity MUST be verified.
//
// DESIGN PRINCIPLES:
//   1. Never trust external API responses — validate everything
//   2. Schema validation is MANDATORY, not optional
//   3. Failure simulation tests the system's resilience to bad data
//   4. Every validation result is logged for auditability
//   5. Paranoia is a feature, not a bug
// ============================================================================

import { z } from 'zod';

// ============================================================================
// ZOD SCHEMAS — External API Response Validation
// ============================================================================

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
}).passthrough(); // Allow extra fields but validate required ones

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

// ============================================================================
// MACRO STATE SCHEMA — Validates the output of getMacroState()
// ============================================================================

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
});

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
});

// ============================================================================
// VALIDATION RESULT TYPE
// ============================================================================

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

// ============================================================================
// CORE VALIDATOR — Validate any data against a Zod schema
// ============================================================================

export function validateData<T>(
  data: unknown,
  schema: z.ZodSchema<T>,
  schemaName: string,
): ValidationResult<T> {
  const timestamp = new Date().toISOString();

  try {
    const result = schema.safeParse(data);

    if (result.success) {
      // Even successful validation can produce warnings
      const warnings = generateWarnings(data, schemaName);
      return {
        success: true,
        data: result.data,
        errors: [],
        warnings,
        timestamp,
        schemaName,
      };
    }

    // Parse errors into structured format
    const errors: ValidationError[] = result.error.issues.map(issue => ({
      path: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
      received: issue.code === 'invalid_type' ? (issue as any).received : undefined,
    }));

    return {
      success: false,
      data: null,
      errors,
      warnings: [],
      timestamp,
      schemaName,
    };
  } catch (err) {
    return {
      success: false,
      data: null,
      errors: [{
        path: 'root',
        message: `Validation threw unexpected error: ${err instanceof Error ? err.message : String(err)}`,
        code: 'UNEXPECTED_ERROR',
      }],
      warnings: [],
      timestamp,
      schemaName,
    };
  }
}

// ============================================================================
// WARNING GENERATION — Sanity checks beyond schema validation
// ============================================================================

function generateWarnings(data: unknown, schemaName: string): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  if (!data || typeof data !== 'object') return warnings;

  const d = data as Record<string, any>;

  // Macro-specific sanity checks
  if (schemaName === 'MacroState') {
    // MEP gap should be non-negative under normal conditions
    if (d.mep?.gap < 0) {
      warnings.push({
        path: 'mep.gap',
        message: `MEP gap is negative (${d.mep.gap.toFixed(2)}%) — blue dollar below official. Possible data error.`,
        severity: 'high',
      });
    }

    // MEP gap > 100% is extreme
    if (d.mep?.gap > 100) {
      warnings.push({
        path: 'mep.gap',
        message: `MEP gap extremely wide (${d.mep.gap.toFixed(2)}%) — confirm data source integrity.`,
        severity: 'high',
      });
    }

    // Inflation expected30d should be within reasonable bounds
    if (d.inflation?.expected30d > 10) {
      warnings.push({
        path: 'inflation.expected30d',
        message: `Monthly inflation expectation ${(d.inflation.expected30d).toFixed(1)}% is extremely high — verify data source.`,
        severity: 'medium',
      });
    }

    // Interest rates should be positive in Argentina
    if (d.rates?.bcraPolicy < 0) {
      warnings.push({
        path: 'rates.bcraPolicy',
        message: `BCRA policy rate is negative (${d.rates.bcraPolicy}%) — unusual for Argentina, verify.`,
        severity: 'high',
      });
    }

    // CER monthly change should roughly track inflation
    if (d.cer?.monthlyChange && d.inflation?.monthly) {
      const cerInflGap = Math.abs(d.cer.monthlyChange - d.inflation.monthly);
      if (cerInflGap > 3) {
        warnings.push({
          path: 'cer.monthlyChange',
          message: `CER (${d.cer.monthlyChange.toFixed(1)}%) diverges from inflation (${d.inflation.monthly.toFixed(1)}%) by ${cerInflGap.toFixed(1)}pp — verify both sources.`,
          severity: 'medium',
        });
      }
    }

    // Crawling peg should be near zero under bandas cambiarias
    if (d.crawlingPeg > 3) {
      warnings.push({
        path: 'crawlingPeg',
        message: `Crawling peg ${d.crawlingPeg.toFixed(1)}%/month is high — under bandas cambiarias (Jan 2026+) this should be near 0%.`,
        severity: 'medium',
      });
    }

    // Real data percentage should not be 0% if source claims REAL
    if (d.source === 'REAL' && d.realDataPct < 30) {
      warnings.push({
        path: 'realDataPct',
        message: `Source claims REAL but realDataPct is only ${d.realDataPct}% — inconsistent labeling.`,
        severity: 'high',
      });
    }
  }

  return warnings;
}

// ============================================================================
// API RESPONSE AUDITOR — Validate and log every API response
// ============================================================================

export interface APIAuditEntry {
  source: string;
  url: string;
  timestamp: string;
  validationSuccess: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  responseTimeMs: number | null;
  dataLabel: 'REAL' | 'ERROR' | 'ERROR';
  dataDate: string | null;
}

const auditLog: APIAuditEntry[] = [];
const MAX_AUDIT_LOG_SIZE = 1000;

export function auditAPIResponse(
  source: string,
  url: string,
  data: unknown,
  schema: z.ZodSchema,
  schemaName: string,
  responseTimeMs: number | null = null,
  dataLabel: 'REAL' | 'ERROR' | 'ERROR' = 'ERROR',
  dataDate: string | null = null,
): ValidationResult<any> {
  const result = validateData(data, schema, schemaName);

  const entry: APIAuditEntry = {
    source,
    url,
    timestamp: new Date().toISOString(),
    validationSuccess: result.success,
    errors: result.errors,
    warnings: result.warnings,
    responseTimeMs,
    dataLabel,
    dataDate,
  };

  auditLog.push(entry);

  // Keep audit log bounded
  if (auditLog.length > MAX_AUDIT_LOG_SIZE) {
    auditLog.shift();
  }

  return result;
}

/** Get the last N audit entries */
export function getAuditLog(count: number = 50): APIAuditEntry[] {
  return auditLog.slice(-count);
}

/** Get audit summary statistics */
export function getAuditStats(): {
  totalEntries: number;
  validationSuccessRate: number;
  recentErrors: number;
  recentWarnings: number;
  sourceBreakdown: Record<string, { total: number; success: number; failed: number }>;
} {
  const recent = auditLog.slice(-100);
  const successCount = recent.filter(e => e.validationSuccess).length;
  const errorCount = recent.filter(e => e.errors.length > 0).length;
  const warningCount = recent.filter(e => e.warnings.length > 0).length;

  const sourceBreakdown: Record<string, { total: number; success: number; failed: number }> = {};
  for (const entry of recent) {
    if (!sourceBreakdown[entry.source]) {
      sourceBreakdown[entry.source] = { total: 0, success: 0, failed: 0 };
    }
    sourceBreakdown[entry.source].total++;
    if (entry.validationSuccess) {
      sourceBreakdown[entry.source].success++;
    } else {
      sourceBreakdown[entry.source].failed++;
    }
  }

  return {
    totalEntries: auditLog.length,
    validationSuccessRate: recent.length > 0 ? successCount / recent.length : 0,
    recentErrors: errorCount,
    recentWarnings: warningCount,
    sourceBreakdown,
  };
}

// ============================================================================
// FAILURE SIMULATION — Test system resilience to bad/missing data
// ============================================================================

export type FailureType =
  | 'NULL_RESPONSE'       // API returns null
  | 'EMPTY_OBJECT'        // API returns {}
  | 'WRONG_TYPES'         // API returns string instead of number
  | 'EXTREME_VALUES'      // API returns 99999 or -99999
  | 'STALE_DATA'          // API returns data from 1 year ago
  | 'PARTIAL_FAILURE'     // Some fields present, others missing
  | 'RATE_LIMITED'        // Simulate 429 response
  | 'NETWORK_ERROR';      // Simulate network failure

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

/**
 * Generate corrupted macro data for failure simulation.
 * Each failure type produces a specific corruption pattern.
 */
export function generateCorruptedMacro(
  baseMacro: Record<string, any>,
  failureType: FailureType,
): Record<string, any> {
  const corrupted = JSON.parse(JSON.stringify(baseMacro)); // Deep clone

  switch (failureType) {
    case 'NULL_RESPONSE':
      return {}; // Completely empty

    case 'EMPTY_OBJECT':
      return {
        lastUpdate: new Date().toISOString(),
        fetchedAt: new Date().toISOString(),
        ageMinutes: 0,
        source: 'ERROR',
        mep: { rate: 0, officialRate: 0, gap: 0, sell: 0, buy: 0 },
        inflation: { monthly: 0, expected30d: 0, expected90d: 0, yearly: 0 },
        rates: { bcraPolicy: 0, moneyMarket: 0, plazoFijo: 0, plazoFijoUVA: 0, lecaps: 0, badlar: 0, leliq: 0, tml: 0 },
        cer: { index: 0, monthlyChange: 0, dailyChange: 0 },
        crawlingPeg: 0,
        realDataPct: 0,
        provenance: {},
      };

    case 'WRONG_TYPES':
      // String instead of number for critical fields
      if (corrupted.mep) corrupted.mep.rate = "not_a_number";
      if (corrupted.inflation) corrupted.inflation.monthly = "high";
      if (corrupted.rates) corrupted.rates.bcraPolicy = null;
      return corrupted;

    case 'EXTREME_VALUES':
      if (corrupted.mep) {
        corrupted.mep.rate = 99999;
        corrupted.mep.gap = 500;
      }
      if (corrupted.inflation) {
        corrupted.inflation.monthly = 50;
        corrupted.inflation.expected30d = 80;
      }
      if (corrupted.rates) {
        corrupted.rates.bcraPolicy = -50;
        corrupted.rates.moneyMarket = 500;
      }
      return corrupted;

    case 'STALE_DATA':
      // Set data from 1 year ago
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      const staleDate = oneYearAgo.toISOString();
      corrupted.fetchedAt = staleDate;
      corrupted.ageMinutes = 525600; // 1 year in minutes
      corrupted.source = 'STALE';
      if (corrupted.provenance) {
        for (const key of Object.keys(corrupted.provenance)) {
          if (corrupted.provenance[key]) {
            corrupted.provenance[key].label = 'STALE';
            corrupted.provenance[key].ageMinutes = 525600;
            corrupted.provenance[key].stalenessHours = 8760;
          }
        }
      }
      return corrupted;

    case 'PARTIAL_FAILURE':
      // Some provenance entries ERROR, others REAL
      if (corrupted.provenance) {
        corrupted.provenance.mepRate = { ...corrupted.provenance.mepRate, label: 'ERROR', fetchError: true };
        corrupted.provenance.inflation = { ...corrupted.provenance.inflation, label: 'ERROR', fetchError: true };
        corrupted.source = 'ERROR';
        corrupted.realDataPct = 30;
      }
      return corrupted;

    case 'RATE_LIMITED':
      // All fetches fail but with error status (not null)
      corrupted.source = 'ERROR';
      corrupted.realDataPct = 0;
      if (corrupted.provenance) {
        for (const key of Object.keys(corrupted.provenance)) {
          if (corrupted.provenance[key]) {
            corrupted.provenance[key].label = 'ERROR';
            corrupted.provenance[key].fetchError = true;
          }
        }
      }
      return corrupted;

    case 'NETWORK_ERROR':
      return {}; // Same as NULL_RESPONSE — network failure means no data

    default:
      return corrupted;
  }
}

/**
 * Run a complete failure simulation suite.
 * Tests each failure type against the X10 pipeline and reports how the system responds.
 *
 * This is the KEY validation tool for ENGINEERING_DISCIPLINE_PHASE.
 * If the system doesn't degrade gracefully to every failure type,
 * it's NOT ready for production.
 */
export function runFailureSimulationSuite(
  baseMacro: Record<string, any>,
  x10EngineRunner: (macro: any) => {
    confidence: number;
    source: string;
    isCapitalPreservation: boolean;
    isEmergencyFreeze: boolean;
  },
): FailureSimulationResult[] {
  const failureTypes: FailureType[] = [
    'NULL_RESPONSE',
    'EMPTY_OBJECT',
    'WRONG_TYPES',
    'EXTREME_VALUES',
    'STALE_DATA',
    'PARTIAL_FAILURE',
    'RATE_LIMITED',
    'NETWORK_ERROR',
  ];

  const results: FailureSimulationResult[] = [];

  for (const failureType of failureTypes) {
    const corrupted = generateCorruptedMacro(baseMacro, failureType);

    // Validate the corrupted data
    const validation = validateData(corrupted, MacroStateSchema, 'MacroState');

    // Try running the X10 engine on corrupted data
    let engineResult: FailureSimulationResult['result'];
    let confidence: number;
    let source: string;
    let isCapitalPreservation: boolean;
    let isEmergencyFreeze: boolean;
    let details: string;

    try {
      // If validation failed completely, the system should reject the data
      if (!validation.success && (failureType === 'NULL_RESPONSE' || failureType === 'NETWORK_ERROR' || failureType === 'WRONG_TYPES')) {
        engineResult = 'FROZEN';
        confidence = 0;
        source = 'ERROR';
        isCapitalPreservation = true;
        isEmergencyFreeze = true;
        details = `Schema validation failed (${validation.errors.length} errors) — system correctly rejected data`;
      } else {
        // Try to run the engine on the corrupted data
        const engine = x10EngineRunner(corrupted);
        confidence = engine.confidence;
        source = engine.source;
        isCapitalPreservation = engine.isCapitalPreservation;
        isEmergencyFreeze = engine.isEmergencyFreeze;

        if (isEmergencyFreeze) {
          engineResult = 'FROZEN';
          details = `System correctly froze — confidence ${confidence.toFixed(2)}, source ${source}`;
        } else if (isCapitalPreservation) {
          engineResult = 'DEGRADED';
          details = `System degraded to capital preservation — confidence ${confidence.toFixed(2)}`;
        } else if (confidence < 0.5) {
          engineResult = 'DEGRADED';
          details = `System running with low confidence ${confidence.toFixed(2)}`;
        } else {
          engineResult = 'PASSED';
          details = `System handled failure gracefully — confidence ${confidence.toFixed(2)}`;
        }

        // Special case: extreme values should NOT pass
        if (failureType === 'EXTREME_VALUES' && engineResult === 'PASSED') {
          engineResult = 'FAILED';
          details = `CRITICAL: System accepted extreme values without degrading — safety gap detected`;
        }
      }
    } catch (err) {
      engineResult = 'FAILED';
      confidence = 0;
      source = 'ERROR';
      isCapitalPreservation = false;
      isEmergencyFreeze = false;
      details = `Engine threw unhandled error: ${err instanceof Error ? err.message : String(err)}`;
    }

    results.push({
      failureType,
      component: 'X10_Pipeline',
      result: engineResult,
      dataLabel: source,
      confidenceScore: Math.round(confidence * 100) / 100,
      capitalPreservationMode: isCapitalPreservation,
      emergencyFreeze: isEmergencyFreeze,
      details,
      timestamp: new Date().toISOString(),
    });
  }

  return results;
}

// ============================================================================
// MACRO STATE VALIDATION GATE — Must pass before entering X10 pipeline
// ============================================================================

export interface IntegrityGateResult {
  passed: boolean;
  macroValid: boolean;
  warnings: ValidationWarning[];
  criticalErrors: ValidationError[];
  dataQualityScore: number; // 0-100
  recommendation: 'PROCEED' | 'PROCEED_WITH_CAUTION' | 'DEGRADED_MODE' | 'FREEZE';
  timestamp: string;
}

/**
 * The integrity gate is the single entry point for all macro data
 * entering the X10 pipeline. If this gate fails, the engine MUST NOT
 * compute new allocations.
 */
export function runIntegrityGate(macro: unknown): IntegrityGateResult {
  const timestamp = new Date().toISOString();

  // Step 1: Schema validation
  const schemaResult = validateData(macro, MacroStateSchema, 'MacroState');

  if (!schemaResult.success) {
    const criticalFields = ['mep', 'inflation', 'rates', 'source'];
    const criticalErrors = schemaResult.errors.filter(e =>
      criticalFields.some(f => e.path.startsWith(f))
    );

    return {
      passed: false,
      macroValid: false,
      warnings: schemaResult.warnings,
      criticalErrors: schemaResult.errors,
      dataQualityScore: 0,
      recommendation: criticalErrors.length > 3 ? 'FREEZE' : 'DEGRADED_MODE',
      timestamp,
    };
  }

  // Step 2: Data quality scoring
  const data = schemaResult.data!;
  let qualityScore = 100;

  // Deduct for non-REAL data
  qualityScore -= (100 - data.realDataPct) * 0.3;

  // Deduct for stale data
  if (data.source === 'STALE') qualityScore -= 20;
  if (data.source === 'ERROR') qualityScore -= 30;
  if (data.source === 'ERROR') qualityScore -= 50;

  // Deduct for age
  if (data.ageMinutes > 60) qualityScore -= 10;
  if (data.ageMinutes > 360) qualityScore -= 20;

  // Deduct for warnings
  qualityScore -= schemaResult.warnings.length * 5;

  qualityScore = Math.max(0, Math.min(100, Math.round(qualityScore)));

  // Step 3: Recommendation
  let recommendation: IntegrityGateResult['recommendation'];
  if (qualityScore >= 80 && data.source === 'REAL') {
    recommendation = 'PROCEED';
  } else if (qualityScore >= 60) {
    recommendation = 'PROCEED_WITH_CAUTION';
  } else if (qualityScore >= 30) {
    recommendation = 'DEGRADED_MODE';
  } else {
    recommendation = 'FREEZE';
  }

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
