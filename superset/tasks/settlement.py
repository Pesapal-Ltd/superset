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

    with db_conn.get_sqla_engine() as engine:
        with engine.connect() as conn:
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
    payload: dict[str, Any],
) -> dict[str, Any]:
    """
    Call the Settlement Credit Recovery API with a pre-constructed payload.
    """
    endpoint = (
        "Create" if action == "hold" else "Update"
    )

    resp = requests.post(
        f"{base_url}/Api/SettlementCreditRecovery/{endpoint}",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    
    if not resp.ok:
        logger.error(
            "Settlement API Error (status=%s): %s",
            resp.status_code,
            resp.text,
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

    # if log is not found (race condition or replication lag), retry.
    if log is None:
        if self.request.retries < self.max_retries:
            logger.warning(
                "SettlementLog(id=%s) not found. Retrying (attempt %s)...",
                log_id,
                self.request.retries + 1,
            )
            # Short exponential backoff or fixed delay
            raise self.retry(countdown=5)
        
        # Still not found after all retries
        err = f"SettlementLog(id={log_id}) not found after all retries. Aborting."
        logger.error(err)
        return {"success": False, "error": err}

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

        # Construct payload
        withdrawal_type_id = current_app.config.get(
            "SETTLEMENT_WITHDRAWAL_ADJUSTMENT_TYPE_ID", 1
        )
        frequency = current_app.config.get("SETTLEMENT_FREQUENCY", "One Off")
        status = 1 if action == "hold" else 0

        request_payload = {
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

        # Call settlement API
        response = _call_settlement_api(
            base_url=base_url,
            token=token,
            action=action,
            payload=request_payload,
        )

        # Mark success
        if log:
            log.status = "success"
            log.request_payload = request_payload
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
        
        # Save the error details to the log immediately so it's visible while retrying
        if log:
            error_msg = str(exc)
            # Use request_payload if it was successfully constructed
            try:
                # We can try to local-reference it, or use the locals() dict
                if locals().get("request_payload"):
                    log.request_payload = locals()["request_payload"]
            except Exception: # pylint: disable=broad-except
                pass

            # If it's a requests error, try to get the response body
            if hasattr(exc, "response") and exc.response is not None:
                try:
                    # Save the raw response text for debugging
                    error_msg = f"{error_msg} - Body: {exc.response.text}"

                    # Try to save the JSON if available
                    log.response_snapshot = exc.response.json()
                except Exception:  # pylint: disable=broad-except
                    pass
            
            log.status = "failed" if self.request.retries >= self.max_retries else "pending"
            log.error_message = error_msg
            log.completed_at = datetime.utcnow() if self.request.retries >= self.max_retries else None
            try:
                db.session.commit()
                # logger.info(f"Settlement log committed for code={confirmation_code} action={action}")
            except Exception as e:
                logger.exception(
                    "Settlement task failed to commit log for code=%s action=%s: %s",
                    confirmation_code,
                    action,
                    e,
                )

        try:
            self.retry(exc=exc)
        except self.MaxRetriesExceededError:
            # Task is now officially finished as failed
            return {"success": False, "error": str(exc)}
        
        # If retry was scheduled
        return {"success": False, "error": str(exc), "retrying": True}
