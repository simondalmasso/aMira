import type { AssetScoreVector } from '@/lib/single-pass-oracle-engine';
import type { LearningSummary } from '@/lib/closed-loop-learning';
import type { LifecycleLedgerRecord, LifecycleLedgerSnapshot } from '@/lib/amira-prediction-lifecycle-ledger';
import type { V2SystemicReport } from '@/lib/oracle/v2';
import type { V3IntelligenceReport } from '@/lib/oracle/v3';
import type { DataLabel } from '@/lib/live-data';
import type { CanonicalMarketFieldProvenance } from '@/lib/macro-market-adapter';
import type { TelemetryStorageStatus } from '@/lib/telemetry';

export interface OracleSingleMacroMetadata {
  source: string;
  overallLabel: DataLabel;
  realDataPct: number;
  fetchedAt: string;
  lastSuccessfulFetch: string | null;
  fieldProvenance: CanonicalMarketFieldProvenance[];
  limitations: string[];
}

export interface OracleSingleSuccessResponse {
  success: true;
  status: 'READY' | 'PARTIAL';
  warnings: Array<'NO_PRIMARY_SCORE'>;
  timestamp: string;
  vector: AssetScoreVector;
  learning: LearningSummary;
  lifecycle: LifecycleLedgerSnapshot;
  lifecycleRecord: LifecycleLedgerRecord | null;
  v2: V2SystemicReport | null;
  v3: V3IntelligenceReport | null;
  macro: OracleSingleMacroMetadata;
  telemetryStorage: TelemetryStorageStatus;
}

export interface OracleSingleErrorResponse {
  success: false;
  code: 'INVALID_ORACLE_REQUEST' | 'CANONICAL_ORACLE_PIPELINE_FAILED';
  error: string;
  telemetryStorage: TelemetryStorageStatus;
  timestamp: string;
}

export type OracleSingleResponse = OracleSingleSuccessResponse | OracleSingleErrorResponse;
