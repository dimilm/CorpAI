"""Bulk price-trend aggregation for the watchlist price-sparkline column.

Mirror of ``jobs_trend_service.aggregated_trends_by_isin``: one cheap query
that reads the already-cached ``PriceHistory`` rows for *all* stocks at once,
so the watchlist avoids an N+1 fan-out. This never hits the network — the
cache is kept warm by the refresh pipeline (see ``HistoryService.warm``); a
stock whose history has not been fetched yet simply has no points and the
column falls back to a dash.
"""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.core.time import utcnow
from app.models.stock import PriceHistory

# Monthly bars keep the bulk payload tiny (~13 points per stock for a year)
# and are cheap to keep warm — the "1mo" interval has a 7-day TTL.
SPARKLINE_INTERVAL = "1mo"


def price_trends_by_isin(
    db: Session, *, days: int = 365, interval: str = SPARKLINE_INTERVAL
) -> dict[str, list[tuple[date, float]]]:
    """Return per-ISIN ``(date, close)`` series over the last ``days``.

    Only cached rows are read; ISINs without history (never refreshed) are
    absent from the result. Points are sorted by date ascending per ISIN.
    """
    cutoff = utcnow().date() - timedelta(days=days)
    rows = (
        db.query(PriceHistory.isin, PriceHistory.date, PriceHistory.close)
        .filter(
            PriceHistory.interval == interval,
            PriceHistory.date >= cutoff,
            PriceHistory.close.isnot(None),
        )
        .order_by(PriceHistory.isin, PriceHistory.date.asc())
        .all()
    )
    out: dict[str, list[tuple[date, float]]] = {}
    for isin, d, close in rows:
        out.setdefault(isin, []).append((d, float(close)))
    return out
