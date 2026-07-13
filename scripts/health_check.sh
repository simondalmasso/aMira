#!/usr/bin/env bash
# Santaninver Oracle — Health Check (no-deploy, read-only)
# Run: bash /home/z/my-project/scripts/health_check.sh
# Exit 0 = healthy, 1 = degraded, 2 = unreachable
set -uo pipefail
URL="https://santaninverter-oracle.simondalmasso44.workers.dev"
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "=== Santaninver Oracle Health — $TS ==="

# 1. Predictions POST (cron-equivalent call)
POST_CODE=$(curl -sS -m 90 -X POST -o /tmp/health_post.json -w "%{http_code}" \
  -H "User-Agent: santaninverter-oracle-cron/4.0" -H "X-Internal-Cron: 1" \
  "$URL/api/oracle/predictions")
POST_SUCCESS=$(grep -o '"success":true' /tmp/health_post.json | head -1 || echo "")
POST_PRED=$(grep -oE '"predictions_count":[0-9]+' /tmp/health_post.json || echo "predictions_count:n/a")
echo "[1] POST /api/oracle/predictions → HTTP $POST_CODE  $POST_SUCCESS  $POST_PRED"

# 2. Telemetry
TLM_CODE=$(curl -sS -m 30 -o /tmp/health_tlm.json -w "%{http_code}" \
  "$URL/api/telemetry?action=summary")
if [ "$TLM_CODE" = "200" ]; then
  CONF=$(grep -oE '"recentConfidence":[0-9.]+' /tmp/health_tlm.json | head -1)
  REAL=$(grep -oE '"REAL":[0-9]+' /tmp/health_tlm.json | head -1)
  ERR=$(grep -oE '"ERROR":[0-9]+' /tmp/health_tlm.json | head -1)
  LAST=$(grep -oE '"lastPipelineExecution":"[^"]+"' /tmp/health_tlm.json | head -1)
  DEC=$(grep -oE '"totalDecisions":[0-9]+' /tmp/health_tlm.json | head -1)
  echo "[2] Telemetry → HTTP $TLM_CODE"
  echo "    $CONF  $REAL  $ERR  $DEC  $LAST"
else
  echo "[2] Telemetry → HTTP $TLM_CODE (FAIL)"
fi

# 3. Verdict
if [ "$POST_CODE" = "200" ] && [ -n "$POST_SUCCESS" ]; then
  echo "=== VEREDICT: HEALTHY (POST OK, FASE 0 alive) ==="
  exit 0
elif [ "$POST_CODE" = "405" ]; then
  echo "=== VEREDICT: DEGRADED — 405 regresó (P2 roto?) ==="
  exit 1
else
  echo "=== VEREDICT: DEGRADED — POST HTTP $POST_CODE ==="
  exit 1
fi
