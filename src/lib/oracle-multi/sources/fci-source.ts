// src/lib/oracle-multi/sources/fci-source.ts
// FCI adapter — reuses existing oracle-fci module (argentinadatos.com) and
// converts its NormalizedFund[] into the unified NormalizedAsset shape.
// Source confidence: 0.95 (regulatory, no-auth, JSON).

import { fetchAllCategories } from '@/lib/oracle-fci/fetch';
import { normalizeAndDeduplicate } from '@/lib/oracle-fci/normalize';
import { CATEGORY_LABELS, CATEGORY_ENDPOINTS, FundCategory } from '@/lib/oracle-fci/types';
import type { NormalizedAsset } from '../types';

export interface FciSourceResult {
  assets: NormalizedAsset[];
  errors: string[];
  fallback_chain: string[];
  total_raw: number;
}

const FCI_SUBCAT_MAP: Record<FundCategory, string> = {
  rentaVariable: 'rentaVariable',
  rentaFija: 'rentaFija',
  mercadoDinero: 'mercadoDinero',
  rentaMixta: 'rentaMixta',
};

export async function fetchFciAssets(): Promise<FciSourceResult> {
  const errors: string[] = [];
  const fallback_chain: string[] = ['fci_primary_fetch'];

  const fetched = await fetchAllCategories();
  fallback_chain.push(...fetched.fallbackChainUsed);
  for (const [cat, err] of Object.entries(fetched.errors)) {
    errors.push(`fci_${cat}: ${err}`);
  }

  const assets: NormalizedAsset[] = [];
  for (const cat of Object.keys(fetched.data) as FundCategory[]) {
    const raw = fetched.data[cat];
    if (!raw) continue;
    const normalized = normalizeAndDeduplicate(raw, cat, CATEGORY_LABELS[cat]);
    for (const f of normalized) {
      // FCI patrimonio is already in ARS (millions). Normalize: keep as ARS millions for ranking.
      const marketCapArs = f.patrimonio > 0 ? f.patrimonio * 1_000_000 : null;
      assets.push({
        id: `FCI:${f.name}`,
        asset_class: 'FCI',
        name: f.name,
        ticker: undefined,
        sub_category: FCI_SUBCAT_MAP[cat],
        currency: f.currency,
        date: f.date,
        price: f.vcp,
        volume: f.ccp,
        market_cap_ars: marketCapArs,
        issuer: f.manager,
        source: 'ARGENTINADATOS_FCI',
      });
    }
  }

  if (assets.length === 0) {
    fallback_chain.push('fci_no_data');
  }

  return {
    assets,
    errors,
    fallback_chain,
    total_raw: fetched.totalRecords,
  };
}

export const FCI_SOURCE_CONFIDENCE = 0.95;
export const FCI_EVIDENCE_URLS: string[] = Object.values(CATEGORY_ENDPOINTS);
