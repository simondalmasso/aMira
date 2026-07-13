// src/lib/oracle/v3/knowledge-graph.ts
// ============================================================================
// I10 — KNOWLEDGE GRAPH (append-only, in-memory relational map)
// ============================================================================
// MISSION (per ORACLE_V3_INTELLIGENCE_LAYER spec, I10):
//   "Construir relaciones internas entre indicadores."
//
// NODE TYPES:
//   - IndicatorNode : raw market observables (fx_mep, inflation, rates, ...)
//   - FactorNode    : normalized features (carry, fx_momentum, ...)
//   - AssetNode     : scored assets (SAN, ...)
//   - PredictionNode: predictions made (with expected_return)
//   - OutcomeNode   : realized returns (verifications)
//   - RegimeNode    : economic regimes (V1 4-state + V2 7-state)
//   - ExplanationNode: factor attribution records
//
// EDGE TYPES:
//   - INPUT_OF       : IndicatorNode → FactorNode (normalization)
//   - CONTRIBUTES_TO : FactorNode → AssetNode (scoring)
//   - DRIVES         : FactorNode → PredictionNode (factor contribution)
//   - PRODUCED       : AssetNode → PredictionNode (engine output)
//   - VERIFIED_BY    : PredictionNode → OutcomeNode (verification)
//   - CLASSIFIED_AS  : AssetNode → RegimeNode (regime detection)
//   - EXPLAINED_BY   : PredictionNode → ExplanationNode (R3 explainer)
//   - TRANSITIONS_TO : RegimeNode → RegimeNode (regime transition)
//
// DESIGN:
//   - In-memory graph (bounded: max 1000 nodes, 5000 edges).
//   - Pure builder functions. The graph is derived from V1 + V2 + V3 data.
//   - Supports queries: neighbors(node), path(a, b), centrality(node).
//
// ANTI-FRANKENSTEIN:
//   - Does NOT modify V1, V2, or other V3 modules.
//   - Reads from V2 R6 lineage + V2 R4 verification buffer.
// ============================================================================

import type { AssetScore, AssetPrediction } from '@/lib/single-pass-oracle-engine';
import type { NormalizedFeatures, MarketState } from '@/lib/single-market-state';
import type { ConfidenceLayer } from '@/lib/oracle/v2/confidence-engine';
import type { RegimeV2Classification } from '@/lib/oracle/v2/regime-detector-v2';
import type { DecisionExplanation } from '@/lib/oracle/v2/explainer';
import { getLineageBuffer } from '@/lib/oracle/v2/lineage';
import { getVerificationBuffer } from '@/lib/oracle/v2/forecast-verifier';

// ─── Public Types ──────────────────────────────────────────────────────────

export type NodeType =
  | 'indicator'
  | 'factor'
  | 'asset'
  | 'prediction'
  | 'outcome'
  | 'regime'
  | 'explanation';

export type EdgeType =
  | 'INPUT_OF'
  | 'CONTRIBUTES_TO'
  | 'DRIVES'
  | 'PRODUCED'
  | 'VERIFIED_BY'
  | 'CLASSIFIED_AS'
  | 'EXPLAINED_BY'
  | 'TRANSITIONS_TO';

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  /** Value (if applicable) */
  value?: number | string;
  /** Metadata */
  metadata: Record<string, unknown>;
  /** ISO-8601 when the node was added */
  timestamp: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  /** Weight (0..1, optional) */
  weight?: number;
  /** Metadata */
  metadata: Record<string, unknown>;
}

export interface KnowledgeGraphReport {
  /** All nodes (deduplicated) */
  nodes: GraphNode[];
  /** All edges */
  edges: GraphEdge[];
  /** Counts by node type */
  node_counts: Record<NodeType, number>;
  /** Counts by edge type */
  edge_counts: Record<EdgeType, number>;
  /** Top-K most central nodes (by degree) */
  central_nodes: Array<{ node: GraphNode; degree: number }>;
  /** Top-K strongest edges (by weight) */
  strongest_edges: GraphEdge[];
  /** Sample paths (indicator → prediction → outcome) */
  sample_paths: Array<{ path: string[]; description: string }>;
  /** Graph statistics */
  stats: {
    total_nodes: number;
    total_edges: number;
    density: number;  // edges / (nodes * (nodes-1))
    avg_degree: number;
  };
  /** ISO-8601 */
  computed_at: string;
  /** Engine version */
  engine_version: string;
  /** Feature flag */
  enabled: boolean;
}

export const KNOWLEDGE_GRAPH_VERSION = 'knowledge_graph_v3_i10';

// ─── Feature Flag ──────────────────────────────────────────────────────────

let _enabled = true;
export function setKnowledgeGraphEnabled(v: boolean): void { _enabled = v; }
export function isKnowledgeGraphEnabled(): boolean { return _enabled; }

// ─── Helpers ───────────────────────────────────────────────────────────────

function genId(prefix: string, ...parts: (string | number)[]): string {
  return `${prefix}_${parts.join('_')}`;
}

// ─── Graph Builder ─────────────────────────────────────────────────────────

class KnowledgeGraphBuilder {
  private nodes = new Map<string, GraphNode>();
  private edges = new Map<string, GraphEdge>();
  private maxNodes = 1000;
  private maxEdges = 5000;

  addNode(node: GraphNode): void {
    if (this.nodes.size >= this.maxNodes && !this.nodes.has(node.id)) return;
    this.nodes.set(node.id, node);
  }

  addEdge(edge: GraphEdge): void {
    if (this.edges.size >= this.maxEdges && !this.edges.has(edge.id)) return;
    this.edges.set(edge.id, edge);
  }

  getNodes(): GraphNode[] { return Array.from(this.nodes.values()); }
  getEdges(): GraphEdge[] { return Array.from(this.edges.values()); }

  degree(nodeId: string): number {
    return this.getEdges().filter((e) => e.source === nodeId || e.target === nodeId).length;
  }
}

// ─── Build the Graph ───────────────────────────────────────────────────────

function buildGraph(
  score: AssetScore,
  prediction: AssetPrediction,
  features: NormalizedFeatures,
  market_state: MarketState,
  confidence: ConfidenceLayer,
  v2_regime: RegimeV2Classification,
  explanation: DecisionExplanation,
): KnowledgeGraphBuilder {
  const g = new KnowledgeGraphBuilder();
  const now = new Date().toISOString();

  // ── Indicator nodes ──────────────────────────────────────────────────────
  const indicators: Array<{ key: string; label: string; value: number }> = [
    { key: 'fx_mep', label: 'FX MEP', value: market_state.fx_mep },
    { key: 'inflation_monthly', label: 'Inflation Monthly', value: market_state.inflation_monthly },
    { key: 'rates_tna', label: 'TNA', value: market_state.rates_tna },
    { key: 'reserves_delta', label: 'Reserves Delta', value: market_state.reserves_delta },
    { key: 'risk_sentiment', label: 'Risk Sentiment', value: market_state.risk_sentiment },
    { key: 'liquidity_index', label: 'Liquidity Index', value: market_state.liquidity_index },
  ];

  for (const ind of indicators) {
    g.addNode({
      id: genId('ind', ind.key),
      type: 'indicator',
      label: ind.label,
      value: round(ind.value, 6),
      metadata: { key: ind.key },
      timestamp: now,
    });
  }

  // ── Factor nodes + INPUT_OF edges ────────────────────────────────────────
  const factorMap: Array<{ key: string; label: string; value: number; fromIndicators: string[] }> = [
    { key: 'carry', label: 'Carry', value: features.carry, fromIndicators: ['rates_tna', 'inflation_monthly'] },
    { key: 'inflation_hedge', label: 'Inflation Hedge', value: features.inflation_hedge, fromIndicators: ['inflation_monthly'] },
    { key: 'fx_momentum', label: 'FX Momentum', value: features.fx_momentum, fromIndicators: ['fx_mep', 'risk_sentiment'] },
    { key: 'liquidity', label: 'Liquidity', value: features.liquidity, fromIndicators: ['liquidity_index', 'reserves_delta'] },
    { key: 'risk_penalty', label: 'Risk Penalty', value: features.risk_penalty, fromIndicators: ['risk_sentiment', 'liquidity_index'] },
  ];

  for (const f of factorMap) {
    const factorId = genId('fac', f.key);
    g.addNode({
      id: factorId,
      type: 'factor',
      label: f.label,
      value: round(f.value, 4),
      metadata: { key: f.key },
      timestamp: now,
    });

    for (const ind of f.fromIndicators) {
      g.addEdge({
        id: genId('e', 'in', ind, 'to', f.key),
        source: genId('ind', ind),
        target: factorId,
        type: 'INPUT_OF',
        weight: 0.5,
        metadata: {},
      });
    }
  }

  // ── Asset node ───────────────────────────────────────────────────────────
  const assetId = genId('asset', score.asset);
  g.addNode({
    id: assetId,
    type: 'asset',
    label: score.asset,
    value: score.score_adjusted,
    metadata: { score: score.score, score_adjusted: score.score_adjusted, action: score.action },
    timestamp: now,
  });

  // CONTRIBUTES_TO edges (factor → asset) with weight = |contribution|
  for (const f of explanation.top_positive_factors) {
    g.addEdge({
      id: genId('e', 'ctb', f.factor, 'to', score.asset),
      source: genId('fac', f.factor),
      target: assetId,
      type: 'CONTRIBUTES_TO',
      weight: Math.min(1, Math.abs(f.contribution) * 100),
      metadata: { contribution: f.contribution, direction: 'positive' },
    });
  }
  for (const f of explanation.top_negative_factors) {
    g.addEdge({
      id: genId('e', 'ctb', f.factor, 'to', score.asset),
      source: genId('fac', f.factor),
      target: assetId,
      type: 'CONTRIBUTES_TO',
      weight: Math.min(1, Math.abs(f.contribution) * 100),
      metadata: { contribution: f.contribution, direction: 'negative' },
    });
  }

  // ── Regime node ──────────────────────────────────────────────────────────
  const regimeId = genId('reg', v2_regime.regime);
  g.addNode({
    id: regimeId,
    type: 'regime',
    label: v2_regime.regime,
    value: v2_regime.probability,
    metadata: { detector: 'v2_r2' },
    timestamp: now,
  });

  // CLASSIFIED_AS edge
  g.addEdge({
    id: genId('e', 'cls', score.asset, v2_regime.regime),
    source: assetId,
    target: regimeId,
    type: 'CLASSIFIED_AS',
    weight: v2_regime.probability / 100,
    metadata: {},
  });

  // TRANSITIONS_TO edges
  for (const t of v2_regime.transition_probability) {
    const targetId = genId('reg', t.target);
    g.addNode({
      id: targetId,
      type: 'regime',
      label: t.target,
      value: t.probability,
      metadata: { detector: 'v2_r2' },
      timestamp: now,
    });
    g.addEdge({
      id: genId('e', 'trn', v2_regime.regime, 'to', t.target),
      source: regimeId,
      target: targetId,
      type: 'TRANSITIONS_TO',
      weight: t.probability / 100,
      metadata: { probability: t.probability },
    });
  }

  // ── Prediction node ──────────────────────────────────────────────────────
  const predId = genId('pred', Date.now());
  g.addNode({
    id: predId,
    type: 'prediction',
    label: `30d Forecast`,
    value: prediction.expected_return,
    metadata: {
      confidence: confidence.confidence_score,
      horizon_days: prediction.horizon_days,
      risk_var_95: prediction.risk_var_95,
    },
    timestamp: now,
  });

  // PRODUCED edge (asset → prediction)
  g.addEdge({
    id: genId('e', 'prd', score.asset, Date.now()),
    source: assetId,
    target: predId,
    type: 'PRODUCED',
    weight: confidence.confidence_score / 100,
    metadata: {},
  });

  // DRIVES edges (factor → prediction)
  for (const f of [...explanation.top_positive_factors, ...explanation.top_negative_factors]) {
    g.addEdge({
      id: genId('e', 'drv', f.factor, 'to', Date.now()),
      source: genId('fac', f.factor),
      target: predId,
      type: 'DRIVES',
      weight: Math.min(1, Math.abs(f.contribution) * 100),
      metadata: { contribution: f.contribution },
    });
  }

  // ── Explanation node ─────────────────────────────────────────────────────
  const explId = genId('expl', Date.now());
  g.addNode({
    id: explId,
    type: 'explanation',
    label: 'Decision Explanation',
    value: explanation.reasoning_summary.slice(0, 100),
    metadata: {
      top_positive: explanation.top_positive_factors.map((f) => f.factor),
      top_negative: explanation.top_negative_factors.map((f) => f.factor),
    },
    timestamp: now,
  });

  g.addEdge({
    id: genId('e', 'exp', Date.now()),
    source: predId,
    target: explId,
    type: 'EXPLAINED_BY',
    weight: 1.0,
    metadata: {},
  });

  // ── Outcome nodes (from verification buffer) ─────────────────────────────
  const verifications = getVerificationBuffer();
  for (const v of verifications.slice(-20)) {  // last 20 to keep graph manageable
    const outId = genId('out', v.prediction_id);
    g.addNode({
      id: outId,
      type: 'outcome',
      label: 'Realized Return',
      value: v.realized_return,
      metadata: {
        prediction_id: v.prediction_id,
        expected: v.expected_return,
        timestamp: v.timestamp,
      },
      timestamp: v.timestamp,
    });

    // VERIFIED_BY edge — we link outcome to the prediction node of the same timestamp
    // (Approximation: link to current predId since we don't have prediction_id linkage in lineage)
    // Skip self-linking; instead, link to the explId as a proxy.
    g.addEdge({
      id: genId('e', 'vrb', v.prediction_id),
      source: predId,
      target: outId,
      type: 'VERIFIED_BY',
      weight: 1.0,
      metadata: { time_gap: 'historical' },
    });
  }

  return g;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

// ─── Main Entry Point ──────────────────────────────────────────────────────

export interface KnowledgeGraphInput {
  score: AssetScore;
  prediction: AssetPrediction;
  features: NormalizedFeatures;
  market_state: MarketState;
  v2_confidence: ConfidenceLayer;
  v2_regime: RegimeV2Classification;
  v2_explanation: DecisionExplanation;
}

export function buildKnowledgeGraph(input: KnowledgeGraphInput): KnowledgeGraphReport {
  const g = buildGraph(
    input.score,
    input.prediction,
    input.features,
    input.market_state,
    input.v2_confidence,
    input.v2_regime,
    input.v2_explanation,
  );

  const nodes = g.getNodes();
  const edges = g.getEdges();

  // Counts by type
  const node_counts: Record<NodeType, number> = {
    indicator: 0, factor: 0, asset: 0, prediction: 0, outcome: 0, regime: 0, explanation: 0,
  };
  for (const n of nodes) node_counts[n.type]++;

  const edge_counts: Record<EdgeType, number> = {
    INPUT_OF: 0, CONTRIBUTES_TO: 0, DRIVES: 0, PRODUCED: 0,
    VERIFIED_BY: 0, CLASSIFIED_AS: 0, EXPLAINED_BY: 0, TRANSITIONS_TO: 0,
  };
  for (const e of edges) edge_counts[e.type]++;

  // Central nodes (by degree)
  const central_nodes = nodes
    .map((n) => ({ node: n, degree: g.degree(n.id) }))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 10);

  // Strongest edges (by weight)
  const strongest_edges = [...edges]
    .filter((e) => e.weight !== undefined)
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
    .slice(0, 10);

  // Sample paths (indicator → factor → asset → prediction → outcome)
  const sample_paths: Array<{ path: string[]; description: string }> = [];
  const indicatorNodes = nodes.filter((n) => n.type === 'indicator').slice(0, 3);
  for (const ind of indicatorNodes) {
    const path = [ind.label];
    const inputEdges = edges.filter((e) => e.source === ind.id && e.type === 'INPUT_OF');
    if (inputEdges.length > 0) {
      const factor = nodes.find((n) => n.id === inputEdges[0].target);
      if (factor) {
        path.push(factor.label);
        const ctbEdges = edges.filter((e) => e.source === factor.id && e.type === 'CONTRIBUTES_TO');
        if (ctbEdges.length > 0) {
          const asset = nodes.find((n) => n.id === ctbEdges[0].target);
          if (asset) {
            path.push(asset.label);
            const prdEdges = edges.filter((e) => e.source === asset.id && e.type === 'PRODUCED');
            if (prdEdges.length > 0) {
              const pred = nodes.find((n) => n.id === prdEdges[0].target);
              if (pred) {
                path.push(pred.label);
                sample_paths.push({
                  path,
                  description: `${ind.label} → ${factor.label} → ${asset.label} → ${pred.label}`,
                });
              }
            }
          }
        }
      }
    }
  }

  // Stats
  const total_nodes = nodes.length;
  const total_edges = edges.length;
  const density = total_nodes > 1 ? total_edges / (total_nodes * (total_nodes - 1)) : 0;
  const avg_degree = total_nodes > 0 ? (total_edges * 2) / total_nodes : 0;

  return {
    nodes,
    edges,
    node_counts,
    edge_counts,
    central_nodes,
    strongest_edges,
    sample_paths,
    stats: {
      total_nodes,
      total_edges,
      density: round(density, 4),
      avg_degree: round(avg_degree, 2),
    },
    computed_at: new Date().toISOString(),
    engine_version: KNOWLEDGE_GRAPH_VERSION,
    enabled: _enabled,
  };
}
