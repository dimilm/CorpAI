"""index ai_runs.status

Revision ID: 0006_ai_runs_status_index
Revises: 0005_ai_run_batch_bracket
Create Date: 2026-05-31

Speeds up the startup recovery query in
``ai_run_service.recover_dangling_ai_runs`` which filters ``ai_runs`` by
``status``; without this index it is a full table scan. (The per-source jobs
trend queries are already covered by the composite snapshot index, so no
snapshot-date index is added here.)
"""
from __future__ import annotations

from alembic import op

revision = "0006_ai_runs_status_index"
down_revision = "0005_ai_run_batch_bracket"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_ai_runs_status", "ai_runs", ["status"])


def downgrade() -> None:
    op.drop_index("ix_ai_runs_status", table_name="ai_runs")
