#!/usr/bin/env python3
"""
FORENSIC FASE 5 — per-asset audit of predictions_count=0
READ-ONLY: only fetches existing GET endpoints from the live worker.

For each asset class, classifies each asset into:
  - HISTORY_INSUFFICIENT_LT2  (all 4 series-derived metrics null → 0-1 valid points)
  - HISTORY_INSUFFICIENT_LT3  (only momentum non-null → 2 valid points)
  - HISTORY_INSUFFICIENT_LT5  (volatility non-null but trend_strength null → 3-4 points)
  - HISTORY_INSUFFICIENT_LT9  (trend_strength non-null but prediction=null, ambiguous 5-8 vs ≥9+conf<0.65)
  - CONFIDENCE_THRESHOLD_BLOCK (best-effort guess: trend_strength non-null AND prediction=null)
  - TOMBSTONE                  (prediction != null AND data_quality == 'insufficient')
  - VALID_PREDICTION           (prediction != null AND data_quality != 'insufficient')

NOTE: We CANNOT cleanly separate HISTORY_INSUFFICIENT_LT9 from CONFIDENCE_THRESHOLD_BLOCK
without reading KV directly. We surface the ambiguity rather than guess.
"""

import json
import urllib.request
import urllib.parse
import datetime as dt
import os
import sys

WORKER = "https://santaninverter-oracle.simondalmasso44.workers.dev"
OUT_DIR = "/home/z/audits/santaninverter-2026-07-13"
os.makedirs(OUT_DIR, exist_ok=True)

CLASSES = ["stocks", "cedears", "bonds", "fci"]
CLASS_KEY = {
    "stocks": "ACCIONES",
    "cedears": "CEDEARS",
    "bonds": "BONOS",
    "fci": "FCI",
}


def fetch(path):
    url = WORKER + path
    req = urllib.request.Request(url, headers={"User-Agent": "forensic-audit/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def classify_asset(a):
    """Return (bucket, point_count_lower_bound, reason)."""
    pred = a.get("prediction")
    dq = a.get("data_quality")
    m7 = a.get("momentum_7d")
    m30 = a.get("momentum_30d")
    vol = a.get("volatility")
    trend = a.get("trend_strength")

    if pred is not None:
        if dq == "insufficient":
            return ("TOMBSTONE", 0, "prediction=tombstone data_quality=insufficient")
        return ("VALID_PREDICTION", 9, "prediction non-null with sufficient data")

    # prediction is null — disambiguate via series-derived metrics
    if trend is not None:
        # ≥5 valid points, but prediction=null.
        # Could be 5-8 points (history insufficient) OR ≥9 with confidence<0.65
        return ("AMBIGUOUS_LT9_OR_CONF_BLOCK", 5,
                "trend_strength non-null (≥5 pts) but prediction=null — cannot disambiguate without KV")
    if vol is not None:
        return ("HISTORY_INSUFFICIENT_LT5", 3,
                "volatility non-null (≥3 pts) but trend_strength null — <5 points")
    if m7 is not None or m30 is not None:
        return ("HISTORY_INSUFFICIENT_LT3", 2,
                "momentum non-null (≥2 pts) but volatility null — <3 points")
    return ("HISTORY_INSUFFICIENT_LT2", 0,
            "all series-derived metrics null — 0-1 valid points")


def main():
    print(f"=== FORENSIC FASE 5 — per-asset audit at {dt.datetime.utcnow().isoformat()}Z ===")
    print()

    summary_rows = []  # (class, total_assets, history_days, engine_active, tomb, null_lt2, null_lt3, null_lt5, ambiguous, valid)
    per_class_details = {}

    for cls in CLASSES:
        print(f"--- {cls.upper()} ---")
        try:
            data = fetch(f"/api/oracle/{cls}")
        except Exception as e:
            print(f"  ERROR fetching {cls}: {e}")
            continue

        # Save raw response
        out_path = os.path.join(OUT_DIR, f"phase5_{cls}.json")
        with open(out_path, "w") as f:
            json.dump(data, f, indent=2)
        print(f"  saved raw → {out_path}")

        meta = data.get("metadata", {})
        assets = data.get("assets", [])
        history_days = meta.get("history_days_available")
        engine_active = meta.get("prediction_engine_active")
        source_status = data.get("source_status")
        print(f"  source_status={source_status}  total_assets={data.get('total_assets')}  assets_in_output={data.get('assets_in_output')}")
        print(f"  history_days_available={history_days}  prediction_engine_active={engine_active}")

        buckets = {
            "TOMBSTONE": 0,
            "HISTORY_INSUFFICIENT_LT2": 0,
            "HISTORY_INSUFFICIENT_LT3": 0,
            "HISTORY_INSUFFICIENT_LT5": 0,
            "AMBIGUOUS_LT9_OR_CONF_BLOCK": 0,
            "VALID_PREDICTION": 0,
        }
        details = []
        for a in assets:
            bucket, lb, reason = classify_asset(a)
            buckets[bucket] += 1
            details.append({
                "id": a.get("id"),
                "ticker": a.get("ticker"),
                "name": a.get("name"),
                "bucket": bucket,
                "lower_bound_points": lb,
                "momentum_7d": a.get("momentum_7d"),
                "momentum_30d": a.get("momentum_30d"),
                "volatility": a.get("volatility"),
                "trend_strength": a.get("trend_strength"),
                "data_quality": a.get("data_quality"),
                "prediction": a.get("prediction"),
                "reason": reason,
            })

        per_class_details[cls] = {
            "source_status": source_status,
            "total_assets": len(assets),
            "history_days_available": history_days,
            "prediction_engine_active": engine_active,
            "buckets": buckets,
            "assets": details,
        }

        for b, c in buckets.items():
            if c > 0:
                print(f"  {b}: {c}")
        print()

    # Save consolidated details
    details_path = os.path.join(OUT_DIR, "phase5_per_asset_details.json")
    with open(details_path, "w") as f:
        json.dump(per_class_details, f, indent=2)
    print(f"Consolidated details → {details_path}")

    # Summary table
    print()
    print("=== SUMMARY TABLE ===")
    print()
    print(f"{'Class':<10} {'Assets':>6} {'HistDays':>8} {'Engine':>7} | {'Tomb':>5} {'<2pts':>6} {'<3pts':>6} {'<5pts':>6} {'Ambig':>6} {'Valid':>6}")
    print("-" * 90)
    for cls in CLASSES:
        d = per_class_details.get(cls, {})
        b = d.get("buckets", {})
        print(f"{cls:<10} {d.get('total_assets', 0):>6} {str(d.get('history_days_available', '-')):>8} {str(d.get('prediction_engine_active', '-')):>7} | "
              f"{b.get('TOMBSTONE', 0):>5} {b.get('HISTORY_INSUFFICIENT_LT2', 0):>6} {b.get('HISTORY_INSUFFICIENT_LT3', 0):>6} "
              f"{b.get('HISTORY_INSUFFICIENT_LT5', 0):>6} {b.get('AMBIGUOUS_LT9_OR_CONF_BLOCK', 0):>6} {b.get('VALID_PREDICTION', 0):>6}")

    print()
    print("Legend:")
    print("  Tomb     = tombstone (empty series, all-invalid prices)")
    print("  <2pts    = 0-1 valid price points (all 4 series metrics null)")
    print("  <3pts    = 2 valid points (momentum non-null but volatility null)")
    print("  <5pts    = 3-4 valid points (volatility non-null but trend_strength null)")
    print("  Ambig    = ≥5 points (trend_strength non-null) but prediction=null — CANNOT disambiguate <9 vs confidence<0.65 without KV")
    print("  Valid    = real prediction returned")


if __name__ == "__main__":
    main()
