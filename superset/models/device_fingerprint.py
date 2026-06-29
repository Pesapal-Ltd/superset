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
"""ORM models for Device Fingerprint Blocking feature."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from flask_appbuilder import Model
from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship

FINGERPRINT_STATUSES = ("active", "inactive")


class BlockedDeviceFingerprint(Model):
    """Audit log and record of blocked device fingerprints."""

    __tablename__ = "blocked_device_fingerprints"

    id = Column(Integer, primary_key=True)
    device_fingerprint = Column(String(512), nullable=False, index=True)
    
    # Audit trail
    blocked_by_fk = Column(Integer, ForeignKey("ab_user.id"), nullable=False)
    blocked_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    block_reason = Column(Text, nullable=True)
    status = Column(String(10), default="active", nullable=False)  # "active" or "inactive"
    
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )
    
    # Context
    dashboard_id = Column(
        Integer, ForeignKey("dashboards.id", ondelete="SET NULL"), nullable=True
    )
    chart_id = Column(
        Integer, ForeignKey("slices.id", ondelete="SET NULL"), nullable=True
    )

    blocked_by = relationship(
        "User",
        foreign_keys=[blocked_by_fk],
        primaryjoin="BlockedDeviceFingerprint.blocked_by_fk == User.id",
    )
    dashboard = relationship(
        "Dashboard",
        foreign_keys=[dashboard_id],
    )
    chart = relationship(
        "Slice",
        foreign_keys=[chart_id],
    )

    def __repr__(self) -> str:
        return f"BlockedDeviceFingerprint<{self.id}:{self.device_fingerprint}:{self.status}>"
