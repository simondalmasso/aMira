// src/components/oracle/v3/v3-intelligence-panel.tsx
// ============================================================================
// V3 INTELLIGENCE PANEL — Visualizes the 10 intelligence layers (I1-I10)
// ============================================================================
// APPEND-ONLY: This panel is rendered BELOW the V2 systemic panel in
// single-oracle-panel.tsx. It gracefully degrades if the V3 payload is
// missing (e.g., transient API failure or feature flag off).
//
// LAYOUT: 10 blocks (I1-I10) in a responsive grid + a composite verdict banner.
// ============================================================================

'use client';

import { motion } from 'framer-motion';
import {
  ShieldCheck, Gauge, Spline, Crosshair, Vote, BookOpen,
  History, HeartPulse, GitCompareArrows, Gavel, Network, AlertTriangle,
} from 'lucide-react';
import type { V3IntelligenceReport } from '@/lib/oracle/v3';

// ─── Helpers ───────────────────────────────────────────────────────────────

function pct(n: number, digits = 2): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${(n * 100).toFixed(digits)}%`;
}
function num(n: number, digits = 2): string { return n.toFixed(digits); }

function gradeColor(score: number): string {
  if (score >= 80) return '#16a34a';
  if (score >= 60) return '#0066cc';
  if (score >= 40) return '#ca8a04';
  return '#dc2626';
}

function statusColor(s: string): string {
  switch (s) {
    case 'healthy': case 'APPROVED': case 'WELL_CALIBRATED': case 'TRUSTWORTHY':
      return '#16a34a';
    case 'watch': case 'APPROVED_WITH_WARNINGS': case 'TRUSTWORTHY_WITH_CAVEATS':
      return '#0066cc';
    case 'degraded': case 'DEGRADED': case 'OVERCONFIDENT': case 'UNDERCONFIDENT':
      return '#ca8a04';
    case 'critical': case 'REJECTED': case 'UNTRUSTWORTHY': case 'BIASED':
      return '#dc2626';
    default: return '#666';
  }
}

function verdictColor(v: string): string {
  switch (v) {
    case 'TRUSTWORTHY': return '#16a34a';
    case 'TRUSTWORTHY_WITH_CAVEATS': return '#0066cc';
    case 'DEGRADED': return '#ca8a04';
    case 'UNTRUSTWORTHY': return '#dc2626';
    default: return '#666';
  }
}

// ─── Block Header ──────────────────────────────────────────────────────────

function BlockHeader({ icon: Icon, title, layer, color = '#7c3aed' }: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  title: string;
  layer: string;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-4 h-4" style={{ color }} />
      <h3 className="text-[14px] font-extrabold tracking-tight">{title}</h3>
      <span className="text-[8px] text-[#999] font-mono ml-auto">{layer}</span>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-[#e5e7eb] rounded-[8px] p-4 bg-white">
      {children}
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="flex justify-between text-[10px] font-mono">
      <span className="text-[#666]">{label}</span>
      <span className="font-bold" style={color ? { color } : undefined}>{value}</span>
    </div>
  );
}

// ─── Composite Verdict Banner ──────────────────────────────────────────────

function VerdictBanner({ v3 }: { v3: V3IntelligenceReport }) {
  const color = verdictColor(v3.composite_verdict);
  return (
    <div
      className="rounded-[10px] p-4 mb-4"
      style={{ background: `${color}10`, border: `1px solid ${color}40` }}
    >
      <div className="flex items-center gap-3">
        <ShieldCheck className="w-6 h-6" style={{ color }} />
        <div className="flex-1">
          <div className="flex items-baseline gap-3">
            <span className="text-[16px] font-extrabold" style={{ color }}>
              {v3.composite_verdict.replace(/_/g, ' ')}
            </span>
            <span className="text-[11px] text-[#666]">composite confidence</span>
            <span className="text-[14px] font-mono font-bold" style={{ color }}>
              {num(v3.composite_confidence, 1)}/100
            </span>
          </div>
          <div className="text-[10px] text-[#666] mt-1">{v3.narrative}</div>
        </div>
      </div>
    </div>
  );
}

// ─── I1: Conformal Confidence Block ────────────────────────────────────────

function ConformalBlock({ c }: { c: V3IntelligenceReport['conformal'] }) {
  const grade = gradeColor(c.conformal_confidence);
  const interval = c.interval;
  return (
    <Card>
      <BlockHeader icon={Gauge} title="I1 · Conformal Confidence" layer="conformal_confidence_v3_i1" />
      <div className="flex items-end gap-4 mb-3">
        <div>
          <div className="text-[9px] text-[#999] uppercase">Conformal Score</div>
          <div className="font-mono font-extrabold text-[28px] leading-none" style={{ color: grade }}>
            {num(c.conformal_confidence, 1)}
          </div>
        </div>
        <div className="flex-1 text-[10px] font-mono space-y-1">
          <Row label="Δ vs V2 heuristic" value={`${c.delta_vs_heuristic >= 0 ? '+' : ''}${num(c.delta_vs_heuristic, 1)}`} color={c.delta_vs_heuristic >= 0 ? '#16a34a' : '#dc2626'} />
          <Row label="coverage target" value={`${(c.calibration.target_coverage * 100).toFixed(0)}%`} />
          <Row label="empirical coverage" value={`${(c.calibration.empirical_coverage * 100).toFixed(1)}%`} color={c.calibration.empirical_coverage >= c.calibration.target_coverage ? '#16a34a' : '#ca8a04'} />
          <Row label="calibration size" value={c.calibration.sample_size} />
        </div>
      </div>
      <div className="border-t border-[#e5e7eb] pt-2">
        <div className="text-[9px] text-[#999] uppercase mb-1">90% Conformal Interval (30d return)</div>
        <div className="grid grid-cols-3 gap-2 text-[10px] font-mono">
          <div>
            <div className="text-[#666]">P5</div>
            <div className="font-bold" style={{ color: '#dc2626' }}>{pct(interval.lower)}</div>
          </div>
          <div className="text-center">
            <div className="text-[#666]">P50</div>
            <div className="font-bold">{pct(interval.center)}</div>
          </div>
          <div className="text-right">
            <div className="text-[#666]">P95</div>
            <div className="font-bold" style={{ color: '#16a34a' }}>{pct(interval.upper)}</div>
          </div>
        </div>
        <div className="text-[9px] text-[#999] mt-1 font-mono">
          width={(interval.width * 100).toFixed(2)}% · {interval.method} · {interval.empirical ? 'EMPIRICAL' : 'HEURISTIC_FALLBACK'}
        </div>
      </div>
    </Card>
  );
}

// ─── I2: Structural Regime Block ───────────────────────────────────────────

function StructuralRegimeBlock({ s }: { s: V3IntelligenceReport['structural_regime'] }) {
  const detectors = [s.cusum, s.page_hinkley, s.bayesian, s.ruptures];
  const changeColor = s.structural_change_detected ? '#dc2626' : '#16a34a';
  return (
    <Card>
      <BlockHeader icon={Spline} title="I2 · Structural Regime" layer="structural_regime_v3_i2" color="#0891b2" />
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[9px] text-[#999] uppercase">Structural Change</div>
          <div className="text-[18px] font-extrabold" style={{ color: changeColor }}>
            {s.structural_change_detected ? 'DETECTED' : 'STABLE'}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9px] text-[#999] uppercase">Instability</div>
          <div className="font-mono font-bold text-[18px]" style={{ color: gradeColor(100 - s.instability_index) }}>
            {num(s.instability_index, 1)}/100
          </div>
        </div>
      </div>
      <div className="text-[10px] font-mono space-y-1 mb-2">
        <Row label="consensus" value={`${s.consensus_count}/4`} color={s.consensus_count >= 2 ? '#dc2626' : '#16a34a'} />
        <Row label="persistence" value={`${num(s.persistence.persistence_score, 1)}/100`} />
        <Row label="consecutive preds" value={s.persistence.consecutive_predictions} />
        <Row label="transition conf" value={`${num(s.transition.transition_confidence, 1)}`} />
      </div>
      <div className="border-t border-[#e5e7eb] pt-2">
        <div className="text-[9px] text-[#999] uppercase mb-1">Detectors</div>
        <div className="grid grid-cols-2 gap-1 text-[10px] font-mono">
          {detectors.map((d) => (
            <div key={d.algorithm} className="flex justify-between">
              <span className="text-[#666]">{d.algorithm}</span>
              <span style={{ color: d.change_detected ? '#dc2626' : '#16a34a' }}>
                {d.change_detected ? '⚠' : '✓'} {num(d.confidence, 0)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ─── I3: Calibration Block ─────────────────────────────────────────────────

function CalibrationBlock({ c }: { c: V3IntelligenceReport['calibration'] }) {
  const diagColor = statusColor(c.diagnosis);
  return (
    <Card>
      <BlockHeader icon={Crosshair} title="I3 · Calibration" layer="calibration_engine_v3_i3" color="#7c3aed" />
      <div className="flex items-end justify-between mb-3">
        <div>
          <div className="text-[9px] text-[#999] uppercase">Diagnosis</div>
          <div className="text-[14px] font-extrabold" style={{ color: diagColor }}>
            {c.diagnosis.replace(/_/g, ' ')}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9px] text-[#999] uppercase">ECE</div>
          <div className="font-mono font-bold text-[16px]">{num(c.metrics.ece, 4)}</div>
        </div>
      </div>
      <div className="text-[10px] font-mono space-y-1 mb-2">
        <Row label="brier" value={num(c.metrics.brier, 6)} />
        <Row label="CRPS" value={num(c.metrics.crps, 6)} />
        <Row label="bias" value={pct(c.metrics.bias)} color={Math.abs(c.metrics.bias) > 0.005 ? '#dc2626' : '#16a34a'} />
        <Row label="directional acc" value={`${(c.metrics.directional_accuracy * 100).toFixed(1)}%`} />
        <Row label="reliability bins" value={`${c.reliability.populated_bins}/10`} />
      </div>
      {c.bias.statistically_significant && (
        <div className="text-[10px] text-[#dc2626] font-mono mt-2 pt-2 border-t border-[#e5e7eb]">
          ⚠ Significant bias detected. Recommended adjustment: {pct(c.bias.recommended_adjustment)}
        </div>
      )}
    </Card>
  );
}

// ─── I4: Model Arbitration Block ───────────────────────────────────────────

function ArbitrationBlock({ a }: { a: V3IntelligenceReport['arbitration'] }) {
  return (
    <Card>
      <BlockHeader icon={Vote} title="I4 · Model Arbitration" layer="model_arbitration_v3_i4" color="#db2777" />
      <div className="flex items-end justify-between mb-3">
        <div>
          <div className="text-[9px] text-[#999] uppercase">Strategy</div>
          <div className="text-[12px] font-bold">{a.strategy.replace(/_/g, ' ')}</div>
        </div>
        <div className="text-right">
          <div className="text-[9px] text-[#999] uppercase">Consensus</div>
          <div className="font-mono font-bold text-[14px]" style={{ color: a.confirms_oracle ? '#16a34a' : '#ca8a04' }}>
            {a.confirms_oracle ? '✓ Oracle' : '⚠ Diverges'}
          </div>
        </div>
      </div>
      <div className="text-[10px] font-mono space-y-1 mb-2">
        <Row label="ensemble return" value={pct(a.ensemble_expected_return)} />
        <Row label="ensemble conf" value={`${num(a.ensemble_confidence, 1)}/100`} />
        <Row label="oracle return" value={pct(a.oracle_authoritative_return)} color="#0066cc" />
        <Row label="consensus adj" value={`${a.consensus_adjustment >= 0 ? '+' : ''}${num(a.consensus_adjustment, 1)}`} />
        <Row label="bull/bear/neutral" value={`${a.disagreement.bullish}/${a.disagreement.bearish}/${a.disagreement.neutral}`} />
      </div>
      <div className="border-t border-[#e5e7eb] pt-2">
        <div className="text-[9px] text-[#999] uppercase mb-1">Votes ({a.votes.length})</div>
        <div className="space-y-1">
          {a.votes.map((v) => (
            <div key={v.model_id} className="flex justify-between text-[10px] font-mono">
              <span style={{ color: v.is_stub ? '#999' : '#000' }}>
                {v.model_name} {v.is_stub && '(stub)'}
              </span>
              <span style={{ color: v.direction === 'bullish' ? '#16a34a' : v.direction === 'bearish' ? '#dc2626' : '#666' }}>
                {pct(v.expected_return)} ({num(v.confidence, 0)})
              </span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ─── I5: Evidence Block ────────────────────────────────────────────────────

function EvidenceBlock({ e }: { e: V3IntelligenceReport['evidence'] }) {
  const gradeColorMap: Record<string, string> = {
    STRONG: '#16a34a', MODERATE: '#0066cc', WEAK: '#ca8a04', INSUFFICIENT: '#dc2626',
  };
  return (
    <Card>
      <BlockHeader icon={BookOpen} title="I5 · Evidence Engine" layer="evidence_engine_v3_i5" color="#059669" />
      <div className="flex items-end justify-between mb-3">
        <div>
          <div className="text-[9px] text-[#999] uppercase">Evidence Level</div>
          <div className="text-[20px] font-extrabold" style={{ color: gradeColorMap[e.evidence_grade] }}>
            {e.evidence_grade}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9px] text-[#999] uppercase">Score</div>
          <div className="font-mono font-bold text-[20px]">{num(e.evidence_level, 1)}</div>
        </div>
      </div>
      <div className="text-[10px] font-mono space-y-1 mb-2">
        <Row label="analog count" value={e.analog_count} />
        <Row label="outcome consistency" value={`${(e.outcome_consistency * 100).toFixed(0)}%`} />
      </div>
      <div className="border-t border-[#e5e7eb] pt-2">
        <div className="text-[9px] text-[#999] uppercase mb-1">Factor Evidence</div>
        <div className="space-y-1">
          {[...e.factor_evidence.positive, ...e.factor_evidence.negative].slice(0, 5).map((f) => (
            <div key={f.factor + f.direction} className="flex justify-between text-[10px] font-mono">
              <span className="text-[#666]">{f.factor}</span>
              <span style={{ color: f.direction === 'positive' ? '#16a34a' : '#dc2626' }}>
                {f.evidence_strength} ({f.sample_size})
              </span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ─── I6: Historical Memory Block ───────────────────────────────────────────

function HistoricalMemoryBlock({ h }: { h: V3IntelligenceReport['historical_memory'] }) {
  return (
    <Card>
      <BlockHeader icon={History} title="I6 · Historical Memory" layer="historical_memory_v3_i6" color="#9333ea" />
      <div className="flex items-end justify-between mb-3">
        <div>
          <div className="text-[9px] text-[#999] uppercase">Memory Size</div>
          <div className="text-[20px] font-extrabold">{h.memory_size}</div>
        </div>
        <div className="text-right">
          <div className="text-[9px] text-[#999] uppercase">Mean Sim</div>
          <div className="font-mono font-bold text-[16px]">{num(h.mean_similarity, 3)}</div>
        </div>
      </div>
      <div className="text-[10px] font-mono space-y-1 mb-2">
        <Row label="verified analogs" value={h.outcome_stats.verified_count} />
        <Row label="mean predicted" value={pct(h.outcome_stats.mean_predicted)} />
        <Row label="mean realized" value={pct(h.outcome_stats.mean_realized)} />
        <Row label="directional acc" value={`${(h.outcome_stats.directional_accuracy * 100).toFixed(0)}%`} />
        <Row label="analog conf" value={`${num(h.analog_confidence.analog_confidence, 1)}/100`} />
        <Row label="adjustment" value={`${h.analog_confidence.adjustment >= 0 ? '+' : ''}${num(h.analog_confidence.adjustment, 1)}`} color={h.analog_confidence.adjustment >= 0 ? '#16a34a' : '#dc2626'} />
      </div>
      <div className="border-t border-[#e5e7eb] pt-2">
        <div className="text-[9px] text-[#999] uppercase mb-1">Nearest States ({h.nearest_states.length})</div>
        <div className="space-y-1 max-h-[120px] overflow-y-auto">
          {h.nearest_states.map((s) => (
            <div key={s.record.lineage_id} className="flex justify-between text-[9px] font-mono">
              <span className="text-[#666] truncate max-w-[60%]">{s.record.regime}</span>
              <span>
                sim={num(s.similarity, 2)} ·{' '}
                {s.record.realized_return !== null ? (
                  <span style={{ color: s.record.was_correct ? '#16a34a' : '#dc2626' }}>
                    {pct(s.record.realized_return)}
                  </span>
                ) : (
                  <span className="text-[#999]">pending</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ─── I7: Self Diagnosis Block ──────────────────────────────────────────────

function SelfDiagnosisBlock({ s }: { s: V3IntelligenceReport['self_diagnosis'] }) {
  const healthColor = gradeColor(s.composite_health);
  return (
    <Card>
      <BlockHeader icon={HeartPulse} title="I7 · Self Diagnosis" layer="self_diagnosis_v3_i7" color="#dc2626" />
      <div className="flex items-end justify-between mb-3">
        <div>
          <div className="text-[9px] text-[#999] uppercase">Status</div>
          <div className="text-[14px] font-extrabold" style={{ color: statusColor(s.composite_status) }}>
            {s.composite_status.toUpperCase()}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9px] text-[#999] uppercase">Health</div>
          <div className="font-mono font-bold text-[20px]" style={{ color: healthColor }}>
            {num(s.composite_health, 1)}
          </div>
        </div>
      </div>
      <div className="text-[10px] font-mono space-y-1 mb-2">
        {s.drift_metrics.map((m) => (
          <div key={m.key} className="flex justify-between">
            <span className="text-[#666]">{m.key.replace(/_/g, ' ')}</span>
            <span style={{ color: statusColor(m.status) }}>
              {m.trend === 'improving' ? '↗' : m.trend === 'deteriorating' ? '↘' : '→'} {m.status}
            </span>
          </div>
        ))}
      </div>
      {s.active_alerts.length > 0 && (
        <div className="border-t border-[#e5e7eb] pt-2">
          <div className="text-[9px] text-[#dc2626] uppercase mb-1">⚠ Active Alerts ({s.active_alerts.length})</div>
          <div className="space-y-1 max-h-[80px] overflow-y-auto">
            {s.active_alerts.slice(0, 5).map((a) => (
              <div key={a.alert_id} className="text-[9px] font-mono">
                <span style={{ color: statusColor(a.severity) }} className="font-bold">[{a.severity}]</span>{' '}
                <span className="text-[#666]">{a.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── I8: Counterfactual Block ──────────────────────────────────────────────

function CounterfactualBlock({ c }: { c: V3IntelligenceReport['counterfactual'] }) {
  return (
    <Card>
      <BlockHeader icon={GitCompareArrows} title="I8 · Counterfactual" layer="counterfactual_engine_v3_i8" color="#0d9488" />
      <div className="flex items-end justify-between mb-3">
        <div>
          <div className="text-[9px] text-[#999] uppercase">Counterfactuals</div>
          <div className="text-[20px] font-extrabold">{c.counterfactuals.length}</div>
        </div>
        <div className="text-right">
          <div className="text-[9px] text-[#999] uppercase">Variables</div>
          <div className="font-mono font-bold text-[16px]">{c.critical_variables.length}</div>
        </div>
      </div>
      {c.most_critical_variable && (
        <div className="text-[10px] font-mono space-y-1 mb-2">
          <Row label="most critical" value={c.most_critical_variable.variable} color="#dc2626" />
          <Row label="sensitivity" value={num(c.most_critical_variable.sensitivity, 4)} />
          <Row label="direction" value={c.most_critical_variable.direction} />
          <Row label="flips action" value={c.most_critical_variable.flips_action ? 'YES' : 'no'} color={c.most_critical_variable.flips_action ? '#dc2626' : '#16a34a'} />
        </div>
      )}
      <div className="border-t border-[#e5e7eb] pt-2">
        <div className="text-[9px] text-[#999] uppercase mb-1">Variable Sensitivity Ranking</div>
        <div className="space-y-1">
          {c.critical_variables.slice(0, 5).map((v) => (
            <div key={v.variable} className="flex justify-between text-[10px] font-mono">
              <span className="text-[#666]">{v.variable}</span>
              <span style={{ color: v.direction === 'positive' ? '#16a34a' : v.direction === 'negative' ? '#dc2626' : '#666' }}>
                {num(v.sensitivity, 3)} {v.flips_action ? '⚠' : ''}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ─── I9: Institutional Validation Block ────────────────────────────────────

function ValidationBlock({ v }: { v: V3IntelligenceReport['validation'] }) {
  const verdictColorMap: Record<string, string> = {
    APPROVED: '#16a34a',
    APPROVED_WITH_WARNINGS: '#0066cc',
    REJECTED: '#dc2626',
  };
  return (
    <Card>
      <BlockHeader icon={Gavel} title="I9 · Institutional Validation" layer="institutional_validation_v3_i9" color="#475569" />
      <div className="flex items-end justify-between mb-3">
        <div>
          <div className="text-[9px] text-[#999] uppercase">Verdict</div>
          <div className="text-[14px] font-extrabold" style={{ color: verdictColorMap[v.verdict] }}>
            {v.verdict.replace(/_/g, ' ')}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9px] text-[#999] uppercase">Pass Rate</div>
          <div className="font-mono font-bold text-[16px]">{(v.pass_rate * 100).toFixed(0)}%</div>
        </div>
      </div>
      <div className="text-[10px] font-mono space-y-1 mb-2">
        <Row label="total checks" value={v.summary.total} />
        <Row label="passed" value={v.summary.passed} color="#16a34a" />
        <Row label="failed" value={v.summary.failed} color={v.summary.failed > 0 ? '#dc2626' : '#666'} />
        <Row label="critical" value={v.summary.by_severity.critical} color={v.summary.by_severity.critical > 0 ? '#dc2626' : '#666'} />
        <Row label="errors" value={v.summary.by_severity.error} color={v.summary.by_severity.error > 0 ? '#ca8a04' : '#666'} />
      </div>
      {v.veto.veto && (
        <div className="border-t border-[#dc2626] pt-2 mt-2" style={{ background: '#dc262610' }}>
          <div className="text-[10px] font-mono text-[#dc2626] font-bold">
            ⚠ VETO: {v.veto.reason}
          </div>
          {v.veto.override_action && (
            <div className="text-[9px] text-[#666] mt-1">
              Override suggested: <span className="font-bold">{v.veto.override_action}</span>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ─── I10: Knowledge Graph Block ────────────────────────────────────────────

function KnowledgeGraphBlock({ k }: { k: V3IntelligenceReport['knowledge_graph'] }) {
  return (
    <Card>
      <BlockHeader icon={Network} title="I10 · Knowledge Graph" layer="knowledge_graph_v3_i10" color="#0284c7" />
      <div className="flex items-end justify-between mb-3">
        <div>
          <div className="text-[9px] text-[#999] uppercase">Nodes</div>
          <div className="text-[20px] font-extrabold">{k.stats.total_nodes}</div>
        </div>
        <div className="text-right">
          <div className="text-[9px] text-[#999] uppercase">Edges</div>
          <div className="font-mono font-bold text-[16px]">{k.stats.total_edges}</div>
        </div>
      </div>
      <div className="text-[10px] font-mono space-y-1 mb-2">
        <Row label="density" value={num(k.stats.density, 4)} />
        <Row label="avg degree" value={num(k.stats.avg_degree, 2)} />
      </div>
      <div className="border-t border-[#e5e7eb] pt-2">
        <div className="text-[9px] text-[#999] uppercase mb-1">Node Distribution</div>
        <div className="grid grid-cols-2 gap-1 text-[10px] font-mono">
          {Object.entries(k.node_counts).map(([type, count]) => (
            count > 0 && (
              <div key={type} className="flex justify-between">
                <span className="text-[#666]">{type}</span>
                <span className="font-bold">{count}</span>
              </div>
            )
          ))}
        </div>
      </div>
      <div className="border-t border-[#e5e7eb] pt-2 mt-2">
        <div className="text-[9px] text-[#999] uppercase mb-1">Sample Paths</div>
        <div className="space-y-1 max-h-[60px] overflow-y-auto">
          {k.sample_paths.slice(0, 3).map((p, i) => (
            <div key={i} className="text-[9px] font-mono text-[#666]">
              {p.path.join(' → ')}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ─── Main Panel ────────────────────────────────────────────────────────────

export function V3IntelligencePanel({ v3 }: { v3?: V3IntelligenceReport }) {
  if (!v3) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="mt-4 border border-[#7c3aed30] rounded-[12px] p-4 bg-[#fafaff]"
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="w-1 h-5 bg-[#7c3aed] rounded-full" />
        <h2 className="text-[16px] font-extrabold tracking-tight">
          V3 · Intelligence Layer
        </h2>
        <span className="text-[9px] text-[#999] font-mono ml-auto">
          I1-I10 · {v3.version}
        </span>
      </div>

      <VerdictBanner v3={v3} />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <ConformalBlock c={v3.conformal} />
        <StructuralRegimeBlock s={v3.structural_regime} />
        <CalibrationBlock c={v3.calibration} />
        <ArbitrationBlock a={v3.arbitration} />
        <EvidenceBlock e={v3.evidence} />
        <HistoricalMemoryBlock h={v3.historical_memory} />
        <SelfDiagnosisBlock s={v3.self_diagnosis} />
        <CounterfactualBlock c={v3.counterfactual} />
        <ValidationBlock v={v3.validation} />
        <KnowledgeGraphBlock k={v3.knowledge_graph} />
      </div>
    </motion.div>
  );
}
