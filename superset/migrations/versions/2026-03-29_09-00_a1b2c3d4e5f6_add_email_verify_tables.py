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
"""add_email_verify_tables

Revision ID: a1b2c3d4e5f6
Revises: 363a9b1e8992
Create Date: 2026-03-29 09:00:00.000000

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "a1b2c3d4e5f6"
down_revision = "363a9b1e8992"
branch_labels = None
depends_on = None


def upgrade():
    # Create email_verification_template table
    op.create_table(
        "email_verification_template",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        # "transaction_verification" | "merchant_verification" — String for
        # cross-DB compat (avoids Postgres-only native Enum)
        sa.Column("type", sa.String(50), nullable=False),
        sa.Column("subject", sa.String(500), nullable=False),
        sa.Column("html_body", sa.Text(), nullable=False),
        sa.Column("text_body", sa.Text(), nullable=True),
        # JSON list of variable names detected in the template
        sa.Column("variables", sa.JSON(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("created_by_fk", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.ForeignKeyConstraint(
            ["created_by_fk"],
            ["ab_user.id"],
            name="fk_email_verify_template_created_by",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_email_verification_template_type",
        "email_verification_template",
        ["type"],
    )
    op.create_index(
        "ix_email_verification_template_is_active",
        "email_verification_template",
        ["is_active"],
    )

    # Create email_verification_log table
    op.create_table(
        "email_verification_log",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("template_id", sa.Integer(), nullable=False),
        sa.Column("sent_by_fk", sa.Integer(), nullable=False),
        sa.Column("recipient_email", sa.String(255), nullable=False),
        sa.Column("merchant_id", sa.String(255), nullable=True),
        sa.Column("dashboard_id", sa.Integer(), nullable=True),
        sa.Column("chart_id", sa.Integer(), nullable=True),
        sa.Column("payload_snapshot", sa.JSON(), nullable=False),
        # "sent" | "failed"
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "sent_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.ForeignKeyConstraint(
            ["template_id"],
            ["email_verification_template.id"],
            name="fk_email_verify_log_template",
        ),
        sa.ForeignKeyConstraint(
            ["sent_by_fk"],
            ["ab_user.id"],
            name="fk_email_verify_log_sent_by",
        ),
        sa.ForeignKeyConstraint(
            ["dashboard_id"],
            ["dashboards.id"],
            name="fk_email_verify_log_dashboard",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["chart_id"],
            ["slices.id"],
            name="fk_email_verify_log_chart",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_email_verification_log_sent_at",
        "email_verification_log",
        ["sent_at"],
    )
    op.create_index(
        "ix_email_verification_log_merchant_id",
        "email_verification_log",
        ["merchant_id"],
    )
    op.create_index(
        "ix_email_verification_log_status",
        "email_verification_log",
        ["status"],
    )


def downgrade():
    op.drop_table("email_verification_log")
    op.drop_table("email_verification_template")
