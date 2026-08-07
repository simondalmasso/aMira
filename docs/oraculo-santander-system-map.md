# Oráculo Santander — Canonical System Map

Authority: GitHub Issue #2. This document describes the current Order #2 architecture and operational truth. Historical baselines remain recoverable from Git history and CI artifacts; they are not repeated here as current state.

## Safety boundary

- Execution is PAPER-only.
- No real broker, custody, real order routing, paid service, card entry, or incremental spend is authorized.
- PR #1 remains the implementation review surface and must stay Draft/open/unmerged until AUD accepts the Order #2 checkpoint.
- Issue #3 is dormant and is not part of this execution graph.

## Canonical deploy/runtime authority

```text
feat/oraculo-santander-completion-sol @ exact SHA
  -> .github/workflows/oraculo-runtime-gate.yml
      -> runtime-gate (strict exact-SHA source gate)
      -> production-deploy (needs runtime-gate=success)
           -> rebuild same SHA
           -> capture rollback anchor
           -> wrangler deploy --config wrangler.jsonc
           -> verify deployment/version/100% traffic
           -> HTTP contract + cron persistence smoke

wrangler.jsonc
  -> main=.open-next/worker-with-cron.js

Next.js app
  -> OpenNext .open-next/worker.js
  -> scripts/wrap-worker-with-cron.mjs
  -> .open-next/worker-with-cron.js
```

`src/worker.ts`, `santaninverter-oracle/`, and `examples/` are retained historical/legacy scopes. They are not production runtime authorities and are excluded from the authoritative root TypeScript/lint graph rather than repaired as parallel production systems.

## Canonical LIVE Oracle

```text
GET/POST /api/oracle/single
  -> request/query validation
  -> getMacroState + field provenance
  -> macroStateToMarketInput
  -> runSinglePass exactly once                 LIVE V1 authority
  -> checked primary-score extraction
       -> READY when usable
       -> PARTIAL when canonical score/data/durability is unavailable
  -> V2 enrichment using precomputed V1
  -> V3 enrichment using precomputed V1/V2
  -> lifecycle domain core
       <-> KV durability adapter
  -> learning summary from verified outcomes only
  -> truthful response adapter
  -> telemetry durability state
```

No canonical server path imports the React lifecycle facade. V2/V3 cannot substitute a second LIVE V1. Scenario and counterfactual reruns are explicitly `SYNTHETIC`, `LIVE_PREDICTION=false`, non-persistent-as-real, and non-learning.

## Lifecycle / verification / learning

```text
src/lib/amira-prediction-lifecycle-core.ts      DOMAIN TRUTH
src/lib/amira-prediction-lifecycle-ledger.ts    CLOUDFLARE KV ADAPTER
src/lib/amira-prediction-lifecycle.ts           CLIENT/REACT FACADE
src/lib/closed-loop-learning.ts                 VERIFIED-OUTCOME DERIVATION
```

Durable event prefixes:

```text
lifecycle:prediction:<prediction_id>
lifecycle:outcome:<outcome_id>
lifecycle:verification:<verification_id>
```

Hydration and verification are idempotent by event identity. Learning is eligible only from verified observed outcomes. With no verified history, `sampleCount=0` and performance metrics are `null` with `NO_HISTORY`; unknown performance is never represented as zero.

## Data truth / provenance

Every canonical macro field carries provenance distinct from display labels:

```text
DATA_CLASS = OBSERVED | RECONSTRUCTED | SYNTHETIC
+ source
+ fetched/observed time
+ coverage
+ transformations
+ limitations
```

Reconstructed or synthetic values never become OBSERVED because another adjacent source is live. `/api/macro` derives its top-level canonical source from canonical field provenance; proxy observations are exposed separately as `AUXILIARY_OBSERVED_FIELDS`.

`src/lib/data-integrity.ts` is the typed validation boundary for macro/external payloads. Public audit/rates/X10/backtest/temporal routes validate inputs and expose stable public error codes rather than caught internal exception strings.

Historical replay truth:

```text
/api/backtest              TRAINING_MEMORY_ESTIMATE / SIMULADO
/api/temporal-validation   TRAINING_MEMORY_ESTIMATE / SIMULADO
```

Real telemetry can be auxiliary context only. It cannot convert reconstructed fixtures into observed historical data or real-return evidence.

## Portfolio / PAPER execution

`src/lib/paper-broker.ts` is PAPER-only. Its API explicitly reports:

```text
executionMode=PAPER_ONLY
persistence=ephemeral-isolate
durable=false
realBrokerConnected=false
```

MARKET/LIMIT risk/accounting checks operate before state mutation and use ARS-normalized exposure/weight accounting. Rejected trades cannot create negative cash/positions or partially mutate financial state.

Legacy Prisma-backed `/api/sync` and `/api/rebalance` are not lifecycle/telemetry authorities. They may compute useful portfolio output while reporting DB persistence independently:

```text
persistence.state = durable | degraded
```

`/api/rebalance` performs allocation replacement and rebalance logging in one Prisma transaction so a failed persistence attempt cannot be reported as durable success.

## Cloudflare persistence

Canonical Cloudflare bindings from `wrangler.jsonc`:

```text
ORACLE_FCI_HISTORY
ORACLE_ASSETS_HISTORY
ORACLE_PREDICTIONS
MACRO_PROXY service binding
ASSETS
```

There is no canonical root D1 binding. A memory/process-local fallback may support degraded reads or PAPER simulation but must never be labeled durable.

## Cron / recovery

Cloudflare schedule:

```text
0 23 * * 1-5 UTC
```

Execution graph:

```text
Cloudflare scheduled()
  -> exactly one internal POST /api/oracle/cron
      -> verify all required KV bindings
      -> read daily completion marker
      -> acquire bounded KV lock
      -> refresh FCI / stocks / bonds / CEDEARs / prediction set
      -> observed class:
           verify exact snap:<class>:<date> read-after-write
      -> unavailable class:
           persist + verify snap:status:<class>:<date>
           data_class=OBSERVED_UNAVAILABLE
           total_assets=0
           bounded TTL
           NEVER overwrite snap:<class>:<date>
      -> lifecycle recovery/expiration
      -> persist + read-after-write completion marker
      -> release lock
```

`GET /api/oracle/cron` is read-only health. Key-count deltas are not persistence proof. Mixed runs combine durable observed snapshots and durable no-data status evidence without fabricating assets.

## Telemetry / observability truth

Telemetry and lifecycle storage state is explicit:

```text
durable
memory-degraded
unavailable
```

Canonical `/api/oracle/single` is PARTIAL if required lifecycle/telemetry durability is unavailable. Public telemetry reads are validated and sanitized; server logs retain detailed exceptions without echoing them in public 500 payloads.

## Strict release gate

The authoritative final source SHA must prove all of the following on that exact SHA:

```text
frozen dependency install PASS
focused runtime tests PASS
global TypeScript = 0 diagnostics
global lint = 0 errors
full Bun suite = 0 failures
git diff --check PASS
Next build PASS
OpenNext build PASS
.open-next/worker.js EXISTS
cron wrapper PASS
.open-next/worker-with-cron.js EXISTS
hardening FINAL GATE GREEN
package/lock integrity PASS
runtime evidence artifact + digest
```

Only after the strict source gate succeeds may the dependency-bound production job deploy that exact SHA. Production completion additionally requires exact-SHA Cloudflare version/deployment/traffic evidence, canonical API smoke, cron persistence proof, and final GitHub reconciliation.

## Current evidence boundary

The last executable strict source gate and Cloudflare deployment are for SHA `9a92251e18b96d650eda086dda305feb41cb3c24`, not for the current post-fix source. That deployment propagated the canonical API contract but its cron verification exposed the FCI/BONOS no-source persistence gap. The current source contains the causal status-snapshot/persistence fixes plus subsequent API/data-integrity hardening.

GitHub Actions is presently refusing to start runners for the current source because of an account payment/spending-limit gate. Order #2 forbids paying, entering card data, or increasing paid spend to bypass it. Consequently the current source cannot be called exact-head CI-green or production-verified until the strict gate and dependency-bound production job execute again at `$0`.

Order #2 remains incomplete until that exact-head evidence exists. No weaker or inferred PASS is authoritative.
