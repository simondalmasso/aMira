'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useHedgeFundStore } from '@/store/hedge-fund-store';
import type { DataLabel } from '@/lib/live-data';

// ============================================================================
// Provenance info per API response
// ============================================================================
interface ProvenanceEntry {
  label: DataLabel;
  source: string;
  url: string;
  lastUpdate: string;
  dataDate: string;
  stalenessHours: number;
  fetchedAt: string;
  ageMinutes: number;
  fetchError: boolean;
}

interface MacroAPIResponse {
  success: boolean;
  source: 'OBSERVADO' | 'REAL' | 'PARTIAL_FALLBACK' | 'ERROR' | 'STALE' | 'ERROR';
  timestamp: string;
  fetchedAt: string;
  ageMinutes: number;
  lastSuccessfulFetch: string | null;
  provenance: Record<string, ProvenanceEntry>;
  realDataPct: number;
  mep: { rate: number; officialRate: number; gap: number; sell: number; buy: number };
  inflation: { monthly: number; expected30d: number; expected90d: number; yearly: number };
  rates: { bcraPolicy: number; moneyMarket: number; plazoFijo: number; plazoFijoUVA: number };
  cer: { index: number; monthlyChange: number };
  crawlingPeg: number;
  carry: { arsCarry30d: number; netCarry: number; viable: boolean; spreadReal: number };
  scenarios: { id: string; name: string; emoji: string; probability: number; inflation30d: number; devaluation30d: number; description: string }[];
}

// ============================================================================
// Badge style map — single source of truth for all 6 states
// ============================================================================
const TAG_STYLE: Record<string, string> = {
  OBSERVADO: 'bg-[#0066cc] text-[#ffffff]',
  REAL:      'bg-[#16a34a] text-[#ffffff]',
  PARTIAL_FALLBACK:    'bg-[#999999] text-[#ffffff]',
  SIMULADO:  'bg-[#ca8a04] text-[#ffffff]',
  STALE:     'bg-[#dc2626] text-[#ffffff]',
  ERROR:     'bg-[#7f1d1d] text-[#ffffff]',
};

export function MacroEnginePanel() {
  const { dataMode } = useHedgeFundStore();
  const [macroData, setMacroData] = useState<MacroAPIResponse | null>(null);
  const [tick, setTick] = useState(0);

  // Fetch macro data
  const fetchMacro = useCallback(() => {
    fetch('/api/macro')
      .then(res => res.json())
      .then(data => { if (data.success) setMacroData(data); })
      .catch(() => {});
  }, []);

  useEffect(() => { fetchMacro(); }, [fetchMacro]);

  // Auto-refresh every 60s
  useEffect(() => {
    const interval = setInterval(() => { fetchMacro(); }, 60000);
    return () => clearInterval(interval);
  }, [fetchMacro]);

  // Tick every 30s to update ageMinutes display
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  const mep = macroData?.mep;
  const inflation = macroData?.inflation;
  const rates = macroData?.rates;
  const cer = macroData?.cer;
  const carry = macroData?.carry;
  const crawlingPeg = macroData?.crawlingPeg;
  const prov = macroData?.provenance;

  // Compute live age from fetchedAt
  const computeAgeMin = (fetchedAt?: string): number | null => {
    if (!fetchedAt) return null;
    void tick; // dependency for re-render
    return Math.round((Date.now() - new Date(fetchedAt).getTime()) / 60000);
  };

  const globalAgeMin = computeAgeMin(macroData?.fetchedAt);

  // Per-indicator provenance tag — reads from provenance, NOT hardcoded
  const getTag = (provKey: string): DataLabel => {
    if (!prov || !prov[provKey]) return 'ERROR';
    return prov[provKey].label;
  };

  // Per-indicator age — reads from provenance.fetchedAt
  const getIndicatorAge = (provKey: string): number | null => {
    if (!prov || !prov[provKey]) return null;
    return computeAgeMin(prov[provKey].fetchedAt);
  };

  // Per-indicator data date — shows when the actual data is FROM (not fetch time)
  const getDataDate = (provKey: string): string | null => {
    if (!prov || !prov[provKey]) return null;
    const dd = prov[provKey].dataDate;
    if (!dd || dd === new Date().toISOString().split('T')[0]) return null; // Skip if today
    return dd;
  };

  const indicators = [
    { label: 'Inflación mensual', value: inflation ? `${inflation.monthly.toFixed(1)}%` : '--', sub: `Esp. 30d: ${inflation?.expected30d.toFixed(1) || '--'}%`, status: (inflation?.monthly || 99) <= 3 ? 'stable' : 'warning', provKey: 'inflation' },
    { label: 'Tasa BCRA', value: rates ? `${rates.bcraPolicy.toFixed(1)}%` : '--', sub: 'TNA Política', status: 'stable' as const, provKey: 'rates' },
    { label: 'Crawling peg', value: crawlingPeg !== undefined && crawlingPeg !== null ? `${crawlingPeg.toFixed(1)}%/mes` : '--', sub: 'Devaluación programada', status: (crawlingPeg || 99) <= 2 ? 'stable' as const : 'warning' as const, provKey: 'crawlingPeg' },
    { label: 'Dólar blue', value: mep ? `$${mep.rate.toFixed(0)}` : '--', sub: `Oficial: $${mep?.officialRate.toFixed(0) || '--'}`, status: 'stable' as const, provKey: 'mepRate' },
    { label: 'Brecha blue/oficial', value: mep ? `${mep.gap.toFixed(1)}%` : '--', sub: 'Riesgo cambiario', status: (mep?.gap || 99) <= 15 ? 'stable' as const : 'warning' as const, provKey: 'mepRate' },
    { label: 'Índice CER', value: cer ? cer.index.toFixed(1) : '--', sub: `Var: ${cer?.monthlyChange.toFixed(1) || '--'}%/mes`, status: 'stable' as const, provKey: 'cer' },
    { label: 'TNA Money Market', value: rates ? `${rates.moneyMarket.toFixed(1)}%` : '--', sub: 'FCI Liquidez', status: 'stable' as const, provKey: 'rates' },
    { label: 'Premium PF UVA', value: rates ? `${rates.plazoFijoUVA.toFixed(1)}%` : '--', sub: 'Sobre CER', status: 'stable' as const, provKey: 'rates' },
  ];

  const statusDot: Record<string, string> = {
    stable: 'bg-[#16a34a]',
    warning: 'bg-[#ca8a04]',
    danger: 'bg-[#dc2626]',
  };

  const carryViable = carry?.viable ?? true;
  const netCarry = carry?.netCarry ?? 0;
  const spreadReal = carry?.spreadReal ?? -10;
  const moneyMarketTNA = rates?.moneyMarket ?? 31.5;
  const inflationMonthly = inflation?.monthly ?? 3.2;

  // Carry tag: derived from rates + inflation provenance
  const carryTag: DataLabel = (() => {
    const ratesTag = getTag('rates');
    const inflTag = getTag('inflation');
    if (ratesTag === 'ERROR' || inflTag === 'ERROR') return 'ERROR';
    if (ratesTag === 'STALE' || inflTag === 'STALE') return 'STALE';
    if (ratesTag === 'REAL' && inflTag === 'REAL') return 'REAL';
    if (ratesTag === 'PARTIAL_FALLBACK' || inflTag === 'PARTIAL_FALLBACK') return 'PARTIAL_FALLBACK';
    return 'ERROR';
  })();

  return (
    <div className="py-4 space-y-4">
      {/* Badge Fuente de Datos + Freshness */}
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-[#999999] uppercase tracking-[0.2em]">
          Indicadores — Argentina
        </p>
        <div className="flex items-center gap-1.5">
          {globalAgeMin !== null && globalAgeMin < 9999 && (
            <span className="text-[8px] font-semibold text-[#999999]">
              actualizado hace {globalAgeMin < 1 ? '<1' : globalAgeMin} min
            </span>
          )}
          {macroData?.lastSuccessfulFetch && (
            <span className="text-[7px] font-medium text-[#bbbbbb]">
              (último fetch real: {new Date(macroData.lastSuccessfulFetch).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })})
            </span>
          )}
          <span className={`text-[10px] font-bold px-3 py-1 rounded-full tracking-[0.15em] ${TAG_STYLE[dataMode] || TAG_STYLE.SIMULADO}`}>
            {dataMode}
          </span>
        </div>
      </div>

      {/* Indicadores Macro — per-indicator provenance + inline timestamps */}
      <div className="space-y-0">
        {indicators.map((ind, i) => {
          const tag = getTag(ind.provKey);
          const age = getIndicatorAge(ind.provKey);
          const dataDate = getDataDate(ind.provKey);
          return (
            <motion.div
              key={ind.label}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.02 }}
              className="flex items-center justify-between py-2.5 px-1 border-b border-[#eaeaea] last:border-0"
            >
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${statusDot[ind.status]}`} />
                <div>
                  <p className="text-[13px] font-bold text-[#000000]">{ind.label}</p>
                  <div className="flex items-center gap-1.5">
                    <p className="text-[11px] font-medium text-[#999999]">{ind.sub}</p>
                    {age !== null && age < 9999 && (
                      <span className="text-[9px] font-semibold text-[#bbbbbb]">
                        · hace {age < 1 ? '<1' : age}m
                      </span>
                    )}
                    {dataDate && (
                      <span className="text-[8px] font-semibold text-[#ca8a04]">
                        · dato: {dataDate}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[8px] font-bold px-1 py-0.5 rounded ${TAG_STYLE[tag] || TAG_STYLE.SIMULADO}`}>
                  {tag}
                </span>
                <p className="text-[17px] font-extrabold text-[#000000]">{ind.value}</p>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Carry Trade KPI */}
      <div className="rounded-lg p-4 border border-[#eaeaea] bg-[#ffffff]">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[11px] font-semibold text-[#999999] uppercase tracking-[0.2em]">
            Viabilidad carry trade
          </p>
          <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${TAG_STYLE[carryTag] || TAG_STYLE.PARTIAL_FALLBACK}`}>
            {carryTag}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[21px] font-extrabold text-[#000000] leading-none">
              {(moneyMarketTNA / 12).toFixed(2)}%
            </p>
            <p className="text-[10px] font-semibold text-[#999999] uppercase tracking-[0.15em] mt-1">Carry ARS 30d</p>
          </div>
          <div>
            <p className="text-[21px] font-extrabold leading-none text-[#000000]">
              {netCarry.toFixed(2)}%
            </p>
            <p className="text-[10px] font-semibold text-[#999999] uppercase tracking-[0.15em] mt-1">Carry neto</p>
          </div>
          <div>
            <p className="text-[21px] font-extrabold leading-none text-[#000000]">
              {spreadReal.toFixed(1)}%
            </p>
            <p className="text-[10px] font-semibold text-[#999999] uppercase tracking-[0.15em] mt-1">Spread real</p>
          </div>
          <div>
            <p className={`text-[21px] font-extrabold leading-none ${
              carryViable ? 'text-[#16a34a]' : 'text-[#dc2626]'
            }`}>
              {carryViable ? 'VIABLE' : 'NO'}
            </p>
            <p className="text-[10px] font-semibold text-[#999999] uppercase tracking-[0.15em] mt-1">Veredicto</p>
          </div>
        </div>
      </div>

      {/* Spread real chart */}
      <div className="border border-[#eaeaea] rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[11px] font-semibold text-[#999999] uppercase tracking-[0.2em]">
            Spread real (TNA vs Inflación)
          </p>
          <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${TAG_STYLE[carryTag] || TAG_STYLE.PARTIAL_FALLBACK}`}>
            {carryTag}
          </span>
        </div>
        <div className="flex items-end gap-4 h-28">
          <div className="flex-1 flex flex-col items-center">
            <div
              className="w-full bg-[#000000] rounded-t-md"
              style={{ height: `${(moneyMarketTNA / 50) * 100}%` }}
            />
            <p className="text-[10px] font-semibold text-[#999999] mt-2">TNA</p>
            <p className="text-[13px] font-bold text-[#000000]">{moneyMarketTNA.toFixed(1)}%</p>
          </div>
          <div className="flex-1 flex flex-col items-center">
            <div
              className="w-full bg-[#ca8a04] rounded-t-md"
              style={{ height: `${(inflationMonthly * 12 / 50) * 100}%` }}
            />
            <p className="text-[10px] font-semibold text-[#999999] mt-2">Inflación*</p>
            <p className="text-[13px] font-bold text-[#000000]">{(inflationMonthly * 12).toFixed(1)}%</p>
          </div>
          <div className="flex-1 flex flex-col items-center">
            <div
              className="w-full rounded-t-md"
              style={{ height: `${Math.max(8, ((spreadReal / 20 + 0.5) * 100))}%`, backgroundColor: spreadReal > 0 ? '#16a34a' : '#dc2626' }}
            />
            <p className="text-[10px] font-semibold text-[#999999] mt-2">Spread</p>
            <p className="text-[13px] font-bold text-[#000000]">
              {spreadReal > 0 ? '+' : ''}{spreadReal.toFixed(1)}%
            </p>
          </div>
        </div>
        <p className="text-[10px] font-semibold text-[#999999] mt-2">*Anualizada</p>
      </div>

      {/* Fuentes de Datos — with per-source provenance */}
      <div className="border border-[#eaeaea] rounded-lg p-4">
        <p className="text-[11px] font-semibold text-[#999999] uppercase tracking-[0.2em] mb-3">
          Fuentes de datos
        </p>
        <div className="space-y-2">
          <SourceItem
            name="Bluelytics API"
            url="api.bluelytics.com.ar"
            tag={getTag('mepRate')}
            age={getIndicatorAge('mepRate')}
            dataDate={getDataDate('mepRate')}
            fetchError={prov?.mepRate?.fetchError ?? false}
          />
          <SourceItem
            name="BCRA Tasas"
            url="bcra.gob.ar"
            tag={getTag('rates')}
            age={getIndicatorAge('rates')}
            dataDate={getDataDate('rates')}
            fetchError={prov?.rates?.fetchError ?? false}
          />
          <SourceItem
            name="INDEC Inflación"
            url="indec.gob.ar"
            tag={getTag('inflation')}
            age={getIndicatorAge('inflation')}
            dataDate={getDataDate('inflation')}
            fetchError={prov?.inflation?.fetchError ?? false}
          />
          <SourceItem
            name="BCRA CER"
            url="bcra.gob.ar"
            tag={getTag('cer')}
            age={getIndicatorAge('cer')}
            dataDate={getDataDate('cer')}
            fetchError={prov?.cer?.fetchError ?? false}
          />
          <SourceItem
            name="Santander"
            url="superfondos.santander.com.ar"
            tag="ERROR"
            age={null}
            dataDate={null}
            fetchError={false}
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// SourceItem — per-source status with provenance tag + age
// ============================================================================
function SourceItem({ name, url, tag, age, dataDate, fetchError }: {
  name: string;
  url: string;
  tag: string;
  age: number | null;
  dataDate: string | null;
  fetchError: boolean;
}) {
  const dotColor = fetchError ? 'bg-[#7f1d1d]' :
    tag === 'REAL' ? 'bg-[#16a34a]' :
    tag === 'STALE' ? 'bg-[#dc2626]' :
    tag === 'ERROR' ? 'bg-[#7f1d1d]' :
    tag === 'PARTIAL_FALLBACK' ? 'bg-[#999999]' :
    'bg-[#ca8a04]';

  const statusLabel = fetchError ? 'Error' :
    tag === 'REAL' ? 'En vivo' :
    tag === 'STALE' ? 'Desactualizado' :
    tag === 'ERROR' ? 'Error' :
    tag === 'PARTIAL_FALLBACK' ? 'Modelo' :
    'Simulado';

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className={`w-2 h-2 rounded-full ${dotColor}`} />
        <div>
          <p className="text-[12px] font-bold text-[#000000]">{name}</p>
          <div className="flex items-center gap-1.5">
            <p className="text-[10px] font-medium text-[#999999]">{url}</p>
            {age !== null && age < 9999 && (
              <span className="text-[8px] font-semibold text-[#bbbbbb]">
                · hace {age < 1 ? '<1' : age}m
              </span>
            )}
            {dataDate && (
              <span className="text-[8px] font-semibold text-[#ca8a04]">
                · dato: {dataDate}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className={`text-[8px] font-bold px-1 py-0.5 rounded ${TAG_STYLE[tag] || TAG_STYLE.SIMULADO}`}>
          {tag}
        </span>
        <span className="text-[10px] font-bold text-[#999999] uppercase tracking-[0.15em]">{statusLabel}</span>
      </div>
    </div>
  );
}
