# aMira — CURRENT STATE

Authority: GitHub Issue #2 (`ORDEN MAESTRA — completar aMira end-to-end / Cloudflare-first`). Issue #3 is dormant until AUD accepts the final Order #2 checkpoint.

## Canonical runtime

- Product runtime: Next.js/OpenNext on Cloudflare Workers.
- Worker entrypoint: `.open-next/worker-with-cron.js` from `wrangler.jsonc`.
- Canonical prediction endpoint: `GET /api/oracle/single` (POST remains a validated compatibility extension).
- Canonical LIVE scoring authority: `runSinglePass` in `src/lib/single-pass-oracle-engine.ts`.
- V2/V3 are enrichers of the precomputed V1 vector. Scenario/counterfactual reruns are explicitly `SYNTHETIC`, non-LIVE, non-persistent-as-real, and non-learning.
- PaperBroker remains PAPER-only. Order #2 does not authorize real-money execution.

## Data truth

Canonical macro provenance classifies each field as `OBSERVED`, `RECONSTRUCTED`, or `SYNTHETIC`, separately from legacy display labels such as REAL/STALE/RECONSTRUIDO. Provenance carries source, observation/fetch time, transformations and limitations. Reconstructed values are never promoted to observed truth.

Unknown/no-history values remain `null`; a real numeric zero remains representable as zero. The canonical API and UI expose READY/PARTIAL/ERROR plus explicit warnings instead of fabricating missing scores.

Public Oracle class routes do not echo caught internal exception messages. Mutating refresh endpoints fail closed when the required durable Cloudflare KV bindings are unavailable; read paths may degrade only where their contract does not claim durable persistence.

## Lifecycle, learning and telemetry

`src/lib/amira-prediction-lifecycle-core.ts` is the single server-side lifecycle truth for Prediction → Outcome → Verification. `amira-prediction-lifecycle.ts` is only the React facade. `amira-prediction-lifecycle-ledger.ts` is only the Cloudflare KV durability adapter: it hydrates the canonical core and persists prediction/outcome/verification events under distinct prefixes.

Learning metrics are derived from canonical verification history. With no verified history: `sampleCount=0`, MAE/directional accuracy/Brier are `null`, status=`NO_HISTORY`. Active weights can be rebuilt deterministically from hydrated verified events.

Telemetry and lifecycle report `durable`, degraded-memory, or unavailable states explicitly. `/api/oracle/single` becomes PARTIAL if lifecycle or telemetry durability is unavailable.

## Cron and recovery

Cloudflare has one schedule: `0 23 * * 1-5` UTC (= 20:00 Argentina). The generated scheduled handler performs exactly one internal POST to `/api/oracle/cron`. The route owns:

- daily idempotency marker;
- bounded re-entrancy lock that fails closed on storage errors;
- five data-refresh jobs;
- exact read-after-write acknowledgements (key-count deltas are not proof);
- truthful no-source status snapshots under `snap:status:<class>:<date>` with bounded TTL; these never overwrite a valid `snap:<class>:<date>` observation;
- partial-class reconciliation: observed classes verify their real snapshots while unavailable classes persist distinct `OBSERVED_UNAVAILABLE` status evidence;
- canonical lifecycle hydration/expiration recovery;
- sanitized public errors.

`GET /api/oracle/cron` is read-only health and never runs jobs.

## Repository debt and authority boundaries

The deployed OpenNext runtime does not use `src/worker.ts`, `santaninverter-oracle/`, or `examples/`. Those paths are retained as historical/legacy evidence and are explicitly excluded from the canonical root TypeScript/lint graph rather than deleted or mistaken for production code. The deploy entrypoint is solely the OpenNext wrapped worker.

Order #2 final gates are strict for the configured authoritative repository graph: global TypeScript zero diagnostics, global lint zero errors, full Bun suite zero failures, Next build, OpenNext build, worker/wrapper, hardening suite and clean diff/integrity.

## CI and production reconciliation

`.github/workflows/oraculo-runtime-gate.yml` is the single authoritative Order #2 gate for the exact branch SHA. Its `production-deploy` job is dependency-bound to the strict source gate (`needs: runtime-gate`), checks out that same green SHA, rebuilds it, captures the Cloudflare rollback anchor, deploys with existing repository secrets, then verifies production `/`, `/api/oracle/single`, cron binding health and one idempotent cron persistence run. There is no second production workflow authority.

The last executable production verification exposed the no-source persistence gap that led to the distinct `snap:status:*` design above. The post-fix exact-head GitHub Actions attempts are currently prevented from starting by GitHub's account payment/spending-limit gate. Order #2 forbids resolving that blocker through payment, card entry, or incremental spend. Therefore the post-fix source must not be represented as exact-head CI- or production-verified until runners execute again at `$0`.

Exact CI run IDs, artifact IDs/digests, Cloudflare version/deployment IDs, traffic, smoke results and final source SHA are deliberately recorded in the final Issue #2 checkpoint rather than hard-coded here, so this document never treats stale deployment identifiers as current truth.

## Order #2 completion rule

Order #2 is complete only when the exact final branch SHA has strict CI green, exact-SHA production deployment evidence green, GitHub is reconciled, PR #1 remains open Draft/unmerged for AUD, and the final material checkpoint is published on Issue #2. Until that evidence exists, this file must not be interpreted as a self-certifying PASS.
