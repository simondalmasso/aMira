'use client';

import { motion } from 'framer-motion';
import { useHedgeFundStore, type PortfolioProfile } from '@/store/hedge-fund-store';
import { type ProfileMetrics } from '@/lib/portfolio-engine';
import { getRegimeFavoredProfile } from '@/lib/portfolio-engine';
import { Shield, Scale, TrendingUp, Check } from 'lucide-react';

// ============================================================================
// PROFILE VISUAL CONFIG
// ============================================================================
const PROFILE_CONFIG: Record<PortfolioProfile, {
  label: string;
  icon: React.ReactNode;
  accentColor: string;
  accentBg: string;
  accentBorder: string;
  accentText: string;
  badgeBg: string;
  badgeText: string;
  glowColor: string;
}> = {
  CONSERVADOR: {
    label: 'CONSERVADOR',
    icon: <Shield className="w-4 h-4" />,
    accentColor: '#16a34a',
    accentBg: 'bg-[#f0faf0]',
    accentBorder: 'border-[#16a34a]/20',
    accentText: 'text-[#16a34a]',
    badgeBg: 'bg-[#16a34a]',
    badgeText: 'text-[#ffffff]',
    glowColor: 'rgba(22,163,74,0.08)',
  },
  MODERADO: {
    label: 'MODERADO',
    icon: <Scale className="w-4 h-4" />,
    accentColor: '#ca8a04',
    accentBg: 'bg-[#fefce8]',
    accentBorder: 'border-[#ca8a04]/20',
    accentText: 'text-[#ca8a04]',
    badgeBg: 'bg-[#ca8a04]',
    badgeText: 'text-[#ffffff]',
    glowColor: 'rgba(202,138,4,0.08)',
  },
  ARRIESGADO: {
    label: 'ARRIESGADO',
    icon: <TrendingUp className="w-4 h-4" />,
    accentColor: '#dc2626',
    accentBg: 'bg-[#fef2f2]',
    accentBorder: 'border-[#dc2626]/20',
    accentText: 'text-[#dc2626]',
    badgeBg: 'bg-[#dc2626]',
    badgeText: 'text-[#ffffff]',
    glowColor: 'rgba(220,38,38,0.08)',
  },
};

export function ProfileCards() {
  const { multiProfile, selectedProfile, applyProfile, oracle } = useHedgeFundStore();

  if (!multiProfile) {
    return (
      <div className="grid grid-cols-3 gap-2 animate-pulse">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-48 bg-[#f5f5f5] rounded-xl" />
        ))}
      </div>
    );
  }

  // Determine which profile the macro regime favors
  const regimeFavored = oracle ? getRegimeFavoredProfile(oracle.regime) : null;

  return (
    <div className="grid grid-cols-3 gap-2">
      {(['CONSERVADOR', 'MODERADO', 'ARRIESGADO'] as PortfolioProfile[]).map((profile, i) => {
        const profileData = multiProfile.profiles[profile];
        const config = PROFILE_CONFIG[profile];
        const isSelected = selectedProfile === profile;
        const isFavored = regimeFavored === profile;

        return (
          <motion.div
            key={profile}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: i * 0.05 }}
            className={`relative rounded-xl p-3 border-2 transition-all cursor-pointer ${
              isSelected
                ? `${config.accentBorder} ${config.accentBg} shadow-sm`
                : 'border-[#eaeaea] bg-[#ffffff] hover:border-[#cccccc]'
            }`}
            onClick={() => applyProfile(profile)}
          >
            {/* Selection indicator */}
            {isSelected && (
              <div
                className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center"
                style={{ backgroundColor: config.accentColor }}
              >
                <Check className="w-3 h-3 text-white" />
              </div>
            )}

            {/* Regime favored indicator */}
            {isFavored && !isSelected && (
              <div className="absolute top-2 right-2">
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-[#000000] text-[#ffffff] uppercase tracking-[0.08em]">
                  Recomendado
                </span>
              </div>
            )}

            {/* Profile header */}
            <div className="flex items-center gap-2 mb-3">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: `${config.accentColor}15`, color: config.accentColor }}
              >
                {config.icon}
              </div>
              <span className="text-[11px] font-extrabold uppercase tracking-[0.15em]" style={{ color: config.accentColor }}>
                {config.label}
              </span>
            </div>

            {/* Return */}
            <div className="mb-2">
              <p className="text-[8px] font-semibold text-[#999999] uppercase tracking-[0.2em]">Retorno esp. 30d</p>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="text-[21px] font-extrabold text-[#000000] leading-none">
                  {profileData.expectedReturn30dPct >= 0 ? '+' : ''}{profileData.expectedReturn30dPct.toFixed(2)}%
                </span>
              </div>
              <p className="text-[10px] font-bold text-[#999999] mt-0.5">
                {profileData.expectedReturn30dUSD >= 0 ? '+' : ''}${profileData.expectedReturn30dUSD.toFixed(1)} USD
              </p>
            </div>

            {/* Metrics row */}
            <div className="grid grid-cols-3 gap-1 mb-2">
              <div className="text-center">
                <p className="text-[13px] font-extrabold text-[#000000] leading-none">{profileData.sharpeRatio.toFixed(2)}</p>
                <p className="text-[7px] font-semibold text-[#999999] uppercase tracking-[0.1em] mt-0.5">Sharpe</p>
              </div>
              <div className="text-center">
                <p className="text-[13px] font-extrabold text-[#000000] leading-none">{profileData.var95.toFixed(1)}%</p>
                <p className="text-[7px] font-semibold text-[#999999] uppercase tracking-[0.1em] mt-0.5">VaR 95</p>
              </div>
              <div className="text-center">
                <p className="text-[13px] font-extrabold text-[#000000] leading-none">{profileData.volatility30d.toFixed(1)}%</p>
                <p className="text-[7px] font-semibold text-[#999999] uppercase tracking-[0.1em] mt-0.5">Vol</p>
              </div>
            </div>

            {/* Top holdings */}
            <div className="space-y-0.5 mb-2">
              {profileData.allocations
                .filter(a => a.weight > 0)
                .sort((a, b) => b.weight - a.weight)
                .slice(0, 3)
                .map(alloc => (
                  <div key={alloc.productId} className="flex items-center justify-between">
                    <span className="text-[9px] font-semibold text-[#666666] truncate">{alloc.productName}</span>
                    <span className="text-[9px] font-bold text-[#000000]">{(alloc.weight * 100).toFixed(0)}%</span>
                  </div>
                ))}
            </div>

            {/* Apply button */}
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={(e) => {
                e.stopPropagation();
                applyProfile(profile);
              }}
              className={`w-full py-1.5 rounded-lg text-[10px] font-extrabold uppercase tracking-[0.12em] transition-all ${
                isSelected
                  ? `${config.badgeBg} ${config.badgeText}`
                  : 'bg-[#f5f5f5] text-[#999999] hover:bg-[#eaeaea]'
              }`}
            >
              {isSelected ? 'ACTIVO' : 'APLICAR'}
            </motion.button>
          </motion.div>
        );
      })}
    </div>
  );
}
