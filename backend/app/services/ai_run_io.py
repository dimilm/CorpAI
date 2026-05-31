"""JSON export/import for the `AIRun` history.

AI agents (Fisher, Tournament, Scenario, Red-Flag) are expensive to run and,
for the Opus/claudecode provider, only available locally. This module lets a
local instance export its finished runs and re-import them on another
deployment (e.g. the Docker server) — which doubles as a backup.

Export shape (one entry per finished run, all stocks, all agents)::

    {
      "format": "corpai-ai-analysis",
      "version": 1,
      "exported_at": "2026-05-31T12:00:00",
      "count": 42,
      "runs": [ {isin, agent_id, created_at, provider, model, status,
                 input_payload, result_payload, error_text,
                 cost_estimate, duration_ms}, ... ]
    }

The DB-local ``id`` and ``batch_run_id`` are omitted (``run_logs`` are not
exported). Runs are sorted by ``(isin, agent_id, created_at)`` so repeated
exports produce deterministic, ``git diff``-able output.

Import policy: skip-on-conflict. A run is a duplicate when an existing row
shares the same ``(isin, agent_id, created_at)``, so re-importing the same
file is idempotent. Runs whose ISIN is not in the watchlist (or whose agent is
unknown) are reported as ``unmapped_rows`` rather than inserted, mirroring the
job-history importer.
"""
from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents import list_agents
from app.core.time import utcnow
from app.models.ai_run import AIRun
from app.models.stock import Stock

EXPORT_FORMAT = "corpai-ai-analysis"
EXPORT_VERSION = 1

# Fields that must be present and truthy for a run to be insertable. The DB
# requires a non-null input_payload but we default that to {} rather than
# rejecting, so it is not listed here.
_REQUIRED_FIELDS = ("isin", "agent_id", "created_at", "provider", "model")


# ---------------------------------------------------------------------------
# Report shape (mirrors app.services.job_history_io.ImportReport)
# ---------------------------------------------------------------------------

class AIUnmappedRow(BaseModel):
    run: dict[str, Any]
    reason: str


class AIMalformedRow(BaseModel):
    run: dict[str, Any]
    error: str


class AIImportReport(BaseModel):
    total_rows: int
    inserted: int
    skipped_existing: int
    unmapped_rows: list[AIUnmappedRow]
    malformed_rows: list[AIMalformedRow]


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

def _run_to_dict(run: AIRun) -> dict[str, Any]:
    return {
        "isin": run.isin,
        "agent_id": run.agent_id,
        "created_at": (
            run.created_at.isoformat()
            if isinstance(run.created_at, datetime)
            else run.created_at
        ),
        "provider": run.provider,
        "model": run.model,
        "status": run.status,
        "input_payload": run.input_payload,
        "result_payload": run.result_payload,
        "error_text": run.error_text,
        "cost_estimate": run.cost_estimate,
        "duration_ms": run.duration_ms,
    }


def build_export(db: Session) -> dict[str, Any]:
    """Return all finished (`status="done"`) AI runs as a JSON-ready envelope."""
    rows = (
        db.execute(
            select(AIRun)
            .where(AIRun.status == "done")
            .order_by(AIRun.isin, AIRun.agent_id, AIRun.created_at)
        )
        .scalars()
        .all()
    )
    runs = [_run_to_dict(r) for r in rows]
    return {
        "format": EXPORT_FORMAT,
        "version": EXPORT_VERSION,
        "exported_at": utcnow().isoformat(),
        "count": len(runs),
        "runs": runs,
    }


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------

def _parse_created_at(value: Any) -> datetime:
    """Parse an ISO datetime, normalising any aware value to naive UTC.

    The DB columns are naive UTC (see app.core.time), so we strip the tzinfo
    after converting, keeping imported keys comparable to existing rows.
    """
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(UTC).replace(tzinfo=None)
    return parsed


def import_runs(db: Session, content: bytes) -> AIImportReport:
    """Parse a `corpai-ai-analysis` export and insert new runs (skip existing).

    Individual bad entries never raise: unknown ISIN / agent → ``unmapped_rows``,
    invalid fields → ``malformed_rows``, duplicates → ``skipped_existing``.
    """
    try:
        text = content.decode("utf-8-sig")  # tolerate a UTF-8 BOM
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    try:
        doc = json.loads(text)
    except json.JSONDecodeError as exc:
        return AIImportReport(
            total_rows=0,
            inserted=0,
            skipped_existing=0,
            unmapped_rows=[],
            malformed_rows=[AIMalformedRow(run={}, error=f"invalid JSON: {exc}")],
        )

    if not isinstance(doc, dict) or not isinstance(doc.get("runs"), list):
        return AIImportReport(
            total_rows=0,
            inserted=0,
            skipped_existing=0,
            unmapped_rows=[],
            malformed_rows=[
                AIMalformedRow(
                    run={},
                    error="missing 'runs' list — not a corpai-ai-analysis export",
                )
            ],
        )

    known_isins = set(db.execute(select(Stock.isin)).scalars().all())
    known_agents = {a.id for a in list_agents()}
    existing_keys: set[tuple[str, str, datetime]] = {
        (isin, agent_id, created_at)
        for isin, agent_id, created_at in db.execute(
            select(AIRun.isin, AIRun.agent_id, AIRun.created_at)
        ).all()
    }

    total_rows = 0
    inserted = 0
    skipped_existing = 0
    unmapped_rows: list[AIUnmappedRow] = []
    malformed_rows: list[AIMalformedRow] = []
    to_insert: list[dict[str, Any]] = []

    for raw in doc["runs"]:
        total_rows += 1

        if not isinstance(raw, dict):
            malformed_rows.append(AIMalformedRow(run={}, error="run entry is not an object"))
            continue

        missing = [f for f in _REQUIRED_FIELDS if not raw.get(f)]
        if missing:
            malformed_rows.append(
                AIMalformedRow(run=raw, error=f"missing required field(s): {', '.join(missing)}")
            )
            continue

        try:
            created_at = _parse_created_at(raw["created_at"])
        except (TypeError, ValueError):
            malformed_rows.append(
                AIMalformedRow(
                    run=raw, error=f"created_at is not an ISO datetime: {raw['created_at']!r}"
                )
            )
            continue

        isin = str(raw["isin"]).upper()
        agent_id = str(raw["agent_id"])

        if isin not in known_isins:
            unmapped_rows.append(
                AIUnmappedRow(run=raw, reason=f"no stock with ISIN {isin!r} in watchlist")
            )
            continue
        if agent_id not in known_agents:
            unmapped_rows.append(
                AIUnmappedRow(run=raw, reason=f"unknown agent_id {agent_id!r}")
            )
            continue

        key = (isin, agent_id, created_at)
        if key in existing_keys:
            skipped_existing += 1
            continue
        # Guard against duplicate entries within the same file too.
        existing_keys.add(key)

        input_payload = raw.get("input_payload")
        if not isinstance(input_payload, dict):
            input_payload = {}
        result_payload = raw.get("result_payload")
        if result_payload is not None and not isinstance(result_payload, dict):
            result_payload = None

        to_insert.append(
            {
                "isin": isin,
                "agent_id": agent_id,
                "created_at": created_at,
                "provider": str(raw["provider"]),
                "model": str(raw["model"]),
                "status": str(raw.get("status") or "done"),
                "input_payload": input_payload,
                "result_payload": result_payload,
                "error_text": raw.get("error_text"),
                "cost_estimate": raw.get("cost_estimate"),
                "duration_ms": raw.get("duration_ms"),
                "batch_run_id": None,
            }
        )
        inserted += 1

    if to_insert:
        db.bulk_insert_mappings(AIRun, to_insert)
        db.commit()

    return AIImportReport(
        total_rows=total_rows,
        inserted=inserted,
        skipped_existing=skipped_existing,
        unmapped_rows=unmapped_rows,
        malformed_rows=malformed_rows,
    )
