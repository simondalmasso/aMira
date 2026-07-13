// src/lib/oracle-multi/search.ts
// Fuzzy search across all assets using fuse.js.
// Searches: name (0.6), ticker (0.25), issuer (0.10), sub_category (0.05)

import Fuse from 'fuse.js';
import type { AssetMetrics } from './types';

export interface SearchResult {
  asset: AssetMetrics;
  score: number; // 0-1 (1 = exact, fuse returns 0 = perfect so we invert)
}

export class MultiAssetSearcher {
  private fuse: Fuse<AssetMetrics>;

  constructor(assets: AssetMetrics[]) {
    this.fuse = new Fuse(assets, {
      keys: [
        { name: 'name', weight: 0.6 },
        { name: 'ticker', weight: 0.25 },
        { name: 'issuer', weight: 0.10 },
        { name: 'sub_category', weight: 0.05 },
      ],
      threshold: 0.4,           // 0 = exact, 1 = anything
      ignoreLocation: true,
      includeScore: true,
      minMatchCharLength: 2,
    });
  }

  search(query: string, limit = 50): SearchResult[] {
    if (!query || query.trim().length < 2) return [];
    const results = this.fuse.search(query.trim(), { limit });
    return results.map((r) => ({
      asset: r.item,
      score: r.score == null ? 0 : Math.max(0, 1 - r.score), // invert fuse score
    }));
  }
}
