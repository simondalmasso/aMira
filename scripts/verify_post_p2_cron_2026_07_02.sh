#!/bin/bash
# ════════════════════════════════════════════════════════════════════════════
# verify_post_p2_cron_2026_07_02.sh
# ════════════════════════════════════════════════════════════════════════════
# Verificación post-cron para la primera ejecución de las 23:00 UTC del
# 2026-07-02, después del deploy del fix P2 (POST handler en
# /api/oracle/predictions/route.ts).
#
# Tres hipótesis a confirmar, en orden:
#   H1 (P2 funcionó)         — refresh_predictions ya no devuelve 405
#   H2 (localeCompare es causa) — si devuelve 500, el body debe mencionar
#                                  "Cannot read properties of null (reading 'localeCompare')"
#   H3 (motor desbloqueado)  — si devuelve 200, predictions_summary.active == true
#                                  y assets_with_predictions > 0
#
# Salidas:
#   EXIT 0 = H1 confirmada (P2 funcionó — ya sea 200 o 500, NO 405)
#   EXIT 1 = H1 fallida (405 persiste — POST handler no deployado)
#   EXIT 2 = error de red / wrangler no disponible
#
# Uso:
#   bash /home/z/my-project/scripts/verify_post_p2_cron_2026_07_02.sh
#
# Ejecutar a partir de las 23:05 UTC del 2026-07-02 (20:05 ART).
# ════════════════════════════════════════════════════════════════════════════

set -uo pipefail

WORKER_NAME="santaninverter-oracle"
PREDICTIONS_URL="https://santaninverter-oracle.simondalmasso44.workers.dev/api/oracle/predictions"
TELEMETRY_URL="https://santaninverter-oracle.simondalmasso44.workers.dev/api/oracle/telemetry?action=summary"
LOG_FILE="/home/z/my-project/scripts/verify_post_p2_cron_2026_07_02.log"

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG_FILE"; }

log "════════════════════════════════════════════════════════════════"
log "POST-P2 CRON VERIFICATION — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "════════════════════════════════════════════════════════════════"

# ─── H1: Invocar POST /api/oracle/predictions directamente ─────────────────
# Esto reproduce exactamente lo que hace wrap-worker-with-cron.mjs:74
log ""
log "[H1] Invocando POST /api/oracle/predictions (reproduce cron call)..."
POST_RESPONSE=$(curl -sS -w "\n__HTTP_STATUS__%{http_code}" \
  -X POST \
  -H "User-Agent: santaninverter-oracle-cron/4.0" \
  -H "X-Internal-Cron: 1" \
  --max-time 60 \
  "$PREDICTIONS_URL" 2>&1) || {
    log "[H1] FAIL — curl error: $POST_RESPONSE"
    exit 2
  }

POST_STATUS=$(echo "$POST_RESPONSE" | grep -oE '__HTTP_STATUS__[0-9]+' | grep -oE '[0-9]+')
POST_BODY=$(echo "$POST_RESPONSE" | sed 's/__HTTP_STATUS__[0-9]*$//' | head -c 4000)

log "[H1] HTTP status: $POST_STATUS"
log "[H1] Body (primeros 4000 chars):"
echo "$POST_BODY" | sed 's/^/      /' | tee -a "$LOG_FILE"

case "$POST_STATUS" in
  405)
    log ""
    log "[H1] ❌ FAIL — 405 Method Not Allowed persiste."
    log "    El fix P2 NO está deployado. El Version ID actual no incluye el POST handler."
    log "    Acción: redeploy con `bun run deploy` o `opennextjs-cloudflare deploy`."
    exit 1
    ;;
  200)
    log ""
    log "[H1] ✅ PASS — 200 OK. El POST handler está vivo."
    log "[H3] Verificando que el motor de predicciones realmente se desbloqueó..."
    PREDICTIONS_ACTIVE=$(echo "$POST_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('predictions_active'))" 2>/dev/null || echo "PARSE_ERROR")
    PREDICTIONS_COUNT=$(echo "$POST_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('predictions_count'))" 2>/dev/null || echo "PARSE_ERROR")
    HIGH_CONV=$(echo "$POST_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('high_conviction_count'))" 2>/dev/null || echo "PARSE_ERROR")
    log "[H3] predictions_active   = $PREDICTIONS_ACTIVE"
    log "[H3] predictions_count    = $PREDICTIONS_COUNT"
    log "[H3] high_conviction_count= $HIGH_CONV"
    if [ "$PREDICTIONS_ACTIVE" = "True" ] && [ "$PREDICTIONS_COUNT" != "0" ] && [ "$PREDICTIONS_COUNT" != "PARSE_ERROR" ]; then
      log "[H3] ✅ PASS — Motor desbloqueado. recentConfidence debería recuperarse en próximos ciclos."
    else
      log "[H3] ⚠️  Motor activo pero 0 predicciones — posible data gap (sin snapshots recientes)."
    fi
    ;;
  500)
    log ""
    log "[H1] ✅ PASS (parcial) — 500 Internal Server Error. POST handler existe y se ejecutó."
    log "[H2] Verificando si el body contiene el error localeCompare..."
    if echo "$POST_BODY" | grep -qi "localeCompare"; then
      log "[H2] ✅ CONFIRMED — El bug es localeCompare sobre un valor null."
      log "    Hipótesis confirmada: algún PricePoint.date o AssetSnapshot.date es null."
      log "    Próximo paso: aplicar null-guard en storage.ts:871 (buildPriceSeries),"
      log "    rank.ts:2221/2231/2247, predict.ts:2437, telemetry.ts:1437/1462/1490/1528."
      log "    Fix sugerido: a.date?.localeCompare(b.date) ?? 0  (o filter nulls antes del sort)."
    else
      log "[H2] ⚠️  500 pero NO es localeCompare. Otro bug emerge — inspeccionar body arriba."
    fi
    ;;
  *)
    log ""
    log "[H1] ⚠️  Status inesperado: $POST_STATUS — inspeccionar body arriba."
    ;;
esac

# ─── H-extra: chequear la última entrada de telemetría del cron ─────────────
log ""
log "[TELEMETRY] Consultando /api/oracle/telemetry?action=summary..."
TELEMETRY_RESPONSE=$(curl -sS --max-time 30 "$TELEMETRY_URL" 2>&1) || {
  log "[TELEMETRY] FAIL — curl error. Continuando."
  TELEMETRY_RESPONSE="{}"
}
echo "$TELEMETRY_RESPONSE" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    print('      (parse error)')
    sys.exit(0)
print(f'      pipelineExecutions: {d.get(\"pipelineExecutions\")}')
print(f'      lastPipelineExecution: {d.get(\"lastPipelineExecution\")}')
print(f'      totalDecisions: {d.get(\"totalDecisions\")}')
print(f'      recentConfidence: {d.get(\"recentConfidence\")}')
print(f'      recentRegime: {d.get(\"recentRegime\")}')
print(f'      daysOfHistory: {d.get(\"daysOfHistory\")}')
" 2>/dev/null | tee -a "$LOG_FILE" || true

# ─── Verificar logs del worker con wrangler (opcional) ─────────────────────
if command -v wrangler >/dev/null 2>&1; then
  log ""
  log "[WRANGLER] Últimos 50 líneas de logs del worker (buscando [cron] y [cron-persist])..."
  wrangler tail "$WORKER_NAME" --format json --once 2>&1 | head -200 | tee -a "$LOG_FILE" || true
else
  log ""
  log "[WRANGLER] wrangler no disponible en PATH — omitiendo tail de logs."
fi

log ""
log "════════════════════════════════════════════════════════════════"
log "VERIFICACIÓN COMPLETA — log en $LOG_FILE"
log "════════════════════════════════════════════════════════════════"

# Exit code refleja H1
case "$POST_STATUS" in
  405) exit 1 ;;
  *)   exit 0 ;;
esac
