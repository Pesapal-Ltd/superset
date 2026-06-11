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
Email dispatch utility for the Merchant Email Verification feature.

Supports SMTP (via Superset's existing send_email_smtp) with a provider
abstraction that allows SendGrid / SES to be dropped in by changing the
EMAIL_VERIFY_PROVIDER config key, without modifying call sites.
"""
from __future__ import annotations

import logging
from typing import Any

from flask import current_app
from jinja2 import Environment, select_autoescape, StrictUndefined, UndefinedError, TemplateSyntaxError

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Jinja2 rendering
# ---------------------------------------------------------------------------

# Single shared Environment — autoescape HTML, StrictUndefined is intentional:
# a missing variable must raise loudly, not render as an empty string.
_jinja_env = Environment(
    autoescape=select_autoescape(["html"]),
    undefined=StrictUndefined,
)


def render_template(template_body: str, variables: dict[str, Any]) -> str:
    """Render a Jinja2 template string with the supplied variables.

    Raises:
        ValueError: If a variable referenced in the template is missing or
                    if the template contains a syntax error.
    """
    try:
        return _jinja_env.from_string(template_body).render(**variables)
    except UndefinedError as exc:
        raise ValueError(f"Missing variable in template: {exc}") from exc
    except TemplateSyntaxError as exc:
        # Provide context around the error position if possible
        context = ""
        if exc.lineno is not None:
            lines = template_body.splitlines()
            if 0 < exc.lineno <= len(lines):
                error_line = lines[exc.lineno - 1]
                # Safely provide the line snippet since 'column' is not always available
                context = f" at line {exc.lineno}: '{error_line.strip()}'"
        raise ValueError(f"Template syntax error{context}: {exc.message}") from exc


# ---------------------------------------------------------------------------
# Provider interface
# ---------------------------------------------------------------------------


def send_verification_email(
    to_address: str,
    subject: str,
    html_body: str,
    text_body: str | None = None,
    images: dict[str, bytes] | None = None,
    cc: str = "",
    bcc: str = "",
) -> bool:
    """Dispatch a verification email through the configured provider.

    Args:
        to_address: Recipient email address.
        subject: Email subject line (already rendered).
        html_body: HTML email body (already rendered).
        text_body: Optional plain-text fallback (already rendered).
        images: Optional dictionary of image content indexed by CID.
        cc: Comma-separated CC email addresses.
        bcc: Comma-separated BCC email addresses.

    Returns:
        True on success.

    Raises:
        RuntimeError: If the provider is unknown or dispatch fails.
    """
    config = current_app.config
    provider = config.get("EMAIL_VERIFY_PROVIDER", "smtp").lower()

    if provider == "smtp":
        return _send_via_smtp(to_address, subject, html_body, text_body, images, config, cc=cc, bcc=bcc)
    if provider == "sendgrid":
        return _send_via_sendgrid(to_address, subject, html_body, text_body, config)
    if provider == "ses":
        return _send_via_ses(to_address, subject, html_body, text_body, config)

    raise RuntimeError(
        f"Unknown EMAIL_VERIFY_PROVIDER '{provider}'. "
        "Valid values: 'smtp', 'sendgrid', 'ses'."
    )


# ---------------------------------------------------------------------------
# SMTP implementation
# ---------------------------------------------------------------------------


def _send_via_smtp(
    to_address: str,
    subject: str,
    html_body: str,
    text_body: str | None,
    images: dict[str, bytes] | None,
    config: dict[str, Any],
    cc: str = "",
    bcc: str = "",
) -> bool:
    """Send via Superset's existing SMTP infrastructure."""
    # Import here to avoid circular imports at module load time
    from superset.utils.core import send_email_smtp  # pylint: disable=import-outside-toplevel

    from_address = (
        config.get("EMAIL_VERIFY_FROM_ADDRESS")
        or config.get("EMAIL_NOTIFY_ADDRESS")
        or config.get("SMTP_MAIL_FROM", "")
    )

    send_email_smtp(
        to=to_address,
        subject=subject,
        html_content=html_body,
        config=config,
        files=None,
        data=None,
        images=images,
        dryrun=False,
        cc=cc,
        bcc=bcc,
        mime_subtype="mixed",
        from_address=from_address,
    )
    logger.info("Verification email sent via SMTP to %s", to_address)
    return True


# ---------------------------------------------------------------------------
# SendGrid stub — implement when EMAIL_VERIFY_PROVIDER = "sendgrid"
# ---------------------------------------------------------------------------


def _send_via_sendgrid(
    to_address: str,
    subject: str,
    html_body: str,
    text_body: str | None,
    config: dict[str, Any],
) -> bool:
    """Send via SendGrid API. Requires sendgrid Python SDK."""
    try:
        import sendgrid  # type: ignore  # pylint: disable=import-outside-toplevel
        from sendgrid.helpers.mail import Mail  # type: ignore  # pylint: disable=import-outside-toplevel
    except ImportError as exc:
        raise RuntimeError(
            "sendgrid package is not installed. "
            "Run: pip install sendgrid"
        ) from exc

    api_key = config.get("EMAIL_VERIFY_SENDGRID_API_KEY", "")
    if not api_key:
        raise RuntimeError("EMAIL_VERIFY_SENDGRID_API_KEY is not configured.")

    from_address = (
        config.get("EMAIL_VERIFY_FROM_ADDRESS")
        or config.get("EMAIL_NOTIFY_ADDRESS", "")
    )

    message = Mail(
        from_email=from_address,
        to_emails=to_address,
        subject=subject,
        html_content=html_body,
    )
    sg = sendgrid.SendGridAPIClient(api_key=api_key)
    response = sg.send(message)

    if response.status_code not in (200, 201, 202):
        raise RuntimeError(
            f"SendGrid returned status {response.status_code}: {response.body}"
        )

    logger.info("Verification email sent via SendGrid to %s", to_address)
    return True


# ---------------------------------------------------------------------------
# AWS SES stub — implement when EMAIL_VERIFY_PROVIDER = "ses"
# ---------------------------------------------------------------------------


def _send_via_ses(
    to_address: str,
    subject: str,
    html_body: str,
    text_body: str | None,
    config: dict[str, Any],
) -> bool:
    """Send via AWS SES. Requires boto3."""
    try:
        import boto3  # type: ignore  # pylint: disable=import-outside-toplevel
    except ImportError as exc:
        raise RuntimeError(
            "boto3 package is not installed. Run: pip install boto3"
        ) from exc

    from_address = (
        config.get("EMAIL_VERIFY_FROM_ADDRESS")
        or config.get("EMAIL_NOTIFY_ADDRESS", "")
    )

    region = config.get("AWS_DEFAULT_REGION", "us-east-1")
    client = boto3.client("ses", region_name=region)

    body: dict[str, Any] = {
        "Html": {"Data": html_body, "Charset": "UTF-8"},
    }
    if text_body:
        body["Text"] = {"Data": text_body, "Charset": "UTF-8"}

    response = client.send_email(
        Source=from_address,
        Destination={"ToAddresses": [to_address]},
        Message={
            "Subject": {"Data": subject, "Charset": "UTF-8"},
            "Body": body,
        },
    )

    logger.info(
        "Verification email sent via SES to %s (MessageId: %s)",
        to_address,
        response.get("MessageId"),
    )
    return True
