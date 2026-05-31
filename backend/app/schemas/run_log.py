from datetime import datetime

from pydantic import BaseModel, ConfigDict


class RefreshAllRequest(BaseModel):
    """Optional body for `POST /jobs/refresh-all`.

    When `isins` is omitted/empty the whole watchlist is refreshed (legacy
    behaviour). When ISINs are given, only that subset is refreshed.
    """

    isins: list[str] | None = None


class RunLogOut(BaseModel):
    id: int
    run_type: str = "market"
    started_at: datetime
    finished_at: datetime | None = None
    duration_seconds: int
    stocks_total: int
    stocks_done: int = 0
    stocks_success: int
    stocks_error: int
    phase: str = "finished"
    status: str
    error_details: str | None = None

    model_config = ConfigDict(from_attributes=True)


class RunStockStepOut(BaseModel):
    status: str
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error: str | None = None


class RunStockStatusOut(BaseModel):
    isin: str
    stock_name: str | None = None
    overall_status: str
    started_at: datetime | None = None
    finished_at: datetime | None = None
    resolved_symbol: str | None = None
    symbol: RunStockStepOut
    quote: RunStockStepOut
    metrics: RunStockStepOut
