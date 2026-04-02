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
"""add request_payload to settlement_log

Revision ID: 20260402_111200
Revises: 20260401_085631
Create Date: 2026-04-02 11:12:00

"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260402_111200"
down_revision = "20260401_085631"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "settlement_log",
        sa.Column("request_payload", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("settlement_log", "request_payload")
