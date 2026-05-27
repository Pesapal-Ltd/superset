/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

/**
 * SettlementConfig
 *
 * Configuration panel injected as a section inside the Dashboard Properties modal.
 * Saves to Dashboard.json_metadata["settlement_config"] via:
 *   PUT /api/v1/settlement/config/dashboard/<id>
 */

import React, { useState, useEffect } from 'react';
import {
  Form,
  Switch,
  Select,
  Input,
  Divider,
  Alert,
  Button,
  message,
  Space,
  Typography,
  Checkbox,
} from 'antd';
import { SwapOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { SupersetClient, t } from '@superset-ui/core';

const { Text, Paragraph } = Typography;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SettlementConfig {
  enabled: boolean;
  allowed_roles: string[];
  confirmation_code_column: string;
  default_reason: string;
  require_reason_input: boolean;
}

interface SettlementConfigPanelProps {
  chartId: number;
  onSaved?: (config: SettlementConfig) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: SettlementConfig = {
  enabled: false,
  allowed_roles: [],
  confirmation_code_column: 'ConfirmationCode',
  default_reason: 'RiskVerification',
  require_reason_input: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function SettlementConfigPanel({
  chartId,
  onSaved,
}: SettlementConfigPanelProps) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [roles, setRoles] = useState<string[]>([]);
  const [enabled, setEnabled] = useState(false);

  // ── Load existing config + available roles on mount ──────────────────────
  useEffect(() => {
    if (!chartId) return;

    const loadAll = async () => {
      setLoading(true);
      try {
        const configResp = await SupersetClient.get({
          endpoint: `/api/v1/settlement/config?chart_id=${chartId}`,
        });
        const existing: SettlementConfig =
          (configResp.json as any)?.result || DEFAULT_CONFIG;

        form.setFieldsValue({
          enabled: existing.enabled,
          allowed_roles: existing.allowed_roles || [],
          confirmation_code_column:
            existing.confirmation_code_column || 'ConfirmationCode',
          default_reason: existing.default_reason || 'RiskVerification',
          require_reason_input:
            existing.require_reason_input !== false, // default true
        });
        setEnabled(existing.enabled);

        // Load FAB roles
        const rolesResp = await SupersetClient.get({
          endpoint: '/api/v1/security/roles/?q=(page_size:100)',
        });
        const rolesData: any = rolesResp.json;
        const roleNames: string[] = (rolesData?.result || []).map(
          (r: any) => r.name,
        );
        setRoles(roleNames);
      } catch {
        message.error(t('Could not load settlement configuration.'));
      } finally {
        setLoading(false);
      }
    };

    loadAll();
  }, [chartId, form]);

  // ── Save ─────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);

      const payload: SettlementConfig = {
        enabled: values.enabled || false,
        allowed_roles: values.allowed_roles || [],
        confirmation_code_column:
          values.confirmation_code_column || 'ConfirmationCode',
        default_reason: values.default_reason || 'RiskVerification',
        require_reason_input: values.require_reason_input !== false,
      };

      await SupersetClient.request({
        method: 'PUT',
        endpoint: `/api/v1/settlement/config/chart/${chartId}`,
        jsonPayload: payload,
      });

      message.success(t('Settlement settings saved.'));
      onSaved?.(payload);
    } catch {
      message.error(t('Failed to save settlement settings.'));
    } finally {
      setSaving(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <SwapOutlined style={{ fontSize: 18, color: '#fa8c16' }} />
        <div>
          <Text strong>{t('Settlement Actions')}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t(
              'Allow authorized users to Hold Funds or Release Funds for transactions directly from this chart.',
            )}
          </Text>
        </div>
      </div>

      <Form
        form={form}
        layout="vertical"
        onValuesChange={(changedValues) => {
          if (changedValues.enabled !== undefined) {
            setEnabled(changedValues.enabled);
          }
        }}
      >
        {/* Master toggle */}
        <Form.Item
          name="enabled"
          valuePropName="checked"
          label={t('Enable Settlement Actions')}
        >
          <Switch
            checkedChildren={t('Enabled')}
            unCheckedChildren={t('Disabled')}
          />
        </Form.Item>

        {!enabled && (
          <Alert
            type="info"
            icon={<InfoCircleOutlined />}
            showIcon
            message={t(
              'Settlement is disabled. Enable the toggle above to expose "Hold Funds" and "Release Funds" in the chart action menu.',
            )}
            style={{ marginBottom: 16 }}
          />
        )}

        {enabled && (
          <>
            <Divider orientation="left" plain>
              {t('Transaction Identification')}
            </Divider>

            <Form.Item
              name="confirmation_code_column"
              label={t('ConfirmationCode Column')}
              tooltip={t(
                'The column name in the table that holds the ConfirmationCode. Used to identify which transaction to settle.',
              )}
            >
              <Input
                placeholder="ConfirmationCode"
                id="settlement-config-code-col"
              />
            </Form.Item>

            <Divider orientation="left" plain>
              {t('Action Reason')}
            </Divider>

            <Form.Item
              name="default_reason"
              label={t('Default Reason')}
              tooltip={t(
                'Pre-filled reason sent as the description in the settlement payload.',
              )}
            >
              <Input
                placeholder="RiskVerification"
                id="settlement-config-default-reason"
              />
            </Form.Item>

            <Form.Item
              name="require_reason_input"
              valuePropName="checked"
              label={t('Allow user to edit reason')}
              tooltip={t(
                'If checked, the analyst will see the reason textarea before confirming. If unchecked, the default reason is sent silently.',
              )}
            >
              <Checkbox id="settlement-config-require-reason" />
            </Form.Item>

            <Divider orientation="left" plain>
              {t('Access Control')}
            </Divider>

            <Paragraph style={{ fontSize: 12, color: '#888' }}>
              {t(
                'Restrict which roles can execute Hold/Release actions on this chart. Leave empty to allow any user with the can_execute_settlement permission.',
              )}
            </Paragraph>

            <Form.Item
              name="allowed_roles"
              label={t('Allowed Roles')}
            >
              <Select
                mode="multiple"
                allowClear
                placeholder={t('All roles with settlement permission')}
                loading={loading}
                id="settlement-config-roles"
              >
                {roles.map(role => (
                  <Select.Option key={role} value={role}>
                    {role}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          </>
        )}
      </Form>

      <div style={{ marginTop: 16, textAlign: 'right' }}>
        <Space>
          <Button
            type="primary"
            loading={saving}
            onClick={handleSave}
            id="settlement-config-save-btn"
          >
            {t('Save Settlement Settings')}
          </Button>
        </Space>
      </div>
    </div>
  );
}
