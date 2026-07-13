// ============================================================================
// ZUSTAND STORE — Mini Hedge Fund V2 (Live API + Oracle Engine)
// + Data Provenance [SIMULADO]/[REAL] + Backtest Error Tracking
// ============================================================================
import { create } from 'zustand';
import {
  type MacroState,
  type SantanderProduct,
  type MarketScenario,
  type DataLabel,
  type DataProvenance,
  type BacktestResult,
} from '@/lib/live-data';
import {
  type PortfolioAllocation,
  type PortfolioMetrics,
  type ScenarioResult,
  type PortfolioProfile,
  type ProfileMetrics,
  type MultiProfileResult,
} from '@/lib/portfolio-engine';
import {
  type OracleState,
  type MacroRegime,
  computeOracle,
} from '@/lib/macroOracle';
import {
  type RebalanceOracleOutput,
  computeRebalance,
} from '@/lib/rebalanceOracle';
import {
  type BucketAllocationResult,
  type CapitalRegime,
  type ScalingPhase,
  computeBucketAllocations,
  HARD_RISK_LIMITS,
} from '@/lib/capital-buckets';

interface EquityPoint {
  date: string;
  day: number;
  valueUSD: number;
  valueARS: number;
  realReturn: number;
}

// Normalized allocation shape used in the store
interface NormalizedAllocation {
  productId: string;
  productName: string;
  weight: number;
  amountARS: number;
  amountUSD: number;
  category: string;
}

function normalizeAllocation(a: Record<string, unknown>): NormalizedAllocation {
  return {
    productId: String(a.productId || ''),
    productName: String(a.productName || a.name || a.productId || ''),
    weight: Number(a.weight || 0),
    amountARS: Number(a.amountARS || 0),
    amountUSD: Number(a.amountUSD || 0),
    category: String(a.category || ''),
  };
}

export type RiskAppetite = 'CONSERVADOR' | 'BALANCEADO' | 'AGRESIVO_CONTROLADO';
export type ReturnTargetMode = 'CONSERVACION' | 'CRECIMIENTO_MODERADO' | 'CRECIMIENTO_AGRESIVO';
export type { PortfolioProfile } from '@/lib/portfolio-engine';

interface HedgeFundState {
  // Core data
  macro: MacroState | null;
  products: SantanderProduct[];
  scenarios: MarketScenario[];
  dataMode: 'OBSERVADO' | 'REAL' | 'PARTIAL_FALLBACK' | 'ERROR' | 'STALE' | 'SIMULADO' | 'RECONSTRUIDO';

  // Portfolio
  allocations: NormalizedAllocation[];
  metrics: PortfolioMetrics | null;
  scenarioResults: ScenarioResult[];
  equityCurve: EquityPoint[];

  // Multi-profile
  multiProfile: MultiProfileResult | null;
  selectedProfile: PortfolioProfile;

  // Oracle
  oracle: OracleState | null;
  rebalanceOracle: RebalanceOracleOutput | null;

  // Risk mode
  riskAppetite: RiskAppetite;
  returnTargetMode: ReturnTargetMode;

  // ─── Data Provenance + Backtest ───
  dataLabel: DataLabel;
  provenance: Record<string, DataProvenance> | null;
  backtest: BacktestResult[];
  realDataPct: number;  // % of data from real APIs (0-100)

  // ─── Capital Bucket Architecture (REALISTIC_CAPITAL_ARCHITECTURE_v1) ───
  bucketResult: BucketAllocationResult | null;
  capitalRegime: CapitalRegime | null;
  scalingPhase: ScalingPhase | null;
  capitalUSD: number;

  // UI state
  lastSync: string | null;
  syncStatus: 'idle' | 'syncing' | 'success' | 'error';
  isRebalancing: boolean;
  showRebalanceToast: boolean;
  activeSection: 'holdings' | 'performance' | 'risk' | 'macro' | 'oracle' | 'goal' | 'x10' | 'carry' | 'fci' | 'multi' | null;
  chartView: 'usd' | 'ars' | 'real';

  // ─── V9.3: Prediction horizon persistence ─────────────────────────────
  // Per spec `5_store_changes`:
  //   - Persistir selected horizon (30d/60d/90d).
  //   - Persistir selected profile y capital input en una sola fuente.
  //   - No resetear el bloque de ganancias al cambiar de sección.
  // The horizon lives in the store so it survives section changes (e.g.,
  // when the user switches to "macro" and back to "multi", the selected
  // horizon remains instead of resetting to "30d").
  predictionHorizon: '30d' | '60d' | '90d';

  // ─── V10: Modular pipeline persistence ──────────────────────────────────
  // Per spec `architecture_upgrade.single_source_of_truth`:
  //   active_asset_ids and prediction_status are part of the unified state graph.
  // Per spec `files_to_modify[hedge-fund-store].changes`:
  //   - persist capital, risk, profile, stress and selected opportunities
  //   - persist source health and prediction status
  //   - avoid state resets across section switches
  /** Asset IDs that the user pinned in the Scanner as interesting.
   * Survives section switches. Empty by default. */
  scannerPinnedAssetIds: string[];
  /** Asset IDs the user explicitly dismissed from the Scanner.
   * Survives section switches. Empty by default. */
  scannerDismissedAssetIds: string[];
  /** Currently selected asset class filter in the Scanner.
   * null = show all classes. Survives section switches. */
  scannerFilterClass: string | null;
  /** Whether the executor block is expanded. Survives section switches. */
  executorExpanded: boolean;
  /** Whether the monitor alerts panel is expanded. Survives section switches. */
  monitorExpanded: boolean;
  /** Last known overall system status from the monitor (GREEN/AMBER/RED).
   * Survives section switches so the status bar can show the last value
   * immediately on remount. */
  lastOverallStatus: 'GREEN' | 'AMBER' | 'RED' | null;
  /** Last known prediction status (ON/OFF/PARTIAL). Survives section switches. */
  lastPredictionStatus: 'ON' | 'OFF' | 'PARTIAL' | null;

  // ─── V10.1: Prediction Lifecycle persistence ────────────────────────────
  // Per spec `system_changes.ui_changes.must_display`:
  //   "Toda UI debe mostrar estado lifecycle activo"
  // Per spec `rules.rule_6`: "Toda UI debe mostrar estado lifecycle activo"
  // These fields persist across section switches so the lifecycle tracker
  // can render the last known state immediately on remount.
  /** Whether the lifecycle tracker block is expanded. Survives section switches. */
  lifecycleExpanded: boolean;
  /** Last known active lifecycle stage — PREDICTION/OUTCOME/VERIFICATION/EMPTY.
   * Used so the status bar can show the last stage immediately on remount. */
  lastLifecycleStage: 'PREDICTION' | 'OUTCOME' | 'VERIFICATION' | 'EMPTY' | null;
  /** Last known rolling verification Brier-like score (0..1, lower is better).
   * Persisted so the lifecycle tracker can show the last score on remount. */
  lastVerificationScore: number | null;
  /** Last known drift signal (rolling mean of signed errors).
   * Persisted so the lifecycle tracker can show drift immediately on remount. */
  lastDriftSignal: number | null;
  /** Last known prediction_id (most recent). Survives section switches so
   * users can copy/trace the last prediction even after switching sections. */
  lastPredictionId: string | null;

  // Actions
  fetchPortfolio: () => Promise<void>;
  fetchMEP: () => Promise<void>;
  fetchMacro: () => Promise<void>;
  rebalance: () => Promise<void>;
  sync: () => Promise<void>;
  setActiveSection: (section: 'holdings' | 'performance' | 'risk' | 'macro' | 'oracle' | 'goal' | 'x10' | 'carry' | 'fci' | 'multi' | null) => void;
  setChartView: (view: 'usd' | 'ars' | 'real') => void;
  setRiskAppetite: (mode: RiskAppetite) => void;
  setReturnTargetMode: (mode: ReturnTargetMode) => void;
  setSelectedProfile: (profile: PortfolioProfile) => void;
  applyProfile: (profile: PortfolioProfile) => void;
  computeOracleFromMacro: (macro: MacroState) => void;
  setCapitalUSD: (capital: number) => void;
  computeBuckets: () => void;
  setPredictionHorizon: (h: '30d' | '60d' | '90d') => void;
  // V10 NEW actions
  toggleScannerPin: (assetId: string) => void;
  toggleScannerDismiss: (assetId: string) => void;
  setScannerFilterClass: (cls: string | null) => void;
  setExecutorExpanded: (expanded: boolean) => void;
  setMonitorExpanded: (expanded: boolean) => void;
  setLastOverallStatus: (status: 'GREEN' | 'AMBER' | 'RED') => void;
  setLastPredictionStatus: (status: 'ON' | 'OFF' | 'PARTIAL') => void;
  // V10.1 NEW actions
  setLifecycleExpanded: (expanded: boolean) => void;
  setLastLifecycleStage: (stage: 'PREDICTION' | 'OUTCOME' | 'VERIFICATION' | 'EMPTY') => void;
  setLastVerificationScore: (score: number) => void;
  setLastDriftSignal: (signal: number) => void;
  setLastPredictionId: (predictionId: string | null) => void;
}

export const useHedgeFundStore = create<HedgeFundState>((set, get) => ({
  // Initial
  macro: null,
  products: [],
  scenarios: [],
  dataMode: 'ERROR',
  allocations: [],
  metrics: null,
  scenarioResults: [],
  equityCurve: [],
  oracle: null,
  rebalanceOracle: null,
  multiProfile: null,
  selectedProfile: 'MODERADO',
  riskAppetite: 'BALANCEADO',
  returnTargetMode: 'CRECIMIENTO_MODERADO',
  dataLabel: 'ERROR',
  provenance: null,
  backtest: [],
  realDataPct: 0,
  bucketResult: null,
  capitalRegime: null,
  scalingPhase: null,
  capitalUSD: 2000,
  lastSync: null,
  syncStatus: 'idle',
  isRebalancing: false,
  showRebalanceToast: false,
  // V3.3 MOUNT FIX — default to 'multi' so MultiOraclePanel (and its StickyTopBar
  // with capital-input) mounts on initial page load. Without this, the panel is
  // gated by AnimatePresence + activeSection === 'multi' && ... at
  // main-dashboard.tsx:573, and the capital input never appears in DOM.
  // Spec: RECOPILAR_INFO_CRITICA_PARA_ARREGLO_DE_UI — minimal mount fix only,
  // no design changes.
  // V11_REFACTORED NOTE: The canonical SingleOraclePanel + BloombergLiteTerminal
  // are rendered ABOVE this section regardless of activeSection, so 'multi'
  // default is safe — it only governs whether the legacy advanced-mode panel
  // expands below. Oracle is always first per spec `oracle_first_render_priority`.
  activeSection: 'multi',
  chartView: 'usd',
  // V9.3: prediction horizon defaults to 30d. Per spec `5_store_changes`:
  // "No resetear el bloque de ganancias al cambiar de sección."
  predictionHorizon: '30d',
  // V10: scanner + executor + monitor persistence. Per spec
  // `files_to_modify[hedge-fund-store].changes`: "avoid state resets across
  // section switches". All V10 fields default to empty/false/null so they
  // have a stable initial state. They survive section changes (e.g.,
  // 'multi' → 'macro' → 'multi') because they're top-level store fields,
  // not component-local state.
  scannerPinnedAssetIds: [],
  scannerDismissedAssetIds: [],
  scannerFilterClass: null,
  executorExpanded: false,
  monitorExpanded: false,
  lastOverallStatus: null,
  lastPredictionStatus: null,
  // V10.1: lifecycle persistence — same pattern as V10 fields above.
  // Default to collapsed, no last known stage/score/drift/prediction_id.
  // These get populated as the lifecycle tracker mounts and observes state.
  lifecycleExpanded: false,
  lastLifecycleStage: null,
  lastVerificationScore: null,
  lastDriftSignal: null,
  lastPredictionId: null,

  fetchPortfolio: async () => {
    try {
      const res = await fetch('/api/portfolio');
      const data = await res.json();

      if (data.success) {
        set({
          allocations: data.allocations.map(normalizeAllocation),
          metrics: data.metrics,
          scenarioResults: data.scenarios,
          equityCurve: data.equityCurve,
          dataMode: data.dataMode || 'ERROR',
          lastSync: data.timestamp,
          multiProfile: data.multiProfile || null,
          dataLabel: data.dataLabel || 'ERROR',
          provenance: data.provenance || null,
          backtest: data.backtest || [],
          realDataPct: data.realDataPct ?? 0,
        });

        // Compute oracle if we have macro data
        const macro = get().macro;
        if (macro) {
          get().computeOracleFromMacro(macro);
        }
      }
    } catch {
      // Silently fail — keep existing data
    }
  },

  fetchMEP: async () => {
    try {
      const res = await fetch('/api/mep');
      const data = await res.json();
      if (data.success && get().macro) {
        set(state => ({
          macro: state.macro ? {
            ...state.macro,
            mep: data.mep,
            source: (data.source as MacroState['source']) || 'ERROR',
          } : state.macro,
        }));
      }
    } catch {
      // Keep existing data
    }
  },

  fetchMacro: async () => {
    try {
      const res = await fetch('/api/macro');
      const data = await res.json();
      if (data.success) {
        set({ lastSync: data.timestamp });
      }
    } catch {
      // Keep existing data
    }
  },

  computeOracleFromMacro: (macro: MacroState) => {
    const oracle = computeOracle(macro);
    const { allocations, metrics } = get();

    const rebalanceOracle = computeRebalance(
      oracle,
      allocations.map(a => ({
        productId: a.productId,
        productName: a.productName,
        weight: a.weight,
        amountARS: a.amountARS,
        amountUSD: a.amountUSD,
        category: a.category,
      })),
      metrics
    );

    set({ oracle, rebalanceOracle, macro });

    // Also compute capital buckets
    const { capitalUSD } = get();
    const result = computeBucketAllocations(macro, oracle, capitalUSD);
    set({
      bucketResult: result,
      capitalRegime: result.regime.regime,
      scalingPhase: result.scalingPhase.phase,
    });
  },

  rebalance: async () => {
    set({ isRebalancing: true });

    try {
      const res = await fetch('/api/rebalance', { method: 'POST' });
      const data = await res.json();

      if (data.success) {
        set({
          allocations: data.allocations.map(normalizeAllocation),
          metrics: data.metrics,
          scenarioResults: data.scenarioResults,
          equityCurve: data.equityCurve,
          dataMode: data.dataMode || 'ERROR',
          isRebalancing: false,
          showRebalanceToast: true,
          lastSync: data.timestamp,
          multiProfile: data.multiProfile || null,
          dataLabel: data.dataLabel || 'ERROR',
          provenance: data.provenance || null,
          backtest: data.backtest || [],
          realDataPct: data.realDataPct ?? 0,
        });

        // Recompute oracle after rebalance
        const macro = get().macro;
        if (macro) {
          get().computeOracleFromMacro(macro);
        }

        setTimeout(() => set({ showRebalanceToast: false }), 3000);
      } else {
        set({ isRebalancing: false });
      }
    } catch {
      set({ isRebalancing: false });
    }
  },

  sync: async () => {
    set({ syncStatus: 'syncing' });

    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      const data = await res.json();

      if (data.success) {
        set({
          allocations: data.allocations.map(normalizeAllocation),
          metrics: data.metrics,
          dataMode: data.dataMode || 'ERROR',
          lastSync: data.timestamp,
          syncStatus: 'success',
        });

        // Refresh full portfolio data after sync
        get().fetchPortfolio();

        // Recompute oracle
        const macro = get().macro;
        if (macro) {
          get().computeOracleFromMacro(macro);
        }

        setTimeout(() => set({ syncStatus: 'idle' }), 2000);
      } else {
        set({ syncStatus: 'error' });
        setTimeout(() => set({ syncStatus: 'idle' }), 3000);
      }
    } catch {
      set({ syncStatus: 'error' });
      setTimeout(() => set({ syncStatus: 'idle' }), 3000);
    }
  },

  setActiveSection: (section) => set({ activeSection: section }),
  setChartView: (view) => set({ chartView: view }),
  setRiskAppetite: (mode) => set({ riskAppetite: mode }),
  setReturnTargetMode: (mode) => set({ returnTargetMode: mode }),
  setSelectedProfile: (profile) => set({ selectedProfile: profile }),
  applyProfile: (profile) => {
    const { multiProfile } = get();
    if (!multiProfile) return;

    const profileData = multiProfile.profiles[profile];
    if (!profileData) return;

    set({
      selectedProfile: profile,
      allocations: profileData.allocations.map((a: PortfolioAllocation) => normalizeAllocation(a as unknown as Record<string, unknown>)),
      metrics: profileData.metrics,
      scenarioResults: profileData.scenarioResults,
    });

    // Recompute oracle with new allocations
    const macro = get().macro;
    if (macro) {
      get().computeOracleFromMacro(macro);
    }
  },

  setCapitalUSD: (capital) => {
    set({ capitalUSD: capital });
    // Recompute buckets when capital changes
    get().computeBuckets();
  },

  setPredictionHorizon: (h) => set({ predictionHorizon: h }),

  // V10 NEW: scanner + executor + monitor actions.
  // All four toggle/set actions are pure state updates — no side effects.
  // Per spec `5_store_changes`: "No resetear el bloque de ganancias al
  // cambiar de sección." Same principle applies to scanner pins, executor
  // expansion, and monitor expansion — they all survive section switches.
  toggleScannerPin: (assetId) => set((state) => {
    const isPinned = state.scannerPinnedAssetIds.includes(assetId);
    return {
      scannerPinnedAssetIds: isPinned
        ? state.scannerPinnedAssetIds.filter((id) => id !== assetId)
        : [...state.scannerPinnedAssetIds, assetId],
    };
  }),
  toggleScannerDismiss: (assetId) => set((state) => {
    const isDismissed = state.scannerDismissedAssetIds.includes(assetId);
    return {
      scannerDismissedAssetIds: isDismissed
        ? state.scannerDismissedAssetIds.filter((id) => id !== assetId)
        : [...state.scannerDismissedAssetIds, assetId],
    };
  }),
  setScannerFilterClass: (cls) => set({ scannerFilterClass: cls }),
  setExecutorExpanded: (expanded) => set({ executorExpanded: expanded }),
  setMonitorExpanded: (expanded) => set({ monitorExpanded: expanded }),
  setLastOverallStatus: (status) => set({ lastOverallStatus: status }),
  setLastPredictionStatus: (status) => set({ lastPredictionStatus: status }),
  // V10.1 NEW: lifecycle tracker persistence actions.
  // All five setters are pure state updates — no side effects. Per spec
  // `rules.rule_6`: "Toda UI debe mostrar estado lifecycle activo". By
  // persisting these values in the store, the lifecycle tracker can render
  // the last known state immediately on remount (e.g., after a section
  // switch back to "multi") instead of showing an empty state.
  setLifecycleExpanded: (expanded) => set({ lifecycleExpanded: expanded }),
  setLastLifecycleStage: (stage) => set({ lastLifecycleStage: stage }),
  setLastVerificationScore: (score) => set({ lastVerificationScore: score }),
  setLastDriftSignal: (signal) => set({ lastDriftSignal: signal }),
  setLastPredictionId: (predictionId) => set({ lastPredictionId: predictionId }),

  computeBuckets: () => {
    const { macro, oracle, capitalUSD } = get();
    if (!macro) return;

    const result = computeBucketAllocations(macro, oracle, capitalUSD);
    set({
      bucketResult: result,
      capitalRegime: result.regime.regime,
      scalingPhase: result.scalingPhase.phase,
    });
  },
}));
