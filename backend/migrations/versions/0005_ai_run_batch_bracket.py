"""Link ai_runs to a RunLog batch bracket.

Revision ID: 0005_ai_run_batch_bracket
Revises: 0004_burggraben_to_moat_tag
Create Date: 2026-05-31

Adds ``ai_runs.batch_run_id`` (FK -> ``run_logs.id``, ON DELETE SET NULL) so a
``POST /ai/runs/batch`` request can wrap its queued runs in a single
``RunLog`` (``run_type='ai'``) and reuse the existing progress/cancel
machinery shared with the market and jobs pipelines.

``batch_alter_table`` is used because SQLite cannot ALTER a table to add a
foreign key in place — Alembic recreates the table transparently.
``render_as_batch=True`` is already active in ``env.py`` so this works both
locally (SQLite) and in any future Postgres deployment.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0005_ai_run_batch_bracket"
down_revision: Union[str, None] = "0004_burggraben_to_moat_tag"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("ai_runs", schema=None) as batch_op:
        batch_op.add_column(sa.Column("batch_run_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_ai_runs_batch_run_id",
            "run_logs",
            ["batch_run_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index("ix_ai_runs_batch_run_id", ["batch_run_id"])


def downgrade() -> None:
    with op.batch_alter_table("ai_runs", schema=None) as batch_op:
        batch_op.drop_index("ix_ai_runs_batch_run_id")
        batch_op.drop_constraint("fk_ai_runs_batch_run_id", type_="foreignkey")
        batch_op.drop_column("batch_run_id")
