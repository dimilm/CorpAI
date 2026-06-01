"""Schema for the Porter's Five Forces agent."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# The five competitive forces, in canonical UI order. A *high* intensity of any
# force is *unfavourable* for the established player (lowers attractiveness).
FIVE_FORCES: tuple[str, ...] = (
    "new_entrants",
    "supplier_power",
    "buyer_power",
    "substitutes",
    "rivalry",
)

Intensity = Literal["low", "medium", "high"]


class ForceAssessment(BaseModel):
    force: str = Field(description="Eine der fünf Kräfte (siehe FIVE_FORCES)")
    intensity: Intensity = Field(
        description="Stärke der Kraft; hoch = ungünstig für den etablierten Anbieter"
    )
    rationale: str
    drivers: list[str] = Field(default_factory=list, max_length=6)


class FiveForcesResult(BaseModel):
    forces: list[ForceAssessment] = Field(min_length=1, max_length=5)
    industry_attractiveness: Literal["attractive", "neutral", "unattractive"]
    summary: str
