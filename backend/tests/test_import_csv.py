from fastapi.testclient import TestClient

from app.db.session import SessionLocal
from app.main import app
from app.models.stock import Stock
from app.services.stock_service import parse_csv_and_upsert, upsert_seed_row

# Column layout the importer expects (see stock_service CSV_COL_* constants):
# ISIN at index 2, name at index 14.
_ISIN_COL = 2
_NAME_COL = 14


def _row(isin: str = "", name: str = "", length: int = 20) -> list[str]:
    cells = [""] * length
    if isin:
        cells[_ISIN_COL] = isin
    if name:
        cells[_NAME_COL] = name
    return cells


def _csv(rows: list[list[str]]) -> bytes:
    return "\r\n".join(";".join(cell for cell in row) for row in rows).encode("utf-8")


def _minimal_seed(isin: str, name: str) -> dict:
    return {
        "isin": isin,
        "name": name,
        "sector": "Tech",
        "currency": "USD",
        "tranches": 0,
        "reasoning": None,
        "link_yahoo": None,
        "link_finanzen": None,
        "link_onvista_chart": None,
        "link_onvista_fundamental": None,
    }


def test_parse_csv_reports_created_updated_and_skipped() -> None:
    db = SessionLocal()
    try:
        upsert_seed_row(db, _minimal_seed("US0000000112", "Existing Co"))
        db.commit()
    finally:
        db.close()

    content = _csv(
        [
            _row("US0000000111", "Alpha"),  # new -> created
            _row("US0000000112", "Beta"),  # already present -> updated
            ["junk", "no isin here", "still nothing"],  # non-empty, no ISIN -> skipped
            ["", "", ""],  # blank -> ignored, not counted
        ]
    )

    db = SessionLocal()
    try:
        result = parse_csv_and_upsert(db, content)
    finally:
        db.close()

    assert result["created"] == 1
    assert result["updated"] == 1
    assert result["skipped"] == 1
    assert result["imported"] == 2
    assert result["errors"] == []


def test_parse_csv_counts_duplicate_isin_as_update() -> None:
    content = _csv(
        [
            _row("US0000000113", "First"),
            _row("US0000000113", "Second"),  # same ISIN again -> update, not a 2nd create
        ]
    )

    db = SessionLocal()
    try:
        result = parse_csv_and_upsert(db, content)
    finally:
        db.close()

    assert result["created"] == 1
    assert result["updated"] == 1


def test_parse_native_export_csv_round_trips() -> None:
    # The exact shape produced by GET /export/csv (comma, ISIN in column 0).
    # Fresh ISINs so the created count is independent of the seeded watchlist.
    content = (
        "isin,name,sector,currency,tranches,current_price,day_change_pct,invested_capital_eur\r\n"
        "US0000000201,Acme Mischkonzern,Mischkonzern,USD,0,153.13,0.18,0.0\r\n"
        "US0000000202,Beta Pharma,Pharma,USD,2,217.72,-0.41,0.0\r\n"
    ).encode("utf-8")

    db = SessionLocal()
    try:
        result = parse_csv_and_upsert(db, content)
        stock = db.get(Stock, "US0000000201")
    finally:
        db.close()

    assert result["created"] == 2
    assert result["skipped"] == 0
    assert stock is not None
    assert stock.name == "Acme Mischkonzern"
    assert stock.sector == "Mischkonzern"


def test_parse_native_export_skips_rows_without_isin() -> None:
    content = (
        "isin,name,sector,currency,tranches,current_price,day_change_pct,invested_capital_eur\r\n"
        "US0000000203,Gamma Tech,Tech,USD,1,0,0,0\r\n"
        "not-an-isin,Broken,Tech,USD,0,0,0,0\r\n"
    ).encode("utf-8")

    db = SessionLocal()
    try:
        result = parse_csv_and_upsert(db, content)
    finally:
        db.close()

    assert result["created"] == 1
    assert result["skipped"] == 1


def _login(client: TestClient) -> str:
    resp = client.post("/api/v1/auth/login", json={"username": "admin", "password": "changeme"})
    assert resp.status_code == 200
    return resp.json()["csrf_token"]


def test_import_csv_endpoint_returns_summary() -> None:
    client = TestClient(app)
    csrf = _login(client)

    content = _csv([_row("US0000000114", "Gamma")])
    resp = client.post(
        "/api/v1/import/csv",
        headers={"X-CSRF-Token": csrf},
        files={"file": ("watchlist.csv", content, "text/csv")},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["created"] == 1
    assert body["updated"] == 0
    assert body["skipped"] == 0
    assert body["imported"] == 1
