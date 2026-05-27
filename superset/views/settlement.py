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
REST API for Settlement (Hold Funds / Release Funds).

Registered at: /api/v1/settlement/
"""
from __future__ import annotations

import logging
import time
from datetime import datetime
from typing import Any

from celery.result import AsyncResult
from flask import current_app, g, request
from flask_appbuilder.api import expose, protect, safe

from superset.extensions import cache_manager, db
from superset.models.dashboard import Dashboard
from superset.models.settlement import SettlementLog
from superset.superset_typing import FlaskResponse
from superset.utils import json
from superset.utils.core import get_user_id
from flask_appbuilder.security.sqla.models import User
from superset.views.base import BaseSupersetView
from superset.views.base_api import BaseSupersetApi

logger = logging.getLogger(__name__)


# Helpers


def _get_settlement_config(
    dashboard_id: int | None = None, chart_id: int | None = None
) -> dict[str, Any] | None:
    """
    Read settlement_config from the params JSON of a Slice (chart-level),
    or fall back to the json_metadata of a Dashboard.

    Chart-level config takes priority because configuration was migrated from
    dashboard-level to chart-level via the Chart Properties Modal.
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
            cfg = params.get("settlement_config")
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
        return metadata.get("settlement_config")

    return None


def _user_role_names() -> list[str]:
    user = g.user
    if user is None or user.is_anonymous:
        return []
    return [role.name for role in user.roles]


def _check_rate_limit(
    user_id: int, limit: int = 50, window_seconds: int = 3600
) -> bool:
    key = f"settlement_rate_limit:{user_id}"
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

class SettlementView(BaseSupersetView):
    """View – Settlement (Hold Funds / Release Funds) UI."""

    route_base = "/settlement"
    allow_browser_login = True

    @expose("/logs/")
    @protect("can_read_settlement_logs")
    def logs(self) -> FlaskResponse:
        """Render the settlement audit log UI."""
        return self.render_app_template()


# API class


class SettlementRestApi(BaseSupersetApi):
    """REST API — Settlement (Hold Funds / Release Funds)."""

    csrf_exempt = True
    resource_name = "settlement"
    route_base = "/api/v1/settlement"
    allow_browser_login = True
    include_route_methods = {
        "get_config",
        "save_dashboard_config",
        "save_chart_config",
        "execute",
        "list_logs",
        "task_status",
        "retry",
    }

    # Config
    @expose("/config", methods=("GET",))
    @protect()
    @safe
    def get_config(self) -> FlaskResponse:
        """Get settlement config for a dashboard or chart.
        ---
        get:
            summary: Get settlement config
            parameters:
            - in: query
              name: dashboard_id
              schema: {type: integer}
            - in: query
              name: chart_id
              schema: {type: integer}
            responses:
            200:
                description: Settlement config
        """
        dashboard_id = request.args.get("dashboard_id", type=int)
        chart_id = request.args.get("chart_id", type=int)
        if not dashboard_id and not chart_id:
            return self.response(400, message="Either dashboard_id or chart_id query param is required.")

        config = _get_settlement_config(dashboard_id=dashboard_id, chart_id=chart_id)
        if config is None:
            return self.response(200, result={"enabled": False, "allowed_roles": []})
        return self.response(200, result=config)

    @expose("/config/dashboard/<int:pk>", methods=("PUT",))
    @protect("can_configure_settlement")
    @safe
    def save_dashboard_config(self, pk: int) -> FlaskResponse:
        """Save settlement config on a dashboard.
        ---
        put:
          summary: Save dashboard settlement config
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

        metadata["settlement_config"] = dict(body)
        dash.json_metadata = json.dumps(metadata)
        db.session.commit()

        return self.response(200, result={"dashboard_id": pk, "saved": True})

    @expose("/config/chart/<int:pk>", methods=("PUT",))
    @protect("can_configure_settlement")
    @safe
    def save_chart_config(self, pk: int) -> FlaskResponse:
        """Save settlement config on a chart.
        ---
        put:
          summary: Save chart settlement config
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

        params["settlement_config"] = dict(body)
        chart.params = json.dumps(params)
        db.session.commit()

        return self.response(200, result={"chart_id": pk, "saved": True})

    # Execute — enqueue background tasks

    @expose("/execute", methods=("POST",))
    @protect("can_execute_settlement")
    @safe
    def execute(self) -> FlaskResponse:
        """Enqueue Hold/Release Funds tasks for selected rows.
        ---
        post:
          summary: Execute settlement action
          requestBody:
            required: true
            content:
              application/json:
                schema:
                  type: object
                  required: [action, dashboard_id, rows]
                  properties:
                    action:
                      type: string
                      enum: [hold, release]
                    dashboard_id:
                      type: integer
                    chart_id:
                      type: integer
                    rows:
                      type: array
                      items:
                        type: object
                    reason:
                      type: string
          responses:
            200:
              description: Tasks enqueued
            400:
              $ref: '#/components/responses/400'
            403:
              $ref: '#/components/responses/403'
        """
        # pylint: disable=import-outside-toplevel
        from superset.tasks.settlement import execute_settlement_action

        if not current_app.config.get("SETTLEMENT_ENABLED", True):
            return self.response(403, message="Settlement feature is disabled.")

        body = request.get_json(force=True, silent=True) or {}
        action: str = str(body.get("action", "")).strip().lower()
        dashboard_id_raw = body.get("dashboard_id")
        dashboard_id: int | None = int(dashboard_id_raw) if dashboard_id_raw else None
        chart_id_raw = body.get("chart_id")
        chart_id: int | None = int(chart_id_raw) if chart_id_raw else None
        rows: list[dict[str, Any]] = body.get("rows", [])
        reason: str = str(body.get("reason", "RiskVerification")).strip() or "RiskVerification"

        if action not in ("hold", "release"):
            return self.response(400, message='action must be "hold" or "release".')
        if not rows:
            return self.response(400, message="rows array is required and must not be empty.")
        if not dashboard_id and not chart_id:
            return self.response(400, message="Either dashboard_id or chart_id is required.")

        # check dashboard or chart settlement_config
        cfg = _get_settlement_config(dashboard_id=dashboard_id, chart_id=chart_id)
        if not cfg or not cfg.get("enabled"):
            return self.response(403,
                message="Settlement is not enabled on this resource."
            )

        allowed_roles: list[str] = cfg.get("allowed_roles", [])
        if allowed_roles:
            user_roles = _user_role_names()
            if not set(user_roles).intersection(allowed_roles):
                return self.response(403,
                    message="Your role is not permitted to execute settlement actions from this dashboard."
                )

        # Rate limit
        user_id = get_user_id() or 0
        if not _check_rate_limit(user_id):
            return self.response(
                429,
                message="Rate limit exceeded for settlement actions.",
            )

        # Derive the confirmation code column name (default "ConfirmationCode")
        code_column: str = cfg.get("confirmation_code_column", "ConfirmationCode")

        task_ids: list[str] = []
        log_ids: list[int] = []
        
        # Prepare parameters for tasks
        logs_to_dispatch: list[tuple[SettlementLog, str, str, str]] = []

        for row in rows:
            confirmation_code = str(row.get(code_column, "")).strip()
            if not confirmation_code:
                logger.warning(
                    "Skipping row with missing ConfirmationCode (column=%s): %s",
                    code_column,
                    row,
                )
                continue

            # Idempotency — one successful/pending hold per confirmation code.
            # Releases are always allowed (they undo a hold).
            if action == "hold":
                existing = (
                    db.session.query(SettlementLog)
                    .filter(
                        SettlementLog.confirmation_code == confirmation_code,
                        SettlementLog.action == "hold",
                        SettlementLog.status.in_(["success", "pending"]),
                    )
                    .first()
                )
                if existing:
                    logger.warning(
                        "Skipping duplicate hold for ConfirmationCode=%s (log_id=%s, status=%s)",
                        confirmation_code,
                        existing.id,
                        existing.status,
                    )
                    continue

            merchant_id = row.get("merchant_id") or row.get("MerchantId")
            currency = row.get("currency") or row.get("Currency")
            country = row.get("country") or row.get("Country")
            amount_raw = row.get("amount") or row.get("Amount")
            
            amount = None
            if amount_raw is not None:
                try:
                    from decimal import Decimal
                    amount = Decimal(str(amount_raw))
                except (ValueError, TypeError, NameError):
                    try:
                        amount = float(amount_raw)
                    except:
                        amount = None

            # Create a pending log entry before enqueuing
            log = SettlementLog(
                dashboard_id=dashboard_id,
                chart_id=chart_id,
                action=action,
                confirmation_code=confirmation_code,
                merchant_id=str(merchant_id) if merchant_id is not None else None,
                currency=str(currency) if currency is not None else None,
                country=str(country) if country is not None else None,
                amount=amount, 
                reason=reason,
                status="pending",
                initiated_by_fk=user_id or None,
                initiated_at=datetime.utcnow(),
            )
            db.session.add(log)
            db.session.flush()  # get log.id
            logs_to_dispatch.append((log, action, confirmation_code, reason))

        # commit now to ensure records are visible to Celery workers 
        # before we enqueue the tasks.
        db.session.commit()

        for log, action, confirmation_code, reason in logs_to_dispatch:
            task = execute_settlement_action.delay(
                log_id=log.id,
                action=action,
                confirmation_code=confirmation_code,
                reason=reason,
            )

            log.task_id = task.id
            task_ids.append(task.id)
            log_ids.append(log.id)

        # Commit task_ids
        db.session.commit()

        return self.response(
            200,
            result={
                "enqueued": len(task_ids),
                "task_ids": task_ids,
                "log_ids": log_ids,
            },
        )

    # Task status polling

    @expose("/task-status/<string:task_id>", methods=("GET",))
    @protect("can_execute_settlement")
    @safe
    def task_status(self, task_id: str) -> FlaskResponse:
        """Poll the status of a settlement Celery task.
        ---
        get:
          summary: Get settlement task status
          parameters:
            - in: path
              name: task_id
              schema: {type: string}
          responses:
            200:
              description: Task status
        """
        result = AsyncResult(task_id)
        state = result.state 

        # read from the DB log the single source of truth for final state
        log: SettlementLog | None = (
            db.session.query(SettlementLog).filter_by(task_id=task_id).one_or_none()
        )

        log_data: dict[str, Any] = {}
        if log:
            log_data = {
                "log_id": log.id,
                "status": log.status,              
                "confirmation_code": log.confirmation_code,
                "merchant_id": log.merchant_id,
                "currency": log.currency,
                "country": log.country,
                "amount": str(log.amount) if log.amount is not None else None,
                "error_message": log.error_message,
                "request_payload": log.request_payload,
                "response_snapshot": log.response_snapshot,
                "completed_at": log.completed_at.isoformat() if log.completed_at else None,
            }
        return self.response(
            200,
            result={
                "task_id": task_id,
                "celery_state": state,
                **log_data,
            },
        )

    # Audit log

    @expose("/logs", methods=("GET",))
    @protect("can_read_settlement_logs")
    @safe
    def list_logs(self) -> FlaskResponse:
        """List settlement audit logs.
        ---
        get:
          summary: List settlement audit logs
          parameters:
            - in: query
              name: dashboard_id
              schema: {type: integer}
            - in: query
              name: action
              schema: {type: string}
            - in: query
              name: status
              schema: {type: string}
            - in: query
              name: confirmation_code
              schema: {type: string}
            - in: query
              name: page
              schema: {type: integer}
            - in: query
              name: page_size
              schema: {type: integer}
          responses:
            200:
              description: Paginated logs
        """
        dashboard_id = request.args.get("dashboard_id", type=int)
        action_filter = request.args.get("action")
        status_filter = request.args.get("status")
        code_filter = request.args.get("confirmation_code")
        page = request.args.get("page", 0, type=int)
        page_size = min(request.args.get("page_size", 25, type=int), 100)

        query = db.session.query(SettlementLog, User).outerjoin(
            User, SettlementLog.initiated_by_fk == User.id
        )
        if dashboard_id:
            query = query.filter(SettlementLog.dashboard_id == dashboard_id)
        if action_filter in ("hold", "release"):
            query = query.filter(SettlementLog.action == action_filter)
        if status_filter in ("pending", "success", "failed"):
            query = query.filter(SettlementLog.status == status_filter)
        if code_filter:
            query = query.filter(SettlementLog.confirmation_code == code_filter)

        total = query.count()
        logs = (
            query.order_by(SettlementLog.initiated_at.desc())
            .offset(page * page_size)
            .limit(page_size)
            .all()
        )

        # Check for released confirmation codes to prevent double release
        codes = [lg.confirmation_code for lg, u in logs]
        released_codes = set()
        if codes:
            released_entries = (
                db.session.query(SettlementLog.confirmation_code)
                .filter(
                    SettlementLog.confirmation_code.in_(codes),
                    SettlementLog.action == "release",
                    SettlementLog.status == "success",
                )
                .all()
            )
            released_codes = {r[0] for r in released_entries}

        result = [
            {
                "id": lg.id,
                "dashboard_id": lg.dashboard_id,
                "chart_id": lg.chart_id,
                "action": lg.action,
                "confirmation_code": lg.confirmation_code,
                "merchant_id": lg.merchant_id,
                "currency": lg.currency,
                "country": lg.country,
                "amount": str(lg.amount) if lg.amount is not None else None,
                "reason": lg.reason,
                "task_id": lg.task_id,
                "status": lg.status,
                "error_message": lg.error_message,
                "initiated_by_fk": lg.initiated_by_fk,
                "initiated_by": f"{u.first_name} {u.last_name}" if u else "System",
                "request_payload": lg.request_payload,
                "response_snapshot": lg.response_snapshot,
                "initiated_at": lg.initiated_at.isoformat() if lg.initiated_at else None,
                "completed_at": lg.completed_at.isoformat() if lg.completed_at else None,
                "is_released": lg.confirmation_code in released_codes,
            }
            for lg, u in logs
        ]

        return self.response(200, result=result, count=total, page=page, page_size=page_size)

    @expose("/retry/<int:log_id>", methods=("POST",))
    @protect("can_execute_settlement")
    @safe
    def retry(self, log_id: int) -> FlaskResponse:
        """Retry a failed settlement task.
        ---
        post:
          summary: Retry a failed settlement action
          parameters:
            - in: path
              name: log_id
              schema: {type: integer}
          responses:
            200:
              description: Task re-enqueued
            400:
              description: Log entry not found or not in failed state
        """
        # pylint: disable=import-outside-toplevel
        from superset.tasks.settlement import execute_settlement_action

        log: SettlementLog | None = db.session.query(SettlementLog).filter_by(id=log_id).one_or_none()
        if log is None:
            return self.response_404()

        if log.status != "failed":
            return self.response(400, message="Only failed actions can be retried.")

        # Rate limit
        user_id = get_user_id() or 0
        if not _check_rate_limit(user_id):
            return self.response(
                429,
                message="Rate limit exceeded. Please wait before retrying.",
            )

        # Reset log status and metadata for the retry attempt
        log.status = "pending"
        log.error_message = None
        log.task_id = None
        log.completed_at = None
        log.initiated_at = datetime.utcnow()
        log.initiated_by_fk = user_id or None
        db.session.commit()

        # Re-enqueue the task
        task = execute_settlement_action.delay(
            log_id=log.id,
            action=log.action,
            confirmation_code=log.confirmation_code,
            reason=log.reason,
        )

        log.task_id = task.id
        db.session.commit()

        return self.response(200, result={"log_id": log_id, "task_id": task.id, "retrying": True})
