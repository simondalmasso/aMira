// src/lib/oracle-fci/search.ts
// Fuzzy search with fuse.js

import Fuse from 'fuse.js';
import type { FuseOptionKey } from 'fuse.js';
import { FundMetrics } from './types';

const SEARCH_KEYS = [
  { name: 'name', weight: 0.7 },
  { name: 'categoryLabel', weight: 0.15 },
  { name: 'manager', weight: 0.10 },
  { name: 'horizonte', weight: 0.05 },
] as const;

export interface SearchResult {
  fund: FundMetrics;
  score: number; // 0 = perfect, 1 = worst
}

export class FciSearcher {
  private fuse: Fuse<FundMetrics>;

  constructor(funds: FundMetrics[]) {
    this.fuse = new Fuse(funds, {
      keys: SEARCH_KEYS as unknown as FuseOptionKey<FundMetrics>[],
      threshold: 0.4,        // typo tolerance
      ignoreLocation: true,  // matches anywhere
      includeScore: true,
      minMatchCharLength: 2,
    });
  }

  search(query: string, limit = 50): SearchResult[] {
    if (!query || query.trim().length < 2) return [];
    const results = this.fuse.search(query.trim(), { limit });
    return results.map((r) => ({
      fund: r.item,
      score: r.score ?? 1,
    }));
  }
}
