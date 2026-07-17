# Oráculo Santander — System Map

## Scope and safety boundary

This repository implements an Argentina-focused macro and multi-asset analytical system. The intended execution boundary is PAPER only. The system must not custody funds, route orders to a real broker, or represent simulated fills, fixtures, fallbacks, reconstructed history, or synthetic scenarios as observed market activity.

Mandatory base commit: `a76be0d2d1272b533c2fcfbb6d285718def8f6cc`.

Working branch: `feat/oraculo-santander-completion-sol`.

## Canonical runtime

The canonical deployment path is Next.js 16 through `@opennextjs/cloudflare`.

1. `opennextjs-cloudflare build` generates `.open-next/worker.js` and assets.
2. `scripts/wrap-worker-with-cron.mjs` generates `.open-next/worker-with-cron.js`.
3. `wrangler.jsonc` points `main` to `.open-next/worker-with-cron.js` and assets to `.open-next/assets`.
4. The generated wrapper invokes the OpenNext fetch handler directly for scheduled jobs.
5. Cloudflare bindings are supplied to the generated worker at runtime.

`src/worker.ts` is a separate, single-file Cloudflare Worker containing its own landing page and handlers for `/api/macro`, `/api/x10`, `/api/regime`, `/api/backtest-lite`, and `/api/health`. It is not referenced by `wrangler.jsonc`, package scripts, or the OpenNext wrapper. Until consumer searches and build evidence are complete it is classified as a legacy/prototype runtime candidate, not deleted code.

## Build and package topology

- Package manager: Bun. The repository declares Bun-oriented scripts and `bun-types`.
- Framework: Next.js 16 and React 19.
- Runtime validation: Zod 4 is already installed and is the required schema layer.
- ORM: Prisma 6 is installed; schema and active consumers require inventory confirmation.
- Cloudflare adapter: `@opennextjs/cloudflare` 1.19.x.
- Cloudflare CLI: Wrangler 4.
- TypeScript: strict mode is enabled, but `noImplicitAny` is explicitly disabled and `skipLibCheck` is enabled.
- Base `package.json` does not define `test`, `test:unit`, `test:integration`, or `typecheck` scripts.

## Cloudflare bindings

`wrangler.jsonc` currently declares:

- `ASSETS`: OpenNext static assets binding.
- `MACRO_PROXY`: service binding to `macro-oracle-proxy`.
- `ORACLE_FCI_HISTORY`: KV namespace.
- `ORACLE_ASSETS_HISTORY`: KV namespace.
- `ORACLE_PREDICTIONS`: KV namespace.
- `PROXY_URL` and `NEXT_PUBLIC_PROXY_URL`: public worker URL variables.
- Scheduled trigger: `0 23 * * 1-5`.

No D1 binding appears in the canonical Wrangler configuration at the base commit. Any code that assumes `ORACLE_DB` or another D1 binding therefore belongs to the alternate Worker or is currently unwired.

## Scheduled execution

The generated wrapper runs five internal POST requests sequentially:

- `refresh_fci` → `/api/oracle/fci`
- `refresh_stocks` → `/api/oracle/stocks`
- `refresh_bonds` → `/api/oracle/bonds`
- `refresh_cedears` → `/api/oracle/cedears`
- `refresh_predictions` → `/api/oracle/predictions`

`snapshot_archive` remains in the endpoint map but is intentionally excluded from the scheduled list because it previously recursed through `/api/oracle/cron` and multiplied executions.

The wrapper currently detects missing KV bindings and compares key counts before and after execution. A successful HTTP result with no net key growth is treated as a possible silent persistence failure. This is useful telemetry but not yet a transactional write guarantee: overwrites of existing keys can produce a zero count delta despite successful persistence, while failed writes can be masked by a successful handler response.

## Current logical layers

### Data ingestion and macro state

`src/lib/live-data.ts` is the expected source of the Next.js `MacroState` contract and current macro aggregation. External adapters named by the repository include BCRA rates, INDEC inflation, CER, MEP/FX, FCI, bonds, Argentine equities, CEDEARs, ETFs, and Yahoo-derived market data. Their concrete contracts, retry semantics, and fallback labels require source-by-source validation.

### Integrity layer

`src/lib/data-integrity.ts` contains Zod schemas, API auditing, failure generation, and the integrity gate. Confirmed defects at the base commit include:

- duplicated and incomplete data-label unions;
- untyped `Record<string, any>` corruption and warning paths;
- `ValidationResult<any>` in API auditing;
- extraction of a non-contractual Zod issue field through `as any`;
- duplicate quality deductions for the same `ERROR` source;
- failure simulations that accept untyped objects and can bypass the schema adapter expected by the engine.

### Decision pipeline

`src/lib/x10-engine.ts` is the current high-level allocation engine. The repository also contains separate regime, signal, confidence, strategy, capital-bucket, product, evidence, prediction, calibration, arbitration, counterfactual, historical-memory, and self-diagnosis concepts. The target dependency direction is:

`source adapters → normalized snapshot → integrity gate → macro state → regime → signals → confidence → prediction → calibration → ranking → portfolio → PAPER execution → attribution → telemetry`.

No route handler or UI component may define a competing domain contract.

### PAPER execution

`src/lib/paper-broker.ts` implements the simulated broker and is consumed by `/api/paper-broker` and temporal validation. The API route currently stores the broker in process memory and therefore resets on isolate restart. It accepts unvalidated action payloads at the base commit. All output and UI references must remain explicitly PAPER.

### Temporal validation

`src/lib/temporal-validation-engine.ts` orchestrates reconstructed macro snapshots, X10 decisions, PAPER fills, attribution, baselines, survival tests, and calibration. Confirmed defects at the base commit include:

- `RebuiltMacroState` is double-cast into `MacroState` instead of adapted;
- bucket, strategy, and product attribution use `as any`;
- product bucket attribution is hard-coded to `CAPITAL_PRESERVATION`;
- constructed return variations are embedded in attribution and must be labeled synthetic rather than observed;
- crisis verdicts depend on the provenance and completeness of the underlying reconstructed dataset.

### Telemetry and audit APIs

- `/api/telemetry` exposes summaries, decisions, events, metrics, and attribution. Query filters are cast rather than validated.
- `/api/audit` validates current macro state and runs failure simulations. Its X10 bridge casts corrupted data directly into the engine.
- `/api/paper-broker` exposes in-memory PAPER state and accepts reset, order, rebalance, and price-update actions without runtime schemas.

## API contract policy

All public route inputs must be parsed with bounded Zod schemas. Stable errors use a typed envelope with a machine-readable code and no stack trace. Query parameters absent by design retain their no-filter defaults; malformed or out-of-range parameters return 400. Internal failures return 5xx and a correlation ID.

## Data truthfulness policy

Every external observation must carry:

- source identifier and URL;
- data timestamp;
- fetch timestamp;
- computed age;
- freshness threshold;
- state: `REAL`, `STALE`, `PARTIAL_FALLBACK`, or `ERROR`;
- warnings and fallback reason when applicable.

Observed, reconstructed, fixture, fallback, and synthetic data are separate provenance classes. UI and backtest outputs must never collapse them into a single “real” status.

## Persistence target

The target store abstraction supports Memory for tests and local development, KV for Cloudflare production, and D1 only when explicitly bound and configured. Production must not silently select Memory when a required binding is absent. Stored objects require versioned keys, schema version, lineage, bounded retention, idempotency key, timestamps, and atomic pointer publication where multi-object snapshots are involved.

## Principal risks

1. Runtime duplication between OpenNext and `src/worker.ts` can produce divergent endpoints and safety behavior.
2. Missing runtime schemas allow malformed API input to enter decision and PAPER execution layers.
3. Process-memory broker state is not durable and can be misleading in a multi-isolate environment.
4. KV visibility checks do not prove complete, atomic, or idempotent persistence.
5. Domain types are duplicated across data, regime, portfolio, prediction, and temporal modules.
6. Historical and constructed scenarios can be overstated unless provenance is propagated through every metric.
7. Existing comments and dashboard labels can imply production readiness or live data without sufficient evidence.
8. The base repository lacks an explicit test runner contract and exact release gate.

## Validation workflow

`.github/workflows/oraculo-santander-validation.yml` is restricted to this feature branch. It has read-only repository permissions, performs no deployment, consumes no production secrets, records exact exit codes, and uploads baseline evidence for typecheck, lint, available tests, Next.js build, OpenNext build, and wrapper generation.

This document will be updated as inventory and executed evidence resolve remaining unknowns.
