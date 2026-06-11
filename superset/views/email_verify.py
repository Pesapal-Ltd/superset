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
REST API for Merchant Email Verification.

All endpoints use FAB's BaseSupersetApi pattern (same as the rest of Superset)
so that CSRF protection, auth, and Swagger UI come for free.

Registered at:  /api/v1/email-verify/
"""
from __future__ import annotations

import logging
import os
import re
import time
from datetime import datetime, timedelta
from typing import Any

from flask import current_app, g, request
from flask_appbuilder.api import expose, protect, safe

from superset.extensions import cache_manager, db, security_manager
from superset.models.dashboard import Dashboard
from superset.models.email_verify import (
    EMAIL_VERIFY_STATUSES,
    EmailVerificationLog,
    EmailVerificationTemplate,
    TEMPLATE_TYPES,
)
from superset.models.slice import Slice
from superset.superset_typing import FlaskResponse
from superset.utils import json
from superset.utils.core import get_user_id
from superset.utils.email_verify_mailer import render_template, send_verification_email
from superset.views.base import BaseSupersetView
from superset.views.base_api import BaseSupersetApi

logger = logging.getLogger(__name__)

# Regex that matches Jinja2-style {{ variable_name }} placeholders
_VAR_REGEX = re.compile(r"\{\{\s*(\w+)\s*\}\}")

# Helpers


def _extract_variables(text: str) -> list[str]:
    """Return de-duplicated list of Jinja2 variables found in *text*."""
    return list(dict.fromkeys(_VAR_REGEX.findall(text)))


def _check_rate_limit(user_id: int, limit: int = 20, window_seconds: int = 3600) -> bool:
    """
    Simple sliding-window rate limiter backed by Superset's cache manager.

    Returns True if the user is within the rate limit, False if exceeded.
    The limit is applied per-user per rolling hour window.
    """
    key = f"email_verify_rate_limit:{user_id}"
    now = time.time()
    window_start = now - window_seconds

    # Retrieve and clean up the per-user timestamps list
    timestamps: list[float] = cache_manager.cache.get(key) or []
    timestamps = [t for t in timestamps if t > window_start]

    if len(timestamps) >= limit:
        return False  # rate limit exceeded

    timestamps.append(now)
    cache_manager.cache.set(key, timestamps, timeout=window_seconds)
    return True


def _user_role_names() -> list[str]:
    """Return the list of role names for the currently authenticated user."""
    user = g.user
    if user is None or user.is_anonymous:
        return []
    return [role.name for role in user.roles]


def _get_email_verify_config(
    dashboard_id: int | None = None, chart_id: int | None = None
) -> dict[str, Any] | None:
    """
    Read email_verify_config from the params JSON of a Slice (chart-level),
    or fall back to the json_metadata of a Dashboard.

    Chart-level config takes priority because configuration was migrated from
    dashboard-level to chart-level via the Chart Properties Modal.
    """
    # Chart-level takes priority
    if chart_id is not None:
        chart = db.session.query(Slice).filter_by(id=chart_id).one_or_none()
        if chart is not None:
            try:
                params = json.loads(chart.params or "{}")
            except Exception:  # pylint: disable=broad-except
                params = {}
            cfg = params.get("email_verify_config")
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
        return metadata.get("email_verify_config")

    return None


# Views


class EmailVerifyView(BaseSupersetView):
    """View – Merchant Email Verification UI."""

    route_base = "/emailverify"
    allow_browser_login = True

    @expose("/templates/list/")
    @protect("can_manage_email_templates")
    def templates_list(self) -> FlaskResponse:
        """Render the email verification template manager UI."""
        return self.render_app_template()

    @expose("/logs/")
    @protect("can_manage_email_templates")
    def logs(self) -> FlaskResponse:
        """Render the email verification audit log UI."""
        return self.render_app_template()


# API class


class EmailVerifyRestApi(BaseSupersetApi):
    """REST API — Merchant Email Verification."""

    csrf_exempt = True
    resource_name = "email-verify"
    route_base = "/api/v1/email-verify"
    allow_browser_login = True
    include_route_methods = {
        "list_templates",
        "create_template",
        "update_template",
        "patch_template",
        "preview_template",
        "get_config",
        "save_dashboard_config",
        "save_chart_config",
        "send_email",
        "resend_email",
        "list_logs",
    }
    
    # Templates

    @expose("/templates", methods=("GET",))
    @protect("can_read")
    @safe
    def list_templates(self) -> FlaskResponse:
        """List email verification templates.
        ---
        get:
          summary: List email verification templates
          parameters:
            - in: query
              name: type
              schema:
                type: string
            - in: query
              name: active_only
              schema:
                type: boolean
          responses:
            200:
              description: List of templates
            401:
              $ref: '#/components/responses/401'
            403:
              $ref: '#/components/responses/403'
        """

        type_filter = request.args.get("type")
        active_only = request.args.get("active_only", "false").lower() == "true"

        query = db.session.query(EmailVerificationTemplate)
        if type_filter and type_filter in TEMPLATE_TYPES:
            query = query.filter_by(type=type_filter)
        if active_only:
            query = query.filter_by(is_active=True)

        templates = query.order_by(EmailVerificationTemplate.created_at.desc()).all()
        result = [
            {
                "id": t.id,
                "name": t.name,
                "type": t.type,
                "subject": t.subject,
                "html_body": t.html_body,
                "text_body": t.text_body,
                "variables": t.variables or [],
                "is_active": t.is_active,
                "created_at": t.created_at.isoformat() if t.created_at else None,
            }
            for t in templates
        ]
        return self.response(200, result=result, count=len(result))

    @expose("/templates", methods=("POST",))
    @protect("can_manage_email_templates")
    @safe
    def create_template(self) -> FlaskResponse:
        """Create a new email verification template.
        ---
        post:
          summary: Create email verification template
          requestBody:
            required: true
            content:
              application/json:
                schema:
                  type: object
                  required: [name, type, subject, html_body]
                  properties:
                    name: {type: string}
                    type: {type: string}
                    subject: {type: string}
                    html_body: {type: string}
                    text_body: {type: string}
          responses:
            201:
              description: Template created
            400:
              $ref: '#/components/responses/400'
            401:
              $ref: '#/components/responses/401'
            403:
              $ref: '#/components/responses/403'
        """

        body = request.get_json(force=True, silent=True) or {}
        error = _validate_template_body(body)
        if error:
            return self.response(400, message=error)

        # Auto-detect variables from subject + html_body
        variables = _extract_variables(body["html_body"]) + _extract_variables(
            body.get("subject", "")
        )
        variables = list(dict.fromkeys(variables))

        tpl = EmailVerificationTemplate(
            name=body["name"],
            type=body["type"],
            subject=body["subject"],
            html_body=body["html_body"],
            text_body=body.get("text_body"),
            variables=variables,
            is_active=True,
            created_by_fk=get_user_id(),
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.session.add(tpl)
        db.session.commit()

        return self.response(
            201,
            result={"id": tpl.id, "name": tpl.name, "variables": tpl.variables},
        )

    @expose("/templates/<int:pk>", methods=("PUT",))
    @protect("can_manage_email_templates")
    @safe
    def update_template(self, pk: int) -> FlaskResponse:
        """Update an existing email verification template.
        ---
        put:
          summary: Update email verification template
          parameters:
            - in: path
              name: pk
              schema: {type: integer}
          responses:
            200:
              description: Template updated
            400:
              $ref: '#/components/responses/400'
            401:
              $ref: '#/components/responses/401'
            403:
              $ref: '#/components/responses/403'
            404:
              $ref: '#/components/responses/404'
        """

        tpl = db.session.query(EmailVerificationTemplate).filter_by(id=pk).one_or_none()
        if tpl is None:
            return self.response_404()

        body = request.get_json(force=True, silent=True) or {}
        error = _validate_template_body(body)
        if error:
            return self.response(400, message=error)

        variables = _extract_variables(body["html_body"]) + _extract_variables(
            body.get("subject", "")
        )
        tpl.name = body["name"]
        tpl.type = body["type"]
        tpl.subject = body["subject"]
        tpl.html_body = body["html_body"]
        tpl.text_body = body.get("text_body", tpl.text_body)
        tpl.variables = list(dict.fromkeys(variables))
        tpl.updated_at = datetime.utcnow()
        db.session.commit()

        return self.response(200, result={"id": tpl.id, "variables": tpl.variables})

    @expose("/templates/<int:pk>", methods=("PATCH",))
    @protect("can_manage_email_templates")
    @safe
    def patch_template(self, pk: int) -> FlaskResponse:
        """Enable or disable an email verification template.
        ---
        patch:
          summary: Enable/disable template
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
                  properties:
                    is_active: {type: boolean}
          responses:
            200:
              description: Template status updated
        """

        tpl = db.session.query(EmailVerificationTemplate).filter_by(id=pk).one_or_none()
        if tpl is None:
            return self.response_404()

        body = request.get_json(force=True, silent=True) or {}
        if "is_active" in body:
            tpl.is_active = bool(body["is_active"])
            tpl.updated_at = datetime.utcnow()
            db.session.commit()

        return self.response(200, result={"id": tpl.id, "is_active": tpl.is_active})

    @expose("/templates/<int:pk>/preview", methods=("POST",))
    @protect("can_read")
    @safe
    def preview_template(self, pk: int) -> FlaskResponse:
        """Preview a template rendered with test variable values.
        ---
        post:
          summary: Preview template with test variables
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
                  properties:
                    variables:
                      type: object
                      additionalProperties: {type: string}
          responses:
            200:
              description: Rendered template preview
        """

        tpl = db.session.query(EmailVerificationTemplate).filter_by(id=pk).one_or_none()
        if tpl is None:
            return self.response_404()

        body = request.get_json(force=True, silent=True) or {}
        variables: dict[str, str] = body.get("variables", {})

        try:
            rendered_subject = render_template(tpl.subject, variables)
            rendered_html = render_template(tpl.html_body, variables)
            rendered_text = (
                render_template(tpl.text_body, variables) if tpl.text_body else None
            )
        except ValueError as exc:
            return self.response(400, message=str(exc))

        return self.response(
            200,
            result={
                "subject": rendered_subject,
                "html_body": rendered_html,
                "text_body": rendered_text,
            },
        )

    # Dashboard / Chart email verify config

    @expose("/config", methods=("GET",))
    @protect()
    @safe
    def get_config(self) -> FlaskResponse:
        """Get email verify config for a dashboard or chart.
        ---
        get:
          summary: Get email verify config
          parameters:
            - in: query
              name: dashboard_id
              schema: {type: integer}
            - in: query
              name: chart_id
              schema: {type: integer}
          responses:
            200:
              description: Email verify config
        """
        dashboard_id = request.args.get("dashboard_id", type=int)
        chart_id = request.args.get("chart_id", type=int)

        if not dashboard_id and not chart_id:
            return self.response(400,
                message="Either dashboard_id or chart_id query param is required."
            )

        config = _get_email_verify_config(dashboard_id=dashboard_id, chart_id=chart_id)
        if config is None:
            # Return empty config — feature not yet configured on this resource
            return self.response(
                200, result={"enabled": False, "allowed_types": [], "allowed_roles": []}
            )
        # Expose from_address so the frontend can pre-populate the CC field
        result = dict(config)
        result.setdefault(
            "from_address",
            current_app.config.get("EMAIL_VERIFY_FROM_ADDRESS") or "",
        )
        return self.response(200, result=result)

    @expose("/config/dashboard/<int:pk>", methods=("PUT",))
    @protect("can_configure_email_verify")
    @safe
    def save_dashboard_config(self, pk: int) -> FlaskResponse:
        """Save email verify config on a dashboard.
        ---
        put:
          summary: Save dashboard email verify config
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

        metadata["email_verify_config"] = dict(body)
        dash.json_metadata = json.dumps(metadata)
        db.session.commit()

        return self.response(200, result={"dashboard_id": pk, "saved": True})

    @expose("/config/chart/<int:pk>", methods=("PUT",))
    @protect("can_configure_email_verify")
    @safe
    def save_chart_config(self, pk: int) -> FlaskResponse:
        """Save email verify config on a chart (slice).
        ---
        put:
          summary: Save chart email verify config
          parameters:
            - in: path
              name: pk
              schema: {type: integer}
          responses:
            200:
              description: Config saved
        """

        chart = db.session.query(Slice).filter_by(id=pk).one_or_none()
        if chart is None:
            return self.response_404()

        body = request.get_json(force=True, silent=True) or {}
        try:
            params: dict[str, Any] = json.loads(chart.params or "{}")
        except Exception:  # pylint: disable=broad-except
            params = {}

        params["email_verify_config"] = dict(body)
        chart.params = json.dumps(params)
        db.session.commit()

        return self.response(200, result={"chart_id": pk, "saved": True})

    # Send email


    @expose("/send", methods=("POST",))
    @protect("can_send_verification_email")
    @safe
    def send_email(self) -> FlaskResponse:
        """Send a verification email to a merchant.
        ---
        post:
          summary: Send merchant verification email
          requestBody:
            required: true
            content:
              application/json:
                schema:
                  type: object
                  required: [template_id, recipient_email]
                  properties:
                    template_id: {type: integer}
                    recipient_email: {type: string}
                    merchant_id: {type: string}
                    dashboard_id: {type: integer}
                    chart_id: {type: integer}
                    variables:
                      type: object
                      additionalProperties: {type: string}
          responses:
            200:
              description: Email sent
            400:
              $ref: '#/components/responses/400'
            401:
              $ref: '#/components/responses/401'
            403:
              $ref: '#/components/responses/403'
            429:
              description: Rate limit exceeded
        """
        #  FAB permission check

        # Check global kill switch
        if not current_app.config.get("EMAIL_VERIFY_ENABLED", True):
            return self.response(403, message="Email verification feature is disabled.")

        body = request.get_json(force=True, silent=True) or {}

        template_id_raw: Any = body.get("template_id")
        template_id: int | None = int(template_id_raw) if template_id_raw else None
        recipient_email: str = str(body.get("recipient_email", "")).strip()
        merchant_id: str | None = (
            str(body.get("merchant_id")) if body.get("merchant_id") else None
        )
        dashboard_id_raw: Any = body.get("dashboard_id")
        dashboard_id: int | None = int(dashboard_id_raw) if dashboard_id_raw else None
        chart_id_raw: Any = body.get("chart_id")
        chart_id: int | None = int(chart_id_raw) if chart_id_raw else None
        variables: dict[str, str] = dict(body.get("variables") or {})

        cc_address: str = str(body.get("cc")).strip()
        bcc_address: str = str(body.get("bcc")).strip()

        if not template_id:
            return self.response(400, message="template_id is required.")
        if not recipient_email:
            return self.response(400, message="recipient_email is required.")

        # Basic email format check — allow multiple comma/semicolon-separated emails
        recipients = [r.strip() for r in re.split(r"[,;]", recipient_email) if r.strip()]
        for r in recipients:
            if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", r):
                return self.response(400, message=f"Invalid email address: {r}")

        # Load dashboard/chart config and perform role + type auth checks
        if dashboard_id or chart_id:
            ev_config = _get_email_verify_config(
                dashboard_id=dashboard_id, chart_id=chart_id
            )
            if not ev_config or not ev_config.get("enabled"):
                return self.response(403,
                    message="Email verification is not enabled on this dashboard/chart."
                )

            allowed_roles: list[str] = ev_config.get("allowed_roles", [])
            if allowed_roles:
                user_roles = _user_role_names()
                if not set(user_roles).intersection(allowed_roles):
                    return self.response(403,
                        message="Your role is not permitted to send emails from this dashboard."
                    )

        # Rate limit check
        user_id = get_user_id() or 0
        rate_limit = int(current_app.config.get("EMAIL_VERIFY_RATE_LIMIT", "20/hour").split("/")[0])
        if not _check_rate_limit(user_id, limit=rate_limit):
            return self.response(
                429,
                message="Rate limit exceeded. You may send at most "
                f"{rate_limit} verification emails per hour.",
            )

        # Idempotency — one successful send per (confirmation_code + template + recipient)
        # This allows the same code to be sent via a different template or to a
        # different recipient, but blocks exact duplicates.
        confirmation_code: str | None = (
            str(variables.get("ConfirmationCode", "")).strip() or None
        )
        if confirmation_code and template_id:
            already_sent = (
                db.session.query(EmailVerificationLog)
                .filter(
                    EmailVerificationLog.confirmation_code == confirmation_code,
                    EmailVerificationLog.template_id == template_id,
                    EmailVerificationLog.recipient_email == recipient_email,
                    EmailVerificationLog.status == "sent",
                )
                .first()
            )
            if already_sent:
                return self.response(
                    409,
                    message=(
                        f"A verification email has already been sent for "
                        f"ConfirmationCode '{confirmation_code}' using this template "
                        f"to '{recipient_email}'. Duplicate sends are not allowed."
                    ),
                )

        # Load template
        tpl = (
            db.session.query(EmailVerificationTemplate)
            .filter_by(id=template_id, is_active=True)
            .one_or_none()
        )
        if tpl is None:
            return self.response_404()

        # Validate that template type is allowed for this dashboard/chart
        if dashboard_id or chart_id:
            allowed_types: list[str] = ev_config.get("allowed_types", [])  # type: ignore[assignment]
            if allowed_types and tpl.type not in allowed_types:
                return self.response(400,
                    message=f"Template type '{tpl.type}' is not allowed on this dashboard."
                )

        #  Validate variables — only keys declared in template.variables are accepted
        allowed_vars: set[str] = set(tpl.variables or [])
        extra_vars = set(variables.keys()) - allowed_vars
        if extra_vars:
            return self.response(400,
                message=f"Extra variables not declared in template: {sorted(extra_vars)}"
            )

        # Render the template
        try:
            rendered_subject = render_template(tpl.subject, variables)
            rendered_html = render_template(tpl.html_body, variables)
            rendered_text = (
                render_template(tpl.text_body, variables) if tpl.text_body else None
            )
        except ValueError as exc:
            return self.response(400, message=str(exc))

        # Send email and write audit log (audit write is in try/except —
        #    a logging failure must NOT prevent the success response)
        status = "failed"
        error_message: str | None = None

        # Load Pesapal Logo for inline embedding (CID: pesapal_logo)
        images = {}
        try:
            # Check multiple potential paths for the logo (docker production vs local dev)
            logo_paths = [
                os.path.join(
                    current_app.config["BASE_DIR"],
                    "static",
                    "assets",
                    "images",
                    "base_pesapal_logo.png",
                ),
                os.path.join(
                    current_app.config["BASE_DIR"],
                    "..",
                    "superset-frontend",
                    "src",
                    "assets",
                    "images",
                    "base_pesapal_logo.png",
                ),
            ]
            for path in logo_paths:
                if os.path.exists(path):
                    logger.info("Loading Pesapal logo for email CID from: %s", path)
                    with open(path, "rb") as f:
                        images["pesapal_logo"] = f.read()
                    break
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning("Failed to load Pesapal logo for email CID: %s", exc)

        try:
            send_verification_email(
                to_address=recipient_email,
                subject=rendered_subject,
                html_body=rendered_html,
                text_body=rendered_text,
                images=images,
                cc=cc_address,
                bcc=bcc_address,
            )
            status = "sent"
        except Exception as exc:  # pylint: disable=broad-except
            error_message = str(exc)
            logger.exception("Failed to send verification email to %s", recipient_email)

        log_id: int | None = None
        try:
            log = EmailVerificationLog(
                template_id=tpl.id,
                sent_by_fk=user_id,
                recipient_email=recipient_email,
                merchant_id=merchant_id,
                dashboard_id=dashboard_id,
                chart_id=chart_id,
                payload_snapshot=variables,
                status=status,
                error_message=error_message,
                sent_at=datetime.utcnow(),
                confirmation_code=confirmation_code,
            )
            db.session.add(log)
            db.session.commit()
            log_id = log.id
        except Exception as log_exc:  # pylint: disable=broad-except
            # Logging failure must NOT surface to the user
            logger.exception("Failed to write email verify audit log: %s", log_exc)

        if status == "sent":
            return self.response(200, result={"success": True, "log_id": log_id})
        return self.response(
            200,
            result={"success": False, "error": error_message, "log_id": log_id},
        )

    # Audit log

    @expose("/logs", methods=("GET",))
    @protect("can_manage_email_templates")
    @safe
    def list_logs(self) -> FlaskResponse:
        """List email verification audit logs.
        ---
        get:
          summary: List email verification audit logs
          parameters:
            - in: query
              name: dashboard_id
              schema: {type: integer}
            - in: query
              name: chart_id
              schema: {type: integer}
            - in: query
              name: merchant_id
              schema: {type: string}
            - in: query
              name: sent_by
              schema: {type: integer}
            - in: query
              name: date_from
              schema: {type: string, format: date}
            - in: query
              name: date_to
              schema: {type: string, format: date}
            - in: query
              name: page
              schema: {type: integer}
            - in: query
              name: page_size
              schema: {type: integer}
          responses:
            200:
              description: Paginated audit log
        """

        dashboard_id = request.args.get("dashboard_id", type=int)
        chart_id = request.args.get("chart_id", type=int)
        merchant_id = request.args.get("merchant_id")
        sent_by = request.args.get("sent_by", type=int)
        date_from = request.args.get("date_from")
        date_to = request.args.get("date_to")
        page = request.args.get("page", 0, type=int)
        page_size = request.args.get("page_size", 25, type=int)
        page_size = min(page_size, 100)  # cap at 100 rows

        query = db.session.query(EmailVerificationLog)
        if dashboard_id:
            query = query.filter_by(dashboard_id=dashboard_id)
        if chart_id:
            query = query.filter_by(chart_id=chart_id)
        if merchant_id:
            query = query.filter_by(merchant_id=merchant_id)
        if sent_by:
            query = query.filter_by(sent_by_fk=sent_by)
        if date_from:
            try:
                query = query.filter(
                    EmailVerificationLog.sent_at
                    >= datetime.strptime(date_from, "%Y-%m-%d")
                )
            except ValueError:
                return self.response(400, message="Invalid date_from format. Use YYYY-MM-DD.")
        if date_to:
            try:
                query = query.filter(
                    EmailVerificationLog.sent_at
                    <= datetime.strptime(date_to, "%Y-%m-%d") + timedelta(days=1)
                )
            except ValueError:
                return self.response_400(message="Invalid date_to format. Use YYYY-MM-DD.")

        total = query.count()
        logs = (
            query.order_by(EmailVerificationLog.sent_at.desc())
            .offset(page * page_size)
            .limit(page_size)
            .all()
        )

        result = [
            {
                "id": log.id,
                "template_id": log.template_id,
                "template_name": log.template.name if log.template else None,
                "template_type": log.template.type if log.template else None,
                "sent_by_fk": log.sent_by_fk,
                "sent_by_name": (
                    f"{log.sent_by.first_name} {log.sent_by.last_name}"
                    if log.sent_by
                    else None
                ),
                "recipient_email": log.recipient_email,
                "merchant_id": log.merchant_id,
                "dashboard_id": log.dashboard_id,
                "chart_id": log.chart_id,
                "payload_snapshot": log.payload_snapshot,
                "status": log.status,
                "error_message": log.error_message,
                "sent_at": log.sent_at.isoformat() if log.sent_at else None,
                "confirmation_code": log.confirmation_code,
            }
            for log in logs
        ]
        return self.response(
            200, result=result, count=total, page=page, page_size=page_size
        )

    # Resend

    @expose("/resend/<int:log_id>", methods=("POST",))
    @protect("can_send_verification_email")
    @safe
    def resend_email(self, log_id: int) -> FlaskResponse:
        """Resend a verification email from a previous log entry.
        ---
        post:
          summary: Resend verification email
          parameters:
            - in: path
              name: log_id
              schema: {type: integer}
          responses:
            200:
              description: Email resent
            404:
              $ref: '#/components/responses/404'
        """
        original = (
            db.session.query(EmailVerificationLog).filter_by(id=log_id).one_or_none()
        )
        if original is None:
            return self.response_404()

        # Re-load the template (must still be active)
        tpl = (
            db.session.query(EmailVerificationTemplate)
            .filter_by(id=original.template_id, is_active=True)
            .one_or_none()
        )
        if tpl is None:
            return self.response(
                400,
                message="The original template is no longer active and cannot be used for resend.",
            )

        # Rate limit still applies
        user_id = get_user_id() or 0
        rate_limit = int(
            current_app.config.get("EMAIL_VERIFY_RATE_LIMIT", "20/hour").split("/")[0]
        )
        if not _check_rate_limit(user_id, limit=rate_limit):
            return self.response(
                429,
                message=f"Rate limit exceeded. You may send at most {rate_limit} verification emails per hour.",
            )

        variables: dict[str, str] = dict(original.payload_snapshot or {})

        # Render
        try:
            rendered_subject = render_template(tpl.subject, variables)
            rendered_html = render_template(tpl.html_body, variables)
            rendered_text = (
                render_template(tpl.text_body, variables) if tpl.text_body else None
            )
        except ValueError as exc:
            return self.response(400, message=str(exc))

        # Load logo
        images: dict[str, bytes] = {}
        try:
            # Check multiple potential paths for the logo (docker production vs local dev)
            logo_paths = [
                os.path.join(
                    current_app.config["BASE_DIR"],
                    "static",
                    "assets",
                    "images",
                    "base_pesapal_logo.png",
                ),
                os.path.join(
                    current_app.config["BASE_DIR"],
                    "..",
                    "superset-frontend",
                    "src",
                    "assets",
                    "images",
                    "base_pesapal_logo.png",
                ),
            ]
            for path in logo_paths:
                if os.path.exists(path):
                    with open(path, "rb") as f:
                        images["pesapal_logo"] = f.read()
                    break
        except Exception:  # pylint: disable=broad-except
            pass

        status = "failed"
        error_message: str | None = None
        try:
            send_verification_email(
                to_address=original.recipient_email,
                subject=rendered_subject,
                html_body=rendered_html,
                text_body=rendered_text,
                images=images,
            )
            status = "sent"
        except Exception as exc:  # pylint: disable=broad-except
            error_message = str(exc)
            logger.exception("Resend failed for log_id=%s: %s", log_id, exc)

        # Write a new log entry (preserves full audit trail — original is untouched)
        new_log_id: int | None = None
        try:
            new_log = EmailVerificationLog(
                template_id=original.template_id,
                sent_by_fk=user_id,
                recipient_email=original.recipient_email,
                merchant_id=original.merchant_id,
                dashboard_id=original.dashboard_id,
                chart_id=original.chart_id,
                payload_snapshot=variables,
                status=status,
                error_message=error_message,
                sent_at=datetime.utcnow(),
                confirmation_code=original.confirmation_code,
            )
            db.session.add(new_log)
            db.session.commit()
            new_log_id = new_log.id
        except Exception as log_exc:  # pylint: disable=broad-except
            logger.exception("Failed to write resend audit log: %s", log_exc)

        if status == "sent":
            return self.response(200, result={"success": True, "log_id": new_log_id})
        return self.response(
            200,
            result={"success": False, "error": error_message, "log_id": new_log_id},
        )


# Validation helpers


def _validate_template_body(body: dict[str, Any]) -> str | None:
    """Return an error message string if validation fails, else None."""
    for field in ("name", "type", "subject", "html_body"):
        if not body.get(field):
            return f"Field '{field}' is required."
    if body["type"] not in TEMPLATE_TYPES:
        return (
            f"Invalid type '{body['type']}'. "
            f"Must be one of: {', '.join(TEMPLATE_TYPES)}."
        )
    return None
