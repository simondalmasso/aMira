// src/lib/oracle/v3/structural-regime-detector.ts
// ============================================================================
// I2 — STRUCTURAL REGIME DETECTOR (append-only, MAPIE-ready)
// ============================================================================
// MISSION (per ORACLE_V3_INTELLIGENCE_LAYER spec, I2):
//   "Implementar detector real de cambio estructural."
//
// ALGORITHMS:
//   - CUSUM: cumulative sum of (observation - target) drift; flags when |S| > threshold
//   - Page-Hinkley: cumulative sum with adaptive reset; flags on min-rejected increase
//   - Bayesian Change Point interface: pluggable adapter for `ruptures` / `rocpack` / PyMC
//   - ruptures adapter: stub that delegates to internal CUSUM (swap for HTTP Python)
//
// EXTENDS V2 R2 (regime-detector-v2):
//   - V2 R2 produces the CURRENT regime classification (7 states, distribution).
//   - V3 I2 ADDS structural change detection: are we IN a regime change right now?
//   - Persistence score: how stable has the regime been over the last N predictions?
//   - Transition confidence: how likely is the predicted transition (vs noise)?
//
// DESIGN:
//   - Reads from V2 R6 lineage buffer (the SINGLE source of truth for predictions).
//   - Pure functions for CUSUM + Page-Hinkley.
//   - Pluggable Bayesian adapter interface.
//   - All buffers are bounded (memory safe).
//
// ANTI-FRANKENSTEIN:
//   - Does NOT replace V2 R2 — adds structural change layer on top.
//   - Does NOT modify single-pass-oracle-engine.
// ============================================================================

import type { MarketState, NormalizedFeatures } from '@/lib/single-market-state';
import type { RegimeV2Classification, RegimeV2State } from '@/lib/oracle/v2/regime-detector-v2';
import { getLineageBuffer } from '@/lib/oracle/v2/lineage';

// ─── Public Types ──────────────────────────────────────────────────────────

export interface ChangePointDetection {
  /** Algorithm name */
  algorithm: 'cusum' | 'page_hinkley' | 'bayesian' | 'ruptures_adapter';
  /** Whether a structural change is currently detected */
  change_detected: boolean;
  /** Magnitude of the detected change (0..1) */
  magnitude: number;
  /** Index of the most recent detected change point (-1 if none) */
  change_point_index: number;
  /** Confidence in the detection (0..100) */
  confidence: number;
  /** Algorithm-specific statistics */
  statistics: {
    cusum_pos?: number;
    cusum_neg?: number;
    ph_cumulative?: number;
    ph_min?: number;
    threshold: number;
  };
  /** ISO-8601 */
  computed_at: string;
}

export interface RegimePersistence {
  /** Current regime */
  current_regime: RegimeV2State;
  /** How many consecutive predictions the regime has been the same */
  consecutive_predictions: number;
  /** How many days the regime has persisted (estimated from lineage timestamps) */
  consecutive_days: number;
  /** Persistence score 0..100 (higher = more stable) */
  persistence_score: number;
  /** Historical mean duration of this regime (in predictions) */
  historical_mean_duration: number;
  /** Historical mean duration of this regime (in days) */
  historical_mean_duration_days: number;
  /** Number of historical episodes of this regime */
  historical_episodes: number;
}

export interface TransitionConfidence {
  /** Predicted next regime (from V2 R2) */
  predicted_next: RegimeV2State;
  /** Predicted probability (from V2 R2) */
  predicted_probability: number;
  /** Structural-change-aware adjusted probability */
  adjusted_probability: number;
  /** Confidence in the transition (0..100) */
  transition_confidence: number;
  /** Reason for adjustment */
  reason: string;
}

export interface StructuralRegimeReport {
  /** CUSUM detection result */
  cusum: ChangePointDetection;
  /** Page-Hinkley detection result */
  page_hinkley: ChangePointDetection;
  /** Bayesian change point detection result (adapter) */
  bayesian: ChangePointDetection;
  /** ruptures adapter result */
  ruptures: ChangePointDetection;
  /** Persistence analysis */
  persistence: RegimePersistence;
  /** Transition confidence analysis */
  transition: TransitionConfidence;
  /** Composite: any structural change detected? */
  structural_change_detected: boolean;
  /** Composite: number of algorithms that agree on a change */
  consensus_count: number;
  /** Composite structural instability index 0..100 (higher = more unstable) */
  instability_index: number;
  /** ISO-8601 */
  computed_at: string;
  /** Engine version */
  engine_version: string;
  /** Feature flag */
  enabled: boolean;
}

export const STRUCTURAL_REGIME_VERSION = 'structural_regime_v3_i2';

// ─── Change Point Detector Interface ──────────────────────────────────────

export interface ChangePointDetector {
  id: string;
  name: string;
  algorithm: ChangePointDetection['algorithm'];
  is_stub: boolean;
  enabled: boolean;
  detect(series: number[], options: DetectOptions): ChangePointDetection;
}

export interface DetectOptions {
  /** Detection threshold (algorithm-specific) */
  threshold?: number;
  /** Slack / tolerance for Page-Hinkley */
  delta?: number;
  /** Minimum number of points required before detection */
  min_points?: number;
}

// ─── CUSUM Detector ────────────────────────────────────────────────────────
//
// CUSUM: cumulative sum of (x_i - target) where target = mean of the first
// min_points observations. A two-sided CUSUM is maintained:
//   S_pos[i] = max(0, S_pos[i-1] + (x_i - target) - k)
//   S_neg[i] = min(0, S_neg[i-1] + (x_i - target) + k)
// where k is a slack parameter (default = 0.005 for fractional returns).
// A change is detected when max(|S_pos|, |S_neg|) > threshold.

class CUSUMDetector implements ChangePointDetector {
  id = 'cusum';
  name = 'CUSUM';
  algorithm = 'cusum' as const;
  is_stub = false;
  enabled = true;

  detect(series: number[], options: DetectOptions = {}): ChangePointDetection {
    const threshold = options.threshold ?? 0.05;
    const k = options.delta ?? 0.005;
    const min_points = options.min_points ?? 5;

    if (series.length < min_points) {
      return {
        algorithm: 'cusum',
        change_detected: false,
        magnitude: 0,
        change_point_index: -1,
        confidence: 0,
        statistics: { cusum_pos: 0, cusum_neg: 0, threshold },
        computed_at: new Date().toISOString(),
      };
    }

    // Target = mean of the first min_points observations (the "in-control" baseline)
    const target = series.slice(0, min_points).reduce((s, v) => s + v, 0) / min_points;

    let sPos = 0;
    let sNeg = 0;
    let maxS = 0;
    let changeIdx = -1;
    let posAtChange = 0;
    let negAtChange = 0;

    for (let i = 0; i < series.length; i++) {
      const x = series[i];
      sPos = Math.max(0, sPos + (x - target) - k);
      sNeg = Math.min(0, sNeg + (x - target) + k);
      const m = Math.max(sPos, -sNeg);
      if (m > threshold && changeIdx === -1) {
        changeIdx = i;
        maxS = m;
        posAtChange = sPos;
        negAtChange = sNeg;
      }
      if (m > maxS) maxS = m;
    }

    const change_detected = changeIdx !== -1;
    const magnitude = Math.min(1, maxS / (threshold * 3));
    const confidence = change_detected
      ? Math.min(100, (maxS / threshold) * 50)
      : 0;

    return {
      algorithm: 'cusum',
      change_detected,
      magnitude: round(magnitude, 3),
      change_point_index: changeIdx,
      confidence: round(confidence, 1),
      statistics: {
        cusum_pos: round(posAtChange || sPos, 6),
        cusum_neg: round(negAtChange || sNeg, 6),
        threshold,
      },
      computed_at: new Date().toISOString(),
    };
  }
}

// ─── Page-Hinkley Detector ─────────────────────────────────────────────────
//
// Page-Hinkley test: cumulative sum of (x_i - mean_so_far - delta), tracking
// the minimum of this cumulative sum. A change is detected when:
//   U_t = m_t - min(m_1..m_t) > threshold
// where m_t = Σ (x_i - mean - delta)

class PageHinkleyDetector implements ChangePointDetector {
  id = 'page_hinkley';
  name = 'Page-Hinkley';
  algorithm = 'page_hinkley' as const;
  is_stub = false;
  enabled = true;

  detect(series: number[], options: DetectOptions = {}): ChangePointDetection {
    const threshold = options.threshold ?? 0.05;
    const delta = options.delta ?? 0.005;
    const min_points = options.min_points ?? 5;

    if (series.length < min_points) {
      return {
        algorithm: 'page_hinkley',
        change_detected: false,
        magnitude: 0,
        change_point_index: -1,
        confidence: 0,
        statistics: { ph_cumulative: 0, ph_min: 0, threshold },
        computed_at: new Date().toISOString(),
      };
    }

    let mean = series[0];
    let m = 0;
    let minM = 0;
    let changeIdx = -1;
    let cumAtChange = 0;
    let minAtChange = 0;

    for (let i = 0; i < series.length; i++) {
      // Update running mean
      mean = (mean * i + series[i]) / (i + 1);
      m += series[i] - mean - delta;
      if (m < minM) minM = m;
      const u = m - minM;
      if (u > threshold && changeIdx === -1) {
        changeIdx = i;
        cumAtChange = m;
        minAtChange = minM;
      }
    }

    const finalU = m - minM;
    const change_detected = changeIdx !== -1;
    const magnitude = Math.min(1, finalU / (threshold * 3));
    const confidence = change_detected
      ? Math.min(100, (finalU / threshold) * 50)
      : 0;

    return {
      algorithm: 'page_hinkley',
      change_detected,
      magnitude: round(magnitude, 3),
      change_point_index: changeIdx,
      confidence: round(confidence, 1),
      statistics: {
        ph_cumulative: round(cumAtChange || m, 6),
        ph_min: round(minAtChange || minM, 6),
        threshold,
      },
      computed_at: new Date().toISOString(),
    };
  }
}

// ─── Bayesian Change Point Adapter (pluggable) ────────────────────────────
//
// Interface for an external Bayesian online change-point detector (e.g.,
// `rocpack` in Python or PyMC-based). Currently delegates to a stub
// implementation that wraps CUSUM with a Bayesian flavor: posterior
// probability of a change is proportional to the CUSUM magnitude.

class BayesianCPAdapter implements ChangePointDetector {
  id = 'bayesian-cp';
  name = 'Bayesian Change Point (pluggable)';
  algorithm = 'bayesian' as const;
  is_stub = true;
  enabled = true;

  private cusum = new CUSUMDetector();

  detect(series: number[], options: DetectOptions = {}): ChangePointDetection {
    // TODO: replace with HTTP call to Python Bayesian CP service.
    const cusumResult = this.cusum.detect(series, options);
    return {
      ...cusumResult,
      algorithm: 'bayesian',
      confidence: round(cusumResult.confidence * 0.9, 1), // slightly less confident (stub)
      statistics: {
        ...cusumResult.statistics,
        threshold: cusumResult.statistics.threshold ?? 0,
      },
      computed_at: new Date().toISOString(),
    };
  }
}

// ─── ruptures Adapter (pluggable) ─────────────────────────────────────────
//
// Interface for the Python `ruptures` library (PELT, BinSeg, Window, Dynp).
// Currently delegates to CUSUM as a stub. When deployed, swap the implementation
// to call a Python service via HTTP/Service Binding.

class RupturesAdapter implements ChangePointDetector {
  id = 'ruptures-adapter';
  name = 'ruptures (pluggable)';
  algorithm = 'ruptures_adapter' as const;
  is_stub = true;
  enabled = true;

  private ph = new PageHinkleyDetector();

  detect(series: number[], options: DetectOptions = {}): ChangePointDetection {
    // TODO: replace with HTTP call to Python ruptures service.
    const phResult = this.ph.detect(series, options);
    return {
      ...phResult,
      algorithm: 'ruptures_adapter',
      confidence: round(phResult.confidence * 0.9, 1),
      statistics: {
        ...phResult.statistics,
        threshold: phResult.statistics.threshold ?? 0,
      },
      computed_at: new Date().toISOString(),
    };
  }
}

// ─── Registry ──────────────────────────────────────────────────────────────

const _detectors = new Map<string, ChangePointDetector>();

export function registerChangePointDetector(d: ChangePointDetector): void {
  _detectors.set(d.id, d);
}

export function listChangePointDetectors(): ChangePointDetector[] {
  return Array.from(_detectors.values());
}

export function getChangePointDetector(id: string): ChangePointDetector | null {
  return _detectors.get(id) ?? null;
}

// Auto-register built-in detectors
registerChangePointDetector(new CUSUMDetector());
registerChangePointDetector(new PageHinkleyDetector());
registerChangePointDetector(new BayesianCPAdapter());
registerChangePointDetector(new RupturesAdapter());

// ─── Feature Flag ──────────────────────────────────────────────────────────

let _enabled = true;
export function setStructuralRegimeEnabled(v: boolean): void { _enabled = v; }
export function isStructuralRegimeEnabled(): boolean { return _enabled; }

// ─── Helpers ───────────────────────────────────────────────────────────────

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}

// ─── Persistence Analysis ─────────────────────────────────────────────────
//
// Walks the lineage buffer backwards to count how many consecutive
// predictions have had the same regime. Also estimates duration in days.

function computePersistence(currentRegime: RegimeV2State): RegimePersistence {
  const lineage = getLineageBuffer();
  if (lineage.length === 0) {
    return {
      current_regime: currentRegime,
      consecutive_predictions: 0,
      consecutive_days: 0,
      persistence_score: 0,
      historical_mean_duration: 0,
      historical_mean_duration_days: 0,
      historical_episodes: 0,
    };
  }

  // Walk backwards
  let consecutive_predictions = 0;
  for (let i = lineage.length - 1; i >= 0; i--) {
    const r = lineage[i].regime_v2?.regime;
    if (r === currentRegime) consecutive_predictions++;
    else break;
  }

  // Estimate consecutive days
  const recentSlice = lineage.slice(-consecutive_predictions);
  let consecutive_days = 0;
  if (recentSlice.length > 0) {
    const first = new Date(recentSlice[0].timestamp).getTime();
    const last = new Date(recentSlice[recentSlice.length - 1].timestamp).getTime();
    consecutive_days = Math.max(1, Math.round((last - first) / (24 * 3600 * 1000)));
  }

  // Historical episodes of this regime
  const episodes: number[] = [];
  let currentEpisode = 0;
  let prev: RegimeV2State | null = null;
  for (const l of lineage) {
    const r = l.regime_v2?.regime;
    if (r === currentRegime) {
      currentEpisode++;
    } else {
      if (currentEpisode > 0) episodes.push(currentEpisode);
      currentEpisode = 0;
    }
    prev = r ?? prev;
  }
  if (currentEpisode > 0) episodes.push(currentEpisode);

  const historical_mean_duration = episodes.length > 0 ? mean(episodes) : 0;
  // Rough day conversion (1 prediction ≈ 1 day for the daily cron)
  const historical_mean_duration_days = historical_mean_duration;

  // Persistence score: based on consecutive_predictions / (mean duration)
  // Higher = more stable than historical average
  const persistence_score = historical_mean_duration > 0
    ? Math.min(100, (consecutive_predictions / historical_mean_duration) * 50 + 50)
    : Math.min(100, consecutive_predictions * 10);

  return {
    current_regime: currentRegime,
    consecutive_predictions,
    consecutive_days,
    persistence_score: round(persistence_score, 1),
    historical_mean_duration: round(historical_mean_duration, 1),
    historical_mean_duration_days: round(historical_mean_duration_days, 1),
    historical_episodes: episodes.length,
  };
}

// ─── Transition Confidence ────────────────────────────────────────────────
//
// Combines V2 R2's predicted transition probability with structural change
// detection. If structural changes are detected, transition confidence drops.

function computeTransitionConfidence(
  v2_regime: RegimeV2Classification,
  structural_change_detected: boolean,
  consensus_count: number,
): TransitionConfidence {
  if (v2_regime.transition_probability.length === 0) {
    return {
      predicted_next: v2_regime.regime,
      predicted_probability: v2_regime.probability,
      adjusted_probability: v2_regime.probability,
      transition_confidence: 50,
      reason: 'no transition predictions available',
    };
  }

  const top = v2_regime.transition_probability[0];
  const predicted_next = top.target;
  const predicted_probability = top.probability;

  // If structural change detected, raise the probability of leaving the current regime
  // and lower confidence in the persistence prediction.
  let adjusted = predicted_probability;
  let reason = 'baseline transition probability (no structural change)';
  let transition_confidence = 50 + (predicted_probability - 50) * 0.5;

  if (structural_change_detected) {
    // Penalize confidence in proportion to consensus_count
    const penalty = Math.min(30, consensus_count * 10);
    transition_confidence = Math.max(0, transition_confidence - penalty);
    // If the predicted transition is to a different regime, boost it
    if (predicted_next !== v2_regime.regime) {
      adjusted = Math.min(100, predicted_probability + consensus_count * 5);
      reason = `structural change detected (${consensus_count}/4 algorithms agree) — transition probability boosted`;
    } else {
      adjusted = Math.max(0, predicted_probability - consensus_count * 5);
      reason = `structural change detected (${consensus_count}/4 algorithms agree) — persistence probability reduced`;
    }
  }

  return {
    predicted_next,
    predicted_probability: round(predicted_probability, 1),
    adjusted_probability: round(adjusted, 1),
    transition_confidence: round(transition_confidence, 1),
    reason,
  };
}

// ─── Main Entry Point ──────────────────────────────────────────────────────

export interface StructuralRegimeInput {
  features: NormalizedFeatures;
  market_state: MarketState;
  v2_regime: RegimeV2Classification;
  /** Series to analyze for change points (default: lineage expected_returns) */
  series?: number[];
}

export function detectStructuralRegime(input: StructuralRegimeInput): StructuralRegimeReport {
  // Default series: expected_returns from lineage buffer
  const series = input.series ?? (() => {
    const lineage = getLineageBuffer();
    return lineage.map((l) => l.prediction.expected_return);
  })();

  const options: DetectOptions = {
    threshold: 0.05,
    delta: 0.005,
    min_points: 5,
  };

  // Run all four detectors
  const cusum = (getChangePointDetector('cusum') ?? new CUSUMDetector()).detect(series, options);
  const page_hinkley = (getChangePointDetector('page_hinkley') ?? new PageHinkleyDetector()).detect(series, options);
  const bayesian = (getChangePointDetector('bayesian-cp') ?? new BayesianCPAdapter()).detect(series, options);
  const ruptures = (getChangePointDetector('ruptures-adapter') ?? new RupturesAdapter()).detect(series, options);

  // Consensus: how many algorithms agree a change is happening
  const detections = [cusum, page_hinkley, bayesian, ruptures];
  const consensus_count = detections.filter((d) => d.change_detected).length;
  const structural_change_detected = consensus_count >= 2; // need ≥2 algorithms to agree

  // Instability index = mean of magnitudes × consensus boost
  const mean_magnitude = mean(detections.map((d) => d.magnitude));
  const consensus_boost = consensus_count >= 3 ? 1.3 : consensus_count >= 2 ? 1.0 : 0.5;
  const instability_index = Math.min(100, mean_magnitude * 100 * consensus_boost);

  const persistence = computePersistence(input.v2_regime.regime);
  const transition = computeTransitionConfidence(input.v2_regime, structural_change_detected, consensus_count);

  return {
    cusum,
    page_hinkley,
    bayesian,
    ruptures,
    persistence,
    transition,
    structural_change_detected,
    consensus_count,
    instability_index: round(instability_index, 1),
    computed_at: new Date().toISOString(),
    engine_version: STRUCTURAL_REGIME_VERSION,
    enabled: _enabled,
  };
}
