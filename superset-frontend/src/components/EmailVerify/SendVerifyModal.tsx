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
 * SendVerifyModal
 *
 * A modal invoked from a chart's action menu that allows an authorized user to:
 *   1. Enter the recipient email and optional merchant ID
 *   2. Select a template type (filtered to those allowed by the dashboard config)
 *   3. Select an active template of that type
 *   4. Fill in any required variables
 *   5. Submit — which calls POST /api/v1/email-verify/send
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  Alert,
  message,
} from 'antd';
import { MailOutlined } from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { SupersetClient, t } from '@superset-ui/core';
import { RootState, Datasource } from 'src/dashboard/types';

const { Option } = Select;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Template {
  id: number;
  name: string;
  type: string;
  subject: string;
  variables: string[];
}

interface EmailVerifyConfig {
  enabled: boolean;
  allowed_types?: string[];
  allowed_roles?: string[];
  recipient_column?: string;
  merchant_id_column?: string;
}

interface SendVerifyModalProps {
  /** Whether the modal is open */
  visible: boolean;
  /** Dashboard context — used to load the email_verify_config */
  dashboardId?: number;
  /** Chart context */
  chartId?: number;
  /** Pre-fill the recipient email from a selected row */
  defaultRecipient?: string;
  /** Pre-fill the merchant ID from a selected row */
  defaultMerchantId?: string;
  /** Selected rows for bulk action */
  selectedRows?: any[];
  /** Called when the modal is closed */
  onClose: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function SendVerifyModal({
  visible,
  dashboardId,
  chartId,
  defaultRecipient,
  defaultMerchantId,
  selectedRows = [],
  onClose,
}: SendVerifyModalProps) {
  const [form] = Form.useForm();
  const isBulk = selectedRows && selectedRows.length > 0;

  const [config, setConfig] = useState<EmailVerifyConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(false);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);

  const [selectedType, setSelectedType] = useState<string | undefined>(undefined);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);

  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{
    success: boolean;
    error?: string;
  } | null>(null);

  // ── Access chart columns from Redux ──────────────────────────────────────
  const chart = useSelector<RootState, any>(
    state => state.charts[chartId || 0],
  );
  const datasource = useSelector<RootState, Datasource | undefined>(
    state => state.datasources[chart?.form_data?.datasource],
  );
  const columnOptions = useMemo(
    () => (datasource?.columns || []).map(c => c.column_name).sort(),
    [datasource],
  );

  // ── Load dashboard/chart config on open ──────────────────────────────────
  useEffect(() => {
    if (!visible) return;

    form.resetFields();
    setSendResult(null);
    setSelectedType(undefined);
    setSelectedTemplate(null);

    if (!isBulk && defaultRecipient) form.setFieldsValue({ recipient_email: defaultRecipient });
    if (!isBulk && defaultMerchantId) form.setFieldsValue({ merchant_id: defaultMerchantId });

    const loadConfig = async () => {
      setConfigLoading(true);
      try {
        const params = new URLSearchParams();
        if (dashboardId) params.set('dashboard_id', String(dashboardId));
        else if (chartId) params.set('chart_id', String(chartId));

        const resp = await SupersetClient.get({
          endpoint: `/api/v1/email-verify/config?${params.toString()}`,
        });
        const data: any = resp.json;
        setConfig(data?.result || null);
      } catch {
        message.error(t('Could not load email verification configuration.'));
      } finally {
        setConfigLoading(false);
      }
    };

    loadConfig();
  }, [visible, dashboardId, chartId, defaultRecipient, defaultMerchantId, form]);

  // ── Load templates when feature is enabled ───────────────────────────────
  useEffect(() => {
    if (!config?.enabled) return;

    const loadTemplates = async () => {
      setTemplatesLoading(true);
      try {
        const params = new URLSearchParams();
        params.set('active_only', 'true');
        if (selectedType) params.set('type', selectedType);

        const resp = await SupersetClient.get({
          endpoint: `/api/v1/email-verify/templates?${params.toString()}`,
        });
        const data: any = resp.json;

        // Filter to allowed types from config
        let results: Template[] = data?.result || [];
        if (config.allowed_types?.length) {
          results = results.filter(t => config.allowed_types!.includes(t.type));
        }
        setTemplates(results);
      } catch {
        message.error(t('Could not load email templates.'));
      } finally {
        setTemplatesLoading(false);
      }
    };

    loadTemplates();
  }, [config, selectedType]);

  // ── Send ─────────────────────────────────────────────────────────────────
  const handleSend = async () => {
    try {
      const values = await form.validateFields();
      setSending(true);
      setSendResult(null);

      if (isBulk) {
        let successCount = 0;
        let failCount = 0;

        for (const row of selectedRows) {
          const emails = [];
          if (row['MerchantEmail']) emails.push(row['MerchantEmail']);
          if (row['CustomerEmail']) emails.push(row['CustomerEmail']);
          if (values.additional_recipients?.length) {
            emails.push(...values.additional_recipients);
          }

          if (emails.length === 0) {
            failCount++;
            continue;
          }

          const payload: Record<string, any> = {
            template_id: selectedTemplate?.id,
            recipient_email: emails.join(','),
            merchant_id: row['MerchantName'] || '',
            variables: {},
          };
          if (dashboardId) payload.dashboard_id = dashboardId;
          if (chartId) payload.chart_id = chartId;

          (selectedTemplate?.variables || []).forEach((v: string) => {
            const mappedCol = values[`var_${v}`]?.[0] || v;
            payload.variables[v] =
              typeof row[mappedCol] !== 'undefined' ? String(row[mappedCol]) : '';
          });

          try {
            await SupersetClient.post({
              endpoint: '/api/v1/email-verify/send',
              jsonPayload: payload,
            });
            successCount++;
          } catch (e) {
            failCount++;
          }
        }

        setSendResult({
          success: failCount === 0,
          error:
            failCount > 0
              ? t(`Sent ${successCount}, Failed ${failCount} (Ensure rows have MerchantEmail)`)
              : undefined,
        });

        if (failCount === 0) {
          message.success(t('Successfully sent all emails in bulk!'));
        }
      } else {
        const payload: Record<string, any> = {
          template_id: selectedTemplate?.id,
          recipient_email: values.recipient_email,
          merchant_id: values.merchant_id,
          variables: {},
        };
        if (dashboardId) payload.dashboard_id = dashboardId;
        if (chartId) payload.chart_id = chartId;

        // Collect variable values from form
        (selectedTemplate?.variables || []).forEach((v: string) => {
          let val = values[`var_${v}`];
          if (Array.isArray(val) && val.length > 0) val = val[0];
          payload.variables[v] = val || '';
        });

        const resp = await SupersetClient.post({
          endpoint: '/api/v1/email-verify/send',
          jsonPayload: payload,
        });
        const data: any = resp.json;
        setSendResult({ success: data?.result?.success, error: data?.result?.error });

        if (data?.result?.success) {
          message.success(t('Verification email sent successfully!'));
        }
      }
    } catch (err: any) {
      if (err?.errorFields) return; // Validation errors
      message.error(err?.message || t('Failed to send verification email(s).'));
    } finally {
      setSending(false);
    }
  };

  // ── Helpers ──────────────────────────────────────────────────────────────
  const typeLabel = (type: string) =>
    type === 'transaction_verification' ? t('Transaction Verification') : t('Merchant Verification');

  const filteredTemplates = selectedType
    ? templates.filter(t => t.type === selectedType)
    : templates;

  const allowedTypes = config?.allowed_types?.length
    ? config.allowed_types
    : ['transaction_verification', 'merchant_verification'];

  // ── Render ───────────────────────────────────────────────────────────────
  if (!configLoading && config && !config.enabled) {
    return null; // Not configured — don't show the button at all
  }

  return (
    <Modal
      title={
        <Space>
          <MailOutlined />
          {t('Send Verification Email')}
        </Space>
      }
      visible={visible}
      width={600}
      onCancel={onClose}
      footer={[
        <Button key="cancel" onClick={onClose}>
          {t('Cancel')}
        </Button>,
        <Button
          key="send"
          type="primary"
          icon={<MailOutlined />}
          loading={sending}
          onClick={handleSend}
          disabled={!selectedTemplate}
          id="send-verify-submit-btn"
        >
          {t('Send Email')}
        </Button>,
      ]}
    >
      {configLoading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin tip={t('Loading configuration...')} />
        </div>
      ) : (
        <Form form={form} layout="vertical">
          {isBulk ? (
            <Alert
              message={t('Bulk Sending Active')}
              description={t(
                `Emails will be sent for ${selectedRows.length} selected row(s). MerchantEmail and CustomerEmail are automatically mapped as recipients. MerchantName is automatically used.`,
              )}
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
          ) : (
            <>
              <Form.Item
                name="recipient_email"
                label={t('Recipient Email')}
                rules={[
                  { required: true, message: t('Recipient email is required.') },
                  { type: 'email', message: t('Please enter a valid email address.') },
                ]}
              >
                <Input
                  prefix={<MailOutlined />}
                  placeholder="merchant@example.com"
                  id="send-verify-recipient"
                />
              </Form.Item>

              <Form.Item name="merchant_id" label={t('Merchant ID (optional)')}>
                <Input placeholder={t('e.g. MERCHANT-001')} id="send-verify-merchant-id" />
              </Form.Item>
            </>
          )}

          {isBulk && (
            <Form.Item
              name="additional_recipients"
              label={t('Additional Recipients (CC)')}
              help={t('These emails will be added as recipients for all bulk emails sent.')}
            >
              <Select mode="tags" placeholder={t('Enter additional emails...')} />
            </Form.Item>
          )}

          <Form.Item label={t('Email Type')}>
            <Select
              allowClear
              placeholder={t('Filter by type')}
              value={selectedType}
              onChange={type => {
                setSelectedType(type);
                setSelectedTemplate(null);
                form.resetFields(
                  (selectedTemplate?.variables || []).map(v => `var_${v}`),
                );
              }}
              id="send-verify-type-select"
            >
              {allowedTypes.map(type => (
                <Option key={type} value={type}>
                  {typeLabel(type)}
                </Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            label={t('Select Template')}
            rules={[{ required: true, message: t('Please select a template.') }]}
          >
            {templatesLoading ? (
              <Spin size="small" />
            ) : (
              <Select
                placeholder={t('Choose a template...')}
                value={selectedTemplate?.id}
                onChange={(id: number) => {
                  const tpl = filteredTemplates.find(t => t.id === id) || null;
                  setSelectedTemplate(tpl);
                  // Clear variable fields when template changes
                  form.resetFields(
                    (selectedTemplate?.variables || []).map(v => `var_${v}`),
                  );
                }}
                id="send-verify-template-select"
              >
                {filteredTemplates.map(tpl => (
                  <Option key={tpl.id} value={tpl.id}>
                    {tpl.name}
                    <Tag
                      color={
                        tpl.type === 'transaction_verification' ? 'gold' : 'geekblue'
                      }
                      style={{ marginLeft: 8 }}
                    >
                      {typeLabel(tpl.type)}
                    </Tag>
                  </Option>
                ))}
              </Select>
            )}
          </Form.Item>

          {selectedTemplate && (
            <>
              <div
                style={{
                  background: '#f9f9f9',
                  padding: '8px 12px',
                  borderRadius: 4,
                  marginBottom: 16,
                  fontSize: 13,
                }}
              >
                <strong>{t('Subject:')}</strong> {selectedTemplate.subject}
              </div>

              {(selectedTemplate.variables || []).length > 0 && (
                <>
                  <p style={{ fontWeight: 600, marginBottom: 8 }}>
                    {t('Template Variables')}
                  </p>
                  {(selectedTemplate.variables || []).map((v: string) => (
                    <Form.Item
                      key={v}
                      name={`var_${v}`}
                      label={<Tag>{`{{${v}}}`}</Tag>}
                      rules={[
                        {
                          required: !isBulk,
                          message: t(`Value or column for {{${v}}} is required.`),
                        },
                      ]}
                    >
                      <Select
                        mode="tags"
                        placeholder={
                          isBulk ? t(`Default: Col '${v}'`) : t(`Enter value or col for ${v}`)
                        }
                      >
                        {columnOptions.map((col: string) => (
                          <Option key={col} value={col}>
                            {col}
                          </Option>
                        ))}
                      </Select>
                    </Form.Item>
                  ))}
                </>
              )}
            </>
          )}

          {sendResult && (
            <Alert
              type={sendResult.success ? 'success' : 'error'}
              message={
                sendResult.success
                  ? t('Email sent successfully!')
                  : t('Email delivery failed.')
              }
              description={sendResult.error}
              showIcon
              style={{ marginTop: 16 }}
            />
          )}
        </Form>
      )}
    </Modal>
  );
}
