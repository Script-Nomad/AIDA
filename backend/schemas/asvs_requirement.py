"""
ASVS Requirement Pydantic schemas
"""
from datetime import datetime
from typing import Optional, List, Dict
from pydantic import BaseModel, ConfigDict


class AsvsRequirementBase(BaseModel):
    # ASVS catalog (static)
    chapter_id: Optional[str] = None
    chapter_name: Optional[str] = None
    section_id: Optional[str] = None
    section_name: Optional[str] = None
    req_id: Optional[str] = None
    level: Optional[int] = None
    description: Optional[str] = None
    # Pre-authored guidance (static, nullable, backfillable)
    test_type: Optional[str] = None          # dast | whitebox | manual
    guidance: Optional[str] = None
    suggested_command: Optional[str] = None
    # Agent-filled verdict
    status: Optional[str] = None             # NOT_TESTED | PASS | FAIL | NA
    command_used: Optional[str] = None
    analysis: Optional[str] = None
    evidence: Optional[str] = None
    # Severity (FAIL only)
    severity: Optional[str] = None
    cvss_vector: Optional[str] = None
    cvss_score: Optional[float] = None


class AsvsRequirementCreate(AsvsRequirementBase):
    """Schema for creating an ASVS requirement row (used internally by seeding)"""
    req_id: str


class AsvsRequirementUpdate(BaseModel):
    """Schema for updating an ASVS requirement verdict (all fields optional)"""
    status: Optional[str] = None             # NOT_TESTED | PASS | FAIL | NA
    command_used: Optional[str] = None
    analysis: Optional[str] = None
    evidence: Optional[str] = None
    severity: Optional[str] = None
    cvss_vector: Optional[str] = None
    cvss_score: Optional[float] = None
    # Guidance can also be edited (e.g. analyst override / backfill)
    test_type: Optional[str] = None
    guidance: Optional[str] = None
    suggested_command: Optional[str] = None


class AsvsRequirementResponse(AsvsRequirementBase):
    """Schema for ASVS requirement response"""
    id: int
    assessment_id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AsvsChapterCoverage(BaseModel):
    """Per-chapter coverage breakdown"""
    chapter_id: str
    chapter_name: str
    total: int
    tested: int
    by_status: Dict[str, int]


class AsvsSummaryResponse(BaseModel):
    """Aggregate ASVS coverage for an assessment"""
    total: int
    tested: int
    coverage_pct: float
    by_status: Dict[str, int]          # NOT_TESTED / PASS / FAIL / NA
    by_chapter: List[AsvsChapterCoverage]
    asvs_version: Optional[str] = None
    asvs_level: Optional[int] = None
