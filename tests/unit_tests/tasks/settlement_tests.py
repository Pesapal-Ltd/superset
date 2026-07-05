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
"""Unit tests for Settlement task response parsing and execution."""

import pytest
from superset.tasks.settlement import parse_settlement_response


def test_parse_settlement_response_success():
    payload = {
        "result": {
            "MerchantRecoveryGuid": "0451330c-a51b-0f0d6d70940d",
            "WithdrawalAdjustmentTypeId": 1,
            "MerchantId": 99717,
            "Currency": "RWF",
            "Country": "RW",
            "Frequency": "OneOff",
            "Amount": 700.0,
            "Status": 1,
            "Reference": "7761059676245104716",
            "Description": "Test RiskVerification",
            "DateCreated": "2026-07-03T05:14:02.7850569+02:00",
            "DateUpdated": None,
            "WithdrawalAdjustmentType": {
                "WithdrawalAdjustmentTypeId": 1,
                "WithdrawalAdjustmentTypeName": "Chargeback debit    ",
                "Enabled": 1,
            },
        }
    }

    parsed = parse_settlement_response(payload, status_code=200)

    assert parsed["is_success"] is True
    assert parsed["merchant_recovery_guid"] == "0451330c-a51b-0f0d6d70940d"
    assert parsed["merchant_id"] == "99717"
    assert parsed["currency"] == "RWF"
    assert parsed["country"] == "RW"
    assert parsed["amount"] == 700.0
    assert parsed["error_type"] is None
    assert parsed["error_message"] is None


def test_parse_settlement_response_duplicate_reference_error():
    payload = {
        "message": " This Recovery Reference Already Exists",
        "error": "CreateMerchantPaymentRecoveryError",
    }

    parsed = parse_settlement_response(payload, status_code=400)

    assert parsed["is_success"] is False
    assert parsed["merchant_recovery_guid"] is None
    assert parsed["error_type"] == "CreateMerchantPaymentRecoveryError"
    assert parsed["error_message"] == "This Recovery Reference Already Exists"


def test_parse_settlement_response_system_exception_error():
    payload = {
        "Message": "An error has occurred.",
        "ExceptionMessage": "Nullable object must have a value.",
        "ExceptionType": "System.InvalidOperationException",
        "StackTrace": "   at System.ThrowHelper.ThrowInvalidOperationException(ExceptionResource resource)",
    }

    parsed = parse_settlement_response(payload, status_code=500)

    assert parsed["is_success"] is False
    assert parsed["merchant_recovery_guid"] is None
    assert parsed["error_type"] == "System.InvalidOperationException"
    assert "An error has occurred." in parsed["error_message"]
    assert "Nullable object must have a value." in parsed["error_message"]


def test_parse_settlement_response_non_json_error():
    parsed = parse_settlement_response("Internal Server Error", status_code=500)

    assert parsed["is_success"] is False
    assert parsed["error_type"] == "HTTP_500"
    assert parsed["error_message"] == "Internal Server Error"
