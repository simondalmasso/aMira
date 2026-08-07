// src/components/oracle/v2/v2-systemic-panel.tsx
// Null-safe visual adapter for the canonical V2 systemic report.

'use client';

import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import type { V2SystemicReport } from '@/lib/oracle/v2';

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border border-[#e5e7eb] rounded-[8px] p-4 bg-white">
      <h3 className="text-[13px] font-extrabold tracking-tight mb-3">{title}</h3>
      {children}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-[9px] text-[#999] uppercase tracking-wide">{label}</div>
      <div className="text-[13px] font-mono font-bold">{value}</div>
    </div>
  );
}

function fixed(value: number | null, digits = 2): string {
  return value === null ? '—' : value.toFixed(digits);
}

function percent(value: number | null, digits = 2): string {
  return value === null ? '—' : `${(value * 100).toFixed(digits)}%`;
}

function VerificationBlock({ verification }: { verification: V2SystemicReport['verification'] }) {
  return (
    <Card title="R4 · Forecast Verification">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Metric label="Status" value={verification.status} />
        <Metric label="Samples" value={verification.sample_count} />
        <Metric label="MAE" value={percent(verification.MAE, 3)} />
        <Metric label="RMSE" value={percent(verification.RMSE, 3)} />
        <Metric label="MAPE" value={verification.MAPE === null ? '—' : `${verification.MAPE.toFixed(2)}%`} />
        <Metric label="Hit rate" value={percent(verification.HitRate, 1)} />
        <Metric label="Directional accuracy" value={verification.DirectionalAccuracy === null ? '—' : `${fixed(verification.DirectionalAccuracy, 1)}%`} />
        <Metric label="Calibration" value={verification.Calibration === null ? '—' : `${(verification.Calibration * 10_000).toFixed(2)} bps²`} />
        <Metric label="Bias" value={percent(verification.bias, 3)} />
        <Metric label="Mean E[R]" value={percent(verification.mean_expected_return, 2)} />
        <Metric label="Mean R[r]" value={percent(verification.mean_realized_return, 2)} />
      </div>
      {verification.status === 'NO_HISTORY' && (
        <p className="mt-3 text-[9px] text-[#777] italic">No verified forecast history yet; verification metrics are intentionally unavailable.</p>
      )}
    </Card>
  );
}

export function V2SystemicPanel({ v2 }: { v2: V2SystemicReport }) {
  const asset = v2.assets[0] ?? null;
  if (!asset) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-3 mt-4 pt-4 border-t-2 border-dashed border-[#e5e7eb]"
      data-testid="v2-systemic-panel"
    >
      <div className="flex items-center justify-between">
        <div className="text-[14px] font-extrabold tracking-tight">V2 Systemic Robustness Layers</div>
        <div className="text-[8px] font-mono text-[#999]">R1-R10 · {v2.version}</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <Card title="R1 · Confidence">
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Score" value={`${fixed(asset.confidence.confidence_score, 1)}/100`} />
            <Metric label="Dispersion" value={fixed(asset.confidence.prediction_dispersion, 1)} />
            <Metric label="Agreement" value={fixed(asset.confidence.feature_agreement, 1)} />
            <Metric label="Data quality" value={fixed(asset.confidence.data_quality, 1)} />
          </div>
        </Card>

        <Card title="R2 · Regime">
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Regime" value={asset.regime_v2.regime} />
            <Metric label="Probability" value={`${fixed(asset.regime_v2.probability, 1)}%`} />
          </div>
          <div className="mt-3 text-[9px] font-mono text-[#666]">
            {asset.regime_v2.distribution.slice(0, 3).map((item) => `${item.state}:${item.probability.toFixed(1)}%`).join(' · ')}
          </div>
        </Card>

        <Card title="R3 · Explainability">
          <Metric label="Decision" value={asset.explanation.decision} />
          <p className="mt-2 text-[10px] text-[#555] leading-relaxed">{asset.explanation.reasoning_summary}</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <VerificationBlock verification={v2.verification} />

        <Card title="R5 · Adaptive Weights">
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Updates" value={v2.adaptive_weights.total_updates} />
            <Metric label="Rejections" value={v2.adaptive_weights.total_rejections} />
            <Metric label="Drift" value={fixed(v2.adaptive_weights.drift_from_default, 4)} />
          </div>
        </Card>

        <Card title="R6 · Lineage">
          <div className="text-[9px] font-mono text-[#555] space-y-1">
            <div>id={asset.lineage.lineage_id}</div>
            <div>model={asset.lineage.model_version}</div>
            <div>asset={asset.lineage.asset}</div>
          </div>
        </Card>

        <Card title="R7 · Health Monitor">
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Status" value={v2.health.composite_status} />
            <Metric label="Health" value={`${fixed(v2.health.composite_score, 1)}/100`} />
            <Metric label="Samples" value={v2.health.sample_size} />
          </div>
        </Card>

        <Card title="R8 · Scenario Engine">
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Base" value={fixed(v2.scenarios.base?.score_adjusted ?? null, 1)} />
            <Metric label="Worst" value={fixed(v2.scenarios.worst_case?.score_adjusted ?? null, 1)} />
            <Metric label="Spread" value={fixed(v2.scenarios.range.spread, 1)} />
          </div>
        </Card>

        <Card title="R9 · Audit Trail">
          <div className="text-[9px] font-mono text-[#555] space-y-1">
            <div>decision_id={asset.audit.decision_id}</div>
            <div>verification={asset.audit.verification_status}</div>
            <div>confidence={asset.audit.confidence === null ? '—' : fixed(asset.audit.confidence, 1)}</div>
          </div>
        </Card>

        <Card title="R10 · Foundation Advisors">
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Adapters" value={v2.advisors.registered_adapters.length} />
            <Metric label="Forecasts" value={v2.advisors.forecasts.length} />
          </div>
          <div className="mt-2 text-[9px] font-mono text-[#666]">
            {v2.advisors.registered_adapters.map((adapter) => `${adapter.name}:${adapter.enabled ? 'ON' : 'OFF'}`).join(' · ')}
          </div>
        </Card>
      </div>
    </motion.div>
  );
}
