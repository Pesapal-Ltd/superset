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
  DatePicker,
  Checkbox,
} from 'antd';
import { MailOutlined } from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { SupersetClient, t } from '@superset-ui/core';
import { RootState, Datasource } from 'src/dashboard/types';

const { Option } = Select;
const { TextArea } = Input;

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
  const [fromAddress, setFromAddress] = useState<string>('');
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);

  const [selectedType, setSelectedType] = useState<string | undefined>(undefined);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);

  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{
    success: boolean;
    error?: string;
  } | null>(null);

  //  Access chart columns from Redux 
  const chart = useSelector<RootState, any>(
    state => state.charts[chartId || 0],
  );
  const datasource = useSelector<RootState, Datasource | undefined>(
    state => state.datasources[chart?.form_data?.datasource],
  );

  const [datasetColumns, setDatasetColumns] = useState<string[]>([]);
  const [isLoadingDataset, setIsLoadingDataset] = useState(false);

  // Sync columns from datasource or fetch if missing
  useEffect(() => {
    if (datasource?.columns) {
      setDatasetColumns(datasource.columns.map(c => c.column_name).sort());
    } else if (chart?.form_data?.datasource && !isLoadingDataset) {
      const [id, type] = chart.form_data.datasource.split('__');
      if (type === 'table') {
        setIsLoadingDataset(true);
        SupersetClient.get({ endpoint: `/api/v1/dataset/${id}` })
          .then(({ json }) => {
            const cols = (json.result?.columns || []).map((c: any) => c.column_name).sort();
            setDatasetColumns(cols);
          })
          .catch(() => setIsLoadingDataset(false))
          .finally(() => setIsLoadingDataset(false));
      }
    }
  }, [datasource, chart?.form_data?.datasource]);

  const columnOptions = useMemo(() => {
    const queryCols = chart?.queriesResponse?.[0]?.colnames || [];
    // Merge dataset columns with query columns (to include calculated ones etc)
    const allCols = Array.from(new Set([...datasetColumns, ...queryCols])).sort();
    return allCols;
  }, [datasetColumns, chart?.queriesResponse]);

  //  Load dashboard/chart config on open 
  useEffect(() => {
    if (!visible) return;

    form.resetFields();
    setSendResult(null);
    setSelectedType(undefined);
    setSelectedTemplate(null);
    setShowCc(false);
    setShowBcc(false);
    setFromAddress('');

    if (!isBulk && defaultRecipient) form.setFieldsValue({ recipient_email: defaultRecipient });
    if (!isBulk && defaultMerchantId) form.setFieldsValue({ merchant_id: defaultMerchantId });

    const loadConfig = async () => {
      setConfigLoading(true);
      try {
        const params = new URLSearchParams();
        // Prefer chart_id since config is now stored at chart level.
        // Fall back to dashboard_id for legacy setups.
        if (chartId) params.set('chart_id', String(chartId));
        else if (dashboardId) params.set('dashboard_id', String(dashboardId));

        const resp = await SupersetClient.get({
          endpoint: `/api/v1/email-verify/config?${params.toString()}`,
        });
        const data: any = resp.json;
        const resultConfig = data?.result || null;
        setConfig(resultConfig);
        // Store from_address silently for background injection into CC
        const addr: string = resultConfig?.from_address || '';
        setFromAddress(addr);
      } catch {
        message.error(t('Could not load email verification configuration.'));
      } finally {
        setConfigLoading(false);
      }
    };

    loadConfig();
  }, [visible, dashboardId, chartId, defaultRecipient, defaultMerchantId, form]);

  //  Load templates when feature is enabled 
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

  //  Send 
  const handleSend = async () => {
    try {
      const values = await form.validateFields();
      setSending(true);
      setSendResult(null);

      // Parse comma/semicolon-separated CC and BCC text inputs into arrays
      const parseEmailList = (raw: string | undefined): string[] =>
        (raw || '')
          .split(/[,;]/)
          .map((e: string) => e.trim())
          .filter(Boolean);

      const ccEmails = parseEmailList(values.additional_recipients);
      // Always silently include the from_address in CC
      if (fromAddress && !ccEmails.includes(fromAddress)) {
        ccEmails.unshift(fromAddress);
      }
      const bccEmails = parseEmailList(values.bcc_recipients);

      if (isBulk) {
        let successCount = 0;
        let failCount = 0;
        let skipCount = 0; // already-sent duplicates

        for (const row of selectedRows) {
          const emails = [];
          const targets = values.recipient_targets || ['merchant'];
          if (targets.includes('merchant') && row['MerchantEmail']) emails.push(row['MerchantEmail']);
          if (targets.includes('customer') && row['CustomerEmail']) emails.push(row['CustomerEmail']);
          if (ccEmails.length) {
            emails.push(...ccEmails);
          }

          const uniqueEmails = Array.from(new Set(emails.map(e => String(e || '').trim()))).filter(Boolean);
          if (uniqueEmails.length === 0) {
            failCount++;
            continue;
          }

          const payload: Record<string, any> = {
            template_id: selectedTemplate?.id,
            recipient_email: uniqueEmails.join(','),
            merchant_id: row['MerchantName'] || '',
            variables: {},
            cc: ccEmails.join(','),
            bcc: bccEmails.join(','),
          };
          if (dashboardId) payload.dashboard_id = dashboardId;
          if (chartId) payload.chart_id = chartId;

          (selectedTemplate?.variables || []).forEach((v: string) => {
            const formVal = values[`var_${v}`];
            // Special cases for variables that are manual inputs in the modal
            if (['Deadline', 'note', 'Year'].includes(v)) {
              let val = formVal;
              if (Array.isArray(val) && val.length > 0) val = val[0];
              if (v === 'Deadline' && val) {
                payload.variables[v] = val.format ? val.format('YYYY-MM-DD') : String(val);
              } else {
                payload.variables[v] = val || (v === 'Year' ? new Date().getFullYear().toString() : '');
              }
            } else {
              const mappedCol = formVal?.[0] || v;
              payload.variables[v] =
                typeof row[mappedCol] !== 'undefined' ? String(row[mappedCol]) : '';
            }
          });

          try {
            await SupersetClient.post({
              endpoint: '/api/v1/email-verify/send',
              jsonPayload: payload,
            });
            successCount++;
          } catch (e: any) {
            // 409 = already sent for this confirmation code — not a real failure
            if (e?.status === 409 || e?.statusCode === 409) {
              skipCount++;
            } else {
              failCount++;
            }
          }
        }

        const parts: string[] = [];
        if (successCount > 0) parts.push(t(`${successCount} sent`));
        if (skipCount > 0) parts.push(t(`${skipCount} skipped (already sent)`));
        if (failCount > 0) parts.push(t(`${failCount} failed`));

        setSendResult({
          success: failCount === 0,
          error:
            failCount > 0
              ? t(`${parts.join(', ')}. Contact Admin for failed emails.`)
              : skipCount > 0
                ? t(`${parts.join(', ')}. Duplicate sends are not allowed.`)
                : undefined,
        });

        if (failCount === 0 && skipCount === 0) {
          message.success(t('Successfully sent all emails in bulk!'));
        } else if (failCount === 0 && skipCount > 0) {
          message.warning(t(`${successCount} sent, ${skipCount} skipped (already sent for those codes).`));
        }

      } else {
        const payload: Record<string, any> = {
          template_id: selectedTemplate?.id,
          recipient_email: values.recipient_email,
          merchant_id: values.merchant_id,
          variables: {},
          cc: ccEmails.join(','),
          bcc: bccEmails.join(','),
        };
        if (dashboardId) payload.dashboard_id = dashboardId;
        if (chartId) payload.chart_id = chartId;

        // Collect variable values from form
        (selectedTemplate?.variables || []).forEach((v: string) => {
          let val = values[`var_${v}`];
          if (Array.isArray(val) && val.length > 0) val = val[0];

          if (v === 'Deadline' && val && val.format) {
            payload.variables[v] = val.format('YYYY-MM-DD');
          } else if (v === 'Year' && !val) {
            payload.variables[v] = new Date().getFullYear().toString();
          } else {
            payload.variables[v] = val || '';
          }
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

  //  Helpers 
  const typeLabel = (type: string) =>
    type === 'transaction_verification' ? t('Transaction Verification') : t('Merchant Verification');

  const filteredTemplates = selectedType
    ? templates.filter(t => t.type === selectedType)
    : templates;

  const allowedTypes = config?.allowed_types?.length
    ? config.allowed_types
    : ['transaction_verification', 'merchant_verification'];

  //  Render 
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
                `Emails will be sent for ${selectedRows.length} selected row(s). Use the checkboxes below to choose which recipients to include.`,
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
            <>
              <Form.Item
                name="recipient_targets"
                label={t('Send To')}
                initialValue={['merchant']}
                rules={[{ required: true, message: t('Please select at least one recipient type.') }]}
              >
                <Checkbox.Group
                  options={[
                    { label: t('Merchant Email'), value: 'merchant' },
                    { label: t('Customer Email'), value: 'customer' },
                  ]}
                />
              </Form.Item>
            </>
          )}

          {/* CC / BCC toggle links */}
          <div style={{ marginBottom: 12, display: 'flex', gap: 16 }}>
            {!showCc && (
              <a
                onClick={() => setShowCc(true)}
                style={{ fontSize: 13 }}
                id="send-verify-add-cc"
              >
                <MailOutlined style={{ marginRight: 4 }} />
                {t('Add CC Recipients')}
              </a>
            )}
            {!showBcc && (
              <a
                onClick={() => setShowBcc(true)}
                style={{ fontSize: 13 }}
                id="send-verify-add-bcc"
              >
                <MailOutlined style={{ marginRight: 4 }} />
                {t('Add BCC Recipients')}
              </a>
            )}
          </div>

          {showCc && (
            <Form.Item
              name="additional_recipients"
              label={t('CC')}
              help={t('Separate multiple addresses with commas or semicolons.')}
            >
              <Input.TextArea
                rows={2}
                placeholder={t('e.g. omollo@example.com; kang@example.com')}
                id="send-verify-cc"
              />
            </Form.Item>
          )}

          {showBcc && (
            <Form.Item
              name="bcc_recipients"
              label={t('BCC')}
              help={t('Separate multiple addresses with commas or semicolons.')}
            >
              <Input.TextArea
                rows={2}
                placeholder={t('e.g. compliance@example.com')}
                id="send-verify-bcc"
              />
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

                  // Auto-map variables based on column names
                  if (tpl) {
                    const newValues: Record<string, any> = {};
                    tpl.variables.forEach(v => {
                      if (v === 'Year') {
                        newValues[`var_${v}`] = new Date().getFullYear().toString();
                      } else if (v === 'Deadline') {
                        // Leave empty for DatePicker
                      } else {
                        // Case-insensitive match for columns
                        const matchedCol = columnOptions.find(
                          col => col.toLowerCase() === v.toLowerCase()
                        );
                        if (matchedCol) {
                          newValues[`var_${v}`] = [matchedCol];
                        }
                      }
                    });
                    form.setFieldsValue(newValues);
                  }
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

          {selectedTemplate &&
            (selectedTemplate.variables || []).some(
              v =>
                v !== 'Year' &&
                (v === 'Deadline' ||
                  v === 'note' ||
                  !columnOptions.some(col => col.toLowerCase() === v.toLowerCase())),
            ) && (
              <Alert
                message={t('Manual Input Required')}
                description={t(
                  'Variables that matched dataset columns were automatically mapped and are hidden from this list to keep it simple.',
                )}
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
              />
            )}

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
                  {(selectedTemplate.variables || []).map((v: string) => {
                    if (v === 'Year') return null; // Always hidden

                    // If it's not a special manual field, check if it's auto-mapped to a column
                    if (v !== 'Deadline' && v !== 'note') {
                      const isAutoMapped = columnOptions.some(
                        col => col.toLowerCase() === v.toLowerCase(),
                      );
                      if (isAutoMapped) return null; // Hide auto-mapped variables
                    }

                    let component = (
                      <Select
                        mode="tags"
                        placeholder={
                          isBulk
                            ? t(`Default: Col '${v}'`)
                            : t(`Enter value or col for ${v}`)
                        }
                      >
                        {columnOptions.map((col: string) => (
                          <Option key={col} value={col}>
                            {col}
                          </Option>
                        ))}
                      </Select>
                    );

                    let label: React.ReactNode = <Tag>{`{{${v}}}`}</Tag>;
                    let rules: any[] = [
                      {
                        required: !isBulk && v !== 'note',
                        message: t(`Value or column for {{${v}}} is required.`),
                      },
                    ];

                    if (v === 'Deadline') {
                      label = (
                        <span>
                          <Tag>{`{{${v}}}`}</Tag> {t('Deadline Date')}
                        </span>
                      );
                      component = <DatePicker style={{ width: '100%' }} />;
                    } else if (v === 'note') {
                      label = (
                        <span>
                          <Tag>{`{{${v}}}`}</Tag> {t('Note from Risk Team')}
                        </span>
                      );
                      component = (
                        <TextArea
                          rows={3}
                          placeholder={t('Optional: Add a comment for the merchant...')}
                        />
                      );
                      rules = []; // Not required
                    }

                    return (
                      <Form.Item
                        key={v}
                        name={`var_${v}`}
                        label={label}
                        rules={rules}
                      >
                        {component}
                      </Form.Item>
                    );
                  })}
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
