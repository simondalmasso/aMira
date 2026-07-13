#!/usr/bin/env bash
# ==============================================================================
# Gate 1 — Validación automática post-cron Vie 10-Jul 23:00 UTC (20:00 AR)
#
# Uso:
#   ./gate1_validate.sh                # validar contra baseline pre-cron
#   ./gate1_validate.sh --capture      # capturar baseline ANTES del cron
#
# Endpoint observable públicamente:
#   GET /api/telemetry  →  pipelineExecutions, lastPipelineExecution,
#                          emergencyFreezes, dataIntegrityFailures, recentConfidence
#   GET /api/audit      →  recentErrors, recentWarnings, validationSuccessRate
#
# Detalles internos del cron (jobs_total, persistence_verified, wall_clock)
# no se exponen vía REST — viven en el Durable Object. Gate 1 se valida con
# los efectos observables en telemetry + audit.
# ==============================================================================

set -euo pipefail

ORACLE="https://santaninverter-oracle.simondalmasso44.workers.dev"
BASELINE_FILE="/home/z/my-project/scripts/gate1_baseline.json"
RAW_FILE="/home/z/my-project/scripts/gate1_last_run.json"

# Color codes (disabled if not a TTY)
if [ -t 1 ]; then
  GREEN=$'\e[32m'; RED=$'\e[31m'; YELLOW=$'\e[33m'; CYAN=$'\e[36m'; BOLD=$'\e[1m'; RESET=$'\e[0m'
else
  GREEN=""; RED=""; YELLOW=""; CYAN=""; BOLD=""; RESET=""
fi

# -----------------------------------------------------------------------------
# Mode: --capture → grabar baseline pre-cron
# -----------------------------------------------------------------------------
if [ "${1:-}" = "--capture" ]; then
  echo "${CYAN}[capture]${RESET} Tomando baseline pre-cron a las $(TZ='America/Buenos_Aires' date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "${CYAN}[capture]${RESET} Hit /api/telemetry + /api/audit..."
  TEL=$(curl -s "$ORACLE/api/telemetry" --max-time 30 || echo '{}')
  AUD=$(curl -s "$ORACLE/api/audit" --max-time 30 || echo '{}')
  python3 - "$TEL" "$AUD" "$BASELINE_FILE" <<'PY'
import sys, json
tel_raw, aud_raw, out = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    tel = json.loads(tel_raw)
    aud = json.loads(aud_raw)
except Exception as e:
    print(f"ERR parseando: {e}", file=sys.stderr); sys.exit(1)

t = tel.get('telemetry', {})
baseline = {
    'captured_at_utc': tel.get('timestamp'),
    'pipelineExecutions': t.get('pipelineExecutions'),
    'lastPipelineExecution': t.get('lastPipelineExecution'),
    'emergencyFreezes': t.get('emergencyFreezes'),
    'dataIntegrityFailures': t.get('dataIntegrityFailures'),
    'staleDegradations': t.get('staleDegradations'),
    'recentConfidence': t.get('recentConfidence'),
    'audit_recentErrors': aud.get('stats', {}).get('recentErrors'),
    'audit_recentWarnings': aud.get('stats', {}).get('recentWarnings'),
    'audit_validationSuccessRate': aud.get('stats', {}).get('validationSuccessRate'),
}
with open(out, 'w') as f:
    json.dump(baseline, f, indent=2)
print(json.dumps(baseline, indent=2))
print(f"\n[OK] baseline guardado en {out}")
PY
  exit 0
fi

# -----------------------------------------------------------------------------
# Mode: default → validar post-cron contra baseline (o contra hardcode si no hay)
# -----------------------------------------------------------------------------
echo "${BOLD}═══════════════════════════════════════════════════════════════════════════${RESET}"
echo "${BOLD} GATE 1 — Validación post-cron Vie 10-Jul 23:00 UTC${RESET}"
echo "${BOLD}═══════════════════════════════════════════════════════════════════════════${RESET}"
echo "Hora actual: $(TZ='America/Buenos_Aires' date '+%Y-%m-%d %H:%M:%S %Z')  /  $(TZ='UTC' date '+%Y-%m-%d %H:%M:%S %Z')"
echo

# Baseline: si existe archivo, usarlo; si no, hardcode del snapshot Jue 09-Jul 22:30 UTC
if [ -f "$BASELINE_FILE" ]; then
  echo "${CYAN}[info]${RESET} Usando baseline capturado de: $(python3 -c "import json;print(json.load(open('$BASELINE_FILE'))['captured_at_utc'])")"
else
  echo "${YELLOW}[warn]${RESET} No hay baseline capturado. Uso hardcode del snapshot Jue 09-Jul 22:30 UTC."
  echo "        Para mayor precisión, correr 'gate1_validate.sh --capture' ANTES del cron."
fi
echo

# Fetch live data
echo "${CYAN}[fetch]${RESET} GET /api/telemetry + /api/audit..."
TEL=$(curl -s "$ORACLE/api/telemetry" --max-time 30 || echo '{}')
AUD=$(curl -s "$ORACLE/api/audit" --max-time 30 || echo '{}')

# Save raw for debugging
python3 -c "
import json,sys
out={'telemetry':json.loads(sys.argv[1]),'audit':json.loads(sys.argv[2])}
json.dump(out,open('$RAW_FILE','w'),indent=2)
" "$TEL" "$AUD"

# Run validation
python3 - "$TEL" "$AUD" "$BASELINE_FILE" <<'PY'
import sys, json, os
from datetime import datetime, timezone

tel_raw, aud_raw, baseline_file = sys.argv[1], sys.argv[2], sys.argv[3]

GREEN, RED, YELLOW, CYAN, BOLD, RESET = '\033[32m','\033[31m','\033[33m','\033[36m','\033[1m','\033[0m'

tel = json.loads(tel_raw)
aud = json.loads(aud_raw)
t = tel.get('telemetry', {})

# Baseline (hardcode fallback si no hay archivo)
if os.path.exists(baseline_file):
    bl = json.load(open(baseline_file))
else:
    bl = {
        'pipelineExecutions': 26,
        'lastPipelineExecution': '2026-07-08T23:10:10.184Z',
        'emergencyFreezes': 4,
        'dataIntegrityFailures': 0,
        'staleDegradations': 0,
        'recentConfidence': 0.51,
    }

# Criterios Gate 1
checks = []

# C1: pipelineExecutions incrementó (26 → 27 o más)
prev_pe = bl.get('pipelineExecutions')
curr_pe = t.get('pipelineExecutions')
c1_pass = (curr_pe is not None) and (prev_pe is None or curr_pe > prev_pe)
checks.append({
    'id': 'C1',
    'name': 'pipelineExecutions incrementó',
    'expected': f'> {prev_pe} (esperado ≥ {prev_pe+1 if prev_pe else "?"})',
    'observed': str(curr_pe),
    'pass': c1_pass,
    'note': f'Δ = {(curr_pe or 0) - (prev_pe or 0)} ejecuciones nuevas'
})

# C2: lastPipelineExecution avanzó a hoy (post 2026-07-10T22:00Z)
prev_lpe = bl.get('lastPipelineExecution')
curr_lpe = t.get('lastPipelineExecution')
try:
    prev_dt = datetime.fromisoformat(prev_lpe.replace('Z','+00:00')) if prev_lpe else None
    curr_dt = datetime.fromisoformat(curr_lpe.replace('Z','+00:00')) if curr_lpe else None
    threshold = datetime(2026, 7, 10, 22, 0, tzinfo=timezone.utc)
    c2_pass = (curr_dt is not None) and (curr_dt > threshold) and (prev_dt is None or curr_dt > prev_dt)
except Exception:
    c2_pass = False
    curr_dt = None
checks.append({
    'id': 'C2',
    'name': 'lastPipelineExecution avanzó a Vie 10-Jul 23:XX UTC',
    'expected': '> 2026-07-10T22:00:00Z',
    'observed': curr_lpe or 'None',
    'pass': c2_pass,
    'note': f'previo: {prev_lpe}'
})

# C3: emergencyFreezes no aumentó (sin nuevo freeze)
prev_ef = bl.get('emergencyFreezes')
curr_ef = t.get('emergencyFreezes')
c3_pass = (curr_ef is not None) and (prev_ef is None or curr_ef <= prev_ef)
checks.append({
    'id': 'C3',
    'name': 'No nuevo emergencyFreeze',
    'expected': f'≤ {prev_ef}',
    'observed': str(curr_ef),
    'pass': c3_pass,
    'note': f'delta = {(curr_ef or 0) - (prev_ef or 0)}'
})

# C4: dataIntegrityFailures sigue en 0
curr_dif = t.get('dataIntegrityFailures')
c4_pass = (curr_dif == 0)
checks.append({
    'id': 'C4',
    'name': 'dataIntegrityFailures = 0',
    'expected': '0',
    'observed': str(curr_dif),
    'pass': c4_pass,
    'note': 'cualquier valor >0 es blocker'
})

# C5: recentConfidence > 0 (modelo no rompió)
curr_rc = t.get('recentConfidence')
c5_pass = (curr_rc is not None) and (curr_rc > 0)
checks.append({
    'id': 'C5',
    'name': 'recentConfidence > 0 (modelo vivo)',
    'expected': '> 0.0',
    'observed': str(curr_rc),
    'pass': c5_pass,
    'note': f'previo: {bl.get("recentConfidence")}'
})

# C6 (bonus): audit sin errores recientes
audit_stats = aud.get('stats', {})
audit_err = audit_stats.get('recentErrors')
audit_warn = audit_stats.get('recentWarnings')
audit_vsr = audit_stats.get('validationSuccessRate')
c6_pass = (audit_err == 0)
checks.append({
    'id': 'C6',
    'name': 'audit recentErrors = 0 (bonus)',
    'expected': '0',
    'observed': f'errors={audit_err}, warnings={audit_warn}, vsr={audit_vsr}',
    'pass': c6_pass,
    'note': 'bonus — no bloquea Gate 1 si C1-C5 pass'
})

# Render
print(f"{BOLD}─" * 75 + f"{RESET}")
print(f"{BOLD} RESULTADO DE LOS 6 CRITERIOS{RESET}")
print(f"{BOLD}─" * 75 + f"{RESET}")
all_pass = True
for c in checks:
    mark = f'{GREEN}✓ PASS{RESET}' if c['pass'] else f'{RED}✗ FAIL{RESET}'
    bonus = f' {YELLOW}[bonus]{RESET}' if c['id'] == 'C6' else ''
    print(f" {c['id']}{bonus}  {mark}  {c['name']}")
    print(f"        expected: {CYAN}{c['expected']}{RESET}")
    print(f"        observed: {BOLD}{c['observed']}{RESET}")
    print(f"        note:     {c['note']}")
    print()
    if not c['pass'] and c['id'] != 'C6':
        all_pass = False

# Blocker summary
critical = [c for c in checks if not c['pass'] and c['id'] != 'C6']
print(f"{BOLD}─" * 75 + f"{RESET}")
if all_pass:
    print(f"{GREEN}{BOLD}🟢 GATE 1: PASS — todas las críticas (C1-C5) pasaron{RESET}")
    print(f"{GREEN}    → Habilitado Gate 2 (Sáb 11-Jul): probe 4 herramientas SantanderAI{RESET}")
else:
    print(f"{RED}{BOLD}🔴 GATE 1: FAIL — {len(critical)} criterio(s) crítico(s) fallaron{RESET}")
    for c in critical:
        print(f"{RED}    → {c['id']}: {c['name']} (observed: {c['observed']}){RESET}")
    print(f"{YELLOW}    → NO habilitar Gate 2 hasta diagnosticar{RESET}")
    print(f"{YELLOW}    → Revisar raw en /home/z/my-project/scripts/gate1_last_run.json{RESET}")
print(f"{BOLD}─" * 75 + f"{RESET}")

# Snapshot final compacto para worklog
print()
print(f"{CYAN}[snapshot] pipelineExecutions={curr_pe} lastPipelineExecution={curr_lpe}{RESET}")
print(f"{CYAN}[snapshot] emergencyFreezes={curr_ef} dataIntegrityFailures={curr_dif} recentConfidence={curr_rc}{RESET}")
print(f"{CYAN}[snapshot] audit errors={audit_err} warnings={audit_warn} vsr={audit_vsr}{RESET}")
PY
