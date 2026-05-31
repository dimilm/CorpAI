"""AI agent endpoints.

The router exposes the agent registry to the frontend:

* `GET /ai/agents` – lists every registered agent including its JSON output schema.
* `GET /ai/agents/{id}/prompt` – serves the static prompt template (read-only).
* `POST /ai/agents/{id}/run/{isin}` – queues an agent run, returns immediately
  with the freshly-created `AIRun` row in `status="running"`. The actual LLM
  call happens in a FastAPI `BackgroundTasks` worker; the UI polls
  `/ai/agents/{id}/runs/{isin}` (or `/ai/runs/{run_id}`) until the row flips
  to `done` / `error`. Returns `409` if a run is already in flight for the
  same `(agent, isin)` pair.
* `GET /ai/agents/{id}/runs/{isin}` – history of past runs for a single
  stock + agent combination.
* `GET /ai/runs/{run_id}` – fetches one persisted run with its full payload.
* `POST /ai/test` – probes the configured provider (`provider.ping()`).
"""
from __future__ import annotations

import json
import time

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import PlainTextResponse, Response
from sqlalchemy.orm import Session
from starlette.status import HTTP_202_ACCEPTED, HTTP_409_CONFLICT

from app.agents import get_agent, list_agents
from app.api.deps import csrf_guard, get_ai_provider, get_current_user, require_admin
from app.db.session import get_db
from app.models.ai_run import AIRun
from app.models.run_log import RunLog
from app.models.settings import AppSettings
from app.models.stock import Stock
from app.providers.ai.base import AIProvider
from app.schemas.ai import (
    AgentInfoOut,
    AgentRunRequest,
    AIRunOut,
    BatchQueuedItem,
    BatchRunRequest,
    BatchRunResult,
)
from app.services import ai_run_io
from app.services.ai_run_io import AIImportReport
from app.services.ai_run_service import (
    execute_batch_in_background,
    execute_run_in_background,
)
from app.services.provider_factory import build_ai_provider  # re-exported for monkeypatch back-compat
from app.services.refresh_lock import request_cancel_for_run
from app.services.run_status_service import humanize_error

__all__ = ["router", "build_ai_provider"]

router = APIRouter(prefix="/ai", tags=["ai"])


@router.get("/agents", response_model=list[AgentInfoOut])
def get_agents(_: dict = Depends(get_current_user)) -> list[dict]:
    return [
        {
            "id": agent.id,
            "name": agent.name,
            "description": agent.description,
            "output_schema": agent.output_schema.model_json_schema(),
        }
        for agent in list_agents()
    ]


@router.get("/agents/{agent_id}/prompt", response_class=PlainTextResponse)
def get_agent_prompt(agent_id: str, _: dict = Depends(get_current_user)) -> str:
    agent = get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent.load_prompt()


@router.post(
    "/agents/{agent_id}/run/{isin}",
    response_model=AIRunOut,
    status_code=HTTP_202_ACCEPTED,
    dependencies=[Depends(csrf_guard)],
)
def run_agent(
    agent_id: str,
    isin: str,
    background: BackgroundTasks,
    payload: AgentRunRequest | None = None,
    _: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AIRun:
    """Queue an agent run and schedule the LLM call in the background.

    Synchronous path: validate, create a `running` row, return it (HTTP 202).
    The `BackgroundTasks` worker then opens a fresh DB session + provider
    and resolves the row. The provider is intentionally *not* injected via
    `Depends(get_ai_provider)` here because the request-scoped session
    closes before the background task runs.
    """
    agent = get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    stock = db.get(Stock, isin.upper())
    if stock is None:
        raise HTTPException(status_code=404, detail="Stock not found")

    existing = (
        db.query(AIRun)
        .filter(
            AIRun.agent_id == agent_id,
            AIRun.isin == stock.isin,
            AIRun.status == "running",
        )
        .first()
    )
    if existing is not None:
        raise HTTPException(
            status_code=HTTP_409_CONFLICT,
            detail="Es läuft bereits eine Analyse dieses Agenten für dieses Unternehmen.",
        )

    kwargs: dict = {}
    if payload is not None and payload.peers is not None:
        kwargs["peers"] = payload.peers
    run = agent.queue_run(db, stock, **kwargs)
    background.add_task(execute_run_in_background, run.id, agent_id, kwargs)
    return run


@router.post(
    "/runs/batch",
    response_model=BatchRunResult,
    status_code=HTTP_202_ACCEPTED,
    dependencies=[Depends(csrf_guard)],
)
def run_agents_batch(
    payload: BatchRunRequest,
    background: BackgroundTasks,
    _: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BatchRunResult:
    """Queue every `(agent_id, isin)` combination and run them serially.

    Mirrors `run_agent`'s per-pair validation but never raises on a single bad
    pair: unknown agents, unknown stocks and pairs already in flight are
    reported as `skipped` so the rest of the batch still runs. All queued runs
    are handed to a *single* background task that resolves them one after
    another, sparing the provider's rate limits.
    """
    queued: list[BatchQueuedItem] = []
    skipped: list[BatchQueuedItem] = []
    items: list[tuple[int, str, dict]] = []
    queued_ids: list[int] = []

    # De-duplicate so the same pair can't be queued twice within one request
    # (the "already running" guard below only sees committed rows).
    seen: set[tuple[str, str]] = set()
    for agent_id in payload.agent_ids:
        agent = get_agent(agent_id)
        for raw_isin in payload.isins:
            isin = raw_isin.upper()
            if (agent_id, isin) in seen:
                continue
            seen.add((agent_id, isin))

            if agent is None:
                skipped.append(
                    BatchQueuedItem(agent_id=agent_id, isin=isin, status="skipped", reason="Agent unbekannt")
                )
                continue
            stock = db.get(Stock, isin)
            if stock is None:
                skipped.append(
                    BatchQueuedItem(agent_id=agent_id, isin=isin, status="skipped", reason="Aktie nicht gefunden")
                )
                continue
            already_running = (
                db.query(AIRun)
                .filter(
                    AIRun.agent_id == agent_id,
                    AIRun.isin == stock.isin,
                    AIRun.status == "running",
                )
                .first()
            )
            if already_running is not None:
                skipped.append(
                    BatchQueuedItem(agent_id=agent_id, isin=stock.isin, status="skipped", reason="läuft bereits")
                )
                continue

            run = agent.queue_run(db, stock)
            queued.append(
                BatchQueuedItem(agent_id=agent_id, isin=stock.isin, run_id=run.id, status="queued")
            )
            items.append((run.id, agent_id, {}))
            queued_ids.append(run.id)

    if not items:
        return BatchRunResult(queued=queued, skipped=skipped, run_id=None)

    # Wrap the queued runs in a RunLog "batch bracket" so the frontend can
    # reuse the existing RunLog progress/cancel machinery (market & jobs runs).
    run_log = RunLog(run_type="ai", phase="queued", stocks_total=len(items), status="ok")
    db.add(run_log)
    db.commit()
    db.refresh(run_log)

    # `queue_run` commits each AIRun internally, so stamp the bracket id with a
    # single bulk update after the RunLog exists.
    db.query(AIRun).filter(AIRun.id.in_(queued_ids)).update(
        {AIRun.batch_run_id: run_log.id}, synchronize_session=False
    )
    db.commit()

    background.add_task(execute_batch_in_background, items, run_log.id)
    return BatchRunResult(queued=queued, skipped=skipped, run_id=run_log.id)


@router.post("/runs/batch/cancel", dependencies=[Depends(csrf_guard)])
def cancel_agents_batch(
    _: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Request cancellation of the most recent in-flight AI batch.

    Flags the latest unfinished ``run_type='ai'`` RunLog in the shared cancel
    registry; the background task notices the flag before its next item and
    marks the remaining runs as ``cancelled``.
    """
    run_log = (
        db.query(RunLog)
        .filter(RunLog.run_type == "ai", RunLog.phase != "finished")
        .order_by(RunLog.id.desc())
        .first()
    )
    if run_log is None:
        return {"cancelled": False, "run_id": None}
    request_cancel_for_run(run_log.id)
    return {"cancelled": True, "run_id": run_log.id}


@router.get("/runs/export")
def export_ai_runs(
    _: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    """Download every finished AI run as a single JSON file.

    Mounted before ``/runs/{run_id}`` so FastAPI does not try to parse the
    literal string ``export`` as an int. The file round-trips through
    ``POST /ai/runs/import`` on another deployment (transfer) or the same one
    (backup/restore).
    """
    payload = json.dumps(ai_run_io.build_export(db), ensure_ascii=False, indent=2)
    return Response(
        content=payload,
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="ai-analysis.json"'},
    )


@router.post(
    "/runs/import",
    response_model=AIImportReport,
    dependencies=[Depends(csrf_guard)],
)
async def import_ai_runs(
    file: UploadFile = File(...),
    _: dict = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AIImportReport:
    """Upload a `corpai-ai-analysis` export and insert new runs (skip existing).

    Runs whose ISIN is not in the watchlist are reported in ``unmapped_rows``;
    re-importing the same file is idempotent (duplicates land in
    ``skipped_existing``).
    """
    content = await file.read()
    return ai_run_io.import_runs(db, content)


@router.get(
    "/agents/{agent_id}/runs/{isin}",
    response_model=list[AIRunOut],
)
def list_agent_runs(
    agent_id: str,
    isin: str,
    limit: int = Query(default=10, ge=1, le=100),
    _: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[AIRun]:
    if get_agent(agent_id) is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    return (
        db.query(AIRun)
        .filter(AIRun.agent_id == agent_id, AIRun.isin == isin.upper())
        .order_by(AIRun.created_at.desc())
        .limit(limit)
        .all()
    )


@router.get("/runs/{run_id}", response_model=AIRunOut)
def get_run(
    run_id: int,
    _: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AIRun:
    run = db.get(AIRun, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


@router.post("/test", dependencies=[Depends(csrf_guard)])
async def test_ai_connection(
    _: dict = Depends(require_admin),
    db: Session = Depends(get_db),
    provider: AIProvider = Depends(get_ai_provider),
) -> dict:
    """Probe the configured AI provider with a minimal `ping()` request."""
    row = db.get(AppSettings, 1) or AppSettings(id=1)
    started = time.perf_counter()
    try:
        await provider.ping()
        return {
            "ok": True,
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "provider": row.ai_provider,
            "model": row.ai_model,
        }
    except Exception as exc:
        return {
            "ok": False,
            "error": humanize_error(exc),
            "provider": row.ai_provider,
            "model": row.ai_model,
        }
