// src/lib/amira-prediction-lifecycle.ts
// Client-only React adapter for the server-safe lifecycle core.

'use client';

import { useMemo, useSyncExternalStore } from 'react';
import {
  getLifecycleSnapshot,
  getLifecycleVersion,
  subscribeLifecycle,
  type LifecycleSnapshot,
} from './amira-prediction-lifecycle-core';

export * from './amira-prediction-lifecycle-core';

export function useLifecycleVersion(): number {
  return useSyncExternalStore(
    subscribeLifecycle,
    getLifecycleVersion,
    getLifecycleVersion,
  );
}

export function useLifecycleSnapshot(): LifecycleSnapshot {
  const version = useLifecycleVersion();
  return useMemo(() => getLifecycleSnapshot(), [version]);
}
