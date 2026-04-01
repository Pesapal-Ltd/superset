# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.
"""add settlement_log table

Revision ID: 20260401_085631
Revises:
Create Date: 2026-04-01 08:56:31

"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260401_085631"
down_revision = "a1b2c3d4e5f6"  # latest migration as of 2026-04-01
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "settlement_log",
        sa.Column("id", sa.Integer(), nullable=False),
        # Context
        sa.Column("dashboard_id", sa.Integer(), nullable=True),
        sa.Column("chart_id", sa.Integer(), nullable=True),
        # Action + identity
        sa.Column("action", sa.String(length=20), nullable=False),
        sa.Column("confirmation_code", sa.String(length=255), nullable=False),
        # Enriched from DB
        sa.Column("merchant_id", sa.String(length=255), nullable=True),
        sa.Column("currency", sa.String(length=10), nullable=True),
        sa.Column("country", sa.String(length=10), nullable=True),
        sa.Column("amount", sa.Numeric(precision=18, scale=4), nullable=True),
        # User input
        sa.Column("reason", sa.String(length=500), nullable=False),
        # Celery
        sa.Column("task_id", sa.String(length=255), nullable=True),
        # Outcome
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("response_snapshot", sa.JSON(), nullable=True),
        # Initiator
        sa.Column("initiated_by_fk", sa.Integer(), nullable=True),
        sa.Column(
            "initiated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        # Constraints
        sa.ForeignKeyConstraint(
            ["dashboard_id"],
            ["dashboards.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["chart_id"],
            ["slices.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["initiated_by_fk"],
            ["ab_user.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    # Index for fast lookups by confirmation_code and status
    op.create_index(
        "ix_settlement_log_confirmation_code",
        "settlement_log",
        ["confirmation_code"],
    )
    op.create_index(
        "ix_settlement_log_status",
        "settlement_log",
        ["status"],
    )
    op.create_index(
        "ix_settlement_log_task_id",
        "settlement_log",
        ["task_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_settlement_log_task_id", table_name="settlement_log")
    op.drop_index("ix_settlement_log_status", table_name="settlement_log")
    op.drop_index("ix_settlement_log_confirmation_code", table_name="settlement_log")
    op.drop_table("settlement_log")
