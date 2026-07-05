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
"""ORM model for Settlement (Hold Funds / Release Funds) audit log."""
from __future__ import annotations

from datetime import datetime

from flask_appbuilder import Model
from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, Numeric, String, Text

SETTLEMENT_ACTIONS = ("hold", "release")
SETTLEMENT_STATUSES = ("pending", "success", "failed")


class SettlementLog(Model):
    """Audit log — records every Hold/Release Funds attempt."""

    __tablename__ = "settlement_log"

    id = Column(Integer, primary_key=True)

    # Context
    dashboard_id = Column(
        Integer, ForeignKey("dashboards.id", ondelete="SET NULL"), nullable=True
    )
    chart_id = Column(
        Integer, ForeignKey("slices.id", ondelete="SET NULL"), nullable=True
    )
    action = Column(String(20), nullable=False)
    confirmation_code = Column(String(255), nullable=False)
    merchant_id = Column(String(255), nullable=True)
    currency = Column(String(10), nullable=True)
    country = Column(String(10), nullable=True)
    amount = Column(Numeric(18, 4), nullable=True)
    reason = Column(String(500), nullable=False)
    task_id = Column(String(255), nullable=True)
    status = Column(String(20), nullable=False, default="pending")
    merchant_recovery_guid = Column(String(255), nullable=True)
    error_type = Column(String(255), nullable=True)
    error_message = Column(Text, nullable=True)
    response_snapshot = Column(JSON, nullable=True)
    request_payload = Column(JSON, nullable=True)
    initiated_by_fk = Column(Integer, ForeignKey("ab_user.id"), nullable=True)
    initiated_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    completed_at = Column(DateTime, nullable=True)

    def __repr__(self) -> str:
        return f"SettlementLog<{self.id}:{self.action}:{self.confirmation_code}:{self.status}>"

