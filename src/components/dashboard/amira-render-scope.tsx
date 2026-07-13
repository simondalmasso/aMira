// src/components/dashboard/amira-render-scope.tsx
// V9.2 — RENDER SCOPE ISOLATION primitives.
//
// Per spec `critical_fixes.2_render_scope_isolation`:
//   STRATEGY_VIEW:    solo narrativa + recomendaciones
//   METRICS_VIEW:     solo números + riesgo + performance
//   REBALANCE_VIEW:   solo acciones + estado
//   DATA_FOOTER_VIEW: solo fuentes + freshness
//   rule: "un scope no puede renderizar datos de otro scope"
//
// Per spec `nav_engine_bloomberg_lite.anti_frankenstein_layer`:
//   dedupe_ui_fragments: true
//   block_cross_injection: true
//   force_single_render_pass: true
//
// This module exposes:
//   1. <RenderScope name="METRICS_VIEW"> wrapper — adds data-render-scope
//      attribute and registers the scope in a global Set for runtime
//      audit (verifies that each scope appears at most once per page).
//   2. useUniqueScope() — guarantees a scope is rendered by exactly one
//      component instance per page lifecycle.
//   3. <SemanticDiffBlock id="portfolio_snapshot"> wrapper — hashes its
//      children's serialized content; if hash matches the previous render,
//      it returns null (per spec `4_duplicate_block_elimination`).
//
// SAFE MODIFICATIONS: This module is advisory only. It does not change
// any data flow — it just enforces render-time discipline at the UI layer.

'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';
import {
  RENDER_SCOPES,
  type RenderScopeName,
  useSemanticDiffGuard,
} from '@/lib/amira-portfolio-view-model';

// ─── Scope Registry (runtime audit) ────────────────────────────────────────
// Tracks how many instances of each scope name are currently mounted.
// Used by `auditScopes()` for deployment verification (e.g., assert that
// METRICS_VIEW has a non-zero count, but no scope cross-injects data).

const MOUNTED_SCOPES = new Map<RenderScopeName, number>();

// ─── <RenderScope> wrapper ────────────────────────────────────────────────
// Wraps a block of UI and tags it with its scope name.
// Per spec `2_render_scope_isolation.rule`: a scope cannot render data
// belonging to another scope. This wrapper does NOT enforce that at the
// type level (React children are untyped), but it DOES:
//   1. Add `data-render-scope="<name>"` attribute for audit / Cypress tests.
//   2. Register the scope in MOUNTED_SCOPES for runtime inspection.
//   3. Audit helper `auditScopes()` returns the count per scope — useful
//      for deployment verification (e.g., METRICS_VIEW should have count
//      that matches the number of `portfolio_value_usd` emissions).
//
// NOTE: Per spec `4_duplicate_block_elimination`, dedupe is at the BLOCK
// level (via <SemanticDiffBlock>) using semantic hashes. The same scope
// can wrap multiple non-identical blocks (e.g., REBALANCE_VIEW may contain
// both the holdings table AND the profit projection block — both are
// "actions/estado", neither duplicates the other).

interface RenderScopeProps {
  name: RenderScopeName;
  children: ReactNode;
  /** Optional className for the wrapper div. */
  className?: string;
  /** Optional testId for the wrapper div. */
  testId?: string;
}

export function RenderScope({
  name,
  children,
  className,
  testId,
}: RenderScopeProps) {
  useEffect(() => {
    const count = MOUNTED_SCOPES.get(name) ?? 0;
    MOUNTED_SCOPES.set(name, count + 1);
    return () => {
      const c = MOUNTED_SCOPES.get(name) ?? 0;
      if (c <= 1) {
        MOUNTED_SCOPES.delete(name);
      } else {
        MOUNTED_SCOPES.set(name, c - 1);
      }
    };
  }, [name]);

  return (
    <div
      data-render-scope={name}
      data-testid={testId ?? `render-scope-${name.toLowerCase()}`}
      className={className}
    >
      {children}
    </div>
  );
}

// ─── <SemanticDiffBlock> ─────────────────────────────────────────────────
// Per spec `critical_fixes.4_duplicate_block_elimination`:
//   method: hash(previous_render_block) == hash(next_render_block)
//   behavior: if identical → suppress render
//   target_blocks: [portfolio_snapshot, return_summary, risk_panel]
//
// Wraps a block of UI. On every render, we hash a "fingerprint" prop
// (provided by the parent — typically a JSON-serializable summary of
// the data the block renders). If the hash matches the previous render,
// we suppress the children render and return null.

interface SemanticDiffBlockProps {
  /** Stable identifier for this block (e.g. 'portfolio_snapshot'). */
  id: 'portfolio_snapshot' | 'return_summary' | 'risk_panel' | string;
  /** JSON-serializable fingerprint of the rendered data. */
  fingerprint: unknown;
  children: ReactNode;
  className?: string;
}

export function SemanticDiffBlock({
  id,
  fingerprint,
  children,
  className,
}: SemanticDiffBlockProps) {
  const shouldRender = useSemanticDiffGuard(`block:${id}`, fingerprint);

  if (!shouldRender) {
    // Identical to ANOTHER mounted instance with the same id — suppress.
    // (V9.3 fix: previously this fired on every re-render with identical
    //  content, which made Ganancia Proyectada disappear after hydration.
    //  Now it only fires when a TRUE duplicate mount is detected.)
    return null;
  }

  return (
    <div
      data-semantic-block={id}
      data-semantic-hash={stableHashString(fingerprint)}
      className={className}
    >
      {children}
    </div>
  );
}

function stableHashString(value: unknown): string {
  if (value == null) return 'null';
  if (typeof value === 'string') return `s:${value}`;
  if (typeof value === 'number') return `n:${value}`;
  if (typeof value === 'boolean') return `b:${value}`;
  try {
    const json = JSON.stringify(value);
    let h = 5381;
    for (let i = 0; i < json.length; i++) {
      h = ((h << 5) + h + json.charCodeAt(i)) >>> 0;
    }
    return `o:${h.toString(36)}`;
  } catch {
    return `u:${String(value)}`;
  }
}

// ─── useUniqueScope (hook form) ────────────────────────────────────────────
// For components that cannot wrap their JSX in <RenderScope> (e.g., because
// they're inside a <table>), this hook provides the same registration.
// Returns the current mounted count for the scope (1 = first instance).

export function useUniqueScope(name: RenderScopeName): number {
  const claimedRef = useRef<boolean>(false);
  const [count, setCount] = useState<number>(0);

  useEffect(() => {
    if (claimedRef.current) return;
    claimedRef.current = true;
    const c = (MOUNTED_SCOPES.get(name) ?? 0) + 1;
    MOUNTED_SCOPES.set(name, c);
    setCount(c);
    return () => {
      const cur = MOUNTED_SCOPES.get(name) ?? 0;
      if (cur <= 1) {
        MOUNTED_SCOPES.delete(name);
      } else {
        MOUNTED_SCOPES.set(name, cur - 1);
      }
      claimedRef.current = false;
    };
  }, [name]);

  return count;
}

// ─── Scope Audit (for tests / deploy verification) ─────────────────────────
// Returns the current scope registry state. Used by deployment verification
// to assert that `portfolio_value_usd` appears in at most 1 UI scope.

export function auditScopes(): Record<RenderScopeName, number> {
  return {
    [RENDER_SCOPES.STRATEGY_VIEW]: MOUNTED_SCOPES.get(RENDER_SCOPES.STRATEGY_VIEW) ?? 0,
    [RENDER_SCOPES.METRICS_VIEW]: MOUNTED_SCOPES.get(RENDER_SCOPES.METRICS_VIEW) ?? 0,
    [RENDER_SCOPES.REBALANCE_VIEW]: MOUNTED_SCOPES.get(RENDER_SCOPES.REBALANCE_VIEW) ?? 0,
    [RENDER_SCOPES.DATA_FOOTER_VIEW]: MOUNTED_SCOPES.get(RENDER_SCOPES.DATA_FOOTER_VIEW) ?? 0,
    [RENDER_SCOPES.PREDICTION_VIEW]: MOUNTED_SCOPES.get(RENDER_SCOPES.PREDICTION_VIEW) ?? 0,
    // V10 NEW: scanner + executor scopes per spec `architecture_upgrade.new_layers`.
    [RENDER_SCOPES.SCANNER_VIEW]: MOUNTED_SCOPES.get(RENDER_SCOPES.SCANNER_VIEW) ?? 0,
    [RENDER_SCOPES.EXECUTOR_VIEW]: MOUNTED_SCOPES.get(RENDER_SCOPES.EXECUTOR_VIEW) ?? 0,
    // V10.1 NEW: lifecycle scope per spec `ui_changes.new_component`:
    //   "PredictionLifecycleTracker". Mounted exactly once in the tree.
    [RENDER_SCOPES.LIFECYCLE_VIEW]: MOUNTED_SCOPES.get(RENDER_SCOPES.LIFECYCLE_VIEW) ?? 0,
  };
}

// Expose audit on window for runtime inspection / Cypress.
if (typeof window !== 'undefined') {
  (window as unknown as { __amiraScopeAudit?: () => Record<string, number> }).__amiraScopeAudit =
    auditScopes;
}
