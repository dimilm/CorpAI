"""Tests for the bulk price-trend endpoint powering the watchlist sparkline.

Covers the service-level aggregation (`price_trends_by_isin`) and the HTTP
endpoint (`GET /stocks/trends`): per-ISIN grouping, cutoff/interval/null
filtering, and that stocks without cached history simply don't appear.
"""
from __future__ import annotations

from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.db.session import SessionLocal
from app.main import app
from app.models.stock import PriceHistory, Stock
from app.services import price_trend_service

ISIN_A = "DE000PRICE01"
ISIN_B = "DE000PRICE02"
ISIN_EMPTY = "DE000PRICE03"
_ALL_ISINS = (ISIN_A, ISIN_B, ISIN_EMPTY)


def _login(client: TestClient) -> str:
    resp = client.post(
        "/api/v1/auth/login", json={"username": "admin", "password": "changeme"}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["csrf_token"]


def _cleanup(db) -> None:
    db.query(PriceHistory).filter(PriceHistory.isin.in_(_ALL_ISINS)).delete(
        synchronize_session=False
    )
    db.query(Stock).filter(Stock.isin.in_(_ALL_ISINS)).delete(
        synchronize_session=False
    )
    db.commit()


def _seed() -> None:
    db = SessionLocal()
    try:
        _cleanup(db)
        for isin, name in (
            (ISIN_A, "Price A AG"),
            (ISIN_B, "Price B AG"),
            (ISIN_EMPTY, "No-History AG"),
        ):
            db.add(Stock(isin=isin, name=name))
        today = date.today()
        # A: three monthly bars within the year, ascending close.
        db.add(PriceHistory(isin=ISIN_A, interval="1mo", date=today - timedelta(days=60), close=100.0))
        db.add(PriceHistory(isin=ISIN_A, interval="1mo", date=today - timedelta(days=30), close=110.0))
        db.add(PriceHistory(isin=ISIN_A, interval="1mo", date=today, close=120.0))
        # A: a bar older than the 365-day cutoff — must be excluded.
        db.add(PriceHistory(isin=ISIN_A, interval="1mo", date=today - timedelta(days=400), close=50.0))
        # A: a daily bar — wrong interval, must be excluded.
        db.add(PriceHistory(isin=ISIN_A, interval="1d", date=today, close=999.0))
        # A: a null-close monthly bar — must be excluded.
        db.add(PriceHistory(isin=ISIN_A, interval="1mo", date=today - timedelta(days=10), close=None))
        # B: a single monthly bar.
        db.add(PriceHistory(isin=ISIN_B, interval="1mo", date=today, close=42.5))
        # ISIN_EMPTY: stock exists but has no price history.
        db.commit()
    finally:
        db.close()


def test_price_trends_by_isin_filters_and_groups():
    _seed()
    db = SessionLocal()
    try:
        out = price_trend_service.price_trends_by_isin(db, days=365)
    finally:
        db.close()

    assert set(out) == {ISIN_A, ISIN_B}  # ISIN_EMPTY absent — no history.

    a_points = out[ISIN_A]
    assert [c for _, c in a_points] == [100.0, 110.0, 120.0]  # sorted, null/old/1d excluded
    dates = [d for d, _ in a_points]
    assert dates == sorted(dates)

    assert out[ISIN_B] == [(date.today(), 42.5)]

    db = SessionLocal()
    try:
        _cleanup(db)
    finally:
        db.close()


def test_price_trends_endpoint_shape():
    _seed()
    client = TestClient(app)
    _login(client)

    resp = client.get("/api/v1/stocks/trends?days=365")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["days"] == 365
    assert body["interval"] == "1mo"

    items_by_isin = {item["isin"]: item["points"] for item in body["items"]}
    assert ISIN_EMPTY not in items_by_isin

    a_points = items_by_isin[ISIN_A]
    assert [p["close"] for p in a_points] == [100.0, 110.0, 120.0]
    assert all("date" in p and "close" in p for p in a_points)

    db = SessionLocal()
    try:
        _cleanup(db)
    finally:
        db.close()


def test_price_trends_endpoint_requires_auth():
    resp = TestClient(app).get("/api/v1/stocks/trends")
    assert resp.status_code == 401
