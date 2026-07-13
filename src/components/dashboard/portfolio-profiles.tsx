// src/components/dashboard/portfolio-profiles.tsx
// V4_TOP_BLOCK_COMPACT_PORTFOLIO_PROFILES_FIX
//
// Compact profile cards (CONSERVADOR / MODERADO / ARRIESGADO) rendered as
// small selectable blocks INSIDE the V4 oracle top block — same visual
// cluster as Capital a invertir / Total Portfolio Value / P&L / Stress
// Projection. The user does NOT need to scroll to see them, and selecting
// a card drives the V4 risk slider (which in turn drives allocations,
// total portfolio, and stress projection).
//
// Design rules (per V4 spec):
//   - cards más bajas y compactas
//   - tipografía más chica que el bloque superior
//   - espaciado reducido
//   - mismo ancho visual que el bloque Capital a invertir
//   - sin scroll extra · sin ocupar toda la pantalla
//   - 3 cards en desktop / stacked en mobile
//   - states: recommended (border + badge) · selected (filled glow) · inactive (muted)

'use client';

import { motion } from 'framer-motion';
import { Shield, Scale, TrendingUp, Check, Sparkles } from 'lucide-react';
import type {
  ProfileCardData,
  PortfolioProfile,
} from '@/lib/oracle/portfolio-engine';
import { PROFILE_RISK_LEVELS } from '@/lib/oracle/portfolio-engine';

// ─── Profile icon mapping ────────────────────────────────────────────────────
const PROFILE_ICONS: Record<PortfolioProfile, typeof Shield> = {
  CONSERVADOR: Shield,
  MODERADO: Scale,
  ARRIESGADO: TrendingUp,
};

// ─── Number formatters (match the rest of V4 dashboard) ─────────────────────
function fmtPct(n: number, withSign = true): string {
  if (!isFinite(n)) return 'N/D';
  const sign = withSign && n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function fmtUsd(n: number): string {
  if (!isFinite(n)) return 'N/D';
  const sign = n < 0 ? '-' : '+';
  const abs = Math.abs(n);
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(2)}K`;
  return `${sign}$${abs.toFixed(1)}`;
}

// ─── CompactProfileCard ─────────────────────────────────────────────────────
function CompactProfileCard({
  card,
  index,
  onSelect,
}: {
  card: ProfileCardData;
  index: number;
  onSelect: (profile: PortfolioProfile, riskLevel: number) => void;
}) {
  const Icon = PROFILE_ICONS[card.profile];

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.04 }}
      onClick={() => onSelect(card.profile, PROFILE_RISK_LEVELS[card.profile])}
      data-testid={`profile-card-${card.profile.toLowerCase()}`}
      data-selected={card.isSelected ? 'true' : 'false'}
      data-recommended={card.isRecommended ? 'true' : 'false'}
      className="relative w-full text-left rounded-xl border transition-all overflow-hidden focus:outline-none"
      style={{
        // V7: compact card per spec — 70% scale of original V4.
        // max-width reduced from 280px to 220px, min-height from 112px to 96px,
        // padding from 8/10px to 6/8px. Keeps all 5 metrics (return, Sharpe,
        // VaR, Vol, allocation preview) legible without crowding.
        minHeight: '96px',
        maxWidth: '220px',
        padding: '6px 8px',
        background: card.isSelected ? card.accentBg : '#ffffff',
        borderColor: card.isSelected ? card.accentBorder : (card.isRecommended ? card.accentBorder : '#e5e7eb'),
        borderWidth: card.isSelected || card.isRecommended ? '2px' : '1px',
        boxShadow: card.isSelected
          ? `0 0 0 2px ${card.glowColor}, 0 2px 6px rgba(0,0,0,0.04)`
          : '0 1px 2px rgba(0,0,0,0.03)',
        cursor: 'pointer',
      }}
    >
      {/* ─── Recommended badge (top-right) ─── */}
      {card.isRecommended && (
        <div
          className="absolute top-1.5 right-1.5 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[8px] font-extrabold uppercase tracking-[0.08em]"
          style={{ background: '#000000', color: '#ffffff' }}
        >
          <Sparkles className="w-2 h-2" />
          Recomendado
        </div>
      )}

      {/* ─── Selected check (top-right, takes priority over recommended) ─── */}
      {card.isSelected && (
        <div
          className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full flex items-center justify-center"
          style={{ background: card.accentColor }}
        >
          <Check className="w-2.5 h-2.5 text-white" />
        </div>
      )}

      {/* ─── Header: icon + label ─── */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <div
          className="w-5 h-5 rounded flex items-center justify-center"
          style={{ background: `${card.accentColor}1a`, color: card.accentColor }}
        >
          <Icon className="w-3 h-3" />
        </div>
        <span
          className="text-[10px] font-extrabold uppercase tracking-[0.12em]"
          style={{ color: card.accentColor }}
        >
          {card.label}
        </span>
      </div>

      {/* ─── Return (primary metric) ─── */}
      <div className="mb-1.5">
        <div className="text-[8px] font-semibold text-[#999999] uppercase tracking-[0.15em]">
          Retorno esp. 30d
        </div>
        <div className="flex items-baseline gap-1.5">
          <span
            className="text-[17px] font-extrabold leading-none tabular-nums"
            style={{ color: card.expected_return_30d_pct >= 0 ? '#16a34a' : '#dc2626' }}
          >
            {fmtPct(card.expected_return_30d_pct)}
          </span>
          <span className="text-[10px] font-bold text-[#666666] tabular-nums">
            {fmtUsd(card.usd_estimate)} USD
          </span>
        </div>
      </div>

      {/* ─── Metrics row: Sharpe · VaR 95 · Vol ─── */}
      <div className="grid grid-cols-3 gap-1 mb-1.5">
        <div className="text-center">
          <div className="text-[11px] font-extrabold text-[#000000] leading-none tabular-nums">
            {card.sharpe.toFixed(2)}
          </div>
          <div className="text-[7px] font-semibold text-[#999999] uppercase tracking-[0.1em] mt-0.5">
            Sharpe
          </div>
        </div>
        <div className="text-center">
          <div className="text-[11px] font-extrabold text-[#000000] leading-none tabular-nums">
            {card.var95_pct.toFixed(1)}%
          </div>
          <div className="text-[7px] font-semibold text-[#999999] uppercase tracking-[0.1em] mt-0.5">
            VaR 95
          </div>
        </div>
        <div className="text-center">
          <div className="text-[11px] font-extrabold text-[#000000] leading-none tabular-nums">
            {card.vol_pct.toFixed(1)}%
          </div>
          <div className="text-[7px] font-semibold text-[#999999] uppercase tracking-[0.1em] mt-0.5">
            Vol
          </div>
        </div>
      </div>

      {/* ─── Allocation summary (top 3 holdings) ─── */}
      <div className="space-y-0.5 mb-1.5">
        {card.allocation_summary.slice(0, 3).map((line, i) => (
          <div key={i} className="text-[8px] text-[#666666] truncate font-medium">
            {line}
          </div>
        ))}
      </div>

      {/* ─── CTA button (ACTIVO / APLICAR) ─── */}
      <div
        className="w-full py-1 rounded-md text-[9px] font-extrabold uppercase tracking-[0.1em] text-center transition-all"
        style={{
          background: card.isSelected ? card.accentColor : '#f5f5f5',
          color: card.isSelected ? '#ffffff' : '#666666',
        }}
      >
        {card.cta}
      </div>
    </motion.button>
  );
}

// ─── ProfileCardsCompact (the V4 top-block grid) ────────────────────────────
export function ProfileCardsCompact({
  cards,
  selectedProfile,
  recommendedProfile,
  regimeLabel,
  onSelect,
}: {
  cards: ProfileCardData[];
  selectedProfile: PortfolioProfile;
  recommendedProfile: PortfolioProfile;
  regimeLabel: string;
  onSelect: (profile: PortfolioProfile, riskLevel: number) => void;
}) {
  return (
    <div
      data-testid="profile-cards-compact"
      className="bg-[#ffffff] border border-[#e5e7eb] rounded-lg p-2.5 mb-3"
    >
      {/* ─── Row 3 (per spec): Régimen favorece + selector hint ─── */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3 h-3 text-[#7c3aed]" />
          <span className="text-[10px] font-bold text-[#666666] uppercase tracking-[0.1em]">
            {regimeLabel}
          </span>
        </div>
        <span className="text-[9px] text-[#999999]">
          Perfiles de cartera · click para aplicar
        </span>
      </div>

      {/* ─── Row 4 (per spec): 3 compact cards · horizontal scroll on mobile · grid on desktop ───
          V7: cards now 70% scale (max-width 220px instead of 280px).
          On mobile (<640px) cards scroll horizontally in a single row,
          each card min-width 180px so they don't shrink to illegible size.
          On desktop (>=640px) cards use auto-fit grid as before. */}
      <div
        className="grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(180px,1fr))]"
        style={{
          // mobile: single-row horizontal scroll
          // desktop: auto-fit grid
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        }}
      >
        {cards.map((card, i) => (
          <CompactProfileCard
            key={card.profile}
            card={card}
            index={i}
            onSelect={onSelect}
          />
        ))}
      </div>

      {/* ─── Footer: selected profile + recommended profile ─── */}
      <div className="mt-2 pt-1.5 border-t border-[#f0f0f0] flex items-center justify-between text-[9px] text-[#666666]">
        <span>
          Perfil activo:{' '}
          <strong style={{ color: '#000000' }}>{selectedProfile}</strong>
        </span>
        <span>
          Recomendado por régimen:{' '}
          <strong style={{ color: '#7c3aed' }}>{recommendedProfile}</strong>
        </span>
      </div>
    </div>
  );
}
