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
Zoho Desk integration for the Email Verification feature.

Used when EMAIL_VERIFY_NOTIFY_MODE = "zoho_ticket".  After each successful
verification email send/resend, a Zoho Desk support ticket is opened with the
same subject and HTML body as the email that was sent.

Token caching
-------------
Zoho access tokens are valid for ~1 hour.  To avoid exchanging the refresh
token on every ticket-creation call, ``get_access_token()`` first checks the
``zoho_desk_token_cache`` database table.  A fresh token is fetched from Zoho
only when the cached one is absent or within ``TOKEN_EXPIRY_BUFFER_SECONDS``
of its reported expiry.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta
from typing import Any

import requests
from flask import current_app

from superset.extensions import db
from superset.models.email_verify import ZohoDeskToken

logger = logging.getLogger(__name__)

# Refresh the token this many seconds before it actually expires to guard
# against clock skew and network latency.
TOKEN_EXPIRY_BUFFER_SECONDS: int = 60


# OAuth helpers


def _fetch_fresh_token() -> tuple[str, datetime]:
    """Call the Zoho OAuth endpoint and return (access_token, expires_at).

    Returns:
        A 2-tuple of the raw access-token string and the UTC datetime at
        which that token expires.

    Raises:
        RuntimeError: If credentials are missing or the token exchange fails.
    """
    config = current_app.config
    base_url: str = config.get("ZOHO_DESK_BASE_URL", "")
    client_id: str = config.get("ZOHO_DESK_CLIENT_ID", "")
    client_secret: str = config.get("ZOHO_DESK_CLIENT_SECRET", "")
    refresh_token: str = config.get("ZOHO_DESK_REFRESH_TOKEN", "")

    if not all([client_id, client_secret, refresh_token, base_url]):
        raise RuntimeError(
            "Zoho Desk OAuth credentials are not fully configured. "
            "Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, "
            "and BASE_URL environment variables."
        )

    token_url = f"{base_url}/oauth/v2/token"
    resp = requests.post(
        url=token_url,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        data={
            "grant_type": "refresh_token",
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
        },
        timeout=15,
    )

    if resp.status_code != 200:
        raise RuntimeError(
            f"Zoho token refresh failed ({resp.status_code}): {resp.text}"
        )

    token_data = resp.json()
    access_token: str | None = token_data.get("access_token")
    if not access_token:
        raise RuntimeError(
            f"Zoho token response did not contain an access_token: {token_data}"
        )

    expires_at: datetime = datetime.utcnow() + timedelta(seconds=3599)

    return access_token, expires_at


def get_access_token() -> str:
    """Return a valid Zoho Desk access token, using the DB cache when possible.

    Returns:
        A valid Zoho OAuth access-token string.

    Raises:
        RuntimeError: If credentials are missing or the token exchange fails.
    """
    session = db.session

    # Check the cache
    cached = ZohoDeskToken.get_valid_token(
        session, buffer_seconds=TOKEN_EXPIRY_BUFFER_SECONDS
    )
    if cached:
        logger.debug("[ZohoToken] Serving access token from DB cache.")
        return cached

    # Fetch a fresh token from Zoho
    logger.info("[ZohoToken] Cache miss — fetching fresh access token from Zoho.")
    access_token, expires_at = _fetch_fresh_token()

    # Persist to the cache so subsequent calls skip the network round-trip
    try:
        ZohoDeskToken.upsert(session, access_token=access_token, expires_at=expires_at)
        logger.info(
            "[ZohoToken] Token cached in DB; expires at %s UTC.",
            expires_at.isoformat(),
        )
    except Exception as exc:  # pylint: disable=broad-except
        # Cache write failure is non-fatal — the token is still usable
        logger.warning("[ZohoToken] Failed to write token to cache: %s", exc)

    return access_token

# Ticket creation

def open_zoho_ticket(
    subject: str,
    description: str,
    country: str = None,
    priority: str = "High",
    contact: dict[str, Any] | None = None,
    channel: str = "Email",
    status: str = None,
    classification: str | None = None,
    department_id: str | None = None,
    max_retries: int = 3,
) -> dict[str, Any]:
    """Open a Zoho Desk ticket with exponential-backoff retry logic.

    Returns:
        dict with keys ``Code``, ``Message``, and ``data``.
    """
    config = current_app.config

    url: str = config.get("ZOHO_DESK_URL", "")
    sub_category:str = config.get("ZOHO_DESK_SUBCATEGORY", "")
    org_id: str = config.get("ZOHO_DESK_ORG_ID", "")
    if not all([url, org_id]):
        raise RuntimeError(
            "ZOHO_DESK_URL and ORG_ID is not configured."
        )

    if department_id is None:
        department_id = config.get("ZOHO_DESK_DEPT_ID", "") or None
    if status is None:
        status = config.get("ZOHO_DESK_STATUS", "")
    if country is None:
        country = config.get("ZOHO_DESK_COUNTRY", "")
    if contact is None:
        contact = dict(config.get("ZOHO_DESK_DEFAULT_CONTACT") or {})
    if classification is None:
        classification = config.get("ZOHO_DESK_CLASS", "")

    body: dict[str, Any] = {
        "subject": subject,
        "description": description,
        "priority": priority,
        "contact": contact,
        "channel": channel,
        "status": status,
        "classification": classification,
        "subCategory": sub_category,
        "departmentId": department_id,
        "cf": {
            "cf_country": country,
        },
    }

    for attempt in range(max_retries):
        try:
            logger.info("ZohoTicket Attempt %d of %d", attempt + 1, max_retries)

            access_token = get_access_token()

            headers = {
                "Authorization": f"Zoho-oauthtoken {access_token}",
                "OrgId": org_id,
                "Content-Type": "application/json",
            }

            response = requests.post(
                url=url, headers=headers, json=body, timeout=30
            )

            logger.info("ZohoTicket Status code: %d", response.status_code)

            if response.status_code == 200:
                response_data = response.json()
                logger.info(
                    "ZohoTicket ticketId=%s departmentId=%s",
                    response_data.get("id"),
                    response_data.get("departmentId"),
                )
                return {
                    "Code": response.status_code,
                    "Message": "Ticket request succeeded",
                    "data": response_data,
                }

            logger.warning(
                "ZohoTicket Request failed with status %d: %s",
                response.status_code,
                response.text,
            )

            # On the last attempt return a structured error instead of raising
            if attempt == max_retries - 1:
                logger.error(
                    "ZohoTicket Failed after %d attempts: %d — %s",
                    max_retries,
                    response.status_code,
                    response.text,
                )
                return {
                    "Code": response.status_code,
                    "Message": "Failed Ticket Request",
                    "data": response.text,
                }

        except requests.exceptions.Timeout as exc:
            logger.error("ZohoTicket Timeout on attempt %d: %s", attempt + 1, exc)
            if attempt == max_retries - 1:
                return {
                    "Code": 408,
                    "Message": "Request Timeout - Failed after retries",
                    "data": str(exc),
                }

        except requests.exceptions.RequestException as exc:
            logger.error(
                "ZohoTicket RequestException on attempt %d: %s", attempt + 1, exc
            )
            if attempt == max_retries - 1:
                return {
                    "Code": 500,
                    "Message": "Request Exception - Failed after retries",
                    "data": str(exc),
                }

        except Exception as exc:  # pylint: disable=broad-except
            logger.error(
                "ZohoTicket Unexpected error on attempt %d: %s", attempt + 1, exc
            )
            if attempt == max_retries - 1:
                return {
                    "Code": 500,
                    "Message": "Unexpected Error - Failed after retries",
                    "data": str(exc),
                }

        # Exponential backoff: 1 s, 2 s, 4 s …
        if attempt < max_retries - 1:
            backoff = 2 ** attempt
            logger.info("ZohoTicket Waiting %d s before retry …", backoff)
            time.sleep(backoff)

    # Defensive fallback — should never be reached
    return {
        "Code": 500,
        "Message": f"Failed to create ticket after {max_retries} attempts",
        "data": None,
    }
