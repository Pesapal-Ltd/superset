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
Settlement Celery task.

Each task handles ONE ConfirmationCode:
  1. Authenticate against external Settlement API → JWT
  2. DB lookup via registered Superset Database connection
     (returns MerchantId, Currency, Country, TargetAmount, Reference)
  3. POST to Create (hold, status=1) or Update (release, status=0)
  4. Update the SettlementLog row with outcome

"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

import requests
from flask import current_app
from sqlalchemy import text

from superset.extensions import celery_app, db

logger = logging.getLogger(__name__)


def _get_jwt_token(base_url: str, email: str, password: str) -> str:
    """Authenticate against the Settlement API and return a JWT bearer token."""
    resp = requests.post(
        f"{base_url}/Api/Auth/Login",
        json={"email": email, "Password": password},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    token = data.get("token") or data.get("Token") or data.get("access_token")
    if not token:
        raise ValueError(f"No token in Auth/Login response: {data}")
    return token


def _db_lookup(connection_id: int, confirmation_code: str) -> dict[str, Any]:
    """
    Query the registered Superset Database connection for enrichment data.
    Returns a dict with keys: MerchantId, Currency, Country, Amount, Reference.
    """
    # pylint: disable=import-outside-toplevel
    from superset.models.core import Database

    db_conn: Database | None = (
        db.session.query(Database).filter_by(id=connection_id).one_or_none()
    )
    if db_conn is None:
        raise ValueError(
            f"Superset Database connection id={connection_id} not found. "
            "Set SETTLEMENT_DB_CONNECTION_ID in config.py."
        )

    query = current_app.config.get("SETTLEMENT_LOOKUP_QUERY", "")
    if not query:
        raise ValueError("SETTLEMENT_LOOKUP_QUERY is not configured.")

    with db_conn.get_sqla_engine().connect() as conn:
        result = conn.execute(text(query), {"confirmation_code": confirmation_code})
        row = result.mappings().fetchone()

    if row is None:
        raise ValueError(
            f"No transaction found for ConfirmationCode={confirmation_code!r}"
        )

    return dict(row)


def _call_settlement_api(
    base_url: str,
    token: str,
    action: str,
    confirmation_code: str,
    merchant_id: Any,
    currency: str,
    country: str,
    amount: Any,
    reason: str,
) -> dict[str, Any]:
    """
    Call the external Settlement Credit Recovery API.
    action: "hold"    → POST /Api/SettlementCreditRecovery/Create  (status=1)
    action: "release" → POST /Api/SettlementCreditRecovery/Update  (status=0)
    """
    withdrawal_type_id = current_app.config.get(
        "SETTLEMENT_WITHDRAWAL_ADJUSTMENT_TYPE_ID", 1
    )
    frequency = current_app.config.get("SETTLEMENT_FREQUENCY", "One Off")
    status = 1 if action == "hold" else 0
    endpoint = (
        "Create" if action == "hold" else "Update"
    )

    payload = {
        "withdrawalAdjustmentTypeId": withdrawal_type_id,
        "merchantId": merchant_id,
        "currency": currency,
        "country": country,
        "frequency": frequency,
        "amount": float(amount),
        "status": status,
        "reference": confirmation_code,
        "description": reason,
    }

    resp = requests.post(
        f"{base_url}/Api/SettlementCreditRecovery/{endpoint}",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


@celery_app.task(
    bind=True,
    name="superset.tasks.settlement.execute_settlement_action",
    max_retries=3,
    default_retry_delay=10,
    soft_time_limit=120,
)
def execute_settlement_action(  # pylint: disable=too-many-locals
    self,
    log_id: int,
    action: str,
    confirmation_code: str,
    reason: str,
) -> dict[str, Any]:
    """
    Celery task that drives one settlement action for one ConfirmationCode.

    Parameters
    ----------
    log_id:            SettlementLog.id created by the API before enqueuing
    action:            "hold" | "release"
    confirmation_code: the ConfirmationCode from the selected row
    reason:            user-supplied description / reason
    """
    # pylint: disable=import-outside-toplevel
    from superset.models.settlement import SettlementLog

    log: SettlementLog | None = (
        db.session.query(SettlementLog).filter_by(id=log_id).one_or_none()
    )

    cfg = current_app.config
    base_url: str = cfg.get("SETTLEMENT_BASE_URL", "")
    email: str = cfg.get("SETTLEMENT_API_EMAIL", "")
    password: str = cfg.get("SETTLEMENT_API_PASSWORD", "")
    connection_id: int | None = cfg.get("SETTLEMENT_DB_CONNECTION_ID")

    if not base_url:
        err = "SETTLEMENT_BASE_URL is not configured."
        logger.error(err)
        if log:
            log.status = "failed"
            log.error_message = err
            log.completed_at = datetime.utcnow()
            db.session.commit()
        return {
            "success": False,
            "error": err
        }

    try:
        # Auth
        token = _get_jwt_token(base_url, email, password)

        # DB lookup
        if connection_id is None:
            raise ValueError("SETTLEMENT_DB_CONNECTION_ID is not configured.")
        row_data = _db_lookup(connection_id, confirmation_code)

        merchant_id = row_data.get("MerchantId")
        currency = row_data.get("Currency", "")
        country = row_data.get("Country", "")
        amount = row_data.get("Amount", 0)

        # Persist enriched data on the log
        if log:
            log.merchant_id = str(merchant_id) if merchant_id is not None else None
            log.currency = str(currency)
            log.country = str(country)
            log.amount = amount
            db.session.commit()

        # Call settlement API
        response = _call_settlement_api(
            base_url=base_url,
            token=token,
            action=action,
            confirmation_code=confirmation_code,
            merchant_id=merchant_id,
            currency=currency,
            country=country,
            amount=amount,
            reason=reason,
        )

        # Mark success
        if log:
            log.status = "success"
            log.response_snapshot = response
            log.completed_at = datetime.utcnow()
            db.session.commit()

        return {
            "success": True,
            "response": response
        }

    except Exception as exc:  # pylint: disable=broad-except
        logger.exception(
            "Settlement task failed for code=%s action=%s: %s",
            confirmation_code,
            action,
            exc,
        )
        
        try:
            self.retry(exc=exc)
        except self.MaxRetriesExceededError:
            if log:
                log.status = "failed"
                log.error_message = str(exc)
                log.completed_at = datetime.utcnow()
                db.session.commit()
            return {"success": False, "error": str(exc)}
        # If retry was scheduled, update status to "pending" (still retrying)
        return {"success": False, "error": str(exc), "retrying": True}
