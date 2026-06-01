"""Reverse-DCF / intrinsic value agent."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.agents.base import BaseAgent
from app.agents.context import build_stock_context
from app.agents.dcf.schema import DcfResult
from app.models.stock import Stock


class DcfAgent(BaseAgent):
    id = "dcf"
    name = "Reverse-DCF / Intrinsischer Wert"
    description = (
        "Leitet einen intrinsischen Wert-Korridor ab und prüft per Reverse-DCF, "
        "welches Wachstum der aktuelle Kurs einpreist und ob das plausibel ist."
    )
    prompt_path = Path(__file__).with_name("prompt.md")
    output_schema = DcfResult

    def build_input(self, db: Session, stock: Stock, **_: Any) -> dict[str, Any]:
        return build_stock_context(db, stock)
