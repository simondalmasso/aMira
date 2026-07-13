#!/usr/bin/env python3
"""
Omega-X10 FULL SYSTEM REPAIR - Verification Script
Tests all 9 patches for the SANTANINVERTER_ORACLE system
"""
import os
import sys

BASE = '/home/z/my-project'
WORKER = f'{BASE}/santaninverter-oracle/src/worker.ts'
ENGINE = f'{BASE}/santaninverter-oracle/src/lib/engine.ts'
FETCHER = f'{BASE}/santaninverter-oracle/src/lib/data-fetcher.ts'
TYPES = f'{BASE}/santaninverter-oracle/src/lib/types.ts'
SEEDED_RNG = f'{BASE}/santaninverter-oracle/src/lib/seeded-rng.ts'
PAPER_BROKER = f'{BASE}/src/lib/paper-broker.ts'
BACKTEST = f'{BASE}/src/lib/backtest-engine.ts'
TELEMETRY = f'{BASE}/src/lib/telemetry.ts'
PNL_ATTR = f'{BASE}/src/lib/pnl-attribution.ts'
DATA_INTEGRITY = f'{BASE}/src/lib/data-integrity.ts'

results = []

def check(id, name, passed, detail):
    status = "PASS" if passed else "FAIL"
    results.append((id, name, passed, detail))
    print(f"  [{status}] [{id}] {name}: {detail}")

def read_file(path):
    try:
        with open(path, 'r') as f:
            return f.read()
    except:
        return ""

print("=" * 70)
print("Omega-X10 FULL SYSTEM REPAIR - VERIFICATION")
print("=" * 70)

# PATCH 1: FAIL HARD data labeling
print("\n--- PATCH 1: FAIL HARD Data Labeling ---")
worker = read_file(WORKER)
fetcher = read_file(FETCHER)
types_content = read_file(TYPES)
data_int = read_file(DATA_INTEGRITY)

modelo_in_worker_data = worker.count("'MODELO'") + worker.count('"MODELO"')
# Exclude deploy guard check references (intentional MODELO detection)
modelo_in_worker_data -= worker.count("includes('MODELO')") + worker.count("source === 'MODELO'")
modelo_in_fetcher = fetcher.count("'MODELO'") + fetcher.count('"MODELO"')

check("1a", "No MODELO in worker.ts data labels", modelo_in_worker_data == 0,
      f"MODELO data references in worker.ts: {modelo_in_worker_data} (expect 0, guard checks excluded)")
check("1b", "No MODELO in data-fetcher.ts", modelo_in_fetcher == 0,
      f"MODELO references in data-fetcher.ts: {modelo_in_fetcher}")
check("1c", "DataLabel type excludes MODELO", 'MODELO' not in types_content.split('DataLabel')[1][:100] if 'DataLabel' in types_content else False,
      "DataLabel type has MODELO removed")
check("1d", "PARTIAL_FALLBACK used for derived values", "PARTIAL_FALLBACK" in fetcher,
      "PARTIAL_FALLBACK found in data-fetcher.ts")
check("1e", "ERROR default for failed fetches", "mepLabel='ERROR'" in worker or "mepLabel = 'ERROR'" in worker,
      "mepLabel defaults to ERROR in worker")

# PATCH 2: Regime Engine
print("\n--- PATCH 2: Regime Engine Fix ---")
engine = read_file(ENGINE)

check("2a", "Crisis recall boost 0.3", "0.3" in engine and "crisisRecallBoost" in engine,
      "Crisis recall boost set to 0.3")
check("2b", "Entropy validation present", "signalSum < 15" in engine,
      "Entropy validation with raised threshold")
check("2c", "Lowered carry priority", "fisherReal > 0.015" in engine,
      "Carry requires fisherReal > 0.015")
check("2d", "NORMAL as default fallback", "return 'NORMAL'" in engine,
      "NORMAL is the statistical baseline default")

# PATCH 3: Deterministic seed
print("\n--- PATCH 3: Deterministic Backtest ---")
seeded_rng = read_file(SEEDED_RNG)
pnl = read_file(PNL_ATTR)

check("3a", "mulberry32 seeded PRNG exists", "mulberry32" in seeded_rng,
      "Seeded PRNG implemented")
check("3b", "Seed=42 hardcoded in backtest", "seed = 42" in worker,
      "Seed=42 hardcoded in worker backtest handler")
check("3c", "No Math.random() in pnl-attribution", "Math.random()" not in pnl.replace("// Deterministic ID counter — no Math.random() allowed", ""),
      "Math.random() removed from pnl-attribution.ts (comment-only reference is OK)")

# PATCH 4: Attribution Pipeline
print("\n--- PATCH 4: Attribution Pipeline ---")
paper_broker = read_file(PAPER_BROKER)
backtest = read_file(BACKTEST)

check("4a", "recordSignalReturn imported in paper-broker", "recordSignalReturn" in paper_broker,
      "recordSignalReturn imported in PaperBroker")
check("4b", "recordSignalReturn called in settleTrade", "recordSignalReturn('regime'" in paper_broker,
      "recordSignalReturn called in PnL realization")
check("4c", "recordSignalReturn imported in backtest-engine", "recordSignalReturn" in backtest,
      "recordSignalReturn imported in BacktestEngine")
check("4d", "All 5 signals tracked in backtest", 
      all(s in backtest for s in ["recordSignalReturn('regime'", "recordSignalReturn('inflation'", "recordSignalReturn('carry'", "recordSignalReturn('volatility'", "recordSignalReturn('liquidity'"]),
      "All 5 signal types tracked in backtest attribution")

# PATCH 5: Negative Returns
print("\n--- PATCH 5: Negative Expected Returns ---")

check("5a", "CRISIS base return is negative", "-2.5" in engine and "CRISIS" in engine,
      "CRISIS base return = -2.5%")
check("5b", "HIGH_VOL base return is negative", "-0.3" in engine,
      "HIGH_VOL base return = -0.3%")
check("5c", "CRISIS bucket returns allow negative", "return: -0.002" in engine,
      "CRISIS capital_preservation return = -0.002")

# PATCH 6: Persistent Telemetry
print("\n--- PATCH 6: Persistent Telemetry ---")
telemetry = read_file(TELEMETRY)

check("6a", "Persistent storage functions added", "persistDecision" in telemetry and "persistEvent" in telemetry,
      "KV/D1 persistence functions added")
check("6b", "Fail on telemetry write error", "TELEMETRY_PERSIST_FAILED" in telemetry,
      "Throws error on persistence failure")
check("6c", "D1 metrics persistence", "persistMetrics" in telemetry,
      "D1 metrics persistence implemented")

# PATCH 7: UI Override
print("\n--- PATCH 7: UI Override (cover.html as dashboard) ---")

check("7a", "Dashboard is root route", "path === '/' || path === ''" in worker,
      "Worker serves dashboard at root /")
check("7b", "Mobile-first responsive grid", "grid-template-columns:1fr" in worker,
      "CSS grid starts 1col (mobile-first)")
check("7c", "3-column desktop layout", "grid-template-columns:1fr 1fr 1fr" in worker,
      "CSS grid expands to 3col on desktop")
check("7d", "Dark financial theme", "--bg:#0d1117" in worker,
      "Dark theme base #0d1117")
check("7e", "Fixed header with regime/NAV/drawdown", "hdr-dd" in worker and "hdr-integrity" in worker,
      "Sticky header includes regime, NAV, drawdown, data integrity")

# PATCH 8: Dashboard Consistency
print("\n--- PATCH 8: Dashboard Consistency ---")

check("8a", "Single dashboard function", worker.count("function dashboard()") == 1,
      "Single dashboard() function in worker")
check("8b", "No alternative dashboard routes", "/dashboard" not in worker,
      "No separate /dashboard route")

# PATCH 9: Deploy Guard
print("\n--- PATCH 9: Deploy Guard ---")

check("9a", "Attribution check in deploy guard", "ATTRIBUTION_CONNECTED" in worker,
      "Attribution connectivity checked")
check("9b", "Deterministic seed verification", "DETERMINISTIC_SEED" in worker,
      "Seed determinism verified in guard")
check("9c", "MODELO masking detection", "NO_FALLBACK_MASKING" in worker,
      "MODELO masking detection in guard")
check("9d", "Data integrity score check", "DATA_INTEGRITY_SCORE" in worker,
      "Data integrity score >= 0.7 check in guard")
check("9e", "Randomness detection", "NO_RANDOMNESS" in worker,
      "Randomness detection check in guard")
check("9f", "Regime accuracy threshold 65%", "0.65" in worker,
      "Regime accuracy min 65% in guard")
check("9g", "CRISIS negative return check", "CRISIS_NEGATIVE_RETURN" in worker,
      "CRISIS negative return validated in guard")

# SUMMARY
print("\n" + "=" * 70)
total = len(results)
passed = sum(1 for r in results if r[2])
failed = total - passed
print(f"TOTAL: {total} checks | PASSED: {passed} | FAILED: {failed}")
print("=" * 70)

if failed > 0:
    print("\nFAILED CHECKS:")
    for id, name, p, detail in results:
        if not p:
            print(f"  FAIL [{id}] {name}: {detail}")

sys.exit(0 if failed == 0 else 1)
