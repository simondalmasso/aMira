'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useHedgeFundStore, type RiskAppetite, type ReturnTargetMode, type PortfolioProfile } from '@/store/hedge-fund-store';
import { type MacroState } from '@/lib/live-data';
import { MacroWeatherOracle } from './macro-weather-oracle';
import { HoldingsPanel } from './holdings-panel';
import { PerformanceChart } from './performance-chart';
import { RiskPanel } from './risk-panel';
import { MacroEnginePanel } from './macro-engine-panel';
import { X10EnginePanel } from './x10-engine-panel';
import { ActionButtons } from './action-buttons';
import { GlobalActionButtons } from './global-action-buttons';
// P1_2026_07_09_GEMINI — ProfileCards import removed: the legacy
// "Perfiles de cartera" block was deleted from this file because it
// duplicated the X10 ProfileCardsCompact inside MultiOraclePanel. The
// file src/components/dashboard/profile-cards.tsx is preserved for
// archaeology but no longer rendered.
import { DataProvenancePanel } from './data-provenance-panel';
import { CarryPanel } from './carry-panel';
// V3.4 UNIFY: FciOraclePanel import removed — FCI is now an internal tab
// inside MultiOraclePanel (V4). The fci-oracle-panel.tsx file is preserved.
import { MultiOraclePanel } from './multi-oracle-panel';
import { BucketAllocationPanel } from './bucket-allocation-panel';
// V11 — Santander Oracle v1 (minimal bloomberg): canonical single-engine UI
// Per spec `oracle_santander_v1_bloomberg_minimal` → ui_contract.single_dashboard_blocks.
// This is the CANONICAL panel (one engine, one loop, one score). Legacy
// multi-oracle / FCI panels remain below for backward compatibility.
import { SingleOraclePanel } from './single-oracle-panel';
// V11_REFACTORED — Bloomberg Lite Terminal: side-panel isolated, read-only mirror.
// Per spec `architecture.bloomberg_module`:
//   position: "SIDE_PANEL_ISOLATED"
//   role: "visualization_and_context_only"
//   must_not_influence_core: true
//   render_rule: "RIGHT_SIDE_OR_BOTTOM_TAB_ONLY"
import { BloombergLiteTerminal } from './bloomberg-lite-terminal';
import { RETURN_TARGETS, REGIME_LABELS } from '@/lib/macroOracle';
// P1_2026_07_09_GEMINI — getRegimeFavoredProfile import removed: it was only
// used by the legacy "Perfiles de cartera" block, which was deleted because
// it duplicated the X10 ProfileCardsCompact inside MultiOraclePanel.
// P2_2026_07_09_GEMINI — Hydrate source-health registry from /api/macro outcome.
// Without this, the Paper Executor's Monitor shows "0 fuentes sanas / CRÍTICO"
// because the in-memory REGISTRY in amira-source-health.ts never gets populated
// on the client. The header's "FRESHNESS 85%" comes from a different code path
// (realDataPct fallback in multi-oracle-panel.tsx), creating the divergent
// state Gemini identified as P2 in the live dashboard audit.
import { recordSourceFetch } from '@/lib/amira-source-health';
import {
  TrendingUp,
  ChevronDown,
  AlertTriangle,
} from 'lucide-react';
// V9.2 — Render scope isolation for main dashboard.
import { RenderScope } from './amira-render-scope';
import { RENDER_SCOPES } from '@/lib/amira-portfolio-view-model';

// ============================================================================
// DATA LABEL BADGE — [OBSERVADO] / [REAL] / [PARTIAL_FALLBACK] / [SIMULADO] / [RECONSTRUIDO] / [STALE] / [ERROR]
// ============================================================================
function DataBadge({ label }: { label: 'OBSERVADO' | 'REAL' | 'PARTIAL_FALLBACK' | 'ERROR' | 'STALE' | 'SIMULADO' | 'RECONSTRUIDO' | 'CARGANDO' | 'SINCRONIZANDO' }) {
  const config = {
    CARGANDO: { bg: 'bg-[#6b7280]', text: 'text-[#ffffff]', tooltip: 'Esperando la primera respuesta de macro' },
    SINCRONIZANDO: { bg: 'bg-[#2563eb]', text: 'text-[#ffffff]', tooltip: 'Actualizando datos macro' },
    OBSERVADO: { bg: 'bg-[#0066cc]', text: 'text-[#ffffff]', tooltip: 'Retorno efectivamente ocurrido — verificado con fuente' },
    REAL: { bg: 'bg-[#16a34a]', text: 'text-[#ffffff]', tooltip: 'Dato obtenido de API real' },
    PARTIAL_FALLBACK: { bg: 'bg-[#999999]', text: 'text-[#ffffff]', tooltip: 'Calculado a partir de inputs reales' },
    SIMULADO: { bg: 'bg-[#ca8a04]', text: 'text-[#ffffff]', tooltip: 'Estimado/simulado — sin serie historica real' },
    RECONSTRUIDO: { bg: 'bg-[#ca8a04]', text: 'text-[#ffffff]', tooltip: 'Reconstruido de memoria de entrenamiento — no fetch real de API' },
    STALE: { bg: 'bg-[#dc2626]', text: 'text-[#ffffff]', tooltip: 'Dato desactualizado (>24h)' },
    ERROR: { bg: 'bg-[#7f1d1d]', text: 'text-[#ffffff]', tooltip: 'Error al obtener dato — usando fallback' },
  };
  const c = config[label];
  return (
    <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded tracking-[0.1em] ${c.bg} ${c.text}`} title={c.tooltip}>
      {label}
    </span>
  );
}

export function MainDashboard() {
  const {
    metrics,
    allocations,
    lastSync,
    dataMode,
    syncStatus,
    isRebalancing,
    showRebalanceToast,
    activeSection,
    oracle,
    returnTargetMode,
    selectedProfile,
    multiProfile,
    dataLabel,
    backtest,
    realDataPct,
    provenance,
    fetchPortfolio,
    sync,
    rebalance,
    setActiveSection,
    computeOracleFromMacro,
  } = useHedgeFundStore();

  const [now, setNow] = useState(new Date());
  const [macroFetchStatus, setMacroFetchStatus] = useState<'loading' | 'syncing' | 'success' | 'error'>('loading');
  const latestMacroRequest = useRef(0);
  const macroAbortController = useRef<AbortController | null>(null);
  const syncInFlight = useRef(false);
  const displayDataLabel =
    macroFetchStatus === 'loading' ? 'CARGANDO' :
    macroFetchStatus === 'syncing' ? 'SINCRONIZANDO' :
    dataLabel;

  useEffect(() => { fetchPortfolio(); }, [fetchPortfolio]);
  useEffect(() => {
    const interval = setInterval(() => { setNow(new Date()); }, 1000);
    return () => clearInterval(interval);
  }, []);

  const loadMacro = useCallback((manual = false) => {
    macroAbortController.current?.abort();
    const controller = new AbortController();
    macroAbortController.current = controller;
    const requestId = ++latestMacroRequest.current;
    let timedOut = false;
    const requestTimeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 15000);
    setMacroFetchStatus(manual ? 'syncing' : 'loading');

    return fetch('/api/macro', { signal: controller.signal })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (requestId !== latestMacroRequest.current) return;
        if (!data?.success) throw new Error('Macro API returned success:false');
        {
          const macro = buildMacroFromAPI(data);
          if (!macro) throw new Error('Invalid macro payload');
          {
            // A successful response must retain its reported provenance; ERROR
            // is reserved for a confirmed request or payload failure below.
            const apiSource = (data.source as string) || macro.source || 'PARTIAL_FALLBACK';
            const mappedMode =
              apiSource === 'REAL' ? 'REAL' :
              apiSource === 'STALE' ? 'STALE' :
              apiSource === 'OBSERVADO' ? 'OBSERVADO' :
              apiSource === 'PARTIAL_FALLBACK' ? 'PARTIAL_FALLBACK' :
              apiSource === 'SIMULADO' ? 'SIMULADO' :
              apiSource === 'RECONSTRUIDO' ? 'RECONSTRUIDO' :
              'PARTIAL_FALLBACK';

            // ─── Provenance: mergear legacy + nuevos campos top-level del proxy ───
            // Los campos tpm/ipc/fx/badlar vienen del proxy (vía service binding)
            // y son los que determinan si el dato es realmente REAL.
            const legacyProv = macro.provenance || {};
            const ts = (data.timestamp as string) || new Date().toISOString();
            const tsDate = ts.split('T')[0];
            const buildProv = (label: 'REAL' | 'STALE', source: string, url: string) => ({
              label,
              source,
              url,
              lastUpdate: ts,
              dataDate: tsDate,
              stalenessHours: label === 'REAL' ? 0 : 999,
              fetchedAt: ts,
              ageMinutes: 0,
              fetchError: label !== 'REAL',
            });
            const enrichedProvenance = {
              ...legacyProv,
              tpm: data.tpm != null
                ? buildProv('REAL', 'BCRA TPM via macro-oracle-proxy', 'https://macro-oracle-proxy.simondalmasso44.workers.dev/api/proxy?source=bcra_all')
                : buildProv('STALE', 'TPM no disponible via proxy', 'N/A'),
              ipc: data.ipc != null
                ? buildProv('REAL', 'INDEC IPC via macro-oracle-proxy', 'https://macro-oracle-proxy.simondalmasso44.workers.dev/api/proxy?source=bcra_inflacion')
                : buildProv('STALE', 'IPC no disponible via proxy', 'N/A'),
              fx: data.fx?.oficial != null
                ? buildProv('REAL', 'DolarAPI via macro-oracle-proxy', 'https://macro-oracle-proxy.simondalmasso44.workers.dev/api/proxy?source=dolar_all')
                : buildProv('STALE', 'FX no disponible via proxy', 'N/A'),
              badlar: data.badlar != null
                ? buildProv('REAL', 'BCRA BADLAR via macro-oracle-proxy', 'https://macro-oracle-proxy.simondalmasso44.workers.dev/api/proxy?source=bcra_all')
                : buildProv('STALE', 'BADLAR no disponible via proxy', 'N/A'),
            };

            // ─── setState PRIMERO, computeOracleFromMacro DESPUÉS ───
            useHedgeFundStore.setState({
              macro,
              realDataPct: (data.realDataPct as number) ?? macro.realDataPct ?? 0,
              dataMode: mappedMode as MacroState['source'],
              dataLabel: mappedMode as MacroState['source'],
              provenance: enrichedProvenance,
              lastSync: ts,
            });
            computeOracleFromMacro(macro);

            // ─── P2_2026_07_09_GEMINI: Hydrate source-health registry ───
            // Per Gemini live-dashboard audit: the Paper Executor's Monitor block
            // showed "Frescura de fuentes: CRÍTICO · 0 sanas · 0 degradadas · 0 en
            // error" while the Ingestor header showed "FRESHNESS 85%". The cause
            // was that recordSourceFetch() was NEVER called from client-side
            // ingestion paths — the in-memory REGISTRY stayed at its DEFAULT
            // (all SIMULADO), so serializeSourceHealth() returned 0 healthy
            // sources. The 85% in the header came from a separate fallback
            // (multi-oracle-panel.tsx uses realDataPct when registry is empty).
            //
            // Fix: when /api/macro returns, immediately record fetch outcomes
            // for BCRA, INDEC, and DolarAPI based on the proxy.* booleans and
            // the presence of tpm/badlar/ipc/fx values. Bluelytics is recorded
            // as STALE when only the proxy path returned (Bluelytics direct is
            // fallback-only per live-data.ts). This makes the registry reflect
            // real ingestion state, so the Monitor's source-freshness guardrail
            // transitions from CRÍTICO → OK / ATENCIÓN based on actual outcomes.
            const proxyPayload = (data.proxy ?? {}) as {
              bcra?: boolean;
              dolar?: boolean;
              inflacion?: boolean;
            };
            const tpmVal = data.tpm ?? null;
            const badlarVal = data.badlar ?? null;
            const ipcVal = data.ipc ?? null;
            const fxOficialVal = data.fx?.oficial ?? null;
            const fxMepVal = data.fx?.mep ?? null;
            const fxCclVal = data.fx?.ccl ?? null;
            const windowDate = (ts ?? new Date().toISOString()).split('T')[0];

            // BCRA: tpm + badlar are the 2 series we expect from bcra_all proxy.
            const bcraCoverage =
              ((tpmVal != null ? 1 : 0) + (badlarVal != null ? 1 : 0)) / 2;
            recordSourceFetch({
              sourceId: 'BCRA',
              success: proxyPayload.bcra === true || tpmVal != null || badlarVal != null,
              coverage: bcraCoverage,
              reason:
                proxyPayload.bcra === true
                  ? 'OK via macro-oracle-proxy'
                  : 'BCRA proxy no respondió — fallback legacy',
              assetClasses: ['BONOS'],
              windowDate,
            });

            // INDEC: ipc is the single series we expect from bcra_inflacion proxy.
            recordSourceFetch({
              sourceId: 'INDEC',
              success: proxyPayload.inflacion === true || ipcVal != null,
              coverage: ipcVal != null ? 1 : 0,
              reason:
                proxyPayload.inflacion === true
                  ? 'OK via macro-oracle-proxy'
                  : 'INDEC proxy no respondió',
              assetClasses: [],
              windowDate,
            });

            // DolarAPI: 3 FX series (oficial, mep, ccl) from dolar_all proxy.
            const dolarCoverage =
              [fxOficialVal, fxMepVal, fxCclVal].filter((v) => v != null).length / 3;
            recordSourceFetch({
              sourceId: 'DolarAPI',
              success: proxyPayload.dolar === true || fxOficialVal != null,
              coverage: dolarCoverage,
              reason:
                proxyPayload.dolar === true
                  ? 'OK via macro-oracle-proxy'
                  : 'DolarAPI proxy no respondió',
              assetClasses: ['CEDEARS', 'ETF_CEDEARS'],
              windowDate,
            });

            // Bluelytics: legacy fallback path. Mark STALE if proxy is the source
            // of FX data (Bluelytics direct is fallback-only). Mark REAL only if
            // we somehow know Bluelytics direct was used — which we can't infer
            // from /api/macro response, so default STALE here. The registry entry
            // at least exists so it shows up in the panel with a reason.
            recordSourceFetch({
              sourceId: 'Bluelytics',
              success: proxyPayload.dolar === true, // proxy internally tries Bluelytics
              forceStatus: proxyPayload.dolar === true ? 'STALE' : 'ERROR',
              reason:
                proxyPayload.dolar === true
                  ? 'Hidratado via proxy (Bluelytics direct es fallback-only)'
                  : 'No hidratado — proxy dolar caído',
              assetClasses: ['CEDEARS', 'ETF_CEDEARS'],
              windowDate,
            });
            setMacroFetchStatus('success');
          }
        }
      })
      .catch((error: unknown) => {
        if (requestId !== latestMacroRequest.current) return;
        if (error instanceof DOMException && error.name === 'AbortError' && !timedOut) return;
        useHedgeFundStore.setState({
          dataMode: 'ERROR' as MacroState['source'],
          dataLabel: 'ERROR' as MacroState['source'],
        });
        setMacroFetchStatus('error');
      })
      .finally(() => {
        window.clearTimeout(requestTimeout);
        if (macroAbortController.current === controller) {
          macroAbortController.current = null;
        }
      });
  }, [computeOracleFromMacro]);

  const syncDashboard = useCallback(async () => {
    if (syncInFlight.current) return;
    syncInFlight.current = true;
    macroAbortController.current?.abort();
    latestMacroRequest.current += 1;
    setMacroFetchStatus('syncing');

    try {
      await sync();
      await loadMacro(true);
    } finally {
      syncInFlight.current = false;
    }
  }, [loadMacro, sync]);

  useEffect(() => {
    void loadMacro();
    return () => macroAbortController.current?.abort();
  }, [loadMacro]);

  useEffect(() => {
    const interval = setInterval(() => { void syncDashboard(); }, 60000);
    return () => clearInterval(interval);
  }, [syncDashboard]);

  // V9.2: `totalUSD` is the LEGACY holdings total (from /api/portfolio via
  // hedge-fund-store allocations). It is DIFFERENT from the MultiOraclePanel's
  // `portfolio_value_usd` (which is the oracle's recommended optimal portfolio).
  // We keep totalUSD ONLY for the derived `estimated30dReturn` metric below —
  // we NO LONGER display totalUSD as a big "$X USD" hero block, because that
  // created a visual duplicate of METRICS_VIEW's portfolio value.
  // Per spec `1_single_source_of_truth.forbidden`: "inline recalculation in
  // UI layer" — this inline reduce is grandfathered because it computes a
  // LEGACY holdings value (different concept from oracle portfolio_value_usd).
  const totalUSD = allocations.reduce((s, a) => s + a.amountUSD, 0);
  const estimated30dReturn = metrics ? (totalUSD * metrics.expectedRealReturn30d / 100) : 0;
  const isLive = dataMode === 'REAL' || dataMode === 'OBSERVADO';

  // vs objetivo calculation
  const target = RETURN_TARGETS[returnTargetMode];
  const projectedReturn = metrics?.expectedRealReturn30d ?? 0;
  const targetMid = (target.monthlyMin + target.monthlyMax) / 2;
  const vsObjetivo = projectedReturn - targetMid;

  // Average backtest error
  const avgBacktestError = backtest.length > 0
    ? backtest.reduce((s, b) => s + b.errorAbs180d, 0) / backtest.length
    : 0;

  const formatTime = (iso: string | null) => {
    if (!iso) {
      return macroFetchStatus === 'loading' ? 'esperando datos' :
        macroFetchStatus === 'syncing' ? 'sincronizando' :
        '--:--:--';
    }
    return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  // ─── U9 FIX: Compute fresh/degraded/stale source counts from provenance ───
  // Per COUNCIL EXECUTION ORDER UI_TRUTHFULNESS_PATCH_v1 Fix U9:
  //   Show counts of fresh/degraded/stale sources when provenance is available.
  //   Do NOT recalculate SLAs or states — use existing labels.
  const provenanceEntries = provenance ? Object.values(provenance) : [];
  const freshCount = provenanceEntries.filter(p => p?.label === 'REAL' || p?.label === 'OBSERVADO').length;
  const degradedCount = provenanceEntries.filter(p => p?.label === 'PARTIAL_FALLBACK' || p?.label === 'RECONSTRUIDO' || p?.label === 'SIMULADO').length;
  const staleCount = provenanceEntries.filter(p => p?.label === 'STALE' || p?.label === 'ERROR').length;
  const hasProvenanceCounts = provenanceEntries.length > 0;

  return (
    <div className="min-h-screen bg-[#ffffff] text-[#000000]">
      {/* ─── Encabezado (V7: responsive + global action buttons inline) ─── */}
      <div className="sticky top-0 z-50 bg-[#ffffff] border-b border-[#eaeaea]">
        <div className="max-w-4xl mx-auto px-3 sm:px-6 py-2 sm:py-3">
          {/* Row 1 (status bar): timestamp · regime · data badges | action buttons */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            {/* Left: live status + timestamp + regime + data badges */}
            <div className="flex items-center gap-1.5 sm:gap-2.5 flex-wrap min-w-0">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                syncStatus === 'syncing' ? 'bg-[#000000] animate-pulse' :
                isLive ? 'bg-[#16a34a] animate-pulse' : 'bg-[#eaeaea]'
              }`} />
              <span className="text-[10px] sm:text-[11px] font-semibold text-[#999999] tracking-[0.05em] whitespace-nowrap">
                <span className="hidden sm:inline">Último fetch: </span>
                {formatTime(lastSync)}
              </span>
              {oracle && (
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full tracking-[0.1em] whitespace-nowrap ${
                  oracle.regime === 'CARRY' ? 'bg-[#16a34a] text-[#ffffff]' :
                  oracle.regime === 'WARNING' ? 'bg-[#ca8a04] text-[#ffffff]' :
                  oracle.regime === 'CRISIS' ? 'bg-[#dc2626] text-[#ffffff]' :
                  'bg-[#2563eb] text-[#ffffff]'
                }`}>
                  {REGIME_LABELS[oracle.regime]}
                </span>
              )}
              <DataBadge label={displayDataLabel} />
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full tracking-[0.05em] whitespace-nowrap ${
                realDataPct >= 70 ? 'bg-[#16a34a]/10 text-[#16a34a]' :
                realDataPct >= 40 ? 'bg-[#ca8a04]/10 text-[#ca8a04]' :
                'bg-[#dc2626]/10 text-[#dc2626]'
              }`} title="Cobertura macro real — no incluye predicciones, backtests, VaR, Sharpe, retornos esperados, historial simulado ni precios de todas las clases.">
                Macro real: {realDataPct}%
              </span>
              {hasProvenanceCounts && (
                <span className="text-[8px] font-semibold text-[#999999] whitespace-nowrap" data-testid="source-freshness-counts">
                  {freshCount} fresh · {degradedCount} degraded · {staleCount} stale
                </span>
              )}
            </div>

            {/* Right: global action buttons (V7 relocation) */}
            <GlobalActionButtons
              onRebalance={rebalance}
              isRebalancing={isRebalancing}
              onSync={syncDashboard}
              syncStatus={syncStatus}
            />
          </div>
        </div>
      </div>

      {/* ─── SIMULADO WARNING BANNER ─── */}
      {macroFetchStatus === 'error' && dataLabel === 'ERROR' && (
        <div className="max-w-4xl mx-auto px-6 pt-3">
          <div className="flex items-center gap-2 bg-[#fefce8] border border-[#ca8a04]/20 rounded-lg p-2.5">
            <AlertTriangle className="w-3.5 h-3.5 text-[#ca8a04] flex-shrink-0" />
            <p className="text-[9px] font-bold text-[#854d0e] leading-snug">
              PROYECCIONES SIMULADAS — Sin series historicas reales. Error medio simulacion 180d: {avgBacktestError.toFixed(2)}pp.
              No tomar decisiones basadas únicamente en estos números.
            </p>
          </div>
        </div>
      )}

      {/* ─── REALISTIC RETURN DISCLAIMER ─── */}
      <div className="max-w-4xl mx-auto px-3 sm:px-6 pt-2">
        <div className="flex items-center gap-2 bg-[#f0f0f0] border border-[#eaeaea] rounded-lg p-2">
          <span className="text-[9px] font-bold text-[#999999] whitespace-nowrap">AMPLIFICADOR:</span>
          <p className="text-[8px] sm:text-[9px] font-medium text-[#666666] leading-snug">
            ingreso = capital × tasa_retorno_real. 0.8%–1.2% mensual combinado. Sin apalancamiento.
            $500/mes requiere ~$50K al 1%/mes. Mayor retorno = mayor capital, NO mayor riesgo.
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-3 sm:px-6 pb-20">

        {/* ═══════════════════════════════════════════════════════════
            SECCIÓN 0 — PREDICCIONES AMIRA VISION (HERO — FIRST VISUAL BLOCK)
            V11_FIX: Per EXPLICIT user request — "Predicciones Amira vision"
            MUST be the first visible block, above the canonical
            SingleOraclePanel. The MultiOraclePanel is the user's
            primary analytical surface (capital input + asset-class tabs
            + portfolio_value_usd). It stays HERO.
            SingleOraclePanel + BloombergLiteTerminal moved BELOW as
            secondary canonical overlay.
        ═══════════════════════════════════════════════════════════ */}
        <SectionToggle
          title="Predicciones Amira vision"
          subtitle="FCI · PF · Acciones · Bonos · CEDEARs · ETFs · Predicciones · 8 pestañas — Oracle Maestro"
          isOpen={activeSection === 'multi'}
          onToggle={() => setActiveSection(activeSection === 'multi' ? null : 'multi')}
        />
        <AnimatePresence>
          {activeSection === 'multi' && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <MultiOraclePanel />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ═══════════════════════════════════════════════════════════
            SECCIÓN CANÓNICA — SANTANDER ORACLE v1 (MINIMAL BLOOMBERG REFACTORED)
            Secondary overlay — SingleOraclePanel + BloombergLiteTerminal.
            Per spec Oracle_Santander_v1_REAL · V11_MINIMAL_BLOOMBERG_REFACTORED,
            but VISUALLY DEMOTED per explicit user request to keep
            "Predicciones Amira vision" as hero. This block still runs the
            canonical single_pass_oracle_engine (one_engine · one_loop ·
            one_score) and feeds the Bloomberg Lite terminal as a read-only
            mirror — it just renders below the multi-asset panel.

            LAYOUT:
              Desktop (>=768px): 2-col grid — Oracle primary (left, 2fr) +
                                 Bloomberg Lite (right, 1fr, isolated).
              Mobile (<768px):   stacked — Oracle first, Bloomberg below as
                                 secondary tab.
        ═══════════════════════════════════════════════════════════ */}
        <div className="pt-3 pb-2">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
            {/* PRIMARY — Oracle (always first visual block per hard_rule) */}
            <div className="lg:col-span-2" data-testid="oracle-primary-slot">
              <SingleOraclePanel />
            </div>
            {/* SECONDARY — Bloomberg Lite Terminal (right drawer / bottom tab) */}
            <div className="lg:col-span-1" data-testid="bloomberg-secondary-slot">
              <BloombergLiteTerminal />
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════
            SECCIÓN 1 — HOLDINGS
        ═══════════════════════════════════════════════════════════ */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="pt-4 pb-2"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[14px] font-extrabold text-[#000000] tracking-tight">
              Holdings
            </h3>
            <div className="flex items-center gap-2">
              {selectedProfile && (
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-[0.1em] ${
                  selectedProfile === 'CONSERVADOR' ? 'bg-[#16a34a] text-[#ffffff]' :
                  selectedProfile === 'MODERADO' ? 'bg-[#ca8a04] text-[#ffffff]' :
                  'bg-[#dc2626] text-[#ffffff]'
                }`}>
                  {selectedProfile}
                </span>
              )}
              <span className="text-[9px] font-semibold text-[#999999] uppercase tracking-[0.15em]">
                {allocations.length} activos
              </span>
            </div>
          </div>
          <HoldingsPanel />
        </motion.div>

        {/* ═══════════════════════════════════════════════════════════
            SECCIÓN 1.5 — PERFILES DE CARTERA
            P1_2026_07_09_GEMINI — REMOVED legacy <ProfileCards /> block.
            The modern X10 ProfileCardsCompact inside MultiOraclePanel
            (Section 0, "Predicciones Amira vision") is now the SINGLE source
            of truth for portfolio profiles. This eliminates the duplicate
            "Perfiles de cartera" block that Gemini identified as showing
            inconsistent returns vs the X10 cards (e.g., CONSERVADOR +2.79%
            in X10 vs +2.22% in legacy, because the two paths computed
            expected_return_30d from different inputs/states).

            The legacy ProfileCards component (src/components/dashboard/
            profile-cards.tsx) is preserved in the codebase for archaeology
            and potential rollback, but is no longer rendered. The
            ProfileCardsCompact (portfolio-profiles.tsx) consumed by
            MultiOraclePanel is the canonical profile card surface.
        ═══════════════════════════════════════════════════════════ */}

        {/* ═══════════════════════════════════════════════════════════
            SECCIÓN 1.7 — CAPITAL BUCKET ARCHITECTURE
        ═══════════════════════════════════════════════════════════ */}
        <SectionToggle
          title="Arquitectura de Buckets"
          subtitle="5-Buckets · Régimen · Escala"
          isOpen={activeSection === 'x10'}
          onToggle={() => setActiveSection(activeSection === 'x10' ? null : 'x10')}
        />
        <AnimatePresence>
          {activeSection === 'x10' && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <BucketAllocationPanel />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ═══════════════════════════════════════════════════════════
            SECCIÓN 1.6 — OBJETIVO DE GANANCIA
        ═══════════════════════════════════════════════════════════ */}
        <SectionToggle
          title="Objetivo de ganancia"
          subtitle="Meta USD"
          isOpen={activeSection === 'goal'}
          onToggle={() => setActiveSection(activeSection === 'goal' ? null : 'goal')}
        />
        <AnimatePresence>
          {activeSection === 'goal' && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <GoalSection />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ═══════════════════════════════════════════════════════════
            SECCIÓN 2 — ORÁCULO MACRO
        ═══════════════════════════════════════════════════════════ */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
          className="pt-3 pb-2"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[14px] font-extrabold text-[#000000] tracking-tight">
              Oráculo macro
            </h3>
            <span className="text-[9px] font-semibold text-[#999999] uppercase tracking-[0.15em]">
              {oracle ? `Deval.: ${oracle.devaluationProbability.toFixed(0)}%` : 'Cargando...'}
            </span>
          </div>
          <MacroWeatherOracle />
        </motion.div>

        {/* ═══════════════════════════════════════════════════════════
            SECCIÓN 3 — MÉTRICAS PRINCIPALES (V9.2 refactored)
            V9.2: Per spec `critical_fixes.1_single_source_of_truth.rule`:
              "solo un objeto puede emitir portfolio_value_usd"
            The previous version of this section rendered a SECOND $2,000 USD
            block (computed from `allocations.reduce((s,a)=>s+a.amountUSD,0)`)
            which duplicated the value already shown by StickyTopBar in the
            MultiOraclePanel (METRICS_VIEW). Per spec `deployment_block.fail_condition`:
              "if portfolio_value_usd appears in more than 1 UI scope"
            We removed the big $totalUSD display and converted this section
            to STRATEGY_VIEW — it now shows the strategy narrative (regime +
            safety score + return projection + VaR) without re-emitting
            portfolio_value_usd. The portfolio value is available exclusively
            in METRICS_VIEW (MultiOraclePanel's StickyTopBar).
        ═══════════════════════════════════════════════════════════ */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="pt-4 pb-2"
        >
          <RenderScope name={RENDER_SCOPES.STRATEGY_VIEW} testId="strategy-view-scope-main">
            {/* V9.2: REMOVED duplicate "Valor portfolio $X USD" hero block.
                The single source of truth for portfolio_value_usd is now
                StickyTopBar inside MultiOraclePanel (METRICS_VIEW).
                This section now leads with the strategy narrative instead. */}
            <div className="py-3">
              <div className="flex items-baseline gap-3 flex-wrap">
                <h2 className="text-[25px] font-extrabold tracking-tight text-[#000000] leading-none">
                  Estrategia {selectedProfile.toLowerCase()}
                </h2>
                {oracle && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full tracking-[0.1em] ${
                    oracle.regime === 'CARRY' ? 'bg-[#16a34a] text-[#ffffff]' :
                    oracle.regime === 'WARNING' ? 'bg-[#ca8a04] text-[#ffffff]' :
                    oracle.regime === 'CRISIS' ? 'bg-[#dc2626] text-[#ffffff]' :
                    'bg-[#2563eb] text-[#ffffff]'
                  }`}>
                    {REGIME_LABELS[oracle.regime]}
                  </span>
                )}
                <DataBadge label={displayDataLabel} />
              </div>
              <p className="text-[11px] font-semibold text-[#999999] tracking-[0.2em] uppercase mt-1">
                Régimen · Perfil · Cobertura · Proyección 30d
              </p>
            </div>

            {/* Score Seguridad + VaR — V9.2: NOT a portfolio_value_usd emitter.
                These are RISK metrics (different concept) computed once by
                the macro oracle. Showing them here in STRATEGY_VIEW is allowed
                per spec `2_render_scope_isolation.scopes.STRATEGY_VIEW`:
                "solo narrativa + recomendaciones" — risk narrative belongs here. */}
            <div className="bg-[#000000] rounded-xl p-4 text-[#ffffff]">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[35px] font-extrabold leading-none tracking-tight">
                      {metrics?.capitalSafetyScore ?? '--'}
                    </span>
                    <span className="text-[13px] font-extrabold text-[#666666]">/100</span>
                  </div>
                  <p className="text-[9px] font-semibold text-[#666666] mt-1 uppercase tracking-[0.25em]">
                    Score seguridad
                  </p>
                </div>
                <div className="text-right">
                  {multiProfile && multiProfile.profiles[selectedProfile] && (
                    <>
                      <div className="flex items-baseline justify-end gap-1.5">
                        <span className="text-[23px] font-extrabold leading-none">
                          {multiProfile.profiles[selectedProfile].var95.toFixed(1)}%
                        </span>
                      </div>
                      <p className="text-[9px] font-semibold text-[#666666] mt-1 uppercase tracking-[0.25em]">
                        VaR 95%
                      </p>
                    </>
                  )}
                </div>
                <p className="text-[11px] font-bold text-[#ffffff] uppercase tracking-[0.12em]">
                  {metrics && metrics.capitalSafetyScore >= 85 ? 'Capital preservado' : 'Monitorear riesgo'}
                </p>
              </div>
            </div>

            {/* Profile recommendation */}
            {multiProfile && multiProfile.profiles[selectedProfile] && (
              <div className={`mt-2 rounded-lg p-3 border ${
                selectedProfile === 'CONSERVADOR' ? 'border-[#16a34a]/20 bg-[#f0faf0]' :
                selectedProfile === 'MODERADO' ? 'border-[#ca8a04]/20 bg-[#fefce8]' :
                'border-[#dc2626]/20 bg-[#fef2f2]'
              }`}>
                <p className="text-[10px] font-bold text-[#000000] leading-snug">
                  {multiProfile.profiles[selectedProfile].recommendation}
                </p>
              </div>
            )}

            {/* Métricas Grid — with [SIMULADO] badges
                V9.2: These are RETURN/EXPOSURE metrics (not portfolio_value_usd).
                Each tile declares provenance via the DataBadge per spec
                `data_layer_fix.rules`: "all metrics must declare provenance field". */}
            <div className="grid grid-cols-2 gap-2 mt-2">
              {/* Real 30d — con vs objetivo */}
              <div className="bg-[#ffffff] border border-[#eaeaea] rounded-xl p-3">
                <div className="flex items-center gap-1.5">
                  {metrics && metrics.expectedRealReturn30d >= 0 ? (
                    <TrendingUp className="w-3 h-3 text-[#000000]" />
                  ) : (
                    <TrendingUp className="w-3 h-3 text-[#000000] rotate-180" />
                  )}
                  <span className="text-[23px] font-extrabold text-[#000000] leading-none">
                    {metrics ? `${metrics.expectedRealReturn30d >= 0 ? '+' : ''}${metrics.expectedRealReturn30d.toFixed(2)}%` : '--'}
                  </span>
                  <DataBadge label={displayDataLabel} />
                </div>
                <p className="text-[9px] font-semibold text-[#999999] tracking-[0.2em] uppercase mt-1">
                  Real 30d
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-[10px] font-bold text-[#000000]">
                    {metrics ? `${estimated30dReturn >= 0 ? '+' : ''}$${estimated30dReturn.toFixed(1)} USD` : '--'}
                  </p>
                  <span className="text-[9px] font-semibold">
                    vs obj.: <span className={vsObjetivo >= 0 ? 'text-[#16a34a]' : 'text-[#dc2626]'}>
                      {vsObjetivo >= 0 ? '+' : ''}{vsObjetivo.toFixed(2)}%
                    </span>
                  </span>
                </div>
                {backtest.length > 0 && (
                  <p className="text-[8px] font-semibold text-[#ca8a04] mt-1 flex items-center gap-1">
                    <span>Error simulación 180d: {avgBacktestError.toFixed(2)}pp</span>
                    {/* DASH-01: Badge SIMULADO — esta métrica viene de /api/backtest */}
                    <span
                      className="text-[7px] font-bold px-1 py-0.5 rounded bg-[#ca8a04] text-[#ffffff] tracking-[0.08em]"
                      title="Calculado contra snapshots sintéticos (TRAINING_MEMORY_ESTIMATE)"
                    >
                      SIMULADO
                    </span>
                  </p>
                )}
              </div>
              <div className="bg-[#ffffff] border border-[#eaeaea] rounded-xl p-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-[23px] font-extrabold text-[#000000] leading-none">
                    {metrics ? `${metrics.fxExposure}%` : '--'}
                  </span>
                  <DataBadge label={displayDataLabel} />
                </div>
                <p className="text-[9px] font-semibold text-[#999999] tracking-[0.2em] uppercase mt-1">
                  Exposición TC
                </p>
              </div>
              <div className="bg-[#ffffff] border border-[#eaeaea] rounded-xl p-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-[23px] font-extrabold text-[#000000] leading-none">
                    {metrics ? `${metrics.inflationExposure}%` : '--'}
                  </span>
                  <DataBadge label={displayDataLabel} />
                </div>
                <p className="text-[9px] font-semibold text-[#999999] tracking-[0.2em] uppercase mt-1">
                  Cobertura inflación
                </p>
              </div>
              <div className="bg-[#ffffff] border border-[#eaeaea] rounded-xl p-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-[23px] font-extrabold text-[#000000] leading-none">
                    {metrics ? `${metrics.volatility30d.toFixed(1)}%` : '--'}
                  </span>
                  <DataBadge label={displayDataLabel} />
                </div>
                <p className="text-[9px] font-semibold text-[#999999] tracking-[0.2em] uppercase mt-1">
                  Volatilidad 30d
                </p>
              </div>
            </div>
          </RenderScope>
        </motion.div>

        {/* ═══════════════════════════════════════════════════════════
            SECCIÓN 3.5 — PROCEDENCIA DE DATOS
        ═══════════════════════════════════════════════════════════ */}
        <SectionToggle
          title="Procedencia de datos"
          subtitle={`Simulacion Historica · Fuentes · Error`}
          isOpen={activeSection === 'risk' && activeSection === 'risk'}
          onToggle={() => setActiveSection(activeSection === 'risk' ? null : 'risk')}
        />
        <DataProvenancePanel />

        {/* ═══════════════════════════════════════════════════════════
            SECCIÓN 3.8 — X10 ENGINE
        ═══════════════════════════════════════════════════════════ */}
        <SectionToggle
          title="Amira Vision Consensus Engine v2"
          subtitle="Señales + Estrategia + Riesgo · Consenso multi-fuente"
          isOpen={activeSection === 'x10'}
          onToggle={() => setActiveSection(activeSection === 'x10' ? null : 'x10')}
        />
        <AnimatePresence>
          {activeSection === 'x10' && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <X10EnginePanel />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ═══════════════════════════════════════════════════════════
            SECCIÓN 4 — DATOS MACRO
        ═══════════════════════════════════════════════════════════ */}
        <SectionToggle
          title="Motor macro"
          subtitle="MEP + BCRA"
          isOpen={activeSection === 'macro'}
          onToggle={() => setActiveSection(activeSection === 'macro' ? null : 'macro')}
        />
        <AnimatePresence>
          {activeSection === 'macro' && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <MacroEnginePanel />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ═══════════════════════════════════════════════════════════
            SECCIÓN 4.5 — CARRY POR PRODUCTO
            Carry real (Fisher) por instrumento: Mix VI, Ahorro USD, MEP,
            PF Tradicional, Lecaps, Corto Plazo, PF UVA, Renta Fija CER.
        ═══════════════════════════════════════════════════════════ */}
        <SectionToggle
          title="Carry por producto"
          subtitle="Fisher · IPC real · TNA por producto"
          isOpen={activeSection === 'carry'}
          onToggle={() => setActiveSection(activeSection === 'carry' ? null : 'carry')}
        />
        <AnimatePresence>
          {activeSection === 'carry' && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <CarryPanel />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ═══════════════════════════════════════════════════════════
            SECCIÓN 4b — FCI ORACLE V3 — REMOVED in V3.4 UNIFY
            FCI data is fully covered by the primary Predicciones Amira vision
            block (SECCIÓN 0, top of page) which has FCI as one of its 6
            asset-class tabs. The /api/oracle/fci endpoint and the
            fci-oracle-panel.tsx component file are PRESERVED — only the
            duplicate top-level shell has been removed to enforce a single
            primary oracle per V3.4 spec.
        ═══════════════════════════════════════════════════════════ */}

        {/* ═══════════════════════════════════════════════════════════
            SECCIÓN 4.5 — ORACLE MULTI-ASSET V4 — MOVED in V3.4 UNIFY
            This block was relocated to SECCIÓN 0 (top of page) so V4 is
            the first visible element. The block below is intentionally
            left empty to preserve section numbering for downstream code.
        ═══════════════════════════════════════════════════════════ */}

        {/* ═══════════════════════════════════════════════════════════
            SECCIÓN 5 — PERFORMANCE
        ═══════════════════════════════════════════════════════════ */}
        <SectionToggle
          title="Performance"
          subtitle="Curva de capital"
          isOpen={activeSection === 'performance'}
          onToggle={() => setActiveSection(activeSection === 'performance' ? null : 'performance')}
        />
        <AnimatePresence>
          {activeSection === 'performance' && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <PerformanceChart />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Riesgo */}
        <SectionToggle
          title="Riesgo"
          subtitle={`Seguridad ${metrics?.capitalSafetyScore ?? '--'}/100`}
          isOpen={activeSection === 'risk'}
          onToggle={() => setActiveSection(activeSection === 'risk' ? null : 'risk')}
        />
        <AnimatePresence>
          {activeSection === 'risk' && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <RiskPanel />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ═══════════════════════════════════════════════════════════
            ACCIONES — V7: el bloque ActionButtons se mantiene al final como
            fallback (CTA grande visible cuando el usuario hace scroll completo).
            Las 4 acciones globales también están en el header sticky (siempre
            visibles). No hay duplicación funcional: el header usa versiones
            pill compactas, este bloque usa versiones grandes con más contexto.
        ═══════════════════════════════════════════════════════════ */}
        <ActionButtons
          onRebalance={rebalance}
          isRebalancing={isRebalancing}
          onSync={syncDashboard}
          syncStatus={syncStatus}
        />

        {/* ─── Toast Rebalance ─── */}
        <AnimatePresence>
          {showRebalanceToast && (
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 40 }}
              className="fixed bottom-8 left-4 right-4 max-w-4xl mx-auto bg-[#000000] text-[#ffffff] px-6 py-5 rounded-xl flex items-center gap-4 z-50"
            >
              <div className="w-10 h-10 rounded-full bg-[#ffffff]/10 flex items-center justify-center flex-shrink-0">
                <span className="text-[17px]">✓</span>
              </div>
              <div>
                <p className="text-[14px] font-extrabold">Portfolio rebalanceado</p>
                <p className="text-[11px] text-[#999999] font-semibold">Asignación óptima restaurada</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function SectionToggle({
  title,
  subtitle,
  isOpen,
  onToggle,
}: {
  title: string;
  subtitle: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between py-4 border-b border-[#eaeaea] group"
    >
      <div className="flex items-center gap-4">
        <h3 className="text-[14px] font-extrabold text-[#000000]">{title}</h3>
        <span className="text-[10px] font-semibold text-[#999999]">{subtitle}</span>
      </div>
      <motion.div
        animate={{ rotate: isOpen ? 180 : 0 }}
        transition={{ duration: 0.15 }}
      >
        <ChevronDown className="w-4 h-4 text-[#000000]" />
      </motion.div>
    </button>
  );
}

// Helper — build MacroState from /api/macro response
function buildMacroFromAPI(data: Record<string, unknown>) {
  try {
    const mep = data.mep as { rate: number; officialRate: number; gap: number; sell: number; buy: number };
    const inflation = data.inflation as { monthly: number; expected30d: number; expected90d: number; yearly: number };
    const rates = data.rates as { bcraPolicy: number; moneyMarket: number; plazoFijo: number; plazoFijoUVA: number; lecaps: number };
    const cer = data.cer as { index: number; monthlyChange: number };
    const crawlingPeg = data.crawlingPeg as number;

    if (!mep || !inflation || !rates || !cer || crawlingPeg === undefined) return null;

    return {
      lastUpdate: (data.timestamp as string) || new Date().toISOString(),
      fetchedAt: (data.fetchedAt as string) || new Date().toISOString(),
      ageMinutes: (data.ageMinutes as number) ?? 0,
      lastSuccessfulFetch: (data.lastSuccessfulFetch as string | null) ?? null,
      source: (data.source as MacroState['source']) || 'ERROR',
      mep,
      inflation,
      rates: { ...rates, badlar: (rates as Record<string, number>).badlar ?? 22, leliq: (rates as Record<string, number>).leliq ?? 20, tml: (rates as Record<string, number>).tml ?? 20, lecaps: (rates as Record<string, number>).lecaps ?? 25 },
      cer: { ...cer, dailyChange: (cer as Record<string, number>).dailyChange ?? 0.07 },
      crawlingPeg,
      realDataPct: (data as Record<string, unknown>).realDataPct as number ?? 0,
      provenance: (data.provenance as MacroState['provenance']) || {} as MacroState['provenance'],
    };
  } catch {
    return null;
  }
}

// Placeholder GoalSection — will be implemented properly later
function GoalSection() {
  return (
    <div className="py-4">
      <div className="bg-[#fefce8] border border-[#ca8a04]/20 rounded-lg p-4">
        <p className="text-[10px] font-bold text-[#854d0e]">
          Seccion Objetivo de Ganancia — Las probabilidades de exito estan [SIMULADO] hasta integrar volatilidades historicas reales.
        </p>
        <p className="text-[9px] text-[#854d0e] mt-1">
          Las probabilidades de éxito sin series históricas reales son [SIMULADO] y no deben usarse para decisiones de inversión.
        </p>
      </div>
    </div>
  );
}
