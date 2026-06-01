"""Schema for the bull-vs-bear debate agent."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class SideArguments(BaseModel):
    """Intermediate payload returned by the bull / bear persona calls."""

    arguments: list[str] = Field(min_length=1, max_length=8)


class JudgeVerdict(BaseModel):
    """Intermediate payload returned by the judge call."""

    winning_side: Literal["bull", "bear", "tie"]
    conviction: Literal["low", "medium", "high"]
    judge_rationale: str
    summary: str


class DebateResult(BaseModel):
    """Aggregate result assembled from the three persona calls."""

    bull_arguments: list[str]
    bear_arguments: list[str]
    winning_side: Literal["bull", "bear", "tie"]
    conviction: Literal["low", "medium", "high"]
    judge_rationale: str
    summary: str
