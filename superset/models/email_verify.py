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
"""ORM models for Merchant Email Verification feature."""
from __future__ import annotations

from datetime import datetime

from flask_appbuilder import Model
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from superset.utils.core import MediumText

# Use JSON type from sqlalchemy — Superset already uses it in other models
from sqlalchemy import JSON


TEMPLATE_TYPES = ("transaction_verification", "merchant_verification")
EMAIL_VERIFY_STATUSES = ("sent", "failed")


class EmailVerificationTemplate(Model):
    """Stores re-usable HTML email templates for merchant verification."""

    __tablename__ = "email_verification_template"

    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    # Store type as String for cross-DB compatibility (avoids Postgres-only Enum)
    type = Column(String(50), nullable=False)
    subject = Column(String(500), nullable=False)
    html_body = Column(Text, nullable=False)
    text_body = Column(Text, nullable=True)
    # JSON list of variable names auto-detected from the template body
    # e.g. ["merchant_name", "transaction_id"]
    variables = Column(JSON, nullable=False, default=list)
    is_active = Column(Boolean, default=True, nullable=False)
    created_by_fk = Column(Integer, ForeignKey("ab_user.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    created_by = relationship(
        "User",
        foreign_keys=[created_by_fk],
        primaryjoin="EmailVerificationTemplate.created_by_fk == User.id",
    )
    logs = relationship(
        "EmailVerificationLog",
        back_populates="template",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"EmailVerificationTemplate<{self.id}:{self.name}>"


class EmailVerificationLog(Model):
    """Audit log — records every send attempt (success or failure)."""

    __tablename__ = "email_verification_log"

    id = Column(Integer, primary_key=True)
    template_id = Column(
        Integer,
        ForeignKey("email_verification_template.id"),
        nullable=False,
    )
    sent_by_fk = Column(Integer, ForeignKey("ab_user.id"), nullable=False)
    recipient_email = Column(String(255), nullable=False)
    merchant_id = Column(String(255), nullable=True)
    dashboard_id = Column(
        Integer, ForeignKey("dashboards.id", ondelete="SET NULL"), nullable=True
    )
    chart_id = Column(
        Integer, ForeignKey("slices.id", ondelete="SET NULL"), nullable=True
    )
    # Snapshot of variables provided at send time — for full auditability
    payload_snapshot = Column(JSON, nullable=False, default=dict)
    # "sent" or "failed" — String for cross-DB compat
    status = Column(String(10), nullable=False)
    error_message = Column(Text, nullable=True)
    sent_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    # ConfirmationCode extracted from variables at send time (used for dedup)
    confirmation_code = Column(String(255), nullable=True, index=True)

    template = relationship("EmailVerificationTemplate", back_populates="logs")
    sent_by = relationship(
        "User",
        foreign_keys=[sent_by_fk],
        primaryjoin="EmailVerificationLog.sent_by_fk == User.id",
    )

    def __repr__(self) -> str:
        return (
            f"EmailVerificationLog<{self.id}:{self.recipient_email}:{self.status}>"
        )
