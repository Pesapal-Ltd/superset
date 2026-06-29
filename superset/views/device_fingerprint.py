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
"""
REST API for Device Fingerprint Blocking.

Registered at: /api/v1/device-fingerprint/
"""
from __future__ import annotations

import logging
import time
from datetime import datetime
from typing import Any

from flask import current_app, g, request
from flask_appbuilder.api import expose, protect, safe

from superset.extensions import cache_manager, db
from superset.models.dashboard import Dashboard
from superset.models.device_fingerprint import BlockedDeviceFingerprint
from superset.superset_typing import FlaskResponse
from superset.utils import json
from superset.utils.core import get_user_id
from flask_appbuilder.security.sqla.models import User
from superset.views.base import BaseSupersetView
from superset.views.base_api import BaseSupersetApi

logger = logging.getLogger(__name__)


# Helpers

def _get_device_fingerprint_config(
    dashboard_id: int | None = None, chart_id: int | None = None
) -> dict[str, Any] | None:
    """
    Read device_fingerprint_config from the params JSON of a Slice (chart-level),
    or fall back to the json_metadata of a Dashboard.
    """
    # Chart-level takes priority
    if chart_id is not None:
        from superset.models.slice import Slice
        chart = db.session.query(Slice).filter_by(id=chart_id).one_or_none()
        if chart is not None:
            try:
                params = json.loads(chart.params or "{}")
            except Exception:  # pylint: disable=broad-except
                params = {}
            cfg = params.get("device_fingerprint_config")
            if cfg is not None:
                return cfg

    # Fall back to dashboard-level (legacy)
    if dashboard_id is not None:
        dash = db.session.query(Dashboard).filter_by(id=dashboard_id).one_or_none()
        if dash is None:
            return None
        try:
            metadata = json.loads(dash.json_metadata or "{}")
        except Exception:  # pylint: disable=broad-except
            return None
        return metadata.get("device_fingerprint_config")

    return None


def _user_role_names() -> list[str]:
    user = g.user
    if user is None or user.is_anonymous:
        return []
    return [role.name for role in user.roles]


def _check_rate_limit(
    user_id: int, limit: int = 50, window_seconds: int = 3600
) -> bool:
    key = f"device_fingerprint_rate_limit:{user_id}"
    now = time.time()
    window_start = now - window_seconds
    timestamps: list[float] = cache_manager.cache.get(key) or []
    timestamps = [t for t in timestamps if t > window_start]
    if len(timestamps) >= limit:
        return False
    timestamps.append(now)
    cache_manager.cache.set(key, timestamps, timeout=window_seconds)
    return True


# Views

class DeviceFingerprintView(BaseSupersetView):
    """View – Blocked Device Fingerprints UI."""

    route_base = "/device-fingerprint"
    allow_browser_login = True

    @expose("/logs/")
    @protect("can_read_blocked_device_fingerprints")
    def logs(self) -> FlaskResponse:
        """Render the blocked device fingerprints log UI."""
        return self.render_app_template()


# API class

class DeviceFingerprintRestApi(BaseSupersetApi):
    """REST API — Device Fingerprint Blocking."""

    csrf_exempt = True
    resource_name = "device-fingerprint"
    route_base = "/api/v1/device-fingerprint"
    allow_browser_login = True
    include_route_methods = {
        "get_config",
        "save_dashboard_config",
        "save_chart_config",
        "block",
        "list_blocked",
        "patch_blocked",
    }

    # Config
    @expose("/config", methods=("GET",))
    @protect()
    @safe
    def get_config(self) -> FlaskResponse:
        """Get device fingerprint config for a dashboard or chart.
        ---
        get:
            summary: Get device fingerprint config
            parameters:
            - in: query
              name: dashboard_id
              schema: {type: integer}
            - in: query
              name: chart_id
              schema: {type: integer}
            responses:
              200:
                description: Device fingerprint config
        """
        dashboard_id = request.args.get("dashboard_id", type=int)
        chart_id = request.args.get("chart_id", type=int)
        if not dashboard_id and not chart_id:
            return self.response(400, message="Either dashboard_id or chart_id query param is required.")

        config = _get_device_fingerprint_config(dashboard_id=dashboard_id, chart_id=chart_id)
        if config is None:
            return self.response(200, result={"enabled": False, "allowed_roles": [], "fingerprint_column": "DeviceFingerprint"})
        return self.response(200, result=config)

    @expose("/config/dashboard/<int:pk>", methods=("PUT",))
    @protect("can_configure_device_fingerprint")
    @safe
    def save_dashboard_config(self, pk: int) -> FlaskResponse:
        """Save device fingerprint config on a dashboard.
        ---
        put:
          summary: Save dashboard device fingerprint config
          parameters:
            - in: path
              name: pk
              schema: {type: integer}
          responses:
            200:
              description: Config saved
        """
        dash = db.session.query(Dashboard).filter_by(id=pk).one_or_none()
        if dash is None:
            return self.response_404()

        body = request.get_json(force=True, silent=True) or {}
        try:
            metadata: dict[str, Any] = json.loads(dash.json_metadata or "{}")
        except Exception:  # pylint: disable=broad-except
            metadata = {}

        metadata["device_fingerprint_config"] = dict(body)
        dash.json_metadata = json.dumps(metadata)
        db.session.commit()

        return self.response(200, result={"dashboard_id": pk, "saved": True})

    @expose("/config/chart/<int:pk>", methods=("PUT",))
    @protect("can_configure_device_fingerprint")
    @safe
    def save_chart_config(self, pk: int) -> FlaskResponse:
        """Save device fingerprint config on a chart.
        ---
        put:
          summary: Save chart device fingerprint config
          parameters:
            - in: path
              name: pk
              schema: {type: integer}
          responses:
            200:
              description: Config saved
        """
        from superset.models.slice import Slice
        chart = db.session.query(Slice).filter_by(id=pk).one_or_none()
        if chart is None:
            return self.response_404()

        body = request.get_json(force=True, silent=True) or {}
        try:
            params: dict[str, Any] = json.loads(chart.params or "{}")
        except Exception:  # pylint: disable=broad-except
            params = {}

        params["device_fingerprint_config"] = dict(body)
        chart.params = json.dumps(params)
        db.session.commit()

        return self.response(200, result={"chart_id": pk, "saved": True})

    # Block Action
    @expose("/block", methods=("POST",))
    @protect("can_block_device_fingerprint")
    @safe
    def block(self) -> FlaskResponse:
        """Block device fingerprints from selected rows.
        ---
        post:
          summary: Block device fingerprints
          requestBody:
            required: true
            content:
              application/json:
                schema:
                  type: object
                  required: [rows]
                  properties:
                    dashboard_id:
                      type: integer
                    chart_id:
                      type: integer
                    rows:
                      type: array
                      items:
                        type: object
                    block_reason:
                      type: string
          responses:
            200:
              description: Device fingerprints processed
            400:
              $ref: '#/components/responses/400'
            403:
              $ref: '#/components/responses/403'
        """
        if not current_app.config.get("DEVICE_FINGERPRINT_BLOCK_ENABLED", True):
            return self.response(403, message="Device fingerprint blocking feature is disabled.")

        body = request.get_json(force=True, silent=True) or {}
        dashboard_id_raw = body.get("dashboard_id")
        dashboard_id: int | None = int(dashboard_id_raw) if dashboard_id_raw else None
        chart_id_raw = body.get("chart_id")
        chart_id: int | None = int(chart_id_raw) if chart_id_raw else None
        rows: list[dict[str, Any]] = body.get("rows", [])
        block_reason: str | None = body.get("block_reason")

        if not rows:
            return self.response(400, message="rows array is required and must not be empty.")

        # Check configuration
        cfg = _get_device_fingerprint_config(dashboard_id=dashboard_id, chart_id=chart_id)
        if not cfg or not cfg.get("enabled"):
            return self.response(403, message="Device fingerprint blocking is not enabled on this resource.")

        allowed_roles: list[str] = cfg.get("allowed_roles", [])
        if allowed_roles:
            user_roles = _user_role_names()
            if not set(user_roles).intersection(allowed_roles):
                return self.response(403, message="Your role is not permitted to block device fingerprints from this resource.")

        # Rate limit
        user_id = get_user_id() or 0
        if not _check_rate_limit(user_id):
            return self.response(429, message="Rate limit exceeded for device fingerprint actions.")

        fingerprint_column: str = cfg.get("fingerprint_column", "DeviceFingerprint")

        blocked_count = 0
        skipped_count = 0
        ids = []

        for row in rows:
            fingerprint = row.get(fingerprint_column)
            if fingerprint is not None:
                fingerprint = str(fingerprint).strip()
            
            if not fingerprint:
                logger.warning("Skipping row with missing fingerprint (column=%s): %s", fingerprint_column, row)
                skipped_count += 1
                continue

            # Check if fingerprint is already active blocked
            existing = (
                db.session.query(BlockedDeviceFingerprint)
                .filter(
                    BlockedDeviceFingerprint.device_fingerprint == fingerprint,
                    BlockedDeviceFingerprint.status == "active",
                )
                .first()
            )
            if existing:
                logger.warning("Skipping duplicate block for fingerprint=%s", fingerprint)
                skipped_count += 1
                continue

            # Persist block record
            block_record = BlockedDeviceFingerprint(
                device_fingerprint=fingerprint,
                blocked_by_fk=user_id,
                blocked_at=datetime.utcnow(),
                block_reason=block_reason,
                status="active",
                dashboard_id=dashboard_id,
                chart_id=chart_id,
            )
            db.session.add(block_record)
            db.session.flush()
            ids.append(block_record.id)
            blocked_count += 1

        db.session.commit()

        return self.response(
            200,
            result={
                "blocked": blocked_count,
                "skipped": skipped_count,
                "ids": ids,
            },
        )

    # Retrieval API
    @expose("/blocked", methods=("GET",))
    @protect("can_read_blocked_device_fingerprints")
    @safe
    def list_blocked(self) -> FlaskResponse:
        """List blocked device fingerprints.
        ---
        get:
          summary: List blocked device fingerprints
          parameters:
            - in: query
              name: status
              schema: {type: string}
            - in: query
              name: fingerprint
              schema: {type: string}
            - in: query
              name: date_from
              schema: {type: string}
            - in: query
              name: date_to
              schema: {type: string}
            - in: query
              name: blocked_by
              schema: {type: integer}
            - in: query
              name: dashboard_id
              schema: {type: integer}
            - in: query
              name: page
              schema: {type: integer}
            - in: query
              name: page_size
              schema: {type: integer}
            - in: query
              name: order_column
              schema: {type: string}
            - in: query
              name: order_direction
              schema: {type: string}
          responses:
            200:
              description: Paginated blocked device fingerprints
        """
        status_filter = request.args.get("status", "active")
        fingerprint_filter = request.args.get("fingerprint")
        date_from_str = request.args.get("date_from")
        date_to_str = request.args.get("date_to")
        blocked_by_filter = request.args.get("blocked_by", type=int)
        dashboard_id_filter = request.args.get("dashboard_id", type=int)
        
        page = request.args.get("page", 0, type=int)
        page_size = min(request.args.get("page_size", 25, type=int), 100)
        
        order_column = request.args.get("order_column", "blocked_at")
        order_direction = request.args.get("order_direction", "desc")

        query = db.session.query(BlockedDeviceFingerprint, User).outerjoin(
            User, BlockedDeviceFingerprint.blocked_by_fk == User.id
        )

        if status_filter in ("active", "inactive"):
            query = query.filter(BlockedDeviceFingerprint.status == status_filter)
        
        if fingerprint_filter:
            query = query.filter(BlockedDeviceFingerprint.device_fingerprint.like(f"%{fingerprint_filter}%"))
        
        if date_from_str:
            try:
                date_from = datetime.fromisoformat(date_from_str)
                query = query.filter(BlockedDeviceFingerprint.blocked_at >= date_from)
            except ValueError:
                pass
        
        if date_to_str:
            try:
                date_to = datetime.fromisoformat(date_to_str)
                query = query.filter(BlockedDeviceFingerprint.blocked_at <= date_to)
            except ValueError:
                pass

        if blocked_by_filter:
            query = query.filter(BlockedDeviceFingerprint.blocked_by_fk == blocked_by_filter)
        
        if dashboard_id_filter:
            query = query.filter(BlockedDeviceFingerprint.dashboard_id == dashboard_id_filter)

        # Ordering
        col = getattr(BlockedDeviceFingerprint, order_column, BlockedDeviceFingerprint.blocked_at)
        if order_direction.lower() == "asc":
            query = query.order_by(col.asc())
        else:
            query = query.order_by(col.desc())

        total = query.count()
        records = query.offset(page * page_size).limit(page_size).all()

        result = [
            {
                "id": record.id,
                "device_fingerprint": record.device_fingerprint,
                "blocked_by": f"{user.first_name} {user.last_name}" if user else "System",
                "blocked_by_id": record.blocked_by_fk,
                "blocked_at": record.blocked_at.isoformat() if record.blocked_at else None,
                "block_reason": record.block_reason,
                "status": record.status,
                "created_at": record.created_at.isoformat() if record.created_at else None,
                "updated_at": record.updated_at.isoformat() if record.updated_at else None,
                "dashboard_id": record.dashboard_id,
                "chart_id": record.chart_id,
            }
            for record, user in records
        ]

        return self.response(200, result=result, count=total, page=page, page_size=page_size)

    # Toggle/Patch Block Status (Unblock support)
    @expose("/blocked/<int:pk>", methods=("PATCH",))
    @protect("can_block_device_fingerprint")
    @safe
    def patch_blocked(self, pk: int) -> FlaskResponse:
        """Update blocked device fingerprint status (e.g. unblock).
        ---
        patch:
          summary: Update status of a blocked device fingerprint
          parameters:
            - in: path
              name: pk
              schema: {type: integer}
          requestBody:
            required: true
            content:
              application/json:
                schema:
                  type: object
                  required: [status]
                  properties:
                    status:
                      type: string
                      enum: [active, inactive]
          responses:
            200:
              description: Device fingerprint status updated
            400:
              description: Invalid payload or state
            404:
              description: Blocked device fingerprint record not found
        """
        record = db.session.query(BlockedDeviceFingerprint).filter_by(id=pk).one_or_none()
        if record is None:
            return self.response_404()

        body = request.get_json(force=True, silent=True) or {}
        new_status = body.get("status")
        if new_status not in ("active", "inactive"):
            return self.response(400, message='status must be "active" or "inactive".')

        record.status = new_status
        db.session.commit()

        return self.response(200, result={"id": record.id, "status": record.status})
