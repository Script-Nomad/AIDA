"""
CVSS 4.0 helpers.

Shared by the cards MCP handler and the ASVS requirements API so the
score/severity derivation lives in exactly one place.
"""
from typing import Optional, Tuple


def calculate_cvss4_score(vector: str) -> Tuple[Optional[float], Optional[str]]:
    """
    Calculate CVSS 4.0 score and severity from a vector string.
    Returns (score, severity) or (None, None) on error.
    Uses the cvss library if available, otherwise falls back to None.
    """
    try:
        from cvss import CVSS4
        c = CVSS4(vector)
        score = float(c.base_score)
        return score, score_to_severity(score)
    except Exception:
        pass
    return None, None


def score_to_severity(score: float) -> str:
    """Map CVSS 4.0 numeric score to severity label (FIRST standard thresholds)."""
    if score >= 9.0:
        return "CRITICAL"
    elif score >= 7.0:
        return "HIGH"
    elif score >= 4.0:
        return "MEDIUM"
    elif score > 0.0:
        return "LOW"
    return "INFO"
