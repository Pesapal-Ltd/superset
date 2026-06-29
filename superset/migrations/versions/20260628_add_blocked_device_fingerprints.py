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
"""add blocked_device_fingerprints table

Revision ID: add_blocked_device_fingerprints
Revises: add_zoho_desk_token_cache
Create Date: 2026-06-28 22:30:00

"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "add_blocked_device_fingerprints"
down_revision = "add_zoho_desk_token_cache"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "blocked_device_fingerprints",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("device_fingerprint", sa.String(length=512), nullable=False),
        sa.Column("blocked_by_fk", sa.Integer(), nullable=False),
        sa.Column(
            "blocked_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("block_reason", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=10), nullable=False, server_default="active"),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("dashboard_id", sa.Integer(), nullable=True),
        sa.Column("chart_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ["blocked_by_fk"],
            ["ab_user.id"],
            name="fk_blocked_device_fingerprints_blocked_by",
        ),
        sa.ForeignKeyConstraint(
            ["dashboard_id"],
            ["dashboards.id"],
            name="fk_blocked_device_fingerprints_dashboard",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["chart_id"],
            ["slices.id"],
            name="fk_blocked_device_fingerprints_chart",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    
    op.create_index(
        "ix_blocked_device_fingerprints_device_fingerprint",
        "blocked_device_fingerprints",
        ["device_fingerprint"],
    )
    op.create_index(
        "ix_blocked_device_fingerprints_status",
        "blocked_device_fingerprints",
        ["status"],
    )
    op.create_index(
        "ix_blocked_device_fingerprints_blocked_at",
        "blocked_device_fingerprints",
        ["blocked_at"],
    )


def downgrade():
    op.drop_index("ix_blocked_device_fingerprints_blocked_at", table_name="blocked_device_fingerprints")
    op.drop_index("ix_blocked_device_fingerprints_status", table_name="blocked_device_fingerprints")
    op.drop_index("ix_blocked_device_fingerprints_device_fingerprint", table_name="blocked_device_fingerprints")
    op.drop_table("blocked_device_fingerprints")
