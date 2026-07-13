#!/usr/bin/env bash
# ============================================================================
# verify_cron_2026_06_26.sh
# ----------------------------------------------------------------------------
# Verificación del cron automático 23:00 UTC (20:00 AR) del 2026-06-26 —
# primera ejecución del Santaninver Oracle con el fix
# CRON_PERSISTENCE_WIRING_FIX (Opción A + Opción B) deployado en
# Version 3a30ebec-caa3-4e3b-979a-8c5aee99647c.
#
# Criterios de éxito (CASO_A limpio):
#   1. Nuevo EVT-CRON-* event con timestamp > 1782500000000 (hoy post-midnight UTC)
#   2. jobs_ok = 6
#   3. jobs_failed = 0
#   4. kv_delta.assets > 0
#   5. kv_delta.fci > 0  (opcional, refresh_fci puede devolver mismo día)
#   6. silent_failure_detected = false
#   7. env_bindings_present = true
#   8. env_bindings_missing = []
#
# Cualquier otro caso → CASO_B (auditar wiring persistente) o
# CASO_AMBIGUO (jobs_ok=6 pero kv_delta=0 → escrituras fantasma, auditar path).
#
# Uso:
#   export CLOUDFLARE_API_TOKEN="<tu-token>"
#   bash /home/z/my-project/scripts/verify_cron_2026_06_26.sh
# ============================================================================

set -euo pipefail

ACCOUNT_ID="b21fa81d12acb663798f9f7c51801955"
PREDICTIONS_NS="968f1bce04ec4949bf37cfbc3a053153"   # KV namespace con telemetry:event:*
ASSETS_NS="630b5eb6c3f64da1b808bbb67928bf2d"        # KV namespace con snap:*
FCI_NS="b95f695ecf9c441d85ebf02588cf23a5"           # KV namespace con snap:FCI:*

CUTOFF_TS="1782500000000"  # 2026-06-26 00:53:30 UTC — cualquier EVT-CRON con ts mayor es de hoy

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "ERROR: CLOUDFLARE_API_TOKEN no está seteado en el entorno"
  echo "  export CLOUDFLARE_API_TOKEN=\"<tu-token>\""
  exit 1
fi

AUTH_HEADER="Authorization: Bearer $CLOUDFLARE_API_TOKEN"
API_BASE="https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/storage/kv/namespaces"

echo "=================================================================="
echo "  VERIFICACIÓN CRON 2026-06-26 23:00 UTC (20:00 AR)"
echo "  Fix: CRON_PERSISTENCE_WIRING_FIX (Opción A + B)"
echo "  Deploy: Version 3a30ebec-caa3-4e3b-979a-8c5aee99647c"
echo "=================================================================="
echo
echo ">>> Paso 1: Listar últimos 10 EVT-CRON-* events"
EVT_KEYS=$(curl -sS --max-time 20 "$API_BASE/$PREDICTIONS_NS/keys?prefix=telemetry:event:EVT-CRON-&limit=20" \
  -H "$AUTH_HEADER" | jq -r '.result[].name' | sort)

echo "$EVT_KEYS" | tail -10
echo

echo ">>> Paso 2: Identificar el MÁS RECIENTE con timestamp > $CUTOFF_TS (hoy)"
LATEST_NEW_KEY=""
while IFS= read -r key; do
  ts=$(echo "$key" | grep -oE '[0-9]{13}' | head -1)
  if [ -n "$ts" ] && [ "$ts" -gt "$CUTOFF_TS" ]; then
    LATEST_NEW_KEY="$key"
  fi
done <<< "$EVT_KEYS"

if [ -z "$LATEST_NEW_KEY" ]; then
  echo "❌ CASO_B: NO se encontró nuevo EVT-CRON-* con timestamp de hoy"
  echo "   Último EVT-CRON sigue siendo de cron anterior (ayer o antes)."
  echo "   El cron automático NO disparó o el handler scheduled() no se ejecutó."
  echo
  echo "   Acción: revisar logs de Cloudflare → Workers → santaninverter-oracle → Triggers"
  exit 2
fi

echo "✅ Nuevo EVT-CRON-* de hoy encontrado: $LATEST_NEW_KEY"
echo

echo ">>> Paso 3: Leer contenido del nuevo EVT-CRON-* event"
EVENT_JSON=$(curl -sS --max-time 20 "$API_BASE/$PREDICTIONS_NS/values/$LATEST_NEW_KEY" \
  -H "$AUTH_HEADER")

echo "$EVENT_JSON" | jq '.'
echo

echo ">>> Paso 4: Evaluar criterios de éxito (CASO_A limpio)"
echo "----------------------------------------------------------"

# Extraer campos con jq
JOBS_OK=$(echo "$EVENT_JSON" | jq -r '.data.jobs_ok // "null"')
JOBS_FAILED=$(echo "$EVENT_JSON" | jq -r '.data.jobs_failed // "null"')
KV_DELTA_ASSETS=$(echo "$EVENT_JSON" | jq -r '.data.kv_delta.assets // "null"')
KV_DELTA_FCI=$(echo "$EVENT_JSON" | jq -r '.data.kv_delta.fci // "null"')
SILENT_FAIL=$(echo "$EVENT_JSON" | jq -r '.data.silent_failure_detected // "null"')
BINDINGS_PRESENT=$(echo "$EVENT_JSON" | jq -r '.data.env_bindings_present // "null"')
BINDINGS_MISSING=$(echo "$EVENT_JSON" | jq -r '.data.env_bindings_missing | join(",") // "null"')

verdict() {
  if [ "$1" = "$2" ]; then echo "✅ $3: $1 (esperado: $2)"; return 0
  else echo "❌ $3: $1 (esperado: $2)"; return 1; fi
}

verdict_pos() {
  if [ "$1" -gt 0 ] 2>/dev/null; then echo "✅ $2: $1 (>0)"; return 0
  else echo "❌ $2: $1 (esperado >0)"; return 1; fi
}

verdict "$JOBS_OK" "6" "jobs_ok"
verdict "$JOBS_FAILED" "0" "jobs_failed"
verdict_pos "$KV_DELTA_ASSETS" "kv_delta.assets"
verdict_pos "$KV_DELTA_FCI" "kv_delta.fci (opcional)"
verdict "$SILENT_FAIL" "false" "silent_failure_detected"
verdict "$BINDINGS_PRESENT" "true" "env_bindings_present"
verdict "$BINDINGS_MISSING" "" "env_bindings_missing (vacío)"
echo "----------------------------------------------------------"
echo

echo ">>> Paso 5: Sanity check en KV directo (snapshots de hoy)"
echo "  ASSETS_HISTORY snapshots 2026-06-26:"
curl -sS --max-time 15 "$API_BASE/$ASSETS_NS/keys?prefix=snap:&limit=100" -H "$AUTH_HEADER" \
  | jq -r '.result[].name' | grep '2026-06-26' | sed 's/^/    /' || echo "    (ninguno)"
echo "  FCI_HISTORY snapshots 2026-06-26:"
curl -sS --max-time 15 "$API_BASE/$FCI_NS/keys?prefix=snap:&limit=50" -H "$AUTH_HEADER" \
  | jq -r '.result[].name' | grep '2026-06-26' | sed 's/^/    /' || echo "    (ninguno)"
echo

echo ">>> Paso 6: Veredicto final"
if [ "$JOBS_OK" = "6" ] && [ "$JOBS_FAILED" = "0" ] && [ "$KV_DELTA_ASSETS" -gt 0 ] 2>/dev/null && [ "$SILENT_FAIL" = "false" ]; then
  echo "✅✅✅ CASO_A LIMPIO — FIX CONFIRMADO FUNCIONAL EN CRON AUTOMÁTICO"
  echo "   El wiring KV vía getCloudflareContext() opera correctamente en scheduled()."
  echo "   Inicia contador 30d de telemetría para validar backtesting pipeline."
  exit 0
elif [ "$JOBS_OK" = "6" ] && [ "$KV_DELTA_ASSETS" = "0" ]; then
  echo "⚠️ CASO_AMBIGUO — jobs_ok=6 PERO kv_delta.assets=0 (escrituras fantasma)"
  echo "   Auditar path: getCloudflareContext() puede no resolver bindings en scheduled()"
  echo "   Pasar a Opción B bypass HTTP: llamar runAllCronJobs(env) directamente"
  exit 3
else
  echo "❌ CASO_B — cron disparó pero jobs_failed>0 o silent_failure_detected=true"
  echo "   Revisar el objeto 'results' del evento para ver qué job falló."
  echo "   Opción B (throw) garantiza que el fallo NO fue silencioso → error explícito."
  exit 4
fi
