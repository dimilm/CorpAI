"""Schema for the reverse-DCF / intrinsic value agent."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator


class DcfResult(BaseModel):
    forecast_years: int = Field(ge=1, le=10)
    discount_rate_pct: float = Field(
        description="Angesetzter Kapitalkostensatz / WACC in Prozent"
    )
    terminal_growth_pct: float = Field(
        description="Ewiges Wachstum nach dem Prognosehorizont in Prozent"
    )

    fair_value_low: float
    fair_value_base: float
    fair_value_high: float

    current_price: float
    upside_pct: float = Field(
        description="(fair_value_base - current_price) / current_price * 100"
    )
    margin_of_safety_pct: float = Field(
        description="(fair_value_low - current_price) / current_price * 100"
    )

    implied_growth_pct: float = Field(
        description="Wachstum, das der aktuelle Kurs einzupreisen scheint (Reverse-DCF)"
    )
    implied_expectations: list[str] = Field(min_length=1, max_length=8)
    key_assumptions: list[str] = Field(min_length=1, max_length=8)

    verdict: Literal["cheap", "fair", "expensive"]
    summary: str

    @model_validator(mode="after")
    def _fair_value_ordering(self) -> "DcfResult":
        if not (self.fair_value_low <= self.fair_value_base <= self.fair_value_high):
            raise ValueError(
                "fair_value_low ≤ fair_value_base ≤ fair_value_high muss gelten"
            )
        return self
