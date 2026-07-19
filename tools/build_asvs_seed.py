#!/usr/bin/env python3
"""
Build the bundled OWASP ASVS seed JSON from the official CSV.

Source CSV (committed alongside this script):
    tools/asvs_v5.0.0_en.csv
downloaded from:
    https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0/5.0/docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.csv

Output (consumed by the backend at assessment-creation time to seed the grid):
    backend/data/asvs_v5.json

Each output object carries the static ASVS catalog fields plus empty,
backfillable guidance fields (test_type / guidance / suggested_command). The
guidance fields are populated later by a separate, user-validated enrichment
pass; this builder leaves them null so the feature is never blocked on authoring.

Run:
    python3 tools/build_asvs_seed.py
"""
import csv
import json
import os
import sys

ASVS_VERSION = "5.0.0"

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)
CSV_PATH = os.path.join(HERE, "asvs_v5.0.0_en.csv")
OUT_DIR = os.path.join(REPO_ROOT, "backend", "data")
OUT_PATH = os.path.join(OUT_DIR, "asvs_v5.json")

# Guidance fields are intentionally left null here; backfilled by enrichment pass.
GUIDANCE_DEFAULTS = {"test_type": None, "guidance": None, "suggested_command": None}


def build():
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    out = []
    for r in rows:
        try:
            level = int(r["L"])
        except (KeyError, ValueError):
            print(f"Skipping row with bad level: {r!r}", file=sys.stderr)
            continue
        out.append({
            "chapter_id": r["chapter_id"].strip(),
            "chapter_name": r["chapter_name"].strip(),
            "section_id": r["section_id"].strip(),
            "section_name": r["section_name"].strip(),
            "req_id": r["req_id"].strip(),
            "level": level,
            "description": r["req_description"].strip(),
            **GUIDANCE_DEFAULTS,
        })

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write("\n")

    # Summary
    chapters = {o["chapter_id"] for o in out}
    levels = {1: 0, 2: 0, 3: 0}
    for o in out:
        levels[o["level"]] = levels.get(o["level"], 0) + 1
    print(f"Wrote {len(out)} requirements to {OUT_PATH}")
    print(f"  chapters: {len(chapters)}  |  levels: L1={levels.get(1)} L2={levels.get(2)} L3={levels.get(3)}")
    print(f"  ASVS version: {ASVS_VERSION}")


if __name__ == "__main__":
    build()
