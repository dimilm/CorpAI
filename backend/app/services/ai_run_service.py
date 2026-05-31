"""Background execution helpers for AI agent runs.

The HTTP route `POST /ai/agents/{id}/run/{isin}` returns immediately after
queueing an `AIRun` row with `status="running"`. The actual LLM call is
scheduled via FastAPI's `BackgroundTasks` and resolved here on the same
event loop with a fresh DB session and a fresh provider, so the request
session can be closed in the meantime.
"""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import func, select

from app.agents import get_agent
from app.core.time import utcnow
from app.db.session import SessionLocal
from app.models.ai_run import AIRun
from app.models.run_log import RunLog
from app.models.settings import AppSettings
from app.models.stock import Stock
from app.services.provider_factory import build_ai_provider
from app.services.refresh_lock import clear_cancel, is_cancel_requested

logger = logging.getLogger(__name__)


async def execute_run_in_background(
    run_id: int,
    agent_id: str,
    kwargs: dict[str, Any] | None = None,
) -> None:
    """Resolve a queued `AIRun` row by performing the LLM call.

    Always opens its own `SessionLocal` so the original request session can
    be closed independently. On any failure the run is forced to
    `status="error"` so the UI's polling loop terminates instead of
    spinning forever on a dangling `running` row.
    """
    kwargs = dict(kwargs or {})
    db = SessionLocal()
    try:
        agent = get_agent(agent_id)
        run = db.get(AIRun, run_id)
        if agent is None or run is None:  # pragma: no cover - defensive
            logger.warning(
                "ai background task: missing agent=%s or run=%s", agent_id, run_id
            )
            if run is not None:
                run.status = "error"
                run.error_text = "Agent not registered"
                run.duration_ms = 0
                db.commit()
            return
        stock = db.get(Stock, run.isin)
        if stock is None:  # pragma: no cover - defensive
            run.status = "error"
            run.error_text = "Stock not found"
            run.duration_ms = 0
            db.commit()
            return
        settings_row = db.get(AppSettings, 1) or AppSettings(id=1)
        provider = build_ai_provider(settings_row)
        await agent.execute_run(db, provider, run, stock, **kwargs)
    except Exception as exc:  # pragma: no cover - safety net
        logger.exception("ai background task failed: %s", exc)
        run = db.get(AIRun, run_id)
        if run is not None and run.status == "running":
            run.status = "error"
            run.error_text = str(exc) or exc.__class__.__name__
            if run.duration_ms is None:
                run.duration_ms = 0
            db.commit()
    finally:
        db.close()


def _count_batch_status(db, run_log_id: int, status: str) -> int:
    return db.execute(
        select(func.count())
        .select_from(AIRun)
        .where(AIRun.batch_run_id == run_log_id, AIRun.status == status)
    ).scalar_one()


def _recompute_batch_counters(db, run_log: RunLog, run_log_id: int) -> None:
    """Refresh the RunLog counters from the committed child AIRun rows.

    The per-item helper commits in its own session, so expire the tracker
    session first to force a re-read of those rows.
    """
    db.expire_all()
    success = _count_batch_status(db, run_log_id, "done")
    error = _count_batch_status(db, run_log_id, "error")
    cancelled = _count_batch_status(db, run_log_id, "cancelled")
    run_log.stocks_success = success
    run_log.stocks_error = error
    run_log.stocks_done = success + error + cancelled
    db.add(run_log)
    db.commit()


async def execute_batch_in_background(
    items: list[tuple[int, str, dict[str, Any]]],
    run_log_id: int,
) -> None:
    """Resolve several queued runs sequentially under a RunLog batch bracket.

    Running the `(run_id, agent_id, kwargs)` items one after another (rather
    than scheduling one task per item) keeps a batch from hammering the AI
    provider's rate limits. Each item reuses `execute_run_in_background`, which
    opens/closes its own DB session and already forces a failed run to
    `status="error"`, so one bad run never aborts the rest of the batch.

    A dedicated `tracker_db` session keeps the wrapping `RunLog` up to date
    (phase, counters, final status) so the frontend can reuse the existing
    RunLog progress machinery. The whole body is defensive: a bookkeeping
    failure must never abort the actual runs, and the RunLog is always
    finalised so the UI's polling loop terminates.
    """
    tracker_db = SessionLocal()
    cancelled = False
    try:
        run_log = tracker_db.get(RunLog, run_log_id)
        if run_log is None:  # pragma: no cover - defensive
            logger.warning("ai batch: RunLog %s vanished before execution", run_log_id)
        else:
            run_log.phase = "running"
            run_log.started_at = utcnow()
            tracker_db.add(run_log)
            tracker_db.commit()

        for run_id, agent_id, kwargs in items:
            if is_cancel_requested(run_log_id):
                cancelled = True
                break
            try:
                await execute_run_in_background(run_id, agent_id, kwargs)
            except Exception as exc:  # pragma: no cover - child handles its own
                logger.exception(
                    "ai batch item failed (run=%s agent=%s): %s", run_id, agent_id, exc
                )
            if run_log is not None:
                try:
                    _recompute_batch_counters(tracker_db, run_log, run_log_id)
                except Exception:  # pragma: no cover - bookkeeping must not abort runs
                    logger.exception("ai batch: counter update failed for run %s", run_log_id)

        if cancelled:
            # Mark the not-yet-executed runs of this batch as cancelled so the
            # UI stops spinning on them.
            tracker_db.query(AIRun).filter(
                AIRun.batch_run_id == run_log_id, AIRun.status == "running"
            ).update({AIRun.status: "cancelled"}, synchronize_session=False)
            tracker_db.commit()
            if run_log is not None:
                _recompute_batch_counters(tracker_db, run_log, run_log_id)
    except Exception:  # pragma: no cover - safety net, never raise out
        logger.exception("ai batch background task failed for run %s", run_log_id)
    finally:
        try:
            run_log = tracker_db.get(RunLog, run_log_id)
            if run_log is not None:
                finished_at = utcnow()
                run_log.phase = "finished"
                run_log.finished_at = finished_at
                run_log.duration_seconds = max(
                    0, int((finished_at - run_log.started_at).total_seconds())
                )
                if cancelled:
                    run_log.status = "cancelled"
                elif run_log.stocks_total and run_log.stocks_error == run_log.stocks_total:
                    run_log.status = "error"
                elif run_log.stocks_error > 0:
                    run_log.status = "partial_error"
                else:
                    run_log.status = "ok"
                tracker_db.add(run_log)
                tracker_db.commit()
        except Exception:  # pragma: no cover - finalisation safety net
            logger.exception("ai batch: finalisation failed for run %s", run_log_id)
        finally:
            clear_cancel(run_log_id)
            tracker_db.close()
