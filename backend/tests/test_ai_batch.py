"""Tests for the AI batch endpoint (`POST /api/v1/ai/runs/batch`).

The background runner is monkeypatched to a no-op so the tests exercise only
the queue/skip bookkeeping without making real provider calls.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import app.api.v1.ai as ai_router
from app.core.time import utcnow
from app.db.session import SessionLocal
from app.main import app
from app.models.ai_run import AIRun
from app.models.run_log import RunLog
from app.models.stock import Stock
from app.services.ai_run_service import recover_dangling_ai_runs


def _login(client: TestClient) -> str:
    resp = client.post("/api/v1/auth/login", json={"username": "admin", "password": "changeme"})
    assert resp.status_code == 200
    return resp.json()["csrf_token"]


@pytest.fixture(autouse=True)
def _cleanup() -> None:
    def _wipe() -> None:
        db = SessionLocal()
        try:
            db.query(AIRun).filter(AIRun.isin.like("BATCH%")).delete()
            db.query(Stock).filter(Stock.isin.like("BATCH%")).delete()
            db.commit()
        finally:
            db.close()

    _wipe()
    yield
    _wipe()


@pytest.fixture
def _no_background(monkeypatch: pytest.MonkeyPatch) -> list:
    """Replace the serial runner with a recorder so no LLM calls happen."""
    captured: list = []

    async def _fake(items: list, run_log_id: int) -> None:
        captured.extend(items)

    monkeypatch.setattr(ai_router, "execute_batch_in_background", _fake)
    return captured


def _seed_stocks(*isins: str) -> None:
    db = SessionLocal()
    try:
        for isin in isins:
            db.add(Stock(isin=isin, name=f"Batch {isin}"))
        db.commit()
    finally:
        db.close()


def _running_count() -> int:
    db = SessionLocal()
    try:
        return (
            db.query(AIRun)
            .filter(AIRun.isin.like("BATCH%"), AIRun.status == "running")
            .count()
        )
    finally:
        db.close()


def test_batch_queues_cartesian_product(_no_background: list) -> None:
    _seed_stocks("BATCH0000001", "BATCH0000002")
    client = TestClient(app)
    csrf = _login(client)

    resp = client.post(
        "/api/v1/ai/runs/batch",
        json={"agent_ids": ["fisher", "redflag"], "isins": ["BATCH0000001", "BATCH0000002"]},
        headers={"X-CSRF-Token": csrf},
    )
    assert resp.status_code == 202
    body = resp.json()
    assert len(body["queued"]) == 4
    assert body["skipped"] == []
    assert all(item["run_id"] is not None for item in body["queued"])
    assert _running_count() == 4
    # The single serial task received all four queued runs.
    assert len(_no_background) == 4


def test_batch_requires_csrf() -> None:
    client = TestClient(app)
    _login(client)
    resp = client.post(
        "/api/v1/ai/runs/batch",
        json={"agent_ids": ["fisher"], "isins": ["BATCH0000001"]},
    )
    assert resp.status_code == 403


def test_batch_skips_unknown_agent_and_stock(_no_background: list) -> None:
    _seed_stocks("BATCH0000003")
    client = TestClient(app)
    csrf = _login(client)

    resp = client.post(
        "/api/v1/ai/runs/batch",
        json={
            "agent_ids": ["fisher", "does-not-exist"],
            "isins": ["BATCH0000003", "BATCH9999999"],
        },
        headers={"X-CSRF-Token": csrf},
    )
    assert resp.status_code == 202
    body = resp.json()
    # Only fisher × BATCH0000003 is valid.
    assert len(body["queued"]) == 1
    assert body["queued"][0] == {
        "agent_id": "fisher",
        "isin": "BATCH0000003",
        "run_id": body["queued"][0]["run_id"],
        "status": "queued",
        "reason": None,
    }
    reasons = {(s["agent_id"], s["reason"]) for s in body["skipped"]}
    assert ("does-not-exist", "Agent unbekannt") in reasons
    assert ("fisher", "Aktie nicht gefunden") in reasons


def test_batch_skips_pair_already_running(_no_background: list) -> None:
    _seed_stocks("BATCH0000004")
    db = SessionLocal()
    try:
        from app.core.time import utcnow

        db.add(
            AIRun(
                isin="BATCH0000004",
                agent_id="fisher",
                created_at=utcnow(),
                provider="pending",
                model="pending",
                status="running",
                input_payload={},
            )
        )
        db.commit()
    finally:
        db.close()

    client = TestClient(app)
    csrf = _login(client)
    resp = client.post(
        "/api/v1/ai/runs/batch",
        json={"agent_ids": ["fisher", "redflag"], "isins": ["BATCH0000004"]},
        headers={"X-CSRF-Token": csrf},
    )
    assert resp.status_code == 202
    body = resp.json()
    assert [q["agent_id"] for q in body["queued"]] == ["redflag"]
    assert [(s["agent_id"], s["reason"]) for s in body["skipped"]] == [
        ("fisher", "läuft bereits")
    ]


def test_batch_deduplicates_repeated_pairs(_no_background: list) -> None:
    _seed_stocks("BATCH0000005")
    client = TestClient(app)
    csrf = _login(client)
    resp = client.post(
        "/api/v1/ai/runs/batch",
        json={
            "agent_ids": ["fisher", "fisher"],
            "isins": ["BATCH0000005", "batch0000005"],
        },
        headers={"X-CSRF-Token": csrf},
    )
    assert resp.status_code == 202
    body = resp.json()
    assert len(body["queued"]) == 1
    assert _running_count() == 1


def test_recover_dangling_ai_runs_cancels_orphans() -> None:
    """A `running` AIRun orphaned by a crash is forced to `cancelled` and its
    batch RunLog is finalised; a terminal run in the same batch is untouched."""
    _seed_stocks("BATCH0000006")
    db = SessionLocal()
    try:
        run_log = RunLog(
            run_type="ai", phase="running", stocks_total=1, status="ok", started_at=utcnow()
        )
        db.add(run_log)
        db.commit()
        db.refresh(run_log)
        run_log_id = run_log.id

        dangling = AIRun(
            isin="BATCH0000006", agent_id="fisher", provider="pending", model="pending",
            status="running", input_payload={}, batch_run_id=run_log_id,
        )
        finished = AIRun(
            isin="BATCH0000006", agent_id="redflag", provider="x", model="y",
            status="done", input_payload={}, result_payload={"ok": True},
        )
        db.add_all([dangling, finished])
        db.commit()
        dangling_id, finished_id = dangling.id, finished.id
    finally:
        db.close()

    recover_dangling_ai_runs()

    db = SessionLocal()
    try:
        assert db.get(AIRun, dangling_id).status == "cancelled"
        assert db.get(AIRun, finished_id).status == "done"  # terminal rows untouched
        recovered = db.get(RunLog, run_log_id)
        assert recovered.phase == "finished"
        assert recovered.status == "cancelled"
        # leaked finished RunLog won't be wiped by the BATCH% cleanup; remove it
        db.delete(recovered)
        db.commit()
    finally:
        db.close()


def test_recover_dangling_ai_runs_noop_when_clean() -> None:
    """With no orphaned `running` rows the pass leaves finished work as-is."""
    _seed_stocks("BATCH0000007")
    db = SessionLocal()
    try:
        done = AIRun(
            isin="BATCH0000007", agent_id="fisher", provider="x", model="y",
            status="done", input_payload={}, result_payload={"ok": True},
        )
        db.add(done)
        db.commit()
        done_id = done.id
    finally:
        db.close()

    recover_dangling_ai_runs()

    db = SessionLocal()
    try:
        assert db.get(AIRun, done_id).status == "done"
    finally:
        db.close()
