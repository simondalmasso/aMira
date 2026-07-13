// Cloudflare Workers ambient types — KV, R2, D1, etc.
// Loaded globally via tsconfig.json include "**/*.ts"

declare global {
  // Minimal KVNamespace interface (subset we use) — matches Cloudflare Workers KV
  interface KVNamespace {
    get(key: string, options?: { type?: 'text' | 'json' | 'arrayBuffer' | 'stream' }): Promise<string | null>;
    get(key: string, options: { type: 'text' }): Promise<string | null>;
    get(key: string, options: { type: 'json' }): Promise<unknown | null>;
    put(key: string, value: string, options?: { expirationTtl?: number; metadata?: unknown }): Promise<void>;
    delete(key: string): Promise<void>;
    list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
      keys: Array<{ name: string; expiration?: number; metadata?: unknown }>;
      list_complete: boolean;
      cursor?: string;
    }>;
  }
}

export {};
