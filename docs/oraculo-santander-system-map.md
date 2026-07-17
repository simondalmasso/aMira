# Oráculo Santander — System Map and Executed Baseline

## Mission boundary

Repository: `simonkey888/aMira` (private). Mandatory base: `a76be0d2d1272b533c2fcfbb6d285718def8f6cc` (`ci: add initial loading state deployment workflow`). Working branch: `feat/oraculo-santander-completion-sol`.

The product is an Argentina-focused analytical oracle. Financial execution is PAPER only. No real broker integration, custody, real order routing, production deploy, merge, or tag is permitted in this branch.

## Executed baseline identity

The exact branch baseline was captured by GitHub Actions run `29598175125`. The workflow explicitly checked out the pull request head SHA rather than GitHub's synthetic merge commit.

- `git rev-parse HEAD`: `86351b54690b5603c1f74b41151bde72fb59dc0f`
- `git status --short --branch`: `## HEAD (no branch)` followed only by `?? validation-evidence/`; the untracked directory is created by the evidence workflow after checkout. No repository file was dirty at checkout.
- Node: `v22.23.1`
- Bun: `1.3.14`
- Package manager: Bun
- Root lockfile: `bun.lock`
- Additional isolated lockfile: `santaninverter-oracle/bun.lock`
- Evidence artifact ID: `8413936539`
- Evidence artifact digest: `sha256:77b9efb4b7227935243812a36d80768fd8f0a92296b1459667cda9df2ad079c8`

## Literal baseline commands and results

| Gate | Literal command | Exit | Executed result |
|---|---|---:|---|
| Global TypeScript | `bunx tsc --noEmit --pretty false` | 2 | 84 diagnostics: 7 canonical, 4 scripts, 19 tests, 2 examples, 38 legacy subproject, 14 unreferenced root Worker. |
| Lint | `bun run lint` (`eslint .`) | 1 | 38 problems: 22 errors and 16 warnings. Canonical React-hook/compiler errors, one telemetry `require()` error, test `require()` errors, and generated/legacy warnings. |
| Existing tests | `bun test` | 1 | 442 tests executed: 431 pass, 11 fail, 2,814 assertions. Failures are architectural/fallback contract tests, not runner failure. |
| Existing hardening harness | `node scripts/hardening/run-all.mjs` | 1 | Harness contains stale absolute paths (`/home/z/my-project/...`), reports false missing-file/binding findings, then fails writing `HARDENING_REPORT.json`. It is not reliable release evidence in its current form. |
| Next build | `bun run build` | 0 | Next.js 16.1.3 production build completed. It explicitly reported `Skipping validation of types`; build success is not typecheck evidence. |
| OpenNext build | `bunx opennextjs-cloudflare build` | 0 | OpenNext Cloudflare 1.19.11 generated `.open-next/worker.js`; workerd compatibility date `2026-06-16`. |
| Cron wrapper | `node scripts/wrap-worker-with-cron.mjs` | 0 | Generated `.open-next/worker-with-cron.js`; scheduled handler reports five jobs. |

No deploy or production credential operation was executed.

## Canonical runtime decision

The canonical deployable runtime is the root Next.js application compiled by OpenNext and wrapped for Cloudflare scheduled execution.

1. Root `package.json` runs `opennextjs-cloudflare build`.
2. OpenNext compiles the Next application routes under `src/app` and emits `.open-next/worker.js` plus `.open-next/assets`.
3. `scripts/wrap-worker-with-cron.mjs` imports `./worker.js`, preserves its `fetch` handler, and adds `scheduled()`; it emits `.open-next/worker-with-cron.js`.
4. Root `wrangler.jsonc` sets `main` to `.open-next/worker-with-cron.js`, assets to `.open-next/assets`, declares the service/KV bindings, and declares the cron trigger.
5. The official historical deployment workflow validates this same chain and invokes Wrangler against root `wrangler.jsonc`.

Root `src/worker.ts` is not imported by the Next application, OpenNext configuration, wrapper, root Wrangler configuration, package scripts, or workflows. It is a divergent single-file Worker with overlapping `/api/*` semantics. It is therefore classified as an unreferenced alternate runtime pending archival/removal evidence, not as production code.

`./santaninverter-oracle/` is a second, self-contained package with its own `package.json`, `bun.lock`, `tsconfig.json`, and `wrangler.toml` whose `main` is `src/worker.ts`. It is technically deployable on its own, but it is not consumed by the root OpenNext pipeline. It is classified as a legacy standalone subproject. It must not be compiled accidentally by the root TypeScript project or linted as generated root application code. Its history must be preserved until the duplicate contracts are compared and any unique functionality is migrated.

## Build route inventory

The successful Next/OpenNext build emitted these application routes:

`/`, `/_not-found`, `/api`, `/api/audit`, `/api/backtest`, `/api/macro`, `/api/mep`, `/api/oracle/bonds`, `/api/oracle/cedears`, `/api/oracle/cron`, `/api/oracle/fci`, `/api/oracle/predictions`, `/api/oracle/rankings`, `/api/oracle/search`, `/api/oracle/single`, `/api/oracle/stocks`, `/api/paper-broker`, `/api/portfolio`, `/api/rates`, `/api/rebalance`, `/api/sync`, `/api/telemetry`, `/api/temporal-validation`, and `/api/x10`.

Root `src/worker.ts` declares `/api/macro`, `/api/x10`, `/api/regime`, `/api/backtest-lite`, and `/api/health`, demonstrating contract divergence rather than integration.

## Repository scope classification and disposition

### Canonical Next/OpenNext runtime

Scope: root `src/app`, `src/components`, `src/hooks`, `src/lib`, `src/store`, and `src/types`, excluding root `src/worker.ts` until it is archived.

Consumer: Next.js build, OpenNext build, generated Cloudflare Worker, dashboard, API routes, and cron-invoked route handlers.

Disposition: integrate and correct. This scope must reach zero TypeScript diagnostics, pass lint, have runtime schemas, and retain tests. It must not be excluded from validation.

### Operational scripts

Scope: root `scripts/` and `.zscripts/`.

Consumers: package scripts, GitHub workflows, manual release verification, evidence generation, and cron wrapping. `scripts/wrap-worker-with-cron.mjs` is part of the canonical build; other scripts vary between active operations and historical audits.

Disposition: use a dedicated `tsconfig.scripts.json`, correct active script diagnostics, replace absolute paths, and classify scripts as active or historical. Do not hide active script failures through root exclusions without a separate gate.

### Tests

Scope: `tests/hardening/*.test.ts` and test helpers.

Consumer: Bun's native test runner. Baseline proves the suite runs without adding Jest or Vitest.

Disposition: adopt Bun as the explicit runner; add `test`, `test:unit`, and `test:integration` scripts; add a dedicated tests TypeScript project with Bun types; correct unsafe casts and update obsolete architecture assertions. Failing assertions must not be converted into unconditional passes.

### Examples and fixtures

Scope: `examples/`, root `dist-test/`, `upload/`, search JSON files, and other captured evidence.

Consumer: no root package script, application import, workflow, or build consumer was found for `examples/websocket`. Its missing `socket.io` dependencies are not production dependencies.

Disposition: isolate examples from the canonical TypeScript project and give them explicit ownership/dependency metadata if retained. Generated fixtures and evidence should be lint-ignored as artifacts, not presented as product code. Archive or delete later only after repository history/consumer verification.

### Legacy standalone subproject

Scope: `santaninverter-oracle/`.

Consumer: its own `wrangler.toml`, package, lockfile, and scripts. Root OpenNext does not consume it. Root scripts such as `verify_patches.py` and historical evidence builders inspect it, which is historical tooling consumption rather than runtime integration.

Disposition: isolate with its existing TypeScript project and install its own lockfile when validating it. Compare its contracts against canonical routes, migrate unique behavior, then archive/remove in a later evidence-backed cleanup commit. Do not deploy it.

### Unreferenced alternate root Worker

Scope: root `src/worker.ts`.

Consumer: none found in package scripts, Wrangler, OpenNext, imports, or workflows.

Disposition: do not repair it as a second production runtime. Preserve temporarily, compare overlapping contracts, then archive/remove after canonical route coverage proves no unique consumer or feature remains.

## Cloudflare bindings and persistence

Root `wrangler.jsonc` declares:

- `ASSETS` for OpenNext static assets;
- service binding `MACRO_PROXY`;
- KV namespaces `ORACLE_FCI_HISTORY`, `ORACLE_ASSETS_HISTORY`, and `ORACLE_PREDICTIONS`;
- `PROXY_URL` and `NEXT_PUBLIC_PROXY_URL` variables;
- cron `0 23 * * 1-5`;
- `nodejs_compat`.

No root D1 binding is declared. Canonical code that accepts a `D1Database` is therefore an optional/unwired adapter and must not claim runtime availability. The legacy subproject has a separate D1-oriented model.

## Scheduled execution

The generated wrapper invokes the OpenNext `fetch` handler directly with internal POST requests for:

- `refresh_fci` → `/api/oracle/fci`
- `refresh_stocks` → `/api/oracle/stocks`
- `refresh_bonds` → `/api/oracle/bonds`
- `refresh_cedears` → `/api/oracle/cedears`
- `refresh_predictions` → `/api/oracle/predictions`

`snapshot_archive` remains in the endpoint map but is excluded from the scheduled list because routing it to `/api/oracle/cron` previously caused recursive full-batch execution.

The wrapper's before/after KV key-count telemetry is not a transactional proof. Overwriting an existing key can produce zero count delta, and count growth does not prove all expected writes succeeded. Versioned snapshots, idempotency keys, explicit write acknowledgements, and lock ownership remain required.

## Current logical pipeline

Target single direction:

`source adapters → normalized snapshot → integrity gate → macro state → regime detector → signals → confidence → prediction → calibration → ranking → portfolio engine → PAPER execution → PnL attribution → telemetry`.

At baseline, these concepts exist but are not yet a single typed, lineage-bearing orchestration contract. Parallel prediction/portfolio modules and two Worker implementations remain.

## Confirmed critical defects before hardening

- `/api/telemetry` casts `decisionType`, `severity`, and `eventType`; numeric query parameters are unbounded.
- `/api/paper-broker` casts order status and accepts unvalidated action payloads.
- `/api/audit` casts corrupted simulation objects into the X10 engine.
- `data-integrity.ts` contains untyped issue extraction, `Record<string, any>`, duplicated data-label union members, and `ValidationResult<any>`.
- temporal validation double-casts rebuilt snapshots and erases bucket/strategy/product literal types.
- PAPER MARKET-order cash/leverage checks use `limitPrice ?? 0`, allowing market orders to bypass the intended estimate.
- PAPER position weights mix ARS and USD market values against an ARS-only denominator.
- telemetry comments promise durable/fail-closed writes while synchronous calls silently fall back to memory when KV is absent.
- the historical rebuilder explicitly contains training-memory estimates; these cannot be reported as observed evidence.

## Baseline TypeScript diagnostic inventory

The global root configuration included every TypeScript file recursively, unintentionally combining six architectural scopes. The full 84-diagnostic inventory follows.

### Canonical Next/OpenNext runtime — 7 diagnostics
- `src/lib/amira-vision-consensus.ts:166:7` — `TS2322` — Type 'AmiraSourceObservation[]' is not assignable to type '{ freshness: number; source: AmiraSourceType; value: number; confidence: number; timestampISO: string; isStale: boolean; notes?: string | undefined; }[]'.
- `src/lib/live-data.ts:946:7` — `TS2367` — This comparison appears to be unintentional because the types '"PARTIAL_FALLBACK" | "REAL" | "STALE" | "OBSERVADO" | "SIMULADO" | "RECONSTRUIDO"' and '"ERROR"' have no overlap.
- `src/lib/macroOracle.ts:205:5` — `TS2322` — Type '"ERROR" | "PARTIAL_FALLBACK" | "REAL" | "STALE" | "OBSERVADO" | "SIMULADO" | "RECONSTRUIDO"' is not assignable to type '"ERROR" | "PARTIAL_FALLBACK" | "REAL" | "STALE" | "OBSERVADO"'.
- `src/lib/portfolio-engine.ts:427:5` — `TS2322` — Type '"ERROR" | "PARTIAL_FALLBACK" | "REAL" | "STALE" | "OBSERVADO" | "SIMULADO" | "RECONSTRUIDO"' is not assignable to type '"ERROR" | "PARTIAL_FALLBACK" | "REAL" | "STALE" | "OBSERVADO"'.
- `src/lib/portfolio-engine.ts:450:5` — `TS2322` — Type '"ERROR" | "PARTIAL_FALLBACK" | "REAL" | "STALE" | "OBSERVADO" | "SIMULADO" | "RECONSTRUIDO"' is not assignable to type '"ERROR" | "PARTIAL_FALLBACK" | "REAL" | "STALE" | "OBSERVADO"'.
- `src/lib/telemetry.ts:706:16` — `TS2552` — Cannot find name 'D1Database'. Did you mean 'IDBDatabase'?
- `src/lib/x10-signal-layer.ts:111:7` — `TS2741` — Property 'RECONSTRUIDO' is missing in type '{ OBSERVADO: number; REAL: number; PARTIAL_FALLBACK: number; SIMULADO: number; STALE: number; ERROR: number; }' but required in type 'Record<DataLabel, number>'.

### Operational scripts — 4 diagnostics
- `scripts/d-post-deploy-validation.ts:63:5` — `TS2322` — Type '{ name: string; status: string; detail: any; }[]' is not assignable to type '{ name: string; status: "PASS" | "FAIL"; detail?: string | undefined; }[]'.
- `scripts/d-post-deploy-validation.ts:158:75` — `TS2322` — Type '"PASS" | "WARN"' is not assignable to type '"PASS" | "FAIL"'.
- `scripts/d-post-deploy-validation.ts:209:44` — `TS2322` — Type '"PASS" | "WARN"' is not assignable to type '"PASS" | "FAIL"'.
- `scripts/d-post-deploy-validation.ts:219:52` — `TS2322` — Type '"WARN"' is not assignable to type '"PASS" | "FAIL"'.

### Tests — 19 diagnostics
- `tests/hardening/_smoke.test.ts:3:30` — `TS2307` — Cannot find module 'bun:test' or its corresponding type declarations.
- `tests/hardening/h10-deployment-gate.test.ts:22:40` — `TS2307` — Cannot find module 'bun:test' or its corresponding type declarations.
- `tests/hardening/h2-golden-regression.test.ts:18:40` — `TS2307` — Cannot find module 'bun:test' or its corresponding type declarations.
- `tests/hardening/h3-determinism.test.ts:17:40` — `TS2307` — Cannot find module 'bun:test' or its corresponding type declarations.
- `tests/hardening/h4-property.test.ts:16:40` — `TS2307` — Cannot find module 'bun:test' or its corresponding type declarations.
- `tests/hardening/h5-stress.test.ts:21:40` — `TS2307` — Cannot find module 'bun:test' or its corresponding type declarations.
- `tests/hardening/h6-replay.test.ts:23:40` — `TS2307` — Cannot find module 'bun:test' or its corresponding type declarations.
- `tests/hardening/h7-performance.test.ts:14:40` — `TS2307` — Cannot find module 'bun:test' or its corresponding type declarations.
- `tests/hardening/h7-performance.test.ts:72:8` — `TS2352` — Conversion of type 'typeof globalThis' to type '{ Bun: { gc: () => void; }; }' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
- `tests/hardening/h7-performance.test.ts:82:8` — `TS2352` — Conversion of type 'typeof globalThis' to type '{ Bun: { gc: () => void; }; }' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
- `tests/hardening/h7-performance.test.ts:115:10` — `TS2352` — Conversion of type 'typeof globalThis' to type '{ Bun: { gc: () => void; }; }' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
- `tests/hardening/h8-architectural-invariants.test.ts:20:40` — `TS2307` — Cannot find module 'bun:test' or its corresponding type declarations.
- `tests/hardening/h9-mutation.test.ts:34:40` — `TS2307` — Cannot find module 'bun:test' or its corresponding type declarations.
- `tests/hardening/u3-deterministic-snapshot-1000.test.ts:13:30` — `TS2307` — Cannot find module 'bun:test' or its corresponding type declarations.
- `tests/hardening/u4-memory-leak-10000.test.ts:18:30` — `TS2307` — Cannot find module 'bun:test' or its corresponding type declarations.
- `tests/hardening/u5-architectural-proof.test.ts:18:40` — `TS2307` — Cannot find module 'bun:test' or its corresponding type declarations.
- `tests/hardening/u6-kv-persistence-audit.test.ts:28:52` — `TS2307` — Cannot find module 'bun:test' or its corresponding type declarations.
- `tests/hardening/u7-failure-injection.test.ts:20:40` — `TS2307` — Cannot find module 'bun:test' or its corresponding type declarations.
- `tests/hardening/u9-performance-envelope.test.ts:14:40` — `TS2307` — Cannot find module 'bun:test' or its corresponding type declarations.

### Examples and fixtures — 2 diagnostics
- `examples/websocket/frontend.tsx:4:20` — `TS2307` — Cannot find module 'socket.io-client' or its corresponding type declarations.
- `examples/websocket/server.ts:2:24` — `TS2307` — Cannot find module 'socket.io' or its corresponding type declarations.

### Legacy standalone subproject — 38 diagnostics
- `santaninverter-oracle/src/lib/data-fetcher.ts:1:23` — `TS2688` — Cannot find type definition file for '@cloudflare/workers-types'.
- `santaninverter-oracle/src/lib/data-fetcher.ts:124:48` — `TS2769` — No overload matches this call.
- `santaninverter-oracle/src/lib/data-fetcher.ts:126:21` — `TS2352` — Conversion of type 'string' to type 'MacroState' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
- `santaninverter-oracle/src/lib/types.ts:1:23` — `TS2688` — Cannot find type definition file for '@cloudflare/workers-types'.
- `santaninverter-oracle/src/lib/types.ts:291:14` — `TS2552` — Cannot find name 'D1Database'. Did you mean 'IDBDatabase'?
- `santaninverter-oracle/src/worker.ts:381:38` — `TS18046` — 'prov' is of type 'unknown'.
- `santaninverter-oracle/src/worker.ts:381:66` — `TS18046` — 'prov' is of type 'unknown'.
- `santaninverter-oracle/src/worker.ts:396:3` — `TS2554` — Expected 7 arguments, but got 6.
- `santaninverter-oracle/src/worker.ts:432:5` — `TS2554` — Expected 7 arguments, but got 6.
- `santaninverter-oracle/src/worker.ts:486:70` — `TS18046` — 'e' is of type 'unknown'.
- `santaninverter-oracle/src/worker.ts:492:542` — `TS18046` — 'v' is of type 'unknown'.
- `santaninverter-oracle/src/worker.ts:498:65` — `TS18046` — 'e' is of type 'unknown'.
- `santaninverter-oracle/src/worker.ts:510:74` — `TS18046` — 'e' is of type 'unknown'.
- `santaninverter-oracle/src/worker.ts:700:78` — `TS18046` — 'bucketAlloc' is of type 'unknown'.
- `santaninverter-oracle/src/worker.ts:700:386` — `TS2345` — Argument of type '{ productId: any; productName: any; weight: number; amountUSD: number; category: any; strategySource: string; }' is not assignable to parameter of type 'never'.
- `santaninverter-oracle/src/worker.ts:701:49` — `TS2339` — Property 'weight' does not exist on type 'never'.
- `santaninverter-oracle/src/worker.ts:701:113` — `TS2339` — Property 'weight' does not exist on type 'never'.
- `santaninverter-oracle/src/worker.ts:701:129` — `TS2339` — Property 'weight' does not exist on type 'never'.
- `santaninverter-oracle/src/worker.ts:701:155` — `TS2339` — Property 'amountUSD' does not exist on type 'never'.
- `santaninverter-oracle/src/worker.ts:701:185` — `TS2339` — Property 'weight' does not exist on type 'never'.
- `santaninverter-oracle/src/worker.ts:708:27` — `TS2571` — Object is of type 'unknown'.
- `santaninverter-oracle/src/worker.ts:708:69` — `TS18046` — 's' is of type 'unknown'.
- `santaninverter-oracle/src/worker.ts:708:71` — `TS18046` — 'b' is of type 'unknown'.
- `santaninverter-oracle/src/worker.ts:708:80` — `TS18046` — 'b' is of type 'unknown'.
- `santaninverter-oracle/src/worker.ts:730:30` — `TS2339` — Property 'safeMode' does not exist on type '{ confidenceThrottle: { active: boolean; reason: string; }; capitalPreservationFallback: { active: any; reason: string; }; emergencyFreeze: { active: any; reason: string; }; deRiskMode: { active: boolean; reason: string; }; }'.
- `santaninverter-oracle/src/worker.ts:753:5` — `TS2554` — Expected 7 arguments, but got 6.
- `santaninverter-oracle/src/worker.ts:757:15` — `TS2345` — Argument of type '{ id: string; passed: boolean; detail: string; }' is not assignable to parameter of type 'never'.
- `santaninverter-oracle/src/worker.ts:766:15` — `TS2345` — Argument of type '{ id: string; passed: boolean; detail: string; }' is not assignable to parameter of type 'never'.
- `santaninverter-oracle/src/worker.ts:775:15` — `TS2345` — Argument of type '{ id: string; passed: boolean; detail: string; }' is not assignable to parameter of type 'never'.
- `santaninverter-oracle/src/worker.ts:785:15` — `TS2345` — Argument of type '{ id: string; passed: boolean; detail: string; value: number; }' is not assignable to parameter of type 'never'.
- `santaninverter-oracle/src/worker.ts:797:15` — `TS2345` — Argument of type '{ id: string; passed: boolean; detail: string; value: number; }' is not assignable to parameter of type 'never'.
- `santaninverter-oracle/src/worker.ts:802:15` — `TS2345` — Argument of type '{ id: string; passed: boolean; detail: string; value: number; }' is not assignable to parameter of type 'never'.
- `santaninverter-oracle/src/worker.ts:808:15` — `TS2345` — Argument of type '{ id: string; passed: boolean; detail: string; value: number; }' is not assignable to parameter of type 'never'.
- `santaninverter-oracle/src/worker.ts:817:15` — `TS2345` — Argument of type '{ id: string; passed: boolean; detail: string; }' is not assignable to parameter of type 'never'.
- `santaninverter-oracle/src/worker.ts:827:15` — `TS2345` — Argument of type '{ id: string; passed: boolean; detail: string; }' is not assignable to parameter of type 'never'.
- `santaninverter-oracle/src/worker.ts:836:15` — `TS2345` — Argument of type '{ id: string; passed: boolean; detail: string; }' is not assignable to parameter of type 'never'.
- `santaninverter-oracle/src/worker.ts:841:15` — `TS2345` — Argument of type '{ id: string; passed: boolean; detail: string; }' is not assignable to parameter of type 'never'.
- `santaninverter-oracle/src/worker.ts:846:15` — `TS2345` — Argument of type '{ id: string; passed: boolean; detail: string; }' is not assignable to parameter of type 'never'.

### Unreferenced alternate root Worker — 14 diagnostics
- `src/worker.ts:163:38` — `TS18046` — 'prov' is of type 'unknown'.
- `src/worker.ts:163:66` — `TS18046` — 'prov' is of type 'unknown'.
- `src/worker.ts:256:542` — `TS18046` — 'v' is of type 'unknown'.
- `src/worker.ts:446:16` — `TS18046` — 'bucketAlloc' is of type 'unknown'.
- `src/worker.ts:452:22` — `TS2345` — Argument of type '{ productId: any; productName: any; weight: number; amountUSD: number; category: any; strategySource: string; }' is not assignable to parameter of type 'never'.
- `src/worker.ts:455:49` — `TS2339` — Property 'weight' does not exist on type 'never'.
- `src/worker.ts:456:57` — `TS2339` — Property 'weight' does not exist on type 'never'.
- `src/worker.ts:456:73` — `TS2339` — Property 'weight' does not exist on type 'never'.
- `src/worker.ts:456:99` — `TS2339` — Property 'amountUSD' does not exist on type 'never'.
- `src/worker.ts:456:129` — `TS2339` — Property 'weight' does not exist on type 'never'.
- `src/worker.ts:463:27` — `TS2571` — Object is of type 'unknown'.
- `src/worker.ts:463:69` — `TS18046` — 's' is of type 'unknown'.
- `src/worker.ts:463:71` — `TS18046` — 'b' is of type 'unknown'.
- `src/worker.ts:463:80` — `TS18046` — 'b' is of type 'unknown'.

## Baseline lint inventory

`bun run lint` returned 22 errors and 16 warnings. Canonical failures include synchronous state updates in effects, React Compiler/manual memoization mismatches, ref access during render, and a CommonJS `require()` in telemetry. Three test files also use forbidden `require()` calls. Warnings in `santaninverter-oracle/dist*` are generated-bundle findings and must be removed from source lint scope through generated-artifact ignores, while source warnings in legacy Workers remain part of their isolated lint debt.

## Baseline test interpretation

`bun test` is functional and fast; no additional test framework is justified. It executed 442 tests. Eleven failures identify inconsistent architecture assertions and fallback assumptions:

- U5 expects one portfolio engine while multiple implementations remain.
- H8 expects one prediction pipeline/lifecycle while multiple modules remain.
- U7 expects specific fallback implementation text and STALE behavior that no longer matches the actual source contracts.

These tests must be updated only after canonical ownership and fallback semantics are explicitly defined. The baseline H10 test printing “ready for deploy” is not authoritative because the same run contains 11 failures, global typecheck failure, lint failure, and no production-readiness proof.

## Validation architecture decision

The root TypeScript project will become the canonical Next/OpenNext project, with explicit includes and justified exclusions for separately gated scopes. Separate TypeScript projects will validate tests and operational scripts. The legacy subproject retains its own existing project and lockfile. Examples remain isolated until explicitly maintained. Root `src/worker.ts` remains visible in an alternate-runtime inventory gate until archival/removal; it will not be silently hidden as if resolved.

## Data truthfulness policy

Every source observation must carry source identity/URL, data timestamp, fetch timestamp, age, freshness threshold, state, warnings, and fallback reason. `REAL`, `STALE`, `PARTIAL_FALLBACK`, `ERROR`, `SIMULADO`, and `RECONSTRUIDO` are semantically distinct. Fixtures, defaults, training-memory reconstruction, and synthetic scenarios never become observed history through formatting or aggregation.

## Remaining architectural risks

1. Parallel prediction and portfolio engines still violate single-source ownership.
2. PAPER state is process-local and not durable across Cloudflare isolates.
3. KV persistence is not atomic or transactionally verified.
4. Source adapters do not yet share one timeout/retry/schema/provenance contract.
5. Historical datasets are largely reconstructed, so temporal metrics are scenario validation rather than observed backtest evidence.
6. Dashboard truthfulness must be verified against degraded/empty/error states after API contracts stabilize.
7. Production state and historical release metadata have not been changed or used as implementation evidence.

## Validation workflow

`.github/workflows/oraculo-santander-validation.yml` is branch-scoped, read-only, uses no production secrets, performs no deploy, captures exact commands/exit codes, emits a source snapshot and machine-readable diagnostics, builds Next/OpenNext, and generates the cron wrapper. It is the evidence harness for this feature branch, not a production workflow.
