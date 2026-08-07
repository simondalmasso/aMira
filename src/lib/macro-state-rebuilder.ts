// Temporal validation fixture built from explicitly reconstructed macro anchors.
// No value in this module is represented as an observed API response.

import type { MacroState, DataLabel, DataProvenance } from './live-data';
import type { CapitalRegime } from './capital-buckets';

export const REBUILDER_DATA_ORIGIN = 'TRAINING_MEMORY_ESTIMATE' as const;

export interface RebuiltMacroState extends MacroState {
  snapshotDate: string;
  periodLabel: string;
  actualRegime: CapitalRegime;
  actualPortfolioReturnUSD: number;
  actualMaxDrawdownUSD: number;
  events: string[];
  dataQuality: 'RECONSTRUIDO' | 'SIMULADO' | 'INTERPOLATED';
  reconstructionConfidence: number;
  dataOrigin: typeof REBUILDER_DATA_ORIGIN;
  fetchedFromAPI: false;
  apiResponseAvailable: false;
}

interface Anchor {
  date: string;
  label: string;
  mep: number;
  official: number;
  inflation: number;
  policy: number;
  moneyMarket: number;
  crawlingPeg: number;
  actualRegime: CapitalRegime;
  actualReturnUSD: number;
  actualMaxDD: number;
  confidence: number;
  events: string[];
}

// These points are approximate reconstruction anchors, not market observations.
const ANCHORS: readonly Anchor[] = [
  { date:'2018-01', label:'Pre-crisis', mep:20, official:19, inflation:1.8, policy:28, moneyMarket:27, crawlingPeg:1.5, actualRegime:'NORMAL', actualReturnUSD:0.4, actualMaxDD:1.5, confidence:0.72, events:['Pre-crisis baseline'] },
  { date:'2018-08', label:'2018 FX crisis', mep:38, official:30, inflation:3.7, policy:60, moneyMarket:55, crawlingPeg:5, actualRegime:'CRISIS', actualReturnUSD:-7.5, actualMaxDD:14, confidence:0.82, events:['FX crisis', 'IMF programme', 'Emergency rate hikes'] },
  { date:'2019-08', label:'PASO shock', mep:60, official:55, inflation:4, policy:74, moneyMarket:68, crawlingPeg:4, actualRegime:'CRISIS', actualReturnUSD:-8, actualMaxDD:16, confidence:0.80, events:['PASO election shock', 'Capital controls'] },
  { date:'2020-03', label:'COVID shock', mep:90, official:65, inflation:3.3, policy:38, moneyMarket:30, crawlingPeg:2, actualRegime:'CRISIS', actualReturnUSD:-6, actualMaxDD:13, confidence:0.78, events:['COVID lockdown', 'Global risk-off'] },
  { date:'2020-10', label:'Pandemic FX stress', mep:165, official:78, inflation:3.8, policy:38, moneyMarket:32, crawlingPeg:2.5, actualRegime:'CRISIS', actualReturnUSD:-4, actualMaxDD:9, confidence:0.78, events:['Parallel FX gap spike'] },
  { date:'2021-12', label:'Post-pandemic controls', mep:200, official:103, inflation:3.8, policy:38, moneyMarket:34, crawlingPeg:2, actualRegime:'HIGH_VOL', actualReturnUSD:-1.5, actualMaxDD:5, confidence:0.74, events:['Persistent capital controls'] },
  { date:'2022-07', label:'2022 political stress', mep:300, official:130, inflation:7.4, policy:60, moneyMarket:55, crawlingPeg:4, actualRegime:'CRISIS', actualReturnUSD:-6, actualMaxDD:12, confidence:0.82, events:['Ministerial crisis', 'Inflation acceleration'] },
  { date:'2022-12', label:'2022 inflation peak', mep:340, official:177, inflation:5.1, policy:75, moneyMarket:68, crawlingPeg:5, actualRegime:'HIGH_VOL', actualReturnUSD:-1, actualMaxDD:5, confidence:0.82, events:['Annual inflation near triple digits'] },
  { date:'2023-08', label:'2023 PASO shock', mep:690, official:350, inflation:12.4, policy:118, moneyMarket:105, crawlingPeg:8, actualRegime:'CRISIS', actualReturnUSD:-9, actualMaxDD:18, confidence:0.85, events:['PASO devaluation shock'] },
  { date:'2023-12', label:'Regime transition', mep:1000, official:800, inflation:25.5, policy:100, moneyMarket:90, crawlingPeg:20, actualRegime:'CRISIS', actualReturnUSD:-10, actualMaxDD:20, confidence:0.85, events:['Large official devaluation', 'Price-level adjustment'] },
  { date:'2024-06', label:'Disinflation phase', mep:1350, official:910, inflation:4.6, policy:40, moneyMarket:33, crawlingPeg:2, actualRegime:'HIGH_VOL', actualReturnUSD:0.3, actualMaxDD:4, confidence:0.78, events:['Disinflation', 'Fiscal adjustment'] },
  { date:'2024-12', label:'Stabilisation', mep:1160, official:1030, inflation:2.7, policy:32, moneyMarket:27, crawlingPeg:2, actualRegime:'NORMAL', actualReturnUSD:1.2, actualMaxDD:2.5, confidence:0.76, events:['FX gap compression'] },
  { date:'2025-06', label:'Carry recovery', mep:1220, official:1180, inflation:1.8, policy:29, moneyMarket:26, crawlingPeg:1, actualRegime:'CARRY_FAVORABLE', actualReturnUSD:1.5, actualMaxDD:1.8, confidence:0.68, events:['Carry regime reconstruction'] },
  { date:'2025-12', label:'Late-2025 baseline', mep:1370, official:1300, inflation:2.2, policy:31, moneyMarket:28, crawlingPeg:1, actualRegime:'NORMAL', actualReturnUSD:0.8, actualMaxDD:2.2, confidence:0.62, events:['Reconstructed late-2025 baseline'] },
  { date:'2026-06', label:'Current reconstruction boundary', mep:1445, official:1380, inflation:2.5, policy:33, moneyMarket:30, crawlingPeg:1, actualRegime:'NORMAL', actualReturnUSD:0.7, actualMaxDD:2.3, confidence:0.55, events:['End of reconstructed coverage'] },
];

const monthIndex = (date: string): number => {
  const [year, month] = date.split('-').map(Number);
  return year * 12 + month - 1;
};
const monthString = (index: number): string => `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}`;
const lerp = (start: number, end: number, ratio: number): number => start + (end - start) * ratio;
const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

function nearestRegime(left: Anchor, right: Anchor, ratio: number): CapitalRegime {
  return ratio < 0.5 ? left.actualRegime : right.actualRegime;
}

function provenance(date: string, quality: RebuiltMacroState['dataQuality'], transformation: string): DataProvenance {
  const now = new Date().toISOString();
  return {
    label: 'RECONSTRUIDO' as DataLabel,
    dataClass: 'RECONSTRUCTED',
    source: `${REBUILDER_DATA_ORIGIN} — no API fetch`,
    url: 'N/A',
    lastUpdate: now,
    dataDate: date,
    stalenessHours: 999,
    fetchedAt: now,
    ageMinutes: 0,
    fetchError: false,
    observedAt: null,
    coverage: 'none',
    limitations: ['Historical macro fixture; not suitable for precise PnL replication.'],
    transformations: [quality === 'INTERPOLATED' ? 'Linear interpolation between reconstructed anchors.' : transformation],
  };
}

function rebuildMonth(index: number, cerIndex: number): RebuiltMacroState {
  const rightIndex = ANCHORS.findIndex((anchor) => monthIndex(anchor.date) >= index);
  const right = rightIndex < 0 ? ANCHORS.at(-1)! : ANCHORS[rightIndex];
  const left = rightIndex <= 0 ? ANCHORS[0] : ANCHORS[rightIndex - 1];
  const leftIndex = monthIndex(left.date);
  const rightMonth = monthIndex(right.date);
  const ratio = rightMonth === leftIndex ? 0 : (index - leftIndex) / (rightMonth - leftIndex);
  const date = monthString(index);
  const isAnchor = ANCHORS.some((anchor) => anchor.date === date);
  const quality: RebuiltMacroState['dataQuality'] = isAnchor ? 'RECONSTRUIDO' : 'INTERPOLATED';
  const anchor = ANCHORS.find((item) => item.date === date);
  const mep = lerp(left.mep, right.mep, ratio);
  const official = lerp(left.official, right.official, ratio);
  const inflation = lerp(left.inflation, right.inflation, ratio);
  const policy = lerp(left.policy, right.policy, ratio);
  const moneyMarket = lerp(left.moneyMarket, right.moneyMarket, ratio);
  const crawlingPeg = lerp(left.crawlingPeg, right.crawlingPeg, ratio);
  const actualRegime = anchor?.actualRegime ?? nearestRegime(left, right, ratio);
  const actualReturnUSD = lerp(left.actualReturnUSD, right.actualReturnUSD, ratio);
  const actualMaxDD = lerp(left.actualMaxDD, right.actualMaxDD, ratio);
  const confidence = Math.max(0.35, lerp(left.confidence, right.confidence, ratio) - (isAnchor ? 0 : 0.08));
  const now = new Date().toISOString();
  const fieldProvenance = provenance(date, quality, 'Reconstructed anchor from public historical summaries.');

  return {
    snapshotDate: date,
    periodLabel: anchor?.label ?? `Interpolated ${date}`,
    lastUpdate: now,
    fetchedAt: now,
    ageMinutes: 0,
    lastSuccessfulFetch: null,
    source: 'PARTIAL_FALLBACK',
    mep: {
      rate: round(mep), officialRate: round(official),
      gap: round((mep - official) / official * 100),
      sell: round(mep * 1.01), buy: round(mep * 0.99),
    },
    inflation: {
      monthly: round(inflation),
      expected30d: round(inflation),
      expected90d: round(inflation * 3),
      yearly: round((Math.pow(1 + inflation / 100, 12) - 1) * 100),
    },
    rates: {
      bcraPolicy: round(policy), moneyMarket: round(moneyMarket),
      plazoFijo: round(Math.max(0, moneyMarket - 4)), plazoFijoUVA: 1,
      lecaps: round(policy + 2), badlar: round(Math.max(0, moneyMarket - 2)),
      leliq: round(policy), tml: round(Math.max(0, moneyMarket - 3)),
    },
    cer: {
      index: round(cerIndex), monthlyChange: round(Math.max(0, inflation - 0.3)),
      dailyChange: round(Math.max(0, inflation - 0.3) / 30, 4),
    },
    crawlingPeg: round(crawlingPeg),
    realDataPct: 0,
    provenance: {
      mepRate: { ...fieldProvenance }, inflation: { ...fieldProvenance },
      rates: { ...fieldProvenance }, cer: { ...fieldProvenance },
      crawlingPeg: { ...fieldProvenance }, reserves: { ...fieldProvenance },
    },
    actualRegime,
    actualPortfolioReturnUSD: round(actualReturnUSD),
    actualMaxDrawdownUSD: round(actualMaxDD),
    events: anchor?.events ?? [],
    dataQuality: quality,
    reconstructionConfidence: round(confidence, 2),
    dataOrigin: REBUILDER_DATA_ORIGIN,
    fetchedFromAPI: false,
    apiResponseAvailable: false,
  };
}

function buildHistory(): RebuiltMacroState[] {
  const start = monthIndex('2018-01');
  const end = monthIndex('2026-06');
  const snapshots: RebuiltMacroState[] = [];
  let cerIndex = 80;
  for (let index = start; index <= end; index++) {
    const snapshot = rebuildMonth(index, cerIndex);
    snapshots.push(snapshot);
    cerIndex *= 1 + snapshot.cer.monthlyChange / 100;
  }
  return snapshots;
}

export const HISTORICAL_MONTHLY: RebuiltMacroState[] = buildHistory();

export interface SurvivalTestScenario {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  description: string;
  question: string;
  snapshots: RebuiltMacroState[];
}

export function getSnapshotsInRange(start: string, end: string): RebuiltMacroState[] {
  return HISTORICAL_MONTHLY.filter((snapshot) => snapshot.snapshotDate >= start && snapshot.snapshotDate <= end);
}

export function getSurvivalTests(): SurvivalTestScenario[] {
  const definitions = [
    ['survival-2018-fx-crisis','2018 FX Crisis','2018-04','2018-12','FX run, IMF programme and emergency rate hikes.','¿Sobreviviría el sistema la crisis cambiaria de 2018?'],
    ['survival-2020-covid','2020 COVID Crash','2020-02','2020-12','Pandemic lockdown, global risk-off and FX stress.','¿Sobreviviría el sistema el shock COVID de 2020?'],
    ['survival-2022-inflation','2022 Inflation Spike','2022-01','2022-12','Inflation acceleration and political stress.','¿Sobreviviría el sistema el pico inflacionario de 2022?'],
    ['survival-2023-paso','2023 PASO + transition','2023-06','2023-12','Election shock and large official devaluation.','¿Sobreviviría el sistema la transición de 2023?'],
  ] as const;
  return definitions.map(([id, name, periodStart, periodEnd, description, question]) => ({
    id, name, periodStart, periodEnd, description, question,
    snapshots: getSnapshotsInRange(periodStart, periodEnd),
  }));
}

export function getHistoricalDatasetStats(): {
  totalSnapshots: number;
  dateRange: { start: string; end: string };
  regimeDistribution: Record<CapitalRegime, number>;
  avgReconstructionConfidence: number;
  crisisPeriods: number;
  avgReturnByRegime: Record<CapitalRegime, number>;
} {
  const regimeDistribution: Record<CapitalRegime, number> = { CRISIS:0, HIGH_VOL:0, NORMAL:0, CARRY_FAVORABLE:0 };
  const returns: Record<CapitalRegime, number[]> = { CRISIS:[], HIGH_VOL:[], NORMAL:[], CARRY_FAVORABLE:[] };
  for (const snapshot of HISTORICAL_MONTHLY) {
    regimeDistribution[snapshot.actualRegime]++;
    returns[snapshot.actualRegime].push(snapshot.actualPortfolioReturnUSD);
  }
  const avgReturnByRegime = Object.fromEntries(Object.entries(returns).map(([regime, values]) => [
    regime,
    values.length === 0 ? 0 : round(values.reduce((sum, value) => sum + value, 0) / values.length),
  ])) as Record<CapitalRegime, number>;
  return {
    totalSnapshots: HISTORICAL_MONTHLY.length,
    dateRange: { start:HISTORICAL_MONTHLY[0]?.snapshotDate ?? '', end:HISTORICAL_MONTHLY.at(-1)?.snapshotDate ?? '' },
    regimeDistribution,
    avgReconstructionConfidence: round(HISTORICAL_MONTHLY.reduce((sum, item) => sum + item.reconstructionConfidence, 0) / HISTORICAL_MONTHLY.length),
    crisisPeriods: regimeDistribution.CRISIS,
    avgReturnByRegime,
  };
}
