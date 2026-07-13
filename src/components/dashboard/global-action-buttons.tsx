// src/components/dashboard/global-action-buttons.tsx
// V7 GLOBAL_HEADER_ACTION_BUTTONS_RELOCATION
//
// Compact pill-style global action buttons for the dashboard header.
// Replaces the bottom-of-page ActionButtons block per V7 spec:
//   "REBALANCEAR / SINCRONIZAR / COPIAR / EXPORTAR arriba del todo"
//   "header-sticky-right (misma línea que status bar)"
//   "small pill buttons · inline right of status"
//   "NO deben estar dentro de panels, deben ser global actions"
//
// Design:
//   - 4 pill buttons inline (REBALANCEAR · SINCRONIZAR · COPIAR · EXPORTAR)
//   - Small size: 24px height, font 9px, icon 11px
//   - Responsive: on mobile (<480px) the buttons collapse to icons-only
//     to save horizontal space. The labels appear on >=480px.
//   - Status indicators: spinner when syncing/rebalancing, ✓ when copied/exported
//   - Black border, white bg, black text — matches the minimalist Swiss style
//   - REBALANCEAR is the primary CTA: filled black bg + white text
//
// Wiring: reads same handlers as the old ActionButtons component
// (onRebalance, onSync, syncStatus, isRebalancing) from the parent.
// Copy/Export logic is self-contained (same as old ActionButtons).

'use client';

import { useHedgeFundStore } from '@/store/hedge-fund-store';
import {
  RefreshCw,
  Copy,
  Download,
  Zap,
  RotateCw,
  Check,
  MoreVertical,
} from 'lucide-react';
import { useState } from 'react';

interface GlobalActionButtonsProps {
  onRebalance: () => void;
  isRebalancing: boolean;
  onSync: () => void;
  syncStatus: 'idle' | 'syncing' | 'success' | 'error';
}

export function GlobalActionButtons({
  onRebalance,
  isRebalancing,
  onSync,
  syncStatus,
}: GlobalActionButtonsProps) {
  const [copied, setCopied] = useState(false);
  const [exported, setExported] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const { allocations, metrics, lastSync } = useHedgeFundStore();

  const handleCopy = () => {
    const text = allocations
      .map(a => `${a.productName}: ${(a.weight * 100).toFixed(1)}% ($${a.amountUSD} USD)`)
      .join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleExport = () => {
    const json = JSON.stringify({
      timestamp: new Date().toISOString(),
      capital: 2000,
      currency: 'USD',
      allocations: allocations.map(a => ({
        product: a.productId,
        name: a.productName,
        weight: `${(a.weight * 100).toFixed(1)}%`,
        amountUSD: a.amountUSD,
        amountARS: a.amountARS,
      })),
      metrics,
      lastSync,
    }, null, 2);

    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hedge-fund-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExported(true);
    setTimeout(() => setExported(false), 2000);
  };

  // ─── Shared button classes ───
  const baseBtn =
    'inline-flex items-center gap-1 h-6 px-2 rounded-full border ' +
    'text-[10px] font-extrabold uppercase tracking-[0.08em] transition-all ' +
    'disabled:opacity-50 disabled:cursor-not-allowed ' +
    'whitespace-nowrap select-none';

  const primaryBtn =
    baseBtn +
    ' bg-[#000000] text-[#ffffff] border-[#000000] hover:bg-[#333333] active:bg-[#000000]';

  const secondaryBtn =
    baseBtn +
    ' bg-[#ffffff] text-[#000000] border-[#eaeaea] hover:bg-[#fafafa] active:bg-[#f0f0f0]';

  // V8: emit a global event for the event-bus layer (observability + cross-component sync)
  const emit = (eventName: string, detail: Record<string, unknown>) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(`amira:${eventName}`, { detail }));
    }
  };

  return (
    <div
      data-testid="global-action-buttons"
      className="flex items-center gap-1.5 flex-shrink-0"
      role="toolbar"
      aria-label="Acciones globales del dashboard"
    >
      {/* ─── REBALANCEAR (primary CTA, always visible) ─── */}
      <button
        type="button"
        onClick={() => {
          onRebalance();
          emit('portfolio-rebalance-requested', { timestamp: Date.now() });
        }}
        disabled={isRebalancing}
        data-testid="global-action-rebalance"
        className={primaryBtn}
        title="Rebalancear portfolio a la asignación óptima"
        aria-label="Rebalancear"
      >
        {isRebalancing ? (
          <RefreshCw className="w-2.5 h-2.5 animate-spin" />
        ) : (
          <Zap className="w-2.5 h-2.5" />
        )}
        {/* Label visible on >=480px, hidden on <480px (icons-only compact mode) */}
        <span className="hidden xs:inline">
          {isRebalancing ? 'Optim...' : 'Rebalancear'}
        </span>
      </button>

      {/* ─── SINCRONIZAR (visible >=480px, collapses into overflow on smaller) ─── */}
      <button
        type="button"
        onClick={() => {
          onSync();
          emit('source-sync-requested', { timestamp: Date.now() });
        }}
        data-testid="global-action-sync"
        className={`${secondaryBtn} hidden xs:inline-flex`}
        title="Sincronizar datos macro desde APIs (BCRA, DolarAPI, datos.gob.ar)"
        aria-label="Sincronizar"
      >
        {syncStatus === 'syncing' ? (
          <RotateCw className="w-2.5 h-2.5 animate-spin" />
        ) : syncStatus === 'success' ? (
          <Check className="w-2.5 h-2.5 text-[#16a34a]" />
        ) : (
          <RotateCw className="w-2.5 h-2.5" />
        )}
        <span className="hidden xs:inline">
          {syncStatus === 'syncing' ? 'Sinc...' : syncStatus === 'success' ? 'Listo' : 'Sincronizar'}
        </span>
      </button>

      {/* ─── COPIAR ─── */}
      <button
        type="button"
        onClick={() => {
          handleCopy();
          emit('export-requested', { format: 'clipboard', timestamp: Date.now() });
        }}
        data-testid="global-action-copy"
        className={`${secondaryBtn} hidden xs:inline-flex`}
        title="Copiar asignaciones al portapapeles"
        aria-label="Copiar"
      >
        {copied ? (
          <Check className="w-2.5 h-2.5 text-[#16a34a]" />
        ) : (
          <Copy className="w-2.5 h-2.5" />
        )}
        <span className="hidden xs:inline">
          {copied ? 'Copiado' : 'Copiar'}
        </span>
      </button>

      {/* ─── EXPORTAR ─── */}
      <button
        type="button"
        onClick={() => {
          handleExport();
          emit('export-requested', { format: 'json', timestamp: Date.now() });
        }}
        data-testid="global-action-export"
        className={`${secondaryBtn} hidden xs:inline-flex`}
        title="Exportar portfolio completo como JSON"
        aria-label="Exportar"
      >
        {exported ? (
          <Check className="w-2.5 h-2.5 text-[#16a34a]" />
        ) : (
          <Download className="w-2.5 h-2.5" />
        )}
        <span className="hidden xs:inline">
          {exported ? 'Guardado' : 'Exportar'}
        </span>
      </button>

      {/* ─── V8 OVERFLOW MENU (⋯) for <480px ─────────────────────────────
          Shows the 3 secondary actions (Sync/Copy/Export) collapsed into a
          dropdown menu so the action bar fits on tiny mobile screens.
          REBALANCEAR stays always-visible as the primary CTA. */}
      <div className="relative xs:hidden" data-testid="global-action-overflow">
        <button
          type="button"
          onClick={() => setOverflowOpen((v) => !v)}
          className={secondaryBtn}
          title="Más acciones"
          aria-label="Más acciones"
          aria-expanded={overflowOpen}
          aria-haspopup="menu"
        >
          <MoreVertical className="w-2.5 h-2.5" />
        </button>
        {overflowOpen && (
          <div
            role="menu"
            aria-label="Acciones secundarias"
            className="absolute right-0 top-7 z-50 bg-[#ffffff] border border-[#eaeaea] rounded-md shadow-lg py-1 min-w-[140px]"
            onMouseLeave={() => setOverflowOpen(false)}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onSync();
                emit('source-sync-requested', { timestamp: Date.now() });
                setOverflowOpen(false);
              }}
              className="w-full text-left px-3 py-1.5 text-[11px] font-bold text-[#000000] hover:bg-[#f3f4f6] flex items-center gap-2"
            >
              {syncStatus === 'syncing' ? (
                <RotateCw className="w-3 h-3 animate-spin" />
              ) : syncStatus === 'success' ? (
                <Check className="w-3 h-3 text-[#16a34a]" />
              ) : (
                <RotateCw className="w-3 h-3" />
              )}
              {syncStatus === 'syncing' ? 'Sincronizando...' : syncStatus === 'success' ? 'Sincronizado' : 'Sincronizar'}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                handleCopy();
                emit('export-requested', { format: 'clipboard', timestamp: Date.now() });
                setOverflowOpen(false);
              }}
              className="w-full text-left px-3 py-1.5 text-[11px] font-bold text-[#000000] hover:bg-[#f3f4f6] flex items-center gap-2"
            >
              {copied ? <Check className="w-3 h-3 text-[#16a34a]" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copiado' : 'Copiar'}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                handleExport();
                emit('export-requested', { format: 'json', timestamp: Date.now() });
                setOverflowOpen(false);
              }}
              className="w-full text-left px-3 py-1.5 text-[11px] font-bold text-[#000000] hover:bg-[#f3f4f6] flex items-center gap-2"
            >
              {exported ? <Check className="w-3 h-3 text-[#16a34a]" /> : <Download className="w-3 h-3" />}
              {exported ? 'Guardado' : 'Exportar'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
