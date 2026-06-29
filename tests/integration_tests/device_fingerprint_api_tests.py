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
from flask import current_app
from unittest.mock import patch
from datetime import datetime

from superset import db
from superset.models.dashboard import Dashboard
from superset.models.slice import Slice
from superset.models.device_fingerprint import BlockedDeviceFingerprint
from superset.utils import json
from tests.integration_tests.base_tests import SupersetTestCase
from tests.integration_tests.constants import ADMIN_USERNAME, ALPHA_USERNAME


class TestDeviceFingerprintApi(SupersetTestCase):
    def setUp(self):
        super().setUp()
        
        # Create a test admin user dynamically
        self.test_user = self.get_user("fp_test_admin")
        if not self.test_user:
            self.test_user = self.create_user(
                "fp_test_admin",
                "general",
                "Admin",
                email="fp_test_admin@fab.org"
            )
        
        self.login("fp_test_admin", password="general")
        
        # Create a test dashboard
        self.dashboard = Dashboard(
            dashboard_title="Test Dashboard Device FP",
            slug="test-dash-dfp",
            json_metadata=json.dumps({
                "device_fingerprint_config": {
                    "enabled": True,
                    "allowed_roles": [],
                    "fingerprint_column": "DeviceFingerprint"
                }
            })
        )
        db.session.add(self.dashboard)
        
        # Create a test slice (chart)
        self.slice = Slice(
            slice_name="Test Slice Device FP",
            datasource_type="table",
            datasource_id=1,
            params=json.dumps({
                "device_fingerprint_config": {
                    "enabled": True,
                    "allowed_roles": [],
                    "fingerprint_column": "device_id"
                }
            })
        )
        db.session.add(self.slice)
        db.session.commit()

    def tearDown(self):
        # Clean up records
        db.session.query(BlockedDeviceFingerprint).delete()
        db.session.delete(self.dashboard)
        db.session.delete(self.slice)
        
        test_user = self.get_user("fp_test_admin")
        if test_user:
            db.session.delete(test_user)
            
        db.session.commit()
        super().tearDown()

    def test_get_config_no_params(self):
        uri = "api/v1/device-fingerprint/config"
        rv = self.client.get(uri)
        self.assertEqual(rv.status_code, 400)

    def test_get_config_dashboard(self):
        uri = f"api/v1/device-fingerprint/config?dashboard_id={self.dashboard.id}"
        rv = self.client.get(uri)
        self.assertEqual(rv.status_code, 200)
        data = json.loads(rv.data.decode("utf-8"))
        self.assertTrue(data["result"]["enabled"])
        self.assertEqual(data["result"]["fingerprint_column"], "DeviceFingerprint")

    def test_get_config_chart(self):
        uri = f"api/v1/device-fingerprint/config?chart_id={self.slice.id}"
        rv = self.client.get(uri)
        self.assertEqual(rv.status_code, 200)
        data = json.loads(rv.data.decode("utf-8"))
        self.assertTrue(data["result"]["enabled"])
        self.assertEqual(data["result"]["fingerprint_column"], "device_id")

    def test_save_dashboard_config(self):
        uri = f"api/v1/device-fingerprint/config/dashboard/{self.dashboard.id}"
        new_config = {
            "enabled": False,
            "allowed_roles": ["Admin"],
            "fingerprint_column": "updated_fp"
        }
        rv = self.client.put(uri, json=new_config)
        self.assertEqual(rv.status_code, 200)
        
        # Verify db update
        db.session.refresh(self.dashboard)
        metadata = json.loads(self.dashboard.json_metadata)
        self.assertEqual(metadata["device_fingerprint_config"], new_config)

    def test_save_chart_config(self):
        uri = f"api/v1/device-fingerprint/config/chart/{self.slice.id}"
        new_config = {
            "enabled": False,
            "allowed_roles": ["Alpha"],
            "fingerprint_column": "updated_fp_chart"
        }
        rv = self.client.put(uri, json=new_config)
        self.assertEqual(rv.status_code, 200)
        
        # Verify db update
        db.session.refresh(self.slice)
        params = json.loads(self.slice.params)
        self.assertEqual(params["device_fingerprint_config"], new_config)

    def test_block_fingerprints_success(self):
        uri = "api/v1/device-fingerprint/block"
        payload = {
            "dashboard_id": self.dashboard.id,
            "rows": [
                {"DeviceFingerprint": "fp_abc_123"},
                {"DeviceFingerprint": "fp_def_456"},
                {"DeviceFingerprint": ""}  # empty fingerprint - should be skipped
            ],
            "block_reason": "Testing block action"
        }
        
        # Ensure block is enabled in config
        with patch.dict(current_app.config, {"DEVICE_FINGERPRINT_BLOCK_ENABLED": True}):
            rv = self.client.post(uri, json=payload)
            self.assertEqual(rv.status_code, 200)
            data = json.loads(rv.data.decode("utf-8"))
            self.assertEqual(data["result"]["blocked"], 2)
            self.assertEqual(data["result"]["skipped"], 1)
            self.assertEqual(len(data["result"]["ids"]), 2)

        # Check DB
        blocked = db.session.query(BlockedDeviceFingerprint).all()
        self.assertEqual(len(blocked), 2)
        self.assertEqual(blocked[0].device_fingerprint, "fp_abc_123")
        self.assertEqual(blocked[0].block_reason, "Testing block action")
        self.assertEqual(blocked[0].status, "active")

    def test_block_fingerprints_duplicate_skipped(self):
        # Insert a pre-existing active block
        pre_existing = BlockedDeviceFingerprint(
            device_fingerprint="fp_dup",
            blocked_by_fk=self.test_user.id,
            status="active",
            dashboard_id=self.dashboard.id
        )
        db.session.add(pre_existing)
        db.session.commit()

        uri = "api/v1/device-fingerprint/block"
        payload = {
            "dashboard_id": self.dashboard.id,
            "rows": [
                {"DeviceFingerprint": "fp_dup"}
            ],
            "block_reason": "Duplicate block test"
        }

        with patch.dict(current_app.config, {"DEVICE_FINGERPRINT_BLOCK_ENABLED": True}):
            rv = self.client.post(uri, json=payload)
            self.assertEqual(rv.status_code, 200)
            data = json.loads(rv.data.decode("utf-8"))
            self.assertEqual(data["result"]["blocked"], 0)
            self.assertEqual(data["result"]["skipped"], 1)

    def test_block_fingerprints_disabled(self):
        uri = "api/v1/device-fingerprint/block"
        payload = {
            "dashboard_id": self.dashboard.id,
            "rows": [{"DeviceFingerprint": "fp_disabled"}]
        }
        with patch.dict(current_app.config, {"DEVICE_FINGERPRINT_BLOCK_ENABLED": False}):
            rv = self.client.post(uri, json=payload)
            self.assertEqual(rv.status_code, 403)

    def test_list_blocked_fingerprints(self):
        # Insert test records
        admin_user_id = self.test_user.id
        r1 = BlockedDeviceFingerprint(
            device_fingerprint="fp1", blocked_by_fk=admin_user_id, status="active", block_reason="reason1"
        )
        r2 = BlockedDeviceFingerprint(
            device_fingerprint="fp2", blocked_by_fk=admin_user_id, status="inactive", block_reason="reason2"
        )
        db.session.add_all([r1, r2])
        db.session.commit()

        # Query active
        uri = "api/v1/device-fingerprint/blocked?status=active"
        rv = self.client.get(uri)
        self.assertEqual(rv.status_code, 200)
        data = json.loads(rv.data.decode("utf-8"))
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["result"][0]["device_fingerprint"], "fp1")
        self.assertEqual(data["result"][0]["block_reason"], "reason1")

        # Query inactive
        uri = "api/v1/device-fingerprint/blocked?status=inactive"
        rv = self.client.get(uri)
        self.assertEqual(rv.status_code, 200)
        data = json.loads(rv.data.decode("utf-8"))
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["result"][0]["device_fingerprint"], "fp2")

    def test_patch_blocked_status(self):
        admin_user_id = self.test_user.id
        record = BlockedDeviceFingerprint(
            device_fingerprint="fp_to_patch", blocked_by_fk=admin_user_id, status="active"
        )
        db.session.add(record)
        db.session.commit()

        uri = f"api/v1/device-fingerprint/blocked/{record.id}"
        rv = self.client.patch(uri, json={"status": "inactive"})
        self.assertEqual(rv.status_code, 200)
        
        # Verify db update
        db.session.refresh(record)
        self.assertEqual(record.status, "inactive")
