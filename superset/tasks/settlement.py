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


def parse_settlement_response(
    raw_response: Any,
    status_code: int = 200,
) -> dict[str, Any]:
    """
    Parse and destructure Settlement API response for success, duplicate error, or system exception.

    """
    parsed: dict[str, Any] = {
        "is_success": False,
        "merchant_recovery_guid": None,
        "error_type": None,
        "error_message": None,
        "merchant_id": None,
        "currency": None,
        "country": None,
        "amount": None,
    }

    if not isinstance(raw_response, dict):
        parsed["error_message"] = str(raw_response) if raw_response is not None else "Empty response body"
        if status_code >= 400:
            parsed["error_type"] = f"HTTP_{status_code}"
        return parsed

    def get_key(d: dict[str, Any], *keys: str) -> Any:
        for k in keys:
            if k in d:
                return d[k]
            for dk in d:
                if dk.lower() == k.lower():
                    return d[dk]
        return None

    # Check for result object (Success case)
    result = get_key(raw_response, "result", "Result")
    if isinstance(result, dict):
        guid = get_key(result, "MerchantRecoveryGuid", "merchantRecoveryGuid", "guid")
        res_status = get_key(result, "Status", "status")
        if guid or res_status is not None:
            parsed["is_success"] = status_code < 400
            parsed["merchant_recovery_guid"] = str(guid) if guid else None
            parsed["merchant_id"] = (
                str(get_key(result, "MerchantId", "merchantId"))
                if get_key(result, "MerchantId", "merchantId") is not None
                else None
            )
            parsed["currency"] = get_key(result, "Currency", "currency")
            parsed["country"] = get_key(result, "Country", "country")
            amt = get_key(result, "Amount", "amount")
            if amt is not None:
                try:
                    parsed["amount"] = float(amt)
                except (ValueError, TypeError):
                    pass
            return parsed

    # Check top-level MerchantRecoveryGuid if present outside "result"
    guid = get_key(raw_response, "MerchantRecoveryGuid", "merchantRecoveryGuid")
    if guid and status_code < 400:
        parsed["is_success"] = True
        parsed["merchant_recovery_guid"] = str(guid)
        parsed["merchant_id"] = (
            str(get_key(raw_response, "MerchantId", "merchantId"))
            if get_key(raw_response, "MerchantId", "merchantId") is not None
            else None
        )
        parsed["currency"] = get_key(raw_response, "Currency", "currency")
        parsed["country"] = get_key(raw_response, "Country", "country")
        amt = get_key(raw_response, "Amount", "amount")
        if amt is not None:
            try:
                parsed["amount"] = float(amt)
            except (ValueError, TypeError):
                pass
        return parsed

    # Check error cases:
    msg = get_key(raw_response, "Message", "message")
    exc_msg = get_key(raw_response, "ExceptionMessage", "exceptionMessage")
    exc_type = get_key(raw_response, "ExceptionType", "exceptionType")
    err_code = get_key(raw_response, "Error", "error", "ErrorCode", "errorCode")

    parsed["is_success"] = False

    if exc_type:
        parsed["error_type"] = str(exc_type)
    elif err_code:
        parsed["error_type"] = str(err_code)
    elif status_code >= 400:
        parsed["error_type"] = f"HTTP_{status_code}"

    error_parts = []
    if msg and str(msg).strip():
        error_parts.append(str(msg).strip())
    if exc_msg and str(exc_msg).strip() and str(exc_msg).strip() not in error_parts:
        error_parts.append(f"Exception: {str(exc_msg).strip()}")

    if error_parts:
        parsed["error_message"] = " ".join(error_parts)
    elif exc_type or err_code:
        parsed["error_message"] = f"Error: {exc_type or err_code}"
    else:
        parsed["error_message"] = f"API request failed with status code {status_code}"

    return parsed


def _call_settlement_api(
    base_url: str,
    token: str,
    action: str,
    payload: dict[str, Any],
) -> tuple[int, Any]:
    """
    Call the Settlement Credit Recovery API with a pre-constructed payload.
    Returns tuple of (status_code, response_data).
    """
    endpoint = (
        "CreateRecovery" if action == "hold" else "Update"
    )
    resp = requests.post(
        f"{base_url}/Api/SettlementCreditRecovery/{endpoint}",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    
    try:
        data = resp.json()
    except Exception:
        data = {"raw_text": resp.text}

    if not resp.ok:
        logger.error(
            "Settlement API Error (status=%s): %s",
            resp.status_code,
            resp.text,
        )

    return resp.status_code, data


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
            log.error_type = "ConfigurationError"
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

        # Detail enrichment
        if action == "hold":
            if connection_id is None:
                raise ValueError("SETTLEMENT_DB_CONNECTION_ID is not configured.")
            row_data = _db_lookup(connection_id, confirmation_code)

            merchant_id = row_data.get("MerchantId") or row_data.get("merchant_id")
            currency = row_data.get("Currency") or row_data.get("currency") or ""
            country = row_data.get("Country") or row_data.get("country") or ""
            amount = row_data.get("Amount") or row_data.get("amount") or 0

            # Persist enriched data on the log
            if log:
                log.merchant_id = str(merchant_id) if merchant_id is not None else None
                log.currency = str(currency)
                log.country = str(country)
                log.amount = amount
                db.session.commit()
        else:
            # "release" funds log is pre-populated
            merchant_id = log.merchant_id if log else None
            currency = log.currency if log else ""
            country = log.country if log else ""
            amount = log.amount if log else 0

        # Construct payload
        withdrawal_type_id = current_app.config.get(
            "SETTLEMENT_WITHDRAWAL_ADJUSTMENT_TYPE_ID", ""
        )
        frequency = current_app.config.get("SETTLEMENT_FREQUENCY", "")

        if not all([withdrawal_type_id, frequency]):
            raise ValueError("SETTLEMENT_FREQUENCY or SETTLEMENT_WITHDRAWAL_ADJUSTMENT_TYPE_ID is not configured.")
        status = 1 if action == "hold" else 0

        request_payload = {
            "withdrawalAdjustmentTypeId": withdrawal_type_id,
            "merchantId": merchant_id,
            "currency": currency,
            "country": country,
            "frequency": frequency,
            "amount": float(amount) if amount is not None else 0,
            "status": status,
            "reference": confirmation_code,
            "description": reason,
        }

        # Save request payload early
        if log:
            log.request_payload = request_payload
            db.session.commit()

        # Call settlement API
        status_code, response_data = _call_settlement_api(
            base_url=base_url,
            token=token,
            action=action,
            payload=request_payload,
        )

        parsed = parse_settlement_response(response_data, status_code)

        if log:
            log.response_snapshot = response_data
            log.completed_at = datetime.utcnow()

            if parsed["is_success"]:
                log.status = "success"
                log.merchant_recovery_guid = parsed["merchant_recovery_guid"]
                log.error_type = None
                log.error_message = None
                if parsed["merchant_id"]:
                    log.merchant_id = parsed["merchant_id"]
                if parsed["currency"]:
                    log.currency = parsed["currency"]
                if parsed["country"]:
                    log.country = parsed["country"]
                if parsed["amount"] is not None:
                    log.amount = parsed["amount"]
            else:
                log.status = "failed"
                log.merchant_recovery_guid = parsed["merchant_recovery_guid"]
                log.error_type = parsed["error_type"]
                log.error_message = parsed["error_message"]

            db.session.commit()

        return {
            "success": parsed["is_success"],
            "response": response_data,
            "error": parsed["error_message"] if not parsed["is_success"] else None,
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
            error_type = type(exc).__name__
            # Use request_payload if it was successfully constructed
            try:
                if locals().get("request_payload"):
                    log.request_payload = locals()["request_payload"]
            except Exception: # pylint: disable=broad-except
                pass

            # If it's a requests error, try to get the response body
            if hasattr(exc, "response") and exc.response is not None:
                try:
                    error_msg = f"{error_msg} - Body: {exc.response.text}"
                    log.response_snapshot = exc.response.json()
                    parsed = parse_settlement_response(log.response_snapshot, getattr(exc.response, "status_code", 500))
                    if parsed.get("error_type"):
                        error_type = parsed["error_type"]
                    if parsed.get("error_message"):
                        error_msg = parsed["error_message"]
                except Exception:  # pylint: disable=broad-except
                    pass
            
            log.status = "failed" if self.request.retries >= self.max_retries else "pending"
            log.error_type = error_type
            log.error_message = error_msg
            log.completed_at = datetime.utcnow() if self.request.retries >= self.max_retries else None
            try:
                db.session.commit()
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
            return {"success": False, "error": str(exc)}
        
        return {"success": False, "error": str(exc), "retrying": True}

