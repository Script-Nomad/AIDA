"""
ASVS Requirement SQLAlchemy model

One row per (assessment, ASVS requirement). Rows are seeded at assessment
creation for ASVS-methodology assessments. The ASVS catalog fields (chapter /
section / req_id / level / description) are denormalized onto each row so the
grid can be queried and filtered without a join to a catalog table.
"""
from sqlalchemy import Column, Integer, String, Text, Float, TIMESTAMP, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from database import Base

# Verdict vocabulary (string column + module constant — project has no Enums)
ASVS_STATUSES = ("NOT_TESTED", "PASS", "FAIL", "NA")
# How a requirement is verified (drives applicability + UI hint)
ASVS_TEST_TYPES = ("dast", "whitebox", "manual")


class AsvsRequirement(Base):
    __tablename__ = "asvs_requirements"

    id = Column(Integer, primary_key=True, index=True)
    assessment_id = Column(Integer, ForeignKey("assessments.id", ondelete="CASCADE"), nullable=False, index=True)

    # --- ASVS catalog (static, from seed JSON) ---
    chapter_id = Column(String(10), index=True)   # "V1"
    chapter_name = Column(String(255))            # "Encoding and Sanitization"
    section_id = Column(String(10), index=True)   # "V1.2"
    section_name = Column(String(255))            # "Injection Prevention"
    req_id = Column(String(20), index=True)       # "V1.2.4"
    level = Column(Integer)                        # 1 | 2 | 3
    description = Column(Text)                     # official ASVS requirement text

    # --- pre-authored guidance (static, nullable, backfillable) ---
    test_type = Column(String(20))                # dast | whitebox | manual
    guidance = Column(Text)                       # "how to test" hint
    suggested_command = Column(Text)              # optional suggested command

    # --- agent-filled verdict ---
    status = Column(String(20), default="NOT_TESTED", index=True)  # see ASVS_STATUSES
    command_used = Column(Text)                   # what the agent actually ran
    analysis = Column(Text)                       # "what the AI saw"
    evidence = Column(Text)                       # raw output / proof (optional)

    # --- severity (only meaningful on FAIL) ---
    severity = Column(String(20))                 # CRITICAL|HIGH|MEDIUM|LOW|INFO
    cvss_vector = Column(String(255))
    cvss_score = Column(Float)

    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())

    # Relationship
    assessment = relationship("Assessment", back_populates="asvs_requirements")
