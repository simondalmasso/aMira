// ============================================================================
// FciOraclePanel — ORACLE_FCI_AR_V3
// Ranking + búsqueda fuzzy + snapshots históricos + predicciones probabilísticas
// de Fondos Comunes de Inversión argentinos.
//
// Datos:
//   - api.argentinadatos.com/v1/finanzas/fci/{categoria}/ultimo (4 categorías)
//   - Snapshot histórico en KV (para momentum + predicción)
//   - 4 modelos ensemble: linear_regression, ewma, momentum, bayesian_trend
//
// Reglas:
//   - Predicciones sólo si confidence ≥ 0.65 (guard anti-alucinación)
//   - Momentum 7d/30d requiere history_days >= 9 / 31
//   - Cada fondo muestra badges [REAL] para VCP, [MODELO] para predicción
//   - Sin datos históricos: predicciones ocultas, oracle_score basado en
//     patrimonio + liquidity
// ============================================================================

'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp,
  TrendingDown,
  Search,
  Trophy,
  Wallet,
  Sparkles,
  ShieldCheck,
  Database,
  AlertTriangle,
  RefreshCw,
  ChevronRight,
} from 'lucide-react';
import type { OracleFciResponse, FundMetrics, FundCategory } from '@/lib/oracle-fci';
import { CATEGORY_LABELS } from '@/lib/oracle-fci';

// ─── Badges ──────────────────────────────────────────────────────────────
function MiniBadge({ label, color = 'green' }: { label: string; color?: 'green' | 'purple' | 'amber' | 'red' | 'blue' | 'gray' }) {
  const cfg = {
    green: 'bg-[#16a34a] text-[#ffffff]',
    purple: 'bg-[#7c3aed] text-[#ffffff]',
    amber: 'bg-[#ca8a04] text-[#ffffff]',
    red: 'bg-[#dc2626] text-[#ffffff]',
    blue: 'bg-[#0066cc] text-[#ffffff]',
    gray: 'bg-[#999999] text-[#ffffff]',
  } as const;
  return (
    <span className={`text-[8px] font-bold px-1 py-0.5 rounded tracking-[0.05em] ${cfg[color]}`}>
      {label}
    </span>
  );
}

// ─── Number formatters ──────────────────────────────────────────────────
function formatARS(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return 'N/D';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function formatVCP(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return 'N/D';
  return n.toLocaleString('es-AR', { maximumFractionDigits: 4, minimumFractionDigits: 2 });
}

function formatPct(n: number | null | undefined, withSign = true): string {
  if (n === null || n === undefined || !isFinite(n)) return 'N/D';
  const sign = withSign && n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function formatProb(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return 'N/D';
  return `${(n * 100).toFixed(0)}%`;
}

// ─── Score bar ──────────────────────────────────────────────────────────
function ScoreBar({ score, max = 100 }: { score: number; max?: number }) {
  const pct = Math.max(0, Math.min(100, (score / max) * 100));
  const color = pct >= 75 ? '#16a34a' : pct >= 50 ? '#ca8a04' : pct >= 25 ? '#ea580c' : '#dc2626';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-[#eaeaea] rounded-full overflow-hidden min-w-[60px]">
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>
      <span className="text-[11px] font-bold tabular-nums" style={{ color }}>
        {score.toFixed(1)}
      </span>
    </div>
  );
}

// ─── Views ──────────────────────────────────────────────────────────────
type ViewKey =
  | 'top_gainers'
  | 'top_patrimonio'
  | 'top_predicted'
  | 'most_stable'
  | 'market_money'
  | 'renta_fija'
  | 'renta_variable'
  | 'renta_mixta';

const VIEWS: Array<{ key: ViewKey; label: string; icon: typeof Trophy; description: string }> = [
  { key: 'top_gainers',     label: 'Top Score Oracle',  icon: Trophy,      description: 'Mejor score compuesto' },
  { key: 'top_patrimonio',  label: 'Top Patrimonio',    icon: Wallet,      description: 'Mayores AUM' },
  { key: 'top_predicted',   label: 'Top Predichos 30d', icon: Sparkles,    description: 'Mejor retorno esperado' },
  { key: 'most_stable',     label: 'Más Estables',      icon: ShieldCheck, description: 'Menor volatilidad' },
  { key: 'market_money',    label: 'Money Market',      icon: Database,    description: 'Mercado de dinero T+0/T+1' },
  { key: 'renta_fija',      label: 'Renta Fija',        icon: Database,    description: 'Bonos / Lecaps / CER' },
  { key: 'renta_variable',  label: 'Renta Variable',    icon: Database,    description: 'Acciones / CEDEARs' },
  { key: 'renta_mixta',     label: 'Renta Mixta',       icon: Database,    description: 'Estrategias combinadas' },
];

function getFundsForView(data: OracleFciResponse | null, view: ViewKey): FundMetrics[] {
  if (!data) return [];
  switch (view) {
    case 'top_gainers':    return data.rankings.top10_by_oracle_score;
    case 'top_patrimonio': return data.rankings.top10_by_patrimonio;
    case 'top_predicted':  return data.rankings.top10_predicted_30d;
    case 'most_stable':    return data.rankings.top10_most_stable;
    case 'market_money':   return data.by_category.mercadoDinero ?? [];
    case 'renta_fija':     return data.by_category.rentaFija ?? [];
    case 'renta_variable': return data.by_category.rentaVariable ?? [];
    case 'renta_mixta':    return data.by_category.rentaMixta ?? [];
  }
}

// ─── Fund row ───────────────────────────────────────────────────────────
function FundRow({ fund, rank }: { fund: FundMetrics; rank: number }) {
  const [expanded, setExpanded] = useState(false);
  const hasPrediction = !!fund.prediction;
  const isBull = fund.prediction ? fund.prediction.expected_return_30d !== null && fund.prediction.expected_return_30d > 0 : false;
  const isBear = fund.prediction ? fund.prediction.expected_return_30d !== null && fund.prediction.expected_return_30d < 0 : false;

  return (
    <div className="border-b border-[#eaeaea] last:border-b-0">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-3 py-2 hover:bg-[#fafafa] transition-colors flex items-center gap-2"
      >
        <span className="text-[11px] font-bold text-[#999999] tabular-nums w-6 text-center">
          #{rank}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[12px] font-semibold text-[#000000] truncate max-w-[260px]" title={fund.name}>
              {fund.name}
            </span>
            <MiniBadge label={fund.currency} color={fund.currency === 'USD' ? 'green' : 'blue'} />
            {hasPrediction && <MiniBadge label="PRED" color="purple" />}
          </div>
          <div className="text-[10px] text-[#999999] truncate mt-0.5">
            {fund.manager} · {fund.horizonte || 'N/D'}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-mono font-semibold tabular-nums">
            {formatVCP(fund.vcp)}
          </div>
          <div className="text-[10px] text-[#999999] tabular-nums">
            {formatARS(fund.patrimonio)}
          </div>
        </div>
        <div className="w-20">
          <ScoreBar score={fund.oracle_score} />
        </div>
        <ChevronRight
          className={`w-3 h-3 text-[#999999] transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 py-3 bg-[#fafafa] grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
              <Metric label="Score Oracle" value={fund.oracle_score.toFixed(1)} />
              <Metric label="TIR Estimada" value={formatPct(fund.tir_estimada)} color={fund.tir_estimada !== null && fund.tir_estimada < 0 ? 'red' : 'green'} />
              <Metric label="Momentum 7d" value={formatPct(fund.momentum_7d)} color={fund.momentum_7d !== null && fund.momentum_7d < 0 ? 'red' : 'green'} />
              <Metric label="Momentum 30d" value={formatPct(fund.momentum_30d)} color={fund.momentum_30d !== null && fund.momentum_30d < 0 ? 'red' : 'green'} />
              <Metric label="Estabilidad" value={fund.stability !== null ? formatProb(fund.stability) : 'N/D'} />
              <Metric label="Liquidez" value={fund.liquidity !== null ? formatProb(fund.liquidity) : 'N/D'} />
              <Metric label="Cuotapartes" value={fund.ccp.toLocaleString('es-AR')} />
              <Metric label="Fecha" value={fund.date} />
              {hasPrediction && fund.prediction && (
                <>
                  <div className="col-span-2 sm:col-span-4 mt-2 pt-2 border-t border-[#eaeaea]">
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles className="w-3 h-3 text-[#7c3aed]" />
                      <span className="font-bold text-[#7c3aed]">Predicción ensemble (4 modelos)</span>
                      <MiniBadge label={`conf ${(fund.prediction.confidence * 100).toFixed(0)}%`} color={fund.prediction.confidence >= 0.85 ? 'green' : 'amber'} />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <Metric label="Retorno 7d" value={formatPct(fund.prediction.expected_return_7d)} color={isBull ? 'green' : isBear ? 'red' : undefined} />
                      <Metric label="Retorno 30d" value={formatPct(fund.prediction.expected_return_30d)} color={isBull ? 'green' : isBear ? 'red' : undefined} />
                      <Metric label="Retorno 90d" value={formatPct(fund.prediction.expected_return_90d)} color={isBull ? 'green' : isBear ? 'red' : undefined} />
                      <Metric label="Volatilidad" value={formatProb(fund.prediction.volatility_score)} />
                      <Metric
                        label="Prob. Alcista"
                        value={formatProb(fund.prediction.bull_probability)}
                        color={fund.prediction.bull_probability > 0.6 ? 'green' : undefined}
                      />
                      <Metric
                        label="Prob. Bajista"
                        value={formatProb(fund.prediction.bear_probability)}
                        color={fund.prediction.bear_probability > 0.5 ? 'red' : undefined}
                      />
                      <Metric label="Modelos" value={fund.prediction.models_used.join(', ')} />
                      <Metric label="Confianza" value={formatProb(fund.prediction.confidence)} color={fund.prediction.confidence >= 0.85 ? 'green' : undefined} />
                    </div>
                  </div>
                </>
              )}
              {!hasPrediction && (
                <div className="col-span-2 sm:col-span-4 mt-2 pt-2 border-t border-[#eaeaea] text-[11px] text-[#999999] flex items-center gap-2">
                  <AlertTriangle className="w-3 h-3" />
                  Predicción no disponible — se requiere historial &gt;= 9 días y confianza &gt;= 65%
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: 'green' | 'red' }) {
  const colorClass = color === 'green' ? 'text-[#16a34a]' : color === 'red' ? 'text-[#dc2626]' : 'text-[#000000]';
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-[#999999]">{label}</div>
      <div className={`font-mono font-semibold tabular-nums ${colorClass}`}>{value}</div>
    </div>
  );
}

// ─── Main panel ─────────────────────────────────────────────────────────
export function FciOraclePanel() {
  const [data, setData] = useState<OracleFciResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewKey>('top_gainers');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FundMetrics[] | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = searchQuery.trim()
        ? `/api/oracle/fci?q=${encodeURIComponent(searchQuery.trim())}&topN=50`
        : `/api/oracle/fci?topN=25`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as OracleFciResponse;
      setData(json);
      setSearchResults(searchQuery.trim() ? null : null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchQuery.trim().length >= 2) {
        fetchData();
      } else if (searchQuery.trim().length === 0 && searchResults !== null) {
        setSearchResults(null);
        fetchData();
      }
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  const visibleFunds = useMemo(() => {
    if (searchQuery.trim().length >= 2 && data) {
      // When searching, flatten all by_category entries
      const all: FundMetrics[] = [];
      for (const cat of Object.keys(data.by_category) as FundCategory[]) {
        all.push(...(data.by_category[cat] ?? []));
      }
      // Dedup by name
      const seen = new Set<string>();
      const unique: FundMetrics[] = [];
      for (const f of all) {
        if (!seen.has(f.name)) {
          seen.add(f.name);
          unique.push(f);
        }
      }
      return unique.sort((a, b) => b.oracle_score - a.oracle_score);
    }
    return getFundsForView(data, view);
  }, [data, view, searchQuery]);

  const statusColor = data?.source_status === 'SUCCESS' ? '#16a34a' :
                       data?.source_status === 'PARTIAL_SUCCESS' ? '#ca8a04' :
                       data?.source_status === 'DEGRADED' ? '#ea580c' : '#dc2626';

  return (
    <div className="bg-white rounded-lg border border-[#eaeaea] p-4">
      {/* Header */}
      <div className="flex items-start justify-between mb-3 gap-2 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-[#000000] flex items-center gap-1.5">
            <Trophy className="w-3.5 h-3.5 text-[#0066cc]" />
            FCI Oracle V3
          </h3>
          <p className="text-[11px] text-[#999999] mt-0.5">
            Ranking + predicciones probabilísticas · api.argentinadatos.com
          </p>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <div className="flex items-center gap-1">
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: statusColor }}
            />
            <span className="font-semibold" style={{ color: statusColor }}>
              {data?.source_status ?? '...'}
            </span>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="text-[#0066cc] hover:text-[#004499] disabled:opacity-50 flex items-center gap-1"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            <span className="font-semibold">Actualizar</span>
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3 text-[11px]">
          <StatBox label="Total fondos" value={data.total_funds.toLocaleString('es-AR')} />
          <StatBox label="Snapshot" value={data.snapshot_date} />
          <StatBox label="Historial" value={`${data.metadata.history_days_available} días`} color={data.metadata.history_days_available >= 9 ? '#16a34a' : '#ca8a04'} />
          <StatBox
            label="Predicciones"
            value={data.metadata.prediction_engine_active ? 'Activas' : 'Esperando historial'}
            color={data.metadata.prediction_engine_active ? '#16a34a' : '#999999'}
          />
        </div>
      )}

      {/* Search */}
      <div className="relative mb-3">
        <Search className="w-3.5 h-3.5 text-[#999999] absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Buscar fondo por nombre, categoría o administradora (ej: 'santander', 'fima', 'renta fija')..."
          className="w-full pl-8 pr-3 py-1.5 text-[12px] border border-[#eaeaea] rounded-md focus:outline-none focus:border-[#0066cc] focus:ring-1 focus:ring-[#0066cc] bg-white"
        />
      </div>

      {/* View tabs */}
      {searchQuery.trim().length < 2 && (
        <div className="flex gap-1 mb-3 overflow-x-auto pb-1">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const isActive = view === v.key;
            return (
              <button
                key={v.key}
                onClick={() => setView(v.key)}
                title={v.description}
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold whitespace-nowrap transition-colors ${
                  isActive
                    ? 'bg-[#0066cc] text-white'
                    : 'bg-[#f5f5f5] text-[#666666] hover:bg-[#eaeaea]'
                }`}
              >
                <Icon className="w-3 h-3" />
                {v.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Errors */}
      {error && (
        <div className="text-[11px] text-[#dc2626] bg-[#fef2f2] border border-[#fecaca] rounded-md p-2 mb-3 flex items-start gap-2">
          <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
          <div>
            <div className="font-bold">Error</div>
            <div className="font-mono">{error}</div>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !data && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-12 bg-[#f5f5f5] rounded-md animate-pulse" />
          ))}
        </div>
      )}

      {/* Fund list */}
      {data && !loading && (
        <>
          <div className="text-[11px] text-[#999999] mb-2 flex items-center justify-between">
            <span>
              {searchQuery.trim().length >= 2
                ? `${visibleFunds.length} resultados para "${searchQuery.trim()}"`
                : `${visibleFunds.length} fondos · ${VIEWS.find((v) => v.key === view)?.description ?? ''}`}
            </span>
            <span className="flex items-center gap-1">
              <MiniBadge label="REAL" color="green" /> VCP
              <MiniBadge label="MODELO" color="purple" /> Score/Pred
            </span>
          </div>
          <div className="border border-[#eaeaea] rounded-md max-h-[500px] overflow-y-auto">
            {visibleFunds.length === 0 ? (
              <div className="text-center text-[11px] text-[#999999] py-8">
                No se encontraron fondos para este criterio.
              </div>
            ) : (
              visibleFunds.slice(0, 50).map((fund, i) => (
                <FundRow key={`${fund.name}-${i}`} fund={fund} rank={i + 1} />
              ))
            )}
          </div>

          {/* Footer */}
          <div className="mt-3 pt-2 border-t border-[#eaeaea] text-[10px] text-[#999999] flex items-start gap-2 flex-wrap">
            <Database className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <strong>Fuente:</strong> {data.source}
              <br />
              <strong>Guard:</strong> never_invent_data={String(data.metadata.guards.never_invent_data)} · confidence_threshold={data.metadata.guards.confidence_threshold} · source_required={String(data.metadata.guards.source_required)}
              {data.errors.length > 0 && (
                <>
                  <br />
                  <strong className="text-[#dc2626]">Errores ({data.errors.length}):</strong>{' '}
                  <span className="font-mono">{data.errors.slice(0, 2).join(' · ')}</span>
                  {data.errors.length > 2 && <em> +{data.errors.length - 2} más</em>}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-[#fafafa] border border-[#eaeaea] rounded-md px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-[#999999]">{label}</div>
      <div className="font-bold text-[12px] tabular-nums" style={{ color: color ?? '#000000' }}>
        {value}
      </div>
    </div>
  );
}
