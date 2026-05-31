"""Tests for the AI-run JSON export/import (app.services.ai_run_io)."""
from __future__ import annotations

import json
from datetime import datetime

import pytest

from app.db.session import SessionLocal
from app.models.ai_run import AIRun
from app.models.stock import Stock
from app.services.ai_run_io import EXPORT_FORMAT, EXPORT_VERSION, build_export, import_runs

_ISIN = "AIIO00000001"
_RESULT = {"total_score": 22, "verdict": "strong", "questions": [{"id": "q1", "rating": 2}]}
_INPUT = {"isin": _ISIN, "name": "Export Test", "metrics": {"pe_forward": 12.5}}
_CREATED = datetime(2026, 4, 1, 12, 0, 0)


@pytest.fixture(autouse=True)
def _cleanup():
    def _wipe() -> None:
        db = SessionLocal()
        try:
            db.query(AIRun).filter(AIRun.isin.like("AIIO%")).delete()
            db.query(Stock).filter(Stock.isin.like("AIIO%")).delete()
            db.commit()
        finally:
            db.close()

    _wipe()
    yield
    _wipe()


def _seed_run(db, *, isin: str = _ISIN, agent_id: str = "fisher", status: str = "done") -> AIRun:
    db.merge(Stock(isin=isin, name="Export Test", sector="Tech"))
    run = AIRun(
        isin=isin,
        agent_id=agent_id,
        created_at=_CREATED,
        provider="claudecode",
        model="claude-opus-4-8",
        status=status,
        input_payload=_INPUT,
        result_payload=_RESULT if status == "done" else None,
        cost_estimate=0.12,
        duration_ms=4500,
    )
    db.add(run)
    db.commit()
    return run


def _our_envelope(db) -> dict:
    """build_export filtered to the test ISIN, re-wrapped as its own export."""
    export = build_export(db)
    runs = [r for r in export["runs"] if r["isin"] == _ISIN]
    return {**export, "count": len(runs), "runs": runs}


def test_build_export_shape_and_omits_local_ids() -> None:
    db = SessionLocal()
    try:
        _seed_run(db)
        export = build_export(db)
        assert export["format"] == EXPORT_FORMAT
        assert export["version"] == EXPORT_VERSION
        mine = [r for r in export["runs"] if r["isin"] == _ISIN]
        assert len(mine) == 1
        row = mine[0]
        assert row["agent_id"] == "fisher"
        assert row["provider"] == "claudecode"
        assert row["created_at"] == _CREATED.isoformat()
        assert row["result_payload"] == _RESULT
        assert "id" not in row and "batch_run_id" not in row
    finally:
        db.close()


def test_build_export_excludes_non_done_runs() -> None:
    db = SessionLocal()
    try:
        _seed_run(db, status="error")
        export = build_export(db)
        assert [r for r in export["runs"] if r["isin"] == _ISIN] == []
    finally:
        db.close()


def test_round_trip_reinserts_run() -> None:
    db = SessionLocal()
    try:
        _seed_run(db)
        content = json.dumps(_our_envelope(db)).encode("utf-8")
        # Simulate a fresh target deployment: keep the stock, drop the run.
        db.query(AIRun).filter(AIRun.isin == _ISIN).delete()
        db.commit()

        report = import_runs(db, content)
        assert report.inserted == 1
        assert report.skipped_existing == 0
        assert report.unmapped_rows == [] and report.malformed_rows == []

        restored = db.query(AIRun).filter(AIRun.isin == _ISIN).one()
        assert restored.agent_id == "fisher"
        assert restored.result_payload == _RESULT
        assert restored.created_at == _CREATED
        assert restored.batch_run_id is None
    finally:
        db.close()


def test_reimport_is_idempotent() -> None:
    db = SessionLocal()
    try:
        _seed_run(db)
        content = json.dumps(_our_envelope(db)).encode("utf-8")
        # The run already exists → every entry is a duplicate.
        report = import_runs(db, content)
        assert report.inserted == 0
        assert report.skipped_existing == 1
        assert db.query(AIRun).filter(AIRun.isin == _ISIN).count() == 1
    finally:
        db.close()


def test_unknown_isin_is_unmapped_not_inserted() -> None:
    db = SessionLocal()
    try:
        envelope = {
            "format": EXPORT_FORMAT,
            "version": EXPORT_VERSION,
            "runs": [
                {
                    "isin": "AIIO99999999",  # no such stock
                    "agent_id": "fisher",
                    "created_at": _CREATED.isoformat(),
                    "provider": "claudecode",
                    "model": "claude-opus-4-8",
                    "status": "done",
                    "input_payload": {},
                    "result_payload": _RESULT,
                }
            ],
        }
        report = import_runs(db, json.dumps(envelope).encode("utf-8"))
        assert report.inserted == 0
        assert len(report.unmapped_rows) == 1
        assert "AIIO99999999" in report.unmapped_rows[0].reason
        assert db.query(AIRun).filter(AIRun.isin == "AIIO99999999").count() == 0
    finally:
        db.close()


def test_unknown_agent_is_unmapped() -> None:
    db = SessionLocal()
    try:
        _seed_run(db)
        db.query(AIRun).filter(AIRun.isin == _ISIN).delete()
        db.commit()
        envelope = {
            "format": EXPORT_FORMAT,
            "runs": [
                {
                    "isin": _ISIN,
                    "agent_id": "does-not-exist",
                    "created_at": _CREATED.isoformat(),
                    "provider": "claudecode",
                    "model": "m",
                    "input_payload": {},
                }
            ],
        }
        report = import_runs(db, json.dumps(envelope).encode("utf-8"))
        assert report.inserted == 0
        assert len(report.unmapped_rows) == 1
        assert "does-not-exist" in report.unmapped_rows[0].reason
    finally:
        db.close()


def test_malformed_rows_reported() -> None:
    db = SessionLocal()
    try:
        _seed_run(db)
        db.query(AIRun).filter(AIRun.isin == _ISIN).delete()
        db.commit()
        envelope = {
            "format": EXPORT_FORMAT,
            "runs": [
                # bad created_at
                {
                    "isin": _ISIN,
                    "agent_id": "fisher",
                    "created_at": "not-a-date",
                    "provider": "claudecode",
                    "model": "m",
                },
                # missing required field (provider)
                {
                    "isin": _ISIN,
                    "agent_id": "fisher",
                    "created_at": _CREATED.isoformat(),
                    "model": "m",
                },
            ],
        }
        report = import_runs(db, json.dumps(envelope).encode("utf-8"))
        assert report.inserted == 0
        assert len(report.malformed_rows) == 2
    finally:
        db.close()


def test_not_an_export_file_is_malformed() -> None:
    db = SessionLocal()
    try:
        report = import_runs(db, b"{\"hello\": \"world\"}")
        assert report.inserted == 0
        assert len(report.malformed_rows) == 1
    finally:
        db.close()
