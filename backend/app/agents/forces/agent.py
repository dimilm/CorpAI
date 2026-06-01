"""Porter's Five Forces agent."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.agents.base import BaseAgent
from app.agents.context import build_stock_context
from app.agents.forces.schema import FiveForcesResult
from app.models.stock import Stock


class FiveForcesAgent(BaseAgent):
    id = "forces"
    name = "Porter's Five Forces"
    description = (
        "Bewertet die Branchenattraktivität über Porters fünf Wettbewerbskräfte "
        "(neue Anbieter, Lieferanten- und Käufermacht, Substitute, Rivalität)."
    )
    prompt_path = Path(__file__).with_name("prompt.md")
    output_schema = FiveForcesResult

    def build_input(self, db: Session, stock: Stock, **_: Any) -> dict[str, Any]:
        return build_stock_context(db, stock)
