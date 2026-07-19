"""
ASVS service — catalog loading, per-assessment seeding, and coverage summary.

The static ASVS catalog is bundled as backend/data/asvs_v5.json (generated from
the official CSV by tools/build_asvs_seed.py). At creation time, an ASVS-methodology
assessment is seeded with one AsvsRequirement row per requirement matching the chosen
level (cumulative: level <= chosen) and chapter subset.
"""
import json
import os
from typing import List, Optional

from sqlalchemy.orm import Session

from models import AsvsRequirement, Assessment
from models.asvs_requirement import ASVS_STATUSES

ASVS_VERSION = "5.0.0"

_CATALOG_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "asvs_v5.json")
_catalog_cache: Optional[List[dict]] = None

# Static fields copied verbatim from the catalog onto each seeded row
_CATALOG_FIELDS = (
    "chapter_id", "chapter_name", "section_id", "section_name",
    "req_id", "level", "description", "test_type", "guidance", "suggested_command",
)


def load_catalog() -> List[dict]:
    """Load (and cache) the bundled ASVS catalog."""
    global _catalog_cache
    if _catalog_cache is None:
        with open(_CATALOG_PATH, encoding="utf-8") as f:
            _catalog_cache = json.load(f)
    return _catalog_cache


def _resolve_tokens(tokens: List[str], catalog: List[dict]) -> set:
    """
    Expand a list of ASVS tokens to a set of full requirement ids.

    Each token may be a requirement id (V1.2.4), a section id (V1.2 → every
    requirement in that section), or a chapter id (V1 → every requirement in
    that chapter). Unknown tokens are ignored (the UI validates/flags them).
    """
    valid_reqs: set = set()
    by_section: dict = {}
    by_chapter: dict = {}
    for r in catalog:
        valid_reqs.add(r["req_id"])
        by_section.setdefault(r["section_id"], []).append(r["req_id"])
        by_chapter.setdefault(r["chapter_id"], []).append(r["req_id"])

    wanted: set = set()
    for raw in tokens or []:
        t = (raw or "").strip().upper()
        if not t:
            continue
        if t in valid_reqs:
            wanted.add(t)
        elif t in by_section:
            wanted.update(by_section[t])
        elif t in by_chapter:
            wanted.update(by_chapter[t])
    return wanted


def seed_requirements(
    db: Session,
    assessment: Assessment,
    level: Optional[int] = None,
    chapters: Optional[List[str]] = None,
    req_ids: Optional[List[str]] = None,
) -> int:
    """
    Seed ASVS requirement rows for an assessment.

    Two selection modes:
    - Custom list: if req_ids is given, seed exactly those requirements. Tokens
      may be requirement / section / chapter ids (expanded against the catalog).
      Takes precedence over level/chapters.
    - Level + chapters: otherwise seed every requirement with level <= target
      level (cumulative, default 3) within the chosen chapter subset.

    Returns the number of rows seeded.
    """
    catalog = load_catalog()

    if req_ids:
        wanted = _resolve_tokens(req_ids, catalog)
        selected = [req for req in catalog if req["req_id"] in wanted]
        # Custom mode: store the highest level present so coverage/report stay coherent
        stored_level = max((req["level"] for req in selected), default=level)
    else:
        target_level = level or 3
        chapter_set = set(chapters) if chapters else None
        selected = [
            req for req in catalog
            if req["level"] <= target_level
            and (chapter_set is None or req["chapter_id"] in chapter_set)
        ]
        stored_level = target_level

    rows = [
        AsvsRequirement(
            assessment_id=assessment.id,
            status="NOT_TESTED",
            **{k: req.get(k) for k in _CATALOG_FIELDS},
        )
        for req in selected
    ]
    if rows:
        db.add_all(rows)

    # Persist methodology metadata on the assessment
    assessment.methodology = "asvs"
    assessment.asvs_level = stored_level
    assessment.asvs_version = ASVS_VERSION
    db.commit()
    return len(rows)


def compute_summary(db: Session, assessment: Assessment) -> dict:
    """Compute coverage stats for an assessment's ASVS grid."""
    reqs = db.query(AsvsRequirement).filter(
        AsvsRequirement.assessment_id == assessment.id
    ).all()

    by_status = {s: 0 for s in ASVS_STATUSES}
    chapters: dict = {}
    for r in reqs:
        st = r.status or "NOT_TESTED"
        by_status[st] = by_status.get(st, 0) + 1
        ch = chapters.setdefault(r.chapter_id, {
            "chapter_id": r.chapter_id,
            "chapter_name": r.chapter_name,
            "total": 0,
            "tested": 0,
            "by_status": {s: 0 for s in ASVS_STATUSES},
        })
        ch["total"] += 1
        ch["by_status"][st] = ch["by_status"].get(st, 0) + 1
        if st != "NOT_TESTED":
            ch["tested"] += 1

    total = len(reqs)
    tested = total - by_status.get("NOT_TESTED", 0)
    coverage_pct = round((tested / total) * 100, 1) if total else 0.0

    return {
        "total": total,
        "tested": tested,
        "coverage_pct": coverage_pct,
        "by_status": by_status,
        "by_chapter": sorted(chapters.values(), key=lambda c: int(c["chapter_id"][1:])),
        "asvs_version": assessment.asvs_version,
        "asvs_level": assessment.asvs_level,
    }
