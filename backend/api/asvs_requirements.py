"""
ASVS Requirements API endpoints

Per-assessment OWASP ASVS verification grid. Rows are seeded at assessment
creation (see services.asvs_service); this router lists them, exposes a
coverage summary, and lets the agent / analyst record verdicts.
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database import get_db
from models import AsvsRequirement, Assessment
from models.asvs_requirement import ASVS_STATUSES
from schemas.asvs_requirement import (
    AsvsRequirementResponse,
    AsvsRequirementUpdate,
    AsvsSummaryResponse,
)
from services.asvs_service import compute_summary, load_catalog
from utils.cvss import calculate_cvss4_score
from websocket.manager import manager
from websocket.events import event_asvs_updated
from utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/assessments/{assessment_id}/asvs", tags=["asvs"])

# Global, assessment-independent ASVS catalog (read-only). Powers the
# custom-list picker in the create-assessment modal: the client fetches it
# once and resolves/validates pasted requirement ids client-side.
catalog_router = APIRouter(prefix="/asvs", tags=["asvs"])


@catalog_router.get("/catalog")
async def asvs_catalog():
    """Full static OWASP ASVS catalog (chapter/section/req ids, level, description)."""
    return load_catalog()


def _get_assessment(assessment_id: int, db: Session) -> Assessment:
    assessment = db.query(Assessment).filter(Assessment.id == assessment_id).first()
    if not assessment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Assessment with id {assessment_id} not found",
        )
    return assessment


@router.get("", response_model=List[AsvsRequirementResponse])
async def list_asvs_requirements(
    assessment_id: int,
    status: Optional[str] = None,
    chapter: Optional[str] = None,
    level: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """List ASVS requirements for an assessment (optional status/chapter/level filters)."""
    _get_assessment(assessment_id, db)

    query = db.query(AsvsRequirement).filter(AsvsRequirement.assessment_id == assessment_id)
    if status:
        query = query.filter(AsvsRequirement.status == status.upper())
    if chapter:
        query = query.filter(AsvsRequirement.chapter_id == chapter.upper())
    if level is not None:
        query = query.filter(AsvsRequirement.level == level)

    return query.order_by(AsvsRequirement.req_id).all()


@router.get("/summary", response_model=AsvsSummaryResponse)
async def asvs_summary(assessment_id: int, db: Session = Depends(get_db)):
    """Coverage summary: counts per status, per-chapter breakdown, coverage %."""
    assessment = _get_assessment(assessment_id, db)
    return compute_summary(db, assessment)


@router.get("/{req_id}", response_model=AsvsRequirementResponse)
async def get_asvs_requirement(assessment_id: int, req_id: str, db: Session = Depends(get_db)):
    """Get a single ASVS requirement by its ASVS id (e.g. V1.2.4)."""
    req = db.query(AsvsRequirement).filter(
        AsvsRequirement.assessment_id == assessment_id,
        AsvsRequirement.req_id == req_id,
    ).first()
    if not req:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"ASVS requirement {req_id} not found for assessment {assessment_id}",
        )
    return req


@router.patch("/{req_id}", response_model=AsvsRequirementResponse)
async def update_asvs_requirement(
    assessment_id: int,
    req_id: str,
    update: AsvsRequirementUpdate,
    db: Session = Depends(get_db),
):
    """Record a verdict for an ASVS requirement (partial update)."""
    req = db.query(AsvsRequirement).filter(
        AsvsRequirement.assessment_id == assessment_id,
        AsvsRequirement.req_id == req_id,
    ).first()
    if not req:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"ASVS requirement {req_id} not found for assessment {assessment_id}",
        )

    update_data = update.model_dump(exclude_unset=True)

    # Normalize + validate status
    if "status" in update_data and update_data["status"] is not None:
        update_data["status"] = update_data["status"].upper()
        if update_data["status"] not in ASVS_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"status must be one of: {', '.join(ASVS_STATUSES)}",
            )

    # Derive CVSS score/severity from vector if provided (same as cards)
    if update_data.get("cvss_vector"):
        score, severity = calculate_cvss4_score(update_data["cvss_vector"])
        if score is not None:
            update_data["cvss_score"] = score
            update_data["severity"] = severity

    for field, value in update_data.items():
        setattr(req, field, value)

    db.commit()
    db.refresh(req)

    req_dict = AsvsRequirementResponse.model_validate(req).model_dump(mode="json")
    await manager.broadcast(
        event_asvs_updated(assessment_id, req_id, req_dict),
        assessment_id=assessment_id,
    )
    logger.info("ASVS requirement updated", req_id=req_id, status=req.status, assessment_id=assessment_id)

    return req
