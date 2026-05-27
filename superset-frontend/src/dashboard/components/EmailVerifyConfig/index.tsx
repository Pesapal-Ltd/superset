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
 * EmailVerifyConfig
 *
 * A configuration panel injected as a tab into the Dashboard Properties modal.
 * Allows administrators to enable/disable email verification on a dashboard and
 * configure which template types and user roles are allowed.
 *
 * Saves config to Dashboard.json_metadata["email_verify_config"] via:
 *   PUT /api/v1/email-verify/config/dashboard/<id>
 */

import React, { useState, useEffect } from 'react';
import {
  Form,
  Switch,
  Select,
  Divider,
  Alert,
  Button,
  message,
  Space,
  Typography,
} from 'antd';
import { MailOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { SupersetClient, t } from '@superset-ui/core';

const { Option } = Select;
const { Text, Paragraph } = Typography;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface EmailVerifyConfig {
  enabled: boolean;
  /** Template types the "Send email" button should expose */
  allowed_types: string[];
  /** FAB role names that are permitted to send from this dashboard */
  allowed_roles: string[];
  /** Optional: dataset column that contains the recipient email address */
  recipient_column?: string;
  /** Optional: dataset column that contains the merchant ID */
  merchant_id_column?: string;
}

interface EmailVerifyConfigPanelProps {
  /** Superset chart ID being edited */
  chartId: number;
  /** Called after config is successfully saved so parent can reflect changes */
  onSaved?: (config: EmailVerifyConfig) => void;
  /** Available column names from dashboard datasets */
  columnOptions?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: EmailVerifyConfig = {
  enabled: false,
  allowed_types: [],
  allowed_roles: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function EmailVerifyConfigPanel({
  chartId,
  onSaved,
  columnOptions = [],
}: EmailVerifyConfigPanelProps) {
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
        // Load existing email_verify_config from the chart
        const configResp = await SupersetClient.get({
          endpoint: `/api/v1/email-verify/config?chart_id=${chartId}`,
        });
        const existing: EmailVerifyConfig =
          (configResp.json as any)?.result || DEFAULT_CONFIG;

        form.setFieldsValue({
          enabled: existing.enabled,
          allowed_types: existing.allowed_types || [],
          allowed_roles: existing.allowed_roles || [],
          recipient_column: existing.recipient_column || '',
          merchant_id_column: existing.merchant_id_column || '',
        });
        setEnabled(existing.enabled);

        // Load FAB roles for the role selector
        const rolesResp = await SupersetClient.get({
          endpoint: '/api/v1/security/roles/?q=(page_size:100)',
        });
        const rolesData: any = rolesResp.json;
        const roleNames: string[] = (rolesData?.result || []).map(
          (r: any) => r.name,
        );
        setRoles(roleNames);
      } catch {
        message.error(t('Could not load email verification configuration.'));
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

      const payload: EmailVerifyConfig = {
        enabled: values.enabled || false,
        allowed_types: values.allowed_types || [],
        allowed_roles: values.allowed_roles || [],
        recipient_column: values.recipient_column || undefined,
        merchant_id_column: values.merchant_id_column || undefined,
      };

      await SupersetClient.request({
        method: 'PUT',
        endpoint: `/api/v1/email-verify/config/chart/${chartId}`,
        jsonPayload: payload,
      });

      message.success(t('Email verification settings saved.'));
      onSaved?.(payload);
    } catch {
      message.error(t('Failed to save email verification settings.'));
    } finally {
      setSaving(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <MailOutlined style={{ fontSize: 18, color: '#1890ff' }} />
        <div>
          <Text strong>{t('Email Verification')}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t(
              'Allow authorized users to send templated verification emails to merchants directly from this chart.',
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
        <Form.Item name="enabled" valuePropName="checked" label={t('Enable email verification')}>
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
              'Email verification is disabled. Enable the toggle above to configure and expose the "Send verification email" button on this chart.',
            )}
            style={{ marginBottom: 16 }}
          />
        )}

        {/* Settings visible only when enabled */}
        {enabled && (
          <>
            <Divider orientation="left" plain>
              {t('Allowed Templates')}
            </Divider>

            <Form.Item
              name="allowed_types"
              label={t('Template Types')}
              tooltip={t(
                'Only templates of these types will be available in the send modal. Leave empty to allow all active types.',
              )}
            >
              <Select
                mode="multiple"
                allowClear
                placeholder={t('All template types')}
                id="email-verify-config-types"
              >
                <Option value="transaction_verification">
                  {t('Transaction Verification')}
                </Option>
                <Option value="merchant_verification">{t('Merchant Verification')}</Option>
              </Select>
            </Form.Item>

            <Divider orientation="left" plain>
              {t('Access Control')}
            </Divider>

            <Form.Item
              name="allowed_roles"
              label={t('Allowed Roles')}
              tooltip={t(
                'Only users with one of these roles can send verification emails from this chart. Leave empty to allow any user with the "can_send_verification_email" permission.',
              )}
            >
              <Select
                mode="multiple"
                allowClear
                placeholder={t('All roles with send permission')}
                loading={loading}
                id="email-verify-config-roles"
              >
                {roles.map(role => (
                  <Option key={role} value={role}>
                    {role}
                  </Option>
                ))}
              </Select>
            </Form.Item>

            <Divider orientation="left" plain>
              {t('Data Column Hints (optional)')}
            </Divider>

            <Paragraph style={{ fontSize: 12, color: '#888' }}>
              {t(
                'If specified, the send modal will attempt to pre-fill the recipient email and merchant ID from the selected chart row using these column names.',
              )}
            </Paragraph>

            <Form.Item
              name="recipient_column"
              label={t('Recipient Email Column')}
              tooltip={t('Dataset column that contains the merchant email address.')}
            >
              <Select
                allowClear
                showSearch
                placeholder={t('e.g. merchant_email')}
                id="email-verify-config-recipient-col"
                mode="tags"
              >
                {columnOptions.map(col => (
                  <Option key={col} value={col}>
                    {col}
                  </Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item
              name="merchant_id_column"
              label={t('Merchant ID Column')}
              tooltip={t('Dataset column that contains the merchant identifier.')}
            >
              <Select
                allowClear
                showSearch
                placeholder={t('e.g. merchant_id')}
                id="email-verify-config-merchant-id-col"
                mode="tags"
              >
                {columnOptions.map(col => (
                  <Option key={col} value={col}>
                    {col}
                  </Option>
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
            id="email-verify-config-save-btn"
          >
            {t('Save Email Settings')}
          </Button>
        </Space>
      </div>
    </div>
  );
}
