// src/components/oracle/v2/v2-systemic-panel.tsx
// ============================================================================
// V2 SYSTEMIC PANEL — Visualizes the 10 robustness layers (R1-R10)
// ============================================================================
// APPEND-ONLY: This panel is rendered BELOW the 4 canonical V1 blocks in
// single-oracle-panel.tsx. It gracefully degrades if the V2 payload is
// missing (e.g., transient API failure).
//
// LAYOUT: 10 blocks, one per layer, in a responsive grid.
// ============================================================================

'use client';

import { motion } from 'framer-motion';
import {
  Activity, Gauge, Compass, MessageSquare, CheckCircle,
  TrendingDown, History, HeartPulse, AlertTriangle, ShieldCheck, Boxes,
} from 'lucide-react';
import type { V2SystemicReport } from '@/lib/oracle/v2';

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

function statusBadge(status: string): { bg: string; label: string } {
  switch (status) {
    case 'healthy': return { bg: 'bg-[#16a34a]', label: 'HEALTHY' };
    case 'watch': return { bg: 'bg-[#0066cc]', label: 'WATCH' };
    case 'degraded': return { bg: 'bg-[#ca8a04]', label: 'DEGRADED' };
    case 'critical': return { bg: 'bg-[#dc2626]', label: 'CRITICAL' };
    default: return { bg: 'bg-[#666]', label: status.toUpperCase() };
  }
}

function actionBadge(a: string): { bg: string; label: string } {
  switch (a) {
    case 'rebalance_signal': return { bg: 'bg-[#0066cc]', label: 'REBALANCE' };
    case 'hold_signal': return { bg: 'bg-[#666666]', label: 'HOLD' };
    case 'reduce_risk_signal': return { bg: 'bg-[#dc2626]', label: 'REDUCE RISK' };
    default: return { bg: 'bg-[#666]', label: a };
  }
}

// ─── Block Header ──────────────────────────────────────────────────────────

function BlockHeader({ icon: Icon, title, layer, color = '#0066cc' }: {
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

// ─── R1: Confidence Layer Block ────────────────────────────────────────────

function ConfidenceBlock({ c }: { c: V2SystemicReport['assets'][0]['confidence'] }) {
  const grade = gradeColor(c.confidence_score);
  const band = c.uncertainty_band;
  return (
    <Card>
      <BlockHeader icon={Gauge} title="R1 · Confidence Layer" layer="confidence_layer_v2_r1" />
      <div className="flex items-end gap-4 mb-3">
        <div>
          <div className="text-[9px] text-[#999] uppercase tracking-wide">Confidence score</div>
          <div className="font-mono font-extrabold text-[36px] leading-none" style={{ color: grade }}>
            {num(c.confidence_score, 1)}<span className="text-[16px] text-[#999]">/100</span>
          </div>
        </div>
        <div className="flex-1">
          <div className="text-[9px] text-[#999] uppercase tracking-wide mb-1">Sub-metrics</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] font-mono">
            <div className="flex justify-between"><span className="text-[#666]">dispersion</span><span className="font-bold">{num(c.prediction_dispersion, 1)}</span></div>
            <div className="flex justify-between"><span className="text-[#666]">agreement</span><span className="font-bold">{num(c.feature_agreement, 1)}</span></div>
            <div className="flex justify-between"><span className="text-[#666]">data_quality</span><span className="font-bold">{num(c.data_quality, 1)}</span></div>
            <div className="flex justify-between"><span className="text-[#666]">freshness</span><span className="font-bold">{num(c.freshness_factor, 1)}</span></div>
          </div>
        </div>
      </div>

      <div className="border-t border-[#f0f0f0] pt-2 mb-2">
        <div className="text-[9px] text-[#999] uppercase tracking-wide mb-1">Uncertainty band (90%)</div>
        <div className="flex items-center gap-2 text-[10px] font-mono">
          <span className="text-[#dc2626]">p5 {pct(band.p5, 2)}</span>
          <span className="text-[#666]">|</span>
          <span className="text-[#999]">p50 {pct(band.p50, 2)}</span>
          <span className="text-[#666]">|</span>
          <span className="text-[#16a34a]">p95 {pct(band.p95, 2)}</span>
          <span className="ml-auto text-[#999]">width {(band.width * 100).toFixed(2)}%</span>
        </div>
      </div>

      <div className="border-t border-[#f0f0f0] pt-2">
        <div className="text-[9px] text-[#999] uppercase tracking-wide mb-1">Contributors</div>
        <div className="space-y-0.5">
          {c.contributors.map((contrib, i) => (
            <div key={i} className="flex items-center gap-2 text-[9px] font-mono">
              <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: gradeColor(contrib.value) }} />
              <span className="text-[#666] w-40 truncate" title={contrib.explanation}>{contrib.source}</span>
              <span className="text-[#999]">w={contrib.weight.toFixed(2)}</span>
              <span className="font-bold ml-auto">{num(contrib.value, 1)}</span>
              <span className="text-[#999] w-10 text-right">→{num(contrib.contribution, 1)}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ─── R2: Regime V2 Block ───────────────────────────────────────────────────

function RegimeV2Block({ r }: { r: V2SystemicReport['assets'][0]['regime_v2'] }) {
  const top = r.distribution[0];
  const meta = (REGIME_V2_META_FALLBACK as Record<string, { label: string; color: string } | undefined>)[r.regime]
    ?? { label: r.regime, color: '#666' };
  return (
    <Card>
      <BlockHeader icon={Compass} title="R2 · Regime Detector V2" layer="regime_detector_v2_r2" />
      <div className="flex items-end gap-4 mb-3">
        <div>
          <div className="text-[9px] text-[#999] uppercase tracking-wide">Current regime</div>
          <div className="font-mono font-extrabold text-[22px] leading-none" style={{ color: meta.color }}>
            {r.regime}
          </div>
          <div className="text-[9px] text-[#999]">prob {num(r.probability, 1)}%</div>
        </div>
      </div>

      <div className="border-t border-[#f0f0f0] pt-2 mb-2">
        <div className="text-[9px] text-[#999] uppercase tracking-wide mb-1">Distribution (7 states)</div>
        <div className="space-y-1">
          {r.distribution.map((d) => {
            const m = (REGIME_V2_META_FALLBACK as Record<string, { label: string; color: string } | undefined>)[d.state]
              ?? { label: d.state, color: '#666' };
            return (
              <div key={d.state} className="flex items-center gap-2 text-[10px] font-mono">
                <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: m.color }} />
                <span className="w-28 text-[#666]">{d.state}</span>
                <div className="flex-1 h-2 bg-[#f5f5f5] rounded-sm overflow-hidden">
                  <div className="h-full" style={{ width: `${d.probability}%`, backgroundColor: m.color }} />
                </div>
                <span className="w-10 text-right font-bold">{num(d.probability, 1)}%</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t border-[#f0f0f0] pt-2">
        <div className="text-[9px] text-[#999] uppercase tracking-wide mb-1">30d transitions (top 3)</div>
        <div className="flex flex-wrap gap-2 text-[10px] font-mono">
          {r.transition_probability.map((t) => (
            <span key={t.target} className="bg-[#f5f5f5] px-2 py-0.5 rounded text-[#666]">
              → {t.target} <span className="font-bold">{num(t.probability, 1)}%</span>
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}

// Minimal metadata fallback (avoid importing full REGIME_V2_META to keep bundle small)
const REGIME_V2_META_FALLBACK: Record<string, { label: string; color: string }> = {
  EASING: { label: 'Easing', color: '#16a34a' },
  TIGHTENING: { label: 'Tightening', color: '#ea580c' },
  HIGH_INFLATION: { label: 'High Inflation', color: '#dc2626' },
  DISINFLATION: { label: 'Disinflation', color: '#059669' },
  CRISIS: { label: 'Crisis', color: '#7f1d1d' },
  RECOVERY: { label: 'Recovery', color: '#0066cc' },
  STRESS: { label: 'Stress', color: '#ca8a04' },
};

// ─── R3: Explainability Block ──────────────────────────────────────────────

function ExplainabilityBlock({ e }: { e: V2SystemicReport['assets'][0]['explanation'] }) {
  const action = actionBadge(e.decision);
  return (
    <Card>
      <BlockHeader icon={MessageSquare} title="R3 · Decision Explainability" layer="explainer_v2_r3" />
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] text-[#666]">Decision</div>
        <span className={`text-[9px] font-bold px-2 py-0.5 rounded text-white ${action.bg}`}>{action.label}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <div className="text-[9px] text-[#999] uppercase tracking-wide mb-1">Top positive factors</div>
          <div className="space-y-1">
            {e.top_positive_factors.length === 0 && <div className="text-[10px] text-[#999] italic">none</div>}
            {e.top_positive_factors.map((f) => (
              <div key={f.factor} className="flex items-center gap-2 text-[10px] font-mono">
                <span className="text-[#16a34a]">▲</span>
                <span className="w-24 text-[#666] truncate" title={f.label}>{f.factor}</span>
                <span className="font-bold text-[#16a34a]">+{num(f.contribution, 4)}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[9px] text-[#999] uppercase tracking-wide mb-1">Top negative factors</div>
          <div className="space-y-1">
            {e.top_negative_factors.length === 0 && <div className="text-[10px] text-[#999] italic">none</div>}
            {e.top_negative_factors.map((f) => (
              <div key={f.factor} className="flex items-center gap-2 text-[10px] font-mono">
                <span className="text-[#dc2626]">▼</span>
                <span className="w-24 text-[#666] truncate" title={f.label}>{f.factor}</span>
                <span className="font-bold text-[#dc2626]">{num(f.contribution, 4)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-[#f0f0f0] pt-2">
        <div className="text-[9px] text-[#999] uppercase tracking-wide mb-1">Reasoning summary</div>
        <p className="text-[10px] text-[#444] leading-relaxed">{e.reasoning_summary}</p>
      </div>
    </Card>
  );
}

// ─── R4: Forecast Verification Block ───────────────────────────────────────

function VerificationBlock({ v }: { v: V2SystemicReport['verification'] }) {
  return (
    <Card>
      <BlockHeader icon={CheckCircle} title="R4 · Forecast Verification" layer="forecast_verifier_v2_r4" color="#16a34a" />
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div>
          <div className="text-[9px] text-[#999] uppercase tracking-wide mb-1">MAE</div>
          <div className="font-mono font-extrabold text-[18px] leading-none">{(v.MAE * 100).toFixed(3)}<span className="text-[10px] text-[#999]">%</span></div>
        </div>
        <div>
          <div className="text-[9px] text-[#999] uppercase tracking-wide mb-1">RMSE</div>
          <div className="font-mono font-extrabold text-[18px] leading-none">{(v.RMSE * 100).toFixed(3)}<span className="text-[10px] text-[#999]">%</span></div>
        </div>
        <div>
          <div className="text-[9px] text-[#999] uppercase tracking-wide mb-1">MAPE</div>
          <div className="font-mono font-extrabold text-[18px] leading-none">
            {v.MAPE === null ? <span className="text-[#999]">—</span> : <>{v.MAPE.toFixed(2)}<span className="text-[10px] text-[#999]">%</span></>}
          </div>
        </div>
        <div>
          <div className="text-[9px] text-[#999] uppercase tracking-wide mb-1">HitRate</div>
          <div className="font-mono font-extrabold text-[18px] leading-none text-[#0066cc]">{(v.HitRate * 100).toFixed(1)}<span className="text-[10px] text-[#999]">%</span></div>
        </div>
        <div>
          <div className="text-[9px] text-[#999] uppercase tracking-wide mb-1">Calibration</div>
          <div className="font-mono font-extrabold text-[18px] leading-none">{(v.Calibration * 10000).toFixed(2)}<span className="text-[10px] text-[#999]">bps²</span></div>
        </div>
        <div>
          <div className="text-[9px] text-[#999] uppercase tracking-wide mb-1">Dir. Accuracy</div>
          <div className="font-mono font-extrabold text-[18px] leading-none">{num(v.DirectionalAccuracy, 1)}<span className="text-[10px] text-[#999]">%</span></div>
        </div>
      </div>
      <div className="border-t border-[#f0f0f0] pt-2 grid grid-cols-3 gap-2 text-[10px] font-mono">
        <div><span className="text-[#999]">n=</span><span className="font-bold">{v.total_verifications}</span></div>
        <div><span className="text-[#999]">window=</span><span className="font-bold">{v.window_size}</span></div>
        <div><span className="text-[#999]">bias=</span><span className="font-bold">{(v.bias * 100).toFixed(3)}%</span></div>
        <div><span className="text-[#999]">E[R]=</span><span className="font-bold">{(v.mean_expected_return * 100).toFixed(2)}%</span></div>
        <div><span className="text-[#999]">R[r]=</span><span className="font-bold">{(v.mean_realized_return * 100).toFixed(2)}%</span></div>
      </div>
    </Card>
  );
}

// ─── R5: Adaptive Weights Block ────────────────────────────────────────────

function AdaptiveWeightsBlock({ w }: { w: V2SystemicReport['adaptive_weights'] }) {
  const cw = w.current_weights;
  const dw = w.default_weights;
  const weightKeys: Array<keyof typeof cw> = ['carry', 'inflation_hedge', 'fx_momentum', 'liquidity', 'risk_penalty'];
  return (
    <Card>
      <BlockHeader icon={TrendingDown} title="R5 · Adaptive Weight Engine" layer="adaptive_weights_v2_r5" color="#ea580c" />
      <div className="grid grid-cols-3 gap-3 mb-3 text-[10px]">
        <div>
          <div className="text-[9px] text-[#999] uppercase tracking-wide mb-1">Updates</div>
          <div className="font-mono font-extrabold text-[18px] leading-none">{w.total_updates}</div>
        </div>
        <div>
          <div className="text-[9px] text-[#999] uppercase tracking-wide mb-1">Rejections</div>
          <div className="font-mono font-extrabold text-[18px] leading-none text-[#dc2626]">{w.total_rejections}</div>
        </div>
        <div>
          <div className="text-[9px] text-[#999] uppercase tracking-wide mb-1">Drift</div>
          <div className="font-mono font-extrabold text-[18px] leading-none">{num(w.drift_from_default, 4)}</div>
        </div>
      </div>

      <div className="border-t border-[#f0f0f0] pt-2">
        <div className="text-[9px] text-[#999] uppercase tracking-wide mb-1">Current vs default weights</div>
        <div className="space-y-1">
          {weightKeys.map((k) => {
            const current = cw[k];
            const def = dw[k];
            const drift = current - def;
            const driftColor = Math.abs(drift) < 0.001 ? '#999' : drift > 0 ? '#16a34a' : '#dc2626';
            return (
              <div key={k} className="flex items-center gap-2 text-[10px] font-mono">
                <span className="w-28 text-[#666]">{k}</span>
                <span className="font-bold">{num(current, 3)}</span>
                <span className="text-[#999]">/ {num(def, 3)}</span>
                <span className="ml-auto" style={{ color: driftColor }}>
                  {drift >= 0 ? '+' : ''}{num(drift, 4)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {w.last_update_timestamp && (
        <div className="border-t border-[#f0f0f0] mt-2 pt-2 text-[9px] text-[#999] font-mono">
          last update: {new Date(w.last_update_timestamp).toLocaleString('es-AR')} · journal: {w.journal.length}/{w.max_journal}
        </div>
      )}
    </Card>
  );
}

// ─── R6: Lineage Block ─────────────────────────────────────────────────────

function LineageBlock({ l }: { l: V2SystemicReport['assets'][0]['lineage'] }) {
  return (
    <Card>
      <BlockHeader icon={History} title="R6 · Prediction Lineage" layer="lineage_v2_r6" color="#7c3aed" />
      <div className="space-y-1 text-[10px] font-mono">
        <div className="flex justify-between">
          <span className="text-[#666]">lineage_id</span>
          <span className="font-bold text-[10px] truncate max-w-[280px]" title={l.lineage_id}>{l.lineage_id}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#666]">prediction_hash</span>
          <span className="font-bold text-[10px] truncate max-w-[280px]" title={l.prediction_hash}>{l.prediction_hash}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#666]">asset</span>
          <span className="font-bold">{l.asset}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#666]">oracle_version</span>
          <span className="font-bold">{l.oracle_version}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#666]">model_version</span>
          <span className="font-bold">{l.model_version}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#666]">timestamp</span>
          <span className="font-bold">{new Date(l.timestamp).toLocaleString('es-AR')}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#666]">score / adjusted</span>
          <span className="font-bold">{num(l.score, 1)} / {num(l.score_adjusted, 1)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#666]">decision</span>
          <span className="font-bold">{l.decision}</span>
        </div>
      </div>
      <div className="border-t border-[#f0f0f0] mt-2 pt-2 text-[9px] text-[#999] italic">
        Reproducible: re-running the engine with the same input + weights yields the same hash.
      </div>
    </Card>
  );
}

// ─── R7: Health Monitor Block ──────────────────────────────────────────────

function HealthBlock({ h }: { h: V2SystemicReport['health'] }) {
  const s = statusBadge(h.composite_status);
  const scoreColor = gradeColor(h.composite_score);
  return (
    <Card>
      <BlockHeader icon={HeartPulse} title="R7 · Oracle Health Monitor" layer="health_monitor_v2_r7" color="#dc2626" />
      <div className="flex items-end gap-4 mb-3">
        <div>
          <div className="text-[9px] text-[#999] uppercase tracking-wide">Composite</div>
          <div className="font-mono font-extrabold text-[36px] leading-none" style={{ color: scoreColor }}>
            {num(h.composite_score, 1)}
          </div>
        </div>
        <span className={`text-[9px] font-bold px-2 py-0.5 rounded text-white ${s.bg} mb-1`}>{s.label}</span>
        <div className="ml-auto text-right text-[9px] text-[#999] font-mono">
          n={h.sample_size}
        </div>
      </div>

      <div className="space-y-1">
        {h.metrics.map((m) => {
          const ms = statusBadge(m.status);
          return (
            <div key={m.name} className="flex items-center gap-2 text-[10px] font-mono">
              <span className={`w-2 h-2 rounded-full ${ms.bg}`} />
              <span className="w-44 text-[#666]">{m.name}</span>
              <span className="font-bold w-16 text-right">{num(m.value, 4)}</span>
              <span className="text-[#999] w-16 text-right">{m.unit}</span>
              <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded text-white ${ms.bg} ml-auto`}>{ms.label}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ─── R8: Scenario Engine Block ─────────────────────────────────────────────

function ScenarioBlock({ s }: { s: V2SystemicReport['scenarios'] }) {
  return (
    <Card>
      <BlockHeader icon={AlertTriangle} title="R8 · Scenario Engine" layer="scenario_engine_v2_r8" color="#ca8a04" />
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div>
          <div className="text-[9px] text-[#999] uppercase tracking-wide mb-1">Base score</div>
          <div className="font-mono font-extrabold text-[18px] leading-none">{num(s.base.score_adjusted, 1)}</div>
        </div>
        <div>
          <div className="text-[9px] text-[#999] uppercase tracking-wide mb-1">Worst case</div>
          <div className="font-mono font-extrabold text-[18px] leading-none text-[#dc2626]">{num(s.worst_case.score_adjusted, 1)}</div>
          <div className="text-[8px] text-[#999]">{s.worst_case.scenario.id}</div>
        </div>
        <div>
          <div className="text-[9px] text-[#999] uppercase tracking-wide mb-1">Range spread</div>
          <div className="font-mono font-extrabold text-[18px] leading-none">{num(s.range.spread, 1)}</div>
          <div className="text-[8px] text-[#999]">{num(s.range.min, 1)} – {num(s.range.max, 1)}</div>
        </div>
      </div>

      <div className="border-t border-[#f0f0f0] pt-2">
        <div className="text-[9px] text-[#999] uppercase tracking-wide mb-1">Shocked scenarios (Δ vs base)</div>
        <div className="space-y-1">
          {s.scenarios.map((sc) => {
            const delta = sc.delta_vs_base;
            const color = delta >= 0 ? '#16a34a' : '#dc2626';
            return (
              <div key={sc.scenario.id} className="flex items-center gap-2 text-[10px] font-mono">
                <span className="w-48 text-[#666] truncate" title={sc.scenario.description}>{sc.scenario.label}</span>
                <span className="font-bold">{num(sc.score_adjusted, 1)}</span>
                <span className="text-[#999]">·</span>
                <span className="font-bold" style={{ color }}>{delta >= 0 ? '+' : ''}{num(delta, 1)}</span>
                <span className="ml-auto text-[9px] text-[#999]">{sc.regime} → {sc.action.replace('_signal', '').toUpperCase()}</span>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

// ─── R9: Audit Trail Block ─────────────────────────────────────────────────

function AuditBlock({ a, totalState }: { a: V2SystemicReport['assets'][0]['audit']; totalState?: { total: number; pending: number; verified: number; mean_confidence: number | null } }) {
  return (
    <Card>
      <BlockHeader icon={ShieldCheck} title="R9 · Institutional Audit Trail" layer="audit_trail_v2_r9" color="#0f766e" />
      <div className="space-y-1 text-[10px] font-mono mb-3">
        <div className="flex justify-between">
          <span className="text-[#666]">decision_id</span>
          <span className="font-bold text-[10px] truncate max-w-[280px]" title={a.decision_id}>{a.decision_id}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#666]">timestamp</span>
          <span className="font-bold">{new Date(a.timestamp).toLocaleString('es-AR')}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#666]">oracle_version</span>
          <span className="font-bold">{a.oracle_version}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#666]">weights_version</span>
          <span className="font-bold">{a.weights_version}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#666]">confidence</span>
          <span className="font-bold">{a.confidence !== null ? num(a.confidence, 1) : '—'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#666]">verification_status</span>
          <span className="font-bold">{a.verification_status}</span>
        </div>
      </div>
      <div className="border-t border-[#f0f0f0] pt-2 text-[9px] text-[#999] font-mono">
        market_snapshot: fx_mep={num(a.market_snapshot.fx_mep, 0)} · infl={pct(a.market_snapshot.inflation_monthly, 1)} · tna={pct(a.market_snapshot.rates_tna, 1)} · risk={num(a.market_snapshot.risk_sentiment, 2)} · quality={a.market_snapshot.quality}
      </div>
      {totalState && (
        <div className="border-t border-[#f0f0f0] mt-2 pt-2 text-[9px] text-[#999] font-mono">
          trail: {totalState.total} entries · {totalState.pending} pending · {totalState.verified} verified
          {totalState.mean_confidence !== null && ` · mean conf ${num(totalState.mean_confidence, 1)}`}
        </div>
      )}
    </Card>
  );
}

// ─── R10: Foundation Model Advisor Block ───────────────────────────────────

function AdvisorBlock({ adv }: { adv: V2SystemicReport['advisors'] }) {
  return (
    <Card>
      <BlockHeader icon={Boxes} title="R10 · Foundation Model Advisors" layer="foundation_model_adapter_v2_r10" color="#7c3aed" />
      <div className="mb-3">
        <div className="text-[9px] text-[#999] uppercase tracking-wide mb-1">Registered adapters</div>
        <div className="space-y-1">
          {adv.registered_adapters.map((a) => (
            <div key={a.id} className="flex items-center gap-2 text-[10px] font-mono">
              <span className={`w-2 h-2 rounded-full ${a.enabled ? 'bg-[#16a34a]' : 'bg-[#999]'}`} />
              <span className="font-bold">{a.name}</span>
              <span className="text-[#999]">v{a.version}</span>
              {a.is_stub && <span className="text-[8px] px-1 py-0.5 bg-[#ca8a04] text-white rounded">STUB</span>}
              <span className="ml-auto text-[8px] text-[#999]">{a.enabled ? 'ENABLED' : 'DISABLED'}</span>
            </div>
          ))}
        </div>
      </div>

      {adv.ensemble && (
        <div className="border-t border-[#f0f0f0] pt-2 mb-3">
          <div className="text-[9px] text-[#999] uppercase tracking-wide mb-1">Ensemble (advisory only)</div>
          <div className="grid grid-cols-2 gap-3 text-[10px] font-mono">
            <div>
              <span className="text-[#666]">expected_return:</span>
              <span className="font-bold ml-1">{pct(adv.ensemble.expected_return, 2)}</span>
            </div>
            <div>
              <span className="text-[#666]">confidence:</span>
              <span className="font-bold ml-1">{num(adv.ensemble.confidence, 1)}/100</span>
            </div>
            <div>
              <span className="text-[#666]">oracle_weight:</span>
              <span className="font-bold ml-1">{(adv.ensemble.oracle_forecast.weight * 100).toFixed(0)}%</span>
            </div>
            <div>
              <span className="text-[#666]">oracle_forecast:</span>
              <span className="font-bold ml-1">{pct(adv.ensemble.oracle_forecast.expected_return, 2)}</span>
            </div>
          </div>
          <p className="text-[9px] text-[#999] italic mt-2">{adv.ensemble.notes}</p>
        </div>
      )}

      <div className="border-t border-[#f0f0f0] pt-2">
        <div className="text-[9px] text-[#999] uppercase tracking-wide mb-1">Advisor forecasts</div>
        <div className="space-y-1">
          {adv.forecasts.map((f) => (
            <div key={f.adapter_id} className="flex items-center gap-2 text-[10px] font-mono">
              <span className="w-32 text-[#666] truncate" title={f.method}>{f.adapter_name}</span>
              <span className="font-bold">{pct(f.expected_return, 2)}</span>
              <span className="text-[#999]">·</span>
              <span className="text-[#666]">conf {num(f.confidence, 0)}</span>
              {f.uncertainty_band && (
                <span className="ml-auto text-[9px] text-[#999]">
                  band [{pct(f.uncertainty_band.p5, 1)}, {pct(f.uncertainty_band.p95, 1)}]
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ─── Main V2 Panel ─────────────────────────────────────────────────────────

export function V2SystemicPanel({ v2 }: { v2: V2SystemicReport }) {
  // The V2 panel renders ONE block per layer (R1-R10). For multi-asset
  // universes we would loop; v1 has only SAN so we take assets[0].
  const san = v2.assets[0];
  if (!san) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="space-y-3 mt-4 pt-4 border-t-2 border-dashed border-[#e5e7eb]"
      data-testid="v2-systemic-panel"
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="text-[14px] font-extrabold tracking-tight">V2 Systemic Robustness Layers</div>
        <span className="text-[8px] font-mono text-[#999]">
          R1-R10 · {v2.version} · computed {new Date(v2.computed_at).toLocaleString('es-AR')}
        </span>
      </div>

      {/* Per-asset layers (R1, R2, R3, R6, R9) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <ConfidenceBlock c={san.confidence} />
        <RegimeV2Block r={san.regime_v2} />
        <ExplainabilityBlock e={san.explanation} />
      </div>

      {/* System-wide layers (R4, R5, R7, R8, R10) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <VerificationBlock v={v2.verification} />
        <AdaptiveWeightsBlock w={v2.adaptive_weights} />
        <HealthBlock h={v2.health} />
        <ScenarioBlock s={v2.scenarios} />
        <AdvisorBlock adv={v2.advisors} />
      </div>

      {/* Per-asset reproducibility (R6 lineage, R9 audit) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <LineageBlock l={san.lineage} />
        <AuditBlock a={san.audit} />
      </div>
    </motion.div>
  );
}
