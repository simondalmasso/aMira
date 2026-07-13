#!/usr/bin/env python3
"""
Genera un único bloque de código con todos los archivos críticos del proyecto
para auditoría de Qwen3.7-Max. Output: 1 solo .txt con headers separadores.
"""
import os
from pathlib import Path

BASE = Path('/home/z/my-project')

# Archivos críticos para auditoría (ordenados por relevancia)
FILES = [
    # ─── Configuración raíz ───────────────────────────────────────────────
    'package.json',
    'wrangler.jsonc',
    'open-next.config.ts',
    'next.config.ts',
    'tsconfig.json',

    # ─── Cron wrapper (ROOT CAUSE del bug actual) ─────────────────────────
    'scripts/wrap-worker-with-cron.mjs',
    'scripts/health_check.sh',

    # ─── oracle-multi: motor principal (FASE 0 + FASE 0.5 aplicados) ──────
    'src/lib/oracle-multi/types.ts',
    'src/lib/oracle-multi/storage.ts',
    'src/lib/oracle-multi/rank.ts',
    'src/lib/oracle-multi/predict.ts',
    'src/lib/oracle-multi/cron.ts',
    'src/lib/oracle-multi/index.ts',
    'src/lib/oracle-multi/mep.ts',
    'src/lib/oracle-multi/search.ts',

    # ─── oracle-multi/sources: data fetchers por asset class ──────────────
    'src/lib/oracle-multi/sources/fci-source.ts',
    'src/lib/oracle-multi/sources/acciones.ts',
    'src/lib/oracle-multi/sources/bonds.ts',
    'src/lib/oracle-multi/sources/cedears.ts',
    'src/lib/oracle-multi/sources/etf-cedears.ts',
    'src/lib/oracle-multi/sources/plazo-fijo.ts',
    'src/lib/oracle-multi/sources/yahoo-finance.ts',

    # ─── API routes: oráculo (6 cron jobs + readers) ──────────────────────
    'src/app/api/oracle/cron/route.ts',
    'src/app/api/oracle/predictions/route.ts',
    'src/app/api/oracle/fci/route.ts',
    'src/app/api/oracle/stocks/route.ts',
    'src/app/api/oracle/bonds/route.ts',
    'src/app/api/oracle/cedears/route.ts',
    'src/app/api/oracle/rankings/route.ts',
    'src/app/api/oracle/search/route.ts',
    'src/app/api/oracle/single/route.ts',

    # ─── Telemetry ────────────────────────────────────────────────────────
    'src/app/api/telemetry/route.ts',
    'src/lib/telemetry.ts',

    # ─── APIs externas (BCRA, INDEC, rates, data-client, live-data) ───────
    'src/lib/bcra-api.ts',
    'src/lib/indec-api.ts',
    'src/lib/rates-api.ts',
    'src/lib/data-client.ts',
    'src/lib/live-data.ts',
    'src/lib/argentina-data.ts',

    # ─── Motores de decisión y backtest ───────────────────────────────────
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

    # ─── Amira (vision/consensus/executor) ────────────────────────────────
    'src/lib/amira-event-bus.ts',
    'src/lib/amira-executor-sim.ts',
    'src/lib/amira-monitor.ts',
    'src/lib/amira-portfolio-view-model.ts',
    'src/lib/amira-prediction-engine.ts',
    'src/lib/amira-prediction-lifecycle.ts',
    'src/lib/amira-scanner.ts',
    'src/lib/amira-source-health.ts',
    'src/lib/amira-vision-consensus.ts',

    # ─── Otros API routes relevantes ──────────────────────────────────────
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

    # ─── oracle-fci (legacy, no en cron path) ─────────────────────────────
    'src/lib/oracle-fci/index.ts',
    'src/lib/oracle-fci/types.ts',
    'src/lib/oracle-fci/fetch.ts',
    'src/lib/oracle-fci/storage.ts',
    'src/lib/oracle-fci/rank.ts',
    'src/lib/oracle-fci/predict.ts',
    'src/lib/oracle-fci/normalize.ts',
    'src/lib/oracle-fci/search.ts',
]

def main():
    out = []
    skipped = []
    total_bytes = 0
    total_lines = 0

    # Header
    out.append('=' * 80)
    out.append('SANTANINVERTER ORACLE — FULL PROJECT SOURCE FOR AUDIT')
    out.append('Generated: 2026-07-04 (post-FASE 0.5, pre-FASE 0.6)')
    out.append('Deployed version: 3a86146b-3c89-4e58-8218-448a8ddfc812')
    out.append('URL: https://santaninverter-oracle.simondalmasso44.workers.dev')
    out.append('')
    out.append('CONTEXT FOR QWEN3.7-MAX AUDITOR:')
    out.append('- Stack: Cloudflare Workers + Next.js 16 + OpenNext (@opennextjs/cloudflare 1.19.11)')
    out.append('- Storage: 3 KV namespaces (ORACLE_FCI_HISTORY, ORACLE_ASSETS_HISTORY, ORACLE_PREDICTIONS)')
    out.append('- Cron: "0 23 * * 1-5" UTC (Mon-Fri 20:00 Argentina)')
    out.append('- 4-model ensemble predictor: OLS + EWMA + momentum + Bayesian')
    out.append('- Constants: MIN_HISTORY_DAYS=9, CONFIDENCE_THRESHOLD=0.65, HIGH_CONVICTION=0.85')
    out.append('')
    out.append('KNOWN STATE:')
    out.append('- FASE 0 (localeCompare null guards) DEPLOYED')
    out.append('- FASE 0.5 (price null guards + tombstone semantics) DEPLOYED')
    out.append('- predictions_count=459 are TOMBSTONES (price:null data, confidence=0, data_quality=insufficient)')
    out.append('  → NOT real predictions. FASE 0.6 (1-line fix to exclude from telemetry) PENDING')
    out.append('- CRITICAL BUG: /api/oracle/cron hangs because wrap-worker-with-cron.mjs:54 maps')
    out.append('  snapshot_archive → /api/oracle/cron, which calls runAllCronJobs() and re-executes')
    out.append('  all 6 jobs in-process (12 runMultiOracle calls instead of 6).')
    out.append('  → Vie 03-Jul cron exceeded 15min CF limit and was killed silently.')
    out.append('  → Fix proposed for Lun 06-Jul: see /home/z/my-project/download/cron-recursion-diagnosis-2026-07-04.md')
    out.append('- FREEZE CRITICAL_ENGINEERING_ONLY active. Only null-guards and wiring fixes allowed.')
    out.append('  Scoring engine, weights, linear_factor_model_v1 model NOT to be modified.')
    out.append('')
    out.append('AUDIT PRIORITIES (suggested):')
    out.append('1. Verify null-guard completeness in oracle-multi/{storage,rank,predict}.ts (FASE 0+0.5)')
    out.append('2. Confirm no NaN/Infinity can propagate to oracle_score')
    out.append('3. Identify any remaining crash paths in cron pipeline')
    out.append('4. Spot logic errors in 4-model ensemble (predict.ts:predictAsset)')
    out.append('5. Check KV write patterns for race conditions')
    out.append('6. Review telemetry counter semantics (predictions_count includes tombstones — bug)')
    out.append('7. Sanity-check the proposed cron fix in the diagnosis report')
    out.append('')
    out.append('FILES INCLUDED: ' + str(len(FILES)))
    out.append('=' * 80)
    out.append('')

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

        out.append('')
        out.append('━' * 80)
        out.append(f'FILE: {fpath}')
        out.append(f'  lines: {lines}  |  bytes: {size}  |  encoding: utf-8')
        out.append('━' * 80)
        out.append('')
        out.append(content.rstrip())
        out.append('')  # ensure newline before next file

    # Footer
    out.append('')
    out.append('=' * 80)
    out.append('END OF PROJECT SOURCE')
    out.append(f'Total files: {len(FILES) - len(skipped)} / {len(FILES)}')
    out.append(f'Total lines: {total_lines}')
    out.append(f'Total bytes: {total_bytes} ({total_bytes/1024:.1f} KB)')
    if skipped:
        out.append('')
        out.append('SKIPPED FILES:')
        for s in skipped:
            out.append(f'  - {s}')
    out.append('=' * 80)

    result = '\n'.join(out)
    out_path = Path('/home/z/my-project/download/full-project-for-audit.txt')
    out_path.write_text(result, encoding='utf-8')

    print(f'✅ Generated: {out_path}')
    print(f'   Files: {len(FILES) - len(skipped)} / {len(FILES)}')
    print(f'   Lines: {total_lines}')
    print(f'   Bytes: {total_bytes} ({total_bytes/1024:.1f} KB)')
    if skipped:
        print(f'   Skipped: {len(skipped)}')
        for s in skipped:
            print(f'     - {s}')

if __name__ == '__main__':
    main()
