#!/usr/bin/env python3
"""
Genera UN SOLO archivo .MD con:
1. TODO el código actualizado del proyecto (post-FASE 0.6 + Fix A/B/C)
2. Análisis de mejoras urgentes, estructurales y arreglos pendientes
Output: download/PROJECT_FULL_AUDIT_2026-07-09.md
"""
import os, hashlib
from pathlib import Path
from datetime import datetime

BASE = Path('/home/z/my-project')
OUT = Path('/home/z/my-project/download/PROJECT_FULL_AUDIT_2026-07-09.md')

# Archivos críticos (mismo orden que build_audit_block.py)
FILES = [
    'package.json',
    'wrangler.jsonc',
    'open-next.config.ts',
    'next.config.ts',
    'tsconfig.json',
    'scripts/wrap-worker-with-cron.mjs',
    'scripts/health_check.sh',
    'src/lib/oracle-multi/types.ts',
    'src/lib/oracle-multi/storage.ts',
    'src/lib/oracle-multi/rank.ts',
    'src/lib/oracle-multi/predict.ts',
    'src/lib/oracle-multi/cron.ts',
    'src/lib/oracle-multi/index.ts',
    'src/lib/oracle-multi/mep.ts',
    'src/lib/oracle-multi/search.ts',
    'src/lib/oracle-multi/sources/fci-source.ts',
    'src/lib/oracle-multi/sources/acciones.ts',
    'src/lib/oracle-multi/sources/bonds.ts',
    'src/lib/oracle-multi/sources/cedears.ts',
    'src/lib/oracle-multi/sources/etf-cedears.ts',
    'src/lib/oracle-multi/sources/plazo-fijo.ts',
    'src/lib/oracle-multi/sources/yahoo-finance.ts',
    'src/app/api/oracle/cron/route.ts',
    'src/app/api/oracle/predictions/route.ts',
    'src/app/api/oracle/fci/route.ts',
    'src/app/api/oracle/stocks/route.ts',
    'src/app/api/oracle/bonds/route.ts',
    'src/app/api/oracle/cedears/route.ts',
    'src/app/api/oracle/rankings/route.ts',
    'src/app/api/oracle/search/route.ts',
    'src/app/api/oracle/single/route.ts',
    'src/app/api/telemetry/route.ts',
    'src/lib/telemetry.ts',
    'src/lib/bcra-api.ts',
    'src/lib/indec-api.ts',
    'src/lib/rates-api.ts',
    'src/lib/data-client.ts',
    'src/lib/live-data.ts',
    'src/lib/argentina-data.ts',
    'src/lib/x10-engine.ts',
    'src/lib/x10-signal-layer.ts',
    'src/lib/x10-strategy-layer.ts',
    'src/lib/macroOracle.ts',
    'src/lib/rebalanceOracle.ts',
    'src/lib/backtest-engine.ts',
    'src/lib/pnl-attribution.ts',
    'src/lib/portfolio-engine.ts',
    'src/lib/paper-broker.ts',
    'src/lib/linear-factor-model.ts',
    'src/lib/closed-loop-learning.ts',
    'src/lib/capital-buckets.ts',
    'src/lib/data-integrity.ts',
    'src/lib/temporal-validation-engine.ts',
    'src/lib/single-market-state.ts',
    'src/lib/single-pass-oracle-engine.ts',
    'src/lib/macro-state-rebuilder.ts',
    'src/lib/baseline-comparison.ts',
    'src/lib/goal-engine.ts',
    'src/lib/utils.ts',
    'src/lib/db.ts',
    'src/lib/amira-event-bus.ts',
    'src/lib/amira-executor-sim.ts',
    'src/lib/amira-monitor.ts',
    'src/lib/amira-portfolio-view-model.ts',
    'src/lib/amira-prediction-engine.ts',
    'src/lib/amira-prediction-lifecycle.ts',
    'src/lib/amira-scanner.ts',
    'src/lib/amira-source-health.ts',
    'src/lib/amira-vision-consensus.ts',
    'src/app/api/macro/route.ts',
    'src/app/api/x10/route.ts',
    'src/app/api/backtest/route.ts',
    'src/app/api/portfolio/route.ts',
    'src/app/api/paper-broker/route.ts',
    'src/app/api/rebalance/route.ts',
    'src/app/api/mep/route.ts',
    'src/app/api/rates/route.ts',
    'src/app/api/audit/route.ts',
    'src/app/api/sync/route.ts',
    'src/app/api/temporal-validation/route.ts',
    'src/app/api/route.ts',
    'src/lib/oracle-fci/index.ts',
    'src/lib/oracle-fci/types.ts',
    'src/lib/oracle-fci/fetch.ts',
    'src/lib/oracle-fci/storage.ts',
    'src/lib/oracle-fci/rank.ts',
    'src/lib/oracle-fci/predict.ts',
    'src/lib/oracle-fci/normalize.ts',
    'src/lib/oracle-fci/search.ts',
]

IMPROVEMENTS_SECTION = r'''

## ════════════════════════════════════════════════════════════════════════════
## PARTE 2 — MEJORAS URGENTES, ARREGLOS ESTRUCTURALES Y DEUDA TÉCNICA
## ════════════════════════════════════════════════════════════════════════════

> Análisis basado en: trabajo de 5 agentes (Qwen, InternLM, GPT, GLM, Sakana) +
> diagnóstico forense de 9 crons + audit de code paths. Priorizado por riesgo
> y esfuerzo. Respeta FREEZE CRITICAL_ENGINEERING_ONLY para scoring engine.

### 🔴 URGENTES (deberían abordarse esta semana)

#### U1. BONOS gap estructural — Yahoo Finance 429 sobre `.BA` tickers
- **Síntoma**: `ERROR=3` estable desde hace 14+ días. `refresh_bonds` dura 0.4s
  (vacía, sin data nueva). `real_bonos_count=0`.
- **Causa raíz**: Yahoo Finance rate-limita agresivamente IPs de Cloudflare Workers
  (no田间 shared egress IPs). Sin User-Agent tuning ni backoff exponencial.
- **Fix propuesto (FASE 2)**:
  1. Implementar backoff exponencial en `sources/yahoo-finance.ts` (2s → 4s → 8s → 16s)
  2. Agregar `User-Agent: Mozilla/5.0 (X11; Linux x86_64)` header
  3. Cache de 24h en KV para responses exitosos (key: `yahoo_cache:{ticker}:{date}`)
  4. **Fallback scraper**: Ámbito Financiero o Cronista para bonos soberanos (AL29, GD30, etc.)
  5. **Largo plazo**: explorar BYMA API con auth (requiere onboarding broker)
- **Esfuerzo**: ~3-4 horas
- **Archivo**: `src/lib/oracle-multi/sources/yahoo-finance.ts`, `sources/bonds.ts`

#### U2. `totalDecisions=17` estancado desde 2026-07-01 (8 días)
- **Síntoma**: `newestDecision=2026-07-01T22:42:52Z` — ningún DEC-* nuevo en 8 días.
- **Causa raíz** (hipótesis): `x10-engine` requiere `predictions_count > 0` para emitir
  decisiones. Antes de FASE 0.6, predictions_count=459 pero todos tombstones → engine
  los veía como activos pero confidence=0 → nunca superaba threshold de decisión.
  Post-FASE 0.6, predictions_count=0 → engine directamente no corre.
- **Dependencia**: 9 días de clean snapshots (~2026-07-15) para que el motor emita
  predicciones reales (no tombstones). Recién entonces x10-engine podrá emitir DEC-*.
- **Verificación pendiente**: revisar `x10-engine.ts` para confirmar que NO hay otro
  bug (¿gate de confidence? ¿threshold demasiado alto?).
- **Esfuerzo**: 1h investigación + 0-3h fix según hallazgo.

#### U3. `pipelineExecutions=0` en telemetry (counter roto)
- **Síntoma**: `pipelineExecutions: 0` siempre, pero `lastPipelineExecution` sí avanza.
- **Causa raíz**: el counter en `telemetry.ts:371` se incrementa en memoria cuando
  `eventType === 'PIPELINE_EXECUTION'`, pero se resetea en cada cold-start del Worker
  isolate. Nunca se persiste a KV.
- **Fix propuesto**: persistir el counter en KV con TTL 90 días (key: `telemetry:counter:pipeline_executions`).
  Mismo patrón para otros counters (`regimeTransitions`, `rebalancesExecuted`, etc.).
- **Esfuerzo**: ~1h
- **Archivo**: `src/lib/telemetry.ts`

#### U4. `recentConfidence=0.51` estático desde hace 5+ días
- **Síntoma**: Confidence no se mueve. Debería fluctuar con cada DEC-* o prediction.
- **Causa raíz**: Ligado a U2 — sin nuevos DEC-*, no hay input para recalcular.
- **Acción**: bloqueado por U2.

---

### 🟡 ESTRUCTURALES (abordar en próximas 2-3 semanas)

#### E1. Eliminar `oracle-fci/` legacy (dead code)
- **Estado**: 8 archivos en `src/lib/oracle-fci/` ya NO están en el cron path ni en
  ningún route handler activo. Reemplazados por `oracle-multi/`.
- **Riesgo**: confusiones futuras, audit cost, possible accidental re-import.
- **Fix propuesto**: `git rm -r src/lib/oracle-fci/` + eliminar imports rotos.
- **Esfuerzo**: 30min
- **Validación**: `grep -r "oracle-fci" src/` debe devolver 0 hits.

#### E2. Unificar `getEnv()` pattern en route handlers
- **Estado**: 9 route handlers (`/api/oracle/*`) repiten el mismo `getEnv()` de 15 líneas
  con `getCloudflareContext()` + try/catch + fallback a undefined.
- **Riesgo**: DRY violation, mantenimiento costoso, riesgo de drift.
- **Fix propuesto**: extraer a `src/lib/oracle-multi/env.ts` con `export function getOracleEnv()` y
  reemplazar los 9 inline.
- **Esfuerzo**: 1h refactor + 1h testing
- **Validación**: `grep -c "getCloudflareContext" src/app/api/oracle/*/route.ts` debe ser 0.

#### E3. `cron.ts` snapshot_archive job es ahora dead code
- **Estado**: Tras Fix A, `snapshot_archive` ya no se invoca desde el wrapper. Pero
  `cron.ts:95-112` mantiene el case en `runJob()` y `CRON_JOBS` array sigue teniendo
  la entrada `'snapshot_archive'`.
- **Riesgo**: si alguien llama `runAllCronJobs()` directo (via `/api/oracle/cron` route
  handler), ejecutará 6 jobs en vez de 5.
- **Fix propuesto**: eliminar `snapshot_archive` de `CRON_JOBS` en `cron.ts` y
  remover el case del switch. Mantener `runAllCronJobs` en `/api/oracle/cron` route
  para uso manual/debug, pero ahora solo ejecutará 5 jobs.
- **Esfuerzo**: 15min
- **Archivo**: `src/lib/oracle-multi/cron.ts`

#### E4. `scheduled()` handler no tiene timeout per-job
- **Estado**: Si un job se cuelga (e.g., Yahoo responde pero muy lento), el wrapper
  espera indefinidamente. CF Workers tiene un hard limit 15min para cron trigger,
  pero sin granularidad per-job.
- **Fix propuesto**: envolver cada `runCronJob()` con `Promise.race(timeout)`.
  Si job >60s, marcar como failed y seguir con el siguiente.
- **Esfuerzo**: 1h
- **Archivo**: `scripts/wrap-worker-with-cron.mjs`

#### E5. KV lock (Fix B) es eventually-consistent — race window existe
- **Estado**: Tras Fix B, dos callers concurrentes pueden ambos leer "no lock" y
  ambos escribir. Para cron una-vez-por-día es negligible, pero si algún día se
  invoca manualmente + cron automático simultáneamente, podría haber re-entrada.
- **Fix propuesto (largo plazo)**: migrar a Durable Objects para locks verdaderamente
  atómicos. O usar KV con `metadata` field para implementar CAS.
- **Esfuerzo**: 4-6h (DO migration es grande)
- **Mitigación actual**: TTL 90s stale-lock cleanup es suficiente para uso real.

#### E6. Telemetry events en KV (no en D1/Durable Object)
- **Estado**: `EVT-CRON-*` events se guardan en `ORACLE_PREDICTIONS` KV con TTL 30d.
  Sin indexes, sin queries agregados, sin retención >30 días.
- **Riesgo**: análisis histórico imposible. No se puede hacer "promedio jobs_ok últimos 90 días".
- **Fix propuesto**: migrar telemetry events a D1 (ya existe schema en `prisma/schema.prisma`).
  Mantener KV para hot-reads (último evento) pero D1 para history.
- **Esfuerzo**: 1-2 días
- **Dependencia**: D1 binding en `wrangler.jsonc` (no existe todavía)

#### E7. `data_quality` field no expuesto en API responses
- **Estado**: FASE 0.5 añadió `data_quality?: 'sufficient' | 'insufficient'` a
  `AssetPrediction` y `AssetMetrics`. Pero ni `GET /api/oracle/predictions` ni
  `GET /api/oracle/rankings` lo incluyen en su output shape.
- **Fix propuesto**: añadir `data_quality` al map de predictions/rankings response
  para que UI pueda mostrar badge "Data Insufficient" en tombstoned assets.
- **Esfuerzo**: 30min
- **Archivo**: `src/app/api/oracle/predictions/route.ts:50-61`, `rankings/route.ts`

---

### 🟢 MEJORAS (cuando FREEZE se levante)

#### M1. Tests automatizados para FASE 0 + 0.5 null-guards
- **Estado**: los null-guards para `date` y `price` están documentados pero no testeados.
  No hay unit tests que verifiquen que un snapshot con `date:null` o `price:null` se
  filtra correctamente en `buildPriceSeries`.
- **Fix propuesto**: añadir `tests/oracle-multi/null-guards.test.ts` con 10-15 casos.
- **Esfuerzo**: 2h
- **Framework**: vitest o node:test

#### M2. Health check endpoint unificado
- **Estado**: `scripts/health_check.sh` hace 2 curls. Pero no hay `/api/health` que
  devuelva status consolidado (KV reachable, bindings present, last cron success,
  predictions_active, error count).
- **Fix propuesto**: `src/app/api/health/route.ts` que devuelva
  `{overall:'healthy|degraded|critical', checks:{kv, cron, predictions, errors}}`.
- **Esfuerzo**: 2h

#### M3. Métricas de backtest (FASE 4 del roadmap)
- **Estado**: `backtest-engine.ts` existe pero no emite métricas estándar (decisionAccuracy,
  VaR_95_1m, CVaR, Sortino). Sin métricas no hay forma de evaluar quality del oracle.
- **Fix propuesto**: añadir cálculo de métricas en backtest output + endpoint
  `/api/backtest/metrics`.
- **Esfuerzo**: 1 día
- **Dependencia**: FASE 3 (9 días clean snapshots acumulados)

#### M4. LLM bridge para narrative decisions (FASE 5)
- **Estado**: pendiente en roadmap. Sería un wrapper sobre z-ai-web-dev-sdk que
  convierta oracle output en texto narrativo para UI.
- **Esfuerzo**: 1-2 días
- **Dependencia**: FASE 3 + FASE 4 completos

#### M5. Observability — wrangler tail automation
- **Estado**: `observability.enabled: false` en `wrangler.jsonc`. Sin logs centralizados.
  Diagnósticos como el bug de recursión requieren inferencia desde KV events.
- **Fix propuesto**: habilitar `observability.logs.enabled: true` y configurar
  tail a un sink (Logflare, Datadog, o self-hosted).
- **Esfuerzo**: 2h config + 2h dashboard setup
- **Trade-off**: costo marginal por CF Workers observability paid tier

---

### 📋 DEUDA TÉCNICA MENOR

| ID | Item | Archivo | Esfuerzo |
|---|---|---|---|
| D1 | `D1Database` type no declarado (TS error pre-existing) | `src/lib/telemetry.ts:691` | 5min |
| D2 | `Math.random()` en oracle/v2/v3 legacy (H2 hardening FAIL) | `src/lib/oracle/{v2,v3}/*` | 1h |
| D3 | `data_quality` field no expuesto en API response | `predictions/route.ts:50` | 30min (E7) |
| D4 | `scheduled()` log line dice "5 jobs" hardcodeado en wrapper template | `wrap-worker-with-cron.mjs:248` | 5min |
| D5 | 19 TS errors nuevos sobre baseline 21 (no bloqueantes) | varios | 2-3h |
| D6 | `oracle-multi/mep.ts` no integrado al cron path | `oracle-multi/mep.ts` | decidir |
| D7 | `plazo-fijo.ts` source no integrado al cron path | `sources/plazo-fijo.ts` | decidir |
| D8 | `argentina-data.ts` y `data-client.ts` solapan (¿duplica?) | `src/lib/` | 1h audit |
| D9 | `db.ts` existe pero no se usa en production path (solo Prisma en dev) | `src/lib/db.ts` | decidir |
| D10 | `compatibility_flags: ["nodejs_compat"]` sin `nodejs_compat_v2` | `wrangler.jsonc` | 5min test |

---

### 🎯 ROADMAP SUGERIDO (post-bundle actual)

```
SEMANA 1 (10-16 Jul):
  ✅ Bundle FASE 0.6 + Fix A/B/C aplicado (Jue 09-Jul)
  ⏳ Validar 2 crons limpios (Vie 10 + Lun 13)
  ⏳ U3 (pipelineExecutions counter persistence) — 1h
  ⏳ E1 (eliminar oracle-fci legacy) — 30min
  ⏳ E3 (snapshot_archive dead code en cron.ts) — 15min

SEMANA 2 (17-23 Jul):
  ⏳ FASE 3 completada (~15 Jul): 9 días clean snapshots
  ⏳ U2 verification: si DEC-* no aparece, investigar x10-engine
  ⏳ U1 (BONOS gap — FASE 2): Yahoo backoff + Ámbito scraper — 4h
  ⏳ E2 (unificar getEnv pattern) — 2h
  ⏳ E7 (data_quality en API response) — 30min
  ⏳ M1 (unit tests null-guards) — 2h

SEMANA 3-4 (24 Jul - 6 Ago):
  ⏳ FASE 4: M3 (backtest metrics — VaR, Sortino, decisionAccuracy) — 1 día
  ⏳ E4 (per-job timeout en scheduled()) — 1h
  ⏳ E6 (telemetry → D1 migration) — 1-2 días
  ⏳ M2 (/api/health endpoint) — 2h
  ⏳ M5 (observability habilitado) — 4h

MES 2 (Aug):
  ⏳ FASE 5: M4 (LLM bridge para narrative) — 1-2 días
  ⏳ E5 (Durable Objects para locks atómicos) — 4-6h
  ⏳ Cleanup deuda técnica D1-D10
```

---

### 📊 ESTADO ACTUAL DEL SISTEMA (post-deploy Jue 09-Jul 21:47 UTC)

| Métrica | Valor | Estado |
|---|---|---|
| Versión deployada | `e26a19cf-856c-4d40-a6df-78e13c06866f` | ✅ |
| Cron wall clock (simulado) | 26s (era 570s) | ✅ -95% |
| `predictions_count` | 0 (era 459 tombstones) | ✅ FASE 0.6 |
| `lastPipelineExecution` | `2026-07-08T23:10:10Z` | ⏳ actualiza Vie 10 |
| `totalDecisions` | 17 (estancado 8 días) | ⚠️ U2 |
| `REAL/PARTIAL/ERROR` | 9/5/3 (estancado 14 días) | ⚠️ U1 |
| `recentConfidence` | 0.51 (estático) | ⚠️ U4 (blocked by U2) |
| `pipelineExecutions` | 0 (counter roto) | ⚠️ U3 |
| FREEZE CRITICAL_ENGINEERING_ONLY | vigente | 🔒 |
| Próximo cron | Vie 10-Jul 23:00 UTC (20:00 AR hoy) | ⏳ ~1h |

---

### 🔒 INVARIANTS DEL FREEZE (no tocar sin Council approval)

- ❌ `linear_factor_model_v1` (weights, formula)
- ❌ `ORACLE_SCORE_WEIGHTS` en `oracle-multi/index.ts`
- ❌ `MIN_HISTORY_DAYS=9`, `CONFIDENCE_THRESHOLD=0.65`, `HIGH_CONVICTION=0.85`
- ❌ 4-model ensemble structure (OLS + EWMA + momentum + Bayesian)
- ❌ Regime definitions (NORMAL/CRISIS/CARRY_FAVORABLE/BANDAS_DEPRECIACION)
- ❌ `seeded-rng.ts` (seed=42, mulberry32)
- ❌ `recordSignalReturn()` attribution model

---

**Fin del análisis. Código fuente completo a continuación.**
'''

def main():
    out = []

    # ═══ HEADER ═══
    out.append('# SANTANINVERTER ORACLE — FULL PROJECT SOURCE + IMPROVEMENTS AUDIT')
    out.append('')
    out.append(f'**Generated:** 2026-07-09 (post-FASE 0.6 + Fix A/B/C bundle deploy)')
    out.append(f'**Deployed version:** `e26a19cf-856c-4d40-a6df-78e13c06866f`')
    out.append(f'**URL:** https://santaninverter-oracle.simondalmasso44.workers.dev')
    out.append(f'**Schedule:** `0 23 * * 1-5` UTC (Mon-Fri 20:00 Argentina)')
    out.append('')
    out.append('---')
    out.append('')
    out.append('## Tabla de contenidos')
    out.append('')
    out.append('- **Parte 1** — Código fuente completo (89 archivos)')
    out.append('- **Parte 2** — Análisis de mejoras urgentes, estructurales y debt técnica')
    out.append('- **Parte 3** — Estado actual del sistema + roadmap')
    out.append('')
    out.append('---')
    out.append('')

    # ═══ PARTE 1: CÓDIGO FUENTE ═══
    out.append('## PARTE 1 — CÓDIGO FUENTE COMPLETO')
    out.append('')
    out.append('> 89 archivos · ~24K líneas · incluye todos los cambios de FASE 0, FASE 0.5,')
    out.append('> FASE 0.6 y Fixes A/B/C aplicados al momento de generar este documento.')
    out.append('')
    out.append('### Stack')
    out.append('- Cloudflare Workers + Next.js 16 + OpenNext (`@opennextjs/cloudflare` 1.19.11)')
    out.append('- Storage: 3 KV namespaces (ORACLE_FCI_HISTORY, ORACLE_ASSETS_HISTORY, ORACLE_PREDICTIONS)')
    out.append('- 4-model ensemble predictor: OLS + EWMA + momentum + Bayesian')
    out.append('- Constants: MIN_HISTORY_DAYS=9, CONFIDENCE_THRESHOLD=0.65, HIGH_CONVICTION=0.85')
    out.append('')
    out.append('### Cambios aplicados en este snapshot')
    out.append('')
    out.append('| Fecha | Cambio | Archivos |')
    out.append('|---|---|---|')
    out.append('| 2026-07-02 | **FASE 0** — null-guards para `date` en localeCompare (5 ubicaciones) | storage.ts, rank.ts, predict.ts |')
    out.append('| 2026-07-02 | **P2** — POST handler en /api/oracle/predictions (fix HTTP 405) | predictions/route.ts |')
    out.append('| 2026-07-02 | **P1** — getCloudflareContext wiring para KV bindings | todos los route handlers |')
    out.append('| 2026-07-03 | **FASE 0.5** — null-guards para `price` + tombstone semantics | storage.ts, rank.ts, predict.ts, types.ts |')
    out.append('| 2026-07-09 | **FASE 0.6** — excluir tombstones de predictions_count | oracle-multi/index.ts |')
    out.append('| 2026-07-09 | **Fix A** — eliminar snapshot_archive del CRON_JOBS wrapper | wrap-worker-with-cron.mjs |')
    out.append('| 2026-07-09 | **Fix B** — KV lock en /api/oracle/cron route handler | oracle/cron/route.ts |')
    out.append('| 2026-07-09 | **Fix C** — lastPipelineExecution solo tras success=true | telemetry.ts |')
    out.append('')
    out.append('---')
    out.append('')

    total_bytes = 0
    total_lines = 0
    skipped = []

    for fpath in FILES:
        full = BASE / fpath
        if not full.exists():
            skipped.append(fpath)
            continue
        try:
            content = full.read_text(encoding='utf-8', errors='replace')
        except Exception as e:
            skipped.append(f'{fpath} (read error: {e})')
            continue

        lines = content.count('\n') + (0 if content.endswith('\n') else 1)
        size = len(content.encode('utf-8'))
        total_lines += lines
        total_bytes += size

        # Detectar lenguaje para syntax highlight
        ext = full.suffix.lower()
        lang_map = {
            '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript',
            '.mjs': 'javascript', '.json': 'json', '.jsonc': 'jsonc',
            '.sh': 'bash', '.md': 'markdown',
        }
        lang = lang_map.get(ext, '')

        out.append(f'### `{fpath}`')
        out.append('')
        out.append(f'*{lines} lines · {size} bytes*')
        out.append('')
        out.append(f'```{lang}')
        out.append(content.rstrip())
        out.append('```')
        out.append('')
        out.append('---')
        out.append('')

    # ═══ PARTE 2: MEJORAS Y ARREGLOS ═══
    out.append(IMPROVEMENTS_SECTION)
    out.append('')

    # ═══ FOOTER ═══
    out.append('---')
    out.append('')
    out.append('## FOOTER')
    out.append('')
    out.append(f'- **Files included:** {len(FILES) - len(skipped)} / {len(FILES)}')
    out.append(f'- **Total lines:** {total_lines}')
    out.append(f'- **Total bytes:** {total_bytes} ({total_bytes/1024:.1f} KB)')
    if skipped:
        out.append(f'- **Skipped files:**')
        for s in skipped:
            out.append(f'  - {s}')
    out.append('')
    out.append('---')
    out.append('')
    out.append('*Documento generado por Super Z (GLM-5.1) para Simón Dalmasso · Santaninver Oracle project*')
    out.append('')

    result = '\n'.join(out)
    OUT.write_text(result, encoding='utf-8')

    print(f'✅ Generated: {OUT}')
    print(f'   Files: {len(FILES) - len(skipped)} / {len(FILES)}')
    print(f'   Lines: {total_lines}')
    print(f'   Bytes: {total_bytes} ({total_bytes/1024:.1f} KB)')
    print(f'   Output size: {len(result.encode("utf-8"))/1024:.1f} KB')
    if skipped:
        print(f'   Skipped: {len(skipped)}')
        for s in skipped:
            print(f'     - {s}')

if __name__ == '__main__':
    main()
