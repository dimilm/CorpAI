"""Schemas for the AI agent endpoints."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class AgentInfoOut(BaseModel):
    id: str
    name: str
    description: str
    output_schema: dict[str, Any]


class AIRunOut(BaseModel):
    id: int
    isin: str
    agent_id: str
    created_at: datetime
    provider: str
    model: str
    status: str
    input_payload: dict[str, Any]
    result_payload: dict[str, Any] | None = None
    error_text: str | None = None
    cost_estimate: float | None = None
    duration_ms: int | None = None

    model_config = ConfigDict(from_attributes=True)


class AgentRunRequest(BaseModel):
    """Optional body parameters per agent. Currently only Tournament uses
    `peers` to override the auto-suggested bracket."""

    peers: list[str] | None = None


class BatchRunRequest(BaseModel):
    """Run a set of agents against a set of stocks (cartesian product).

    Every `(agent_id, isin)` pair is queued as its own `AIRun`; the pairs are
    then executed serially in a single background task to spare the provider's
    rate limits.
    """

    agent_ids: list[str]
    isins: list[str]


class BatchQueuedItem(BaseModel):
    """Outcome for one `(agent_id, isin)` pair of a batch request."""

    agent_id: str
    isin: str
    run_id: int | None = None
    status: str  # "queued" | "skipped"
    reason: str | None = None  # populated when status == "skipped"


class BatchRunResult(BaseModel):
    queued: list[BatchQueuedItem]
    skipped: list[BatchQueuedItem]
