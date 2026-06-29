/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  See the NOTICE file
 * distributed with this work for information on how to configure your skills.
 * 
 * Please note that the frontmatter is YAML formatted.
 */
/**
 * DeviceFingerprintConfig
 *
 * Configuration panel injected as a section inside the Chart Properties modal.
 * Saves to Chart.form_data["device_fingerprint_config"] via:
 *   PUT /api/v1/device-fingerprint/config/chart/<id>
 */

import React, { useState, useEffect } from 'react';
import {
  Form,
  Switch,
  Select,
  Input,
  Button,
  message,
  Space,
  Typography,
} from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import { SupersetClient, t } from '@superset-ui/core';

const { Paragraph } = Typography;

export interface DeviceFingerprintConfig {
  enabled: boolean;
  allowed_roles: string[];
  fingerprint_column: string;
}

interface DeviceFingerprintConfigPanelProps {
  chartId: number;
  onSaved?: (config: DeviceFingerprintConfig) => void;
}

const DEFAULT_CONFIG: DeviceFingerprintConfig = {
  enabled: false,
  allowed_roles: [],
  fingerprint_column: 'DeviceFingerprint',
};

export default function DeviceFingerprintConfigPanel({
  chartId,
  onSaved,
}: DeviceFingerprintConfigPanelProps) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [roles, setRoles] = useState<string[]>([]);
  const [enabled, setEnabled] = useState(false);

  // Load existing config and roles
  useEffect(() => {
    if (!chartId) return;

    const loadAll = async () => {
      setLoading(true);
      try {
        const configResp = await SupersetClient.get({
          endpoint: `/api/v1/device-fingerprint/config?chart_id=${chartId}`,
        });
        const existing: DeviceFingerprintConfig =
          (configResp.json as any)?.result || DEFAULT_CONFIG;

        form.setFieldsValue({
          enabled: existing.enabled,
          allowed_roles: existing.allowed_roles || [],
          fingerprint_column: existing.fingerprint_column || 'DeviceFingerprint',
        });
        setEnabled(existing.enabled);

        // Load roles
        const rolesResp = await SupersetClient.get({
          endpoint: '/api/v1/security/roles/?q=(page_size:100)',
        });
        const rolesData: any = rolesResp.json;
        const roleNames: string[] = (rolesData?.result || []).map(
          (r: any) => r.name,
        );
        setRoles(roleNames);
      } catch {
        message.error(t('Could not load device fingerprint configuration.'));
      } finally {
        setLoading(false);
      }
    };

    loadAll();
  }, [chartId, form]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(saving => true);

      const payload: DeviceFingerprintConfig = {
        enabled: values.enabled || false,
        allowed_roles: values.allowed_roles || [],
        fingerprint_column: values.fingerprint_column || 'DeviceFingerprint',
      };

      await SupersetClient.request({
        method: 'PUT',
        endpoint: `/api/v1/device-fingerprint/config/chart/${chartId}`,
        jsonPayload: payload,
      });

      message.success(t('Device fingerprint blocking settings saved.'));
      onSaved?.(payload);
    } catch {
      message.error(t('Failed to save device fingerprint settings.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ marginTop: 16 }}>
      <Space align="baseline">
        <WarningOutlined style={{ fontSize: '18px', color: '#ff4d4f' }} />
        <h3 style={{ margin: 0 }}>{t('Device Fingerprint Blocking')}</h3>
      </Space>
      <Paragraph style={{ color: '#666', marginTop: 4, marginBottom: 16 }}>
        {t('Allow authorized users to block device fingerprints directly from this chart.')}
      </Paragraph>

      <Form
        form={form}
        layout="vertical"
        initialValues={DEFAULT_CONFIG}
      >
        <Form.Item
          name="enabled"
          label={t('Enable device fingerprint blocking')}
          valuePropName="checked"
        >
          <Switch
            disabled={loading || saving}
            onChange={v => setEnabled(v)}
            checkedChildren={t('Enabled')}
            unCheckedChildren={t('Disabled')}
          />
        </Form.Item>

        {enabled && (
          <>
            <Form.Item
              name="fingerprint_column"
              label={t('Device Fingerprint Column')}
              tooltip={t('The name of the column in the query results containing the device fingerprint string')}
              rules={[{ required: true, message: t('Please specify the device fingerprint column.') }]}
            >
              <Input disabled={loading || saving} placeholder="e.g. DeviceFingerprint" />
            </Form.Item>

            <Form.Item
              name="allowed_roles"
              label={t('Allowed Roles')}
              tooltip={t('Only users with these roles will be authorized to trigger device fingerprint blocking')}
            >
              <Select
                mode="multiple"
                allowClear
                disabled={loading || saving}
                placeholder={t('Select allowed roles (leave empty for all users)')}
                style={{ width: '100%' }}
              >
                {roles.map(r => (
                  <Select.Option key={r} value={r}>
                    {r}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          </>
        )}

        <Form.Item style={{ marginBottom: 0, marginTop: 16 }}>
          <Button
            type="primary"
            onClick={handleSave}
            loading={saving}
            disabled={loading || saving}
            style={{ float: 'right' }}
          >
            {t('Save Device Fingerprint Settings')}
          </Button>
        </Form.Item>
      </Form>
    </div>
  );
}
