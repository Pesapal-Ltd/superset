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
 * SettlementModal
 *
 * 4-step modal triggered from the chart action menu:
 *   Step 1 — Summary: lists selected ConfirmationCodes + action badge
 *   Step 2 — Reason:  user edits / confirms the reason (if require_reason_input)
 *   Step 3 — Confirm: explicit "Are you sure?" confirmation dialog
 *   Step 4 — Progress: per-row status polling of Celery tasks
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Alert,
  Badge,
  Button,
  Divider,
  Form,
  Input,
  Modal,
  Progress,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { SupersetClient, t } from '@superset-ui/core';

const { Text, Title, Paragraph } = Typography;
const { TextArea } = Input;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface SettlementConfig {
  enabled: boolean;
  allowed_roles?: string[];
  confirmation_code_column?: string;
  default_reason?: string;
  require_reason_input?: boolean;
}

interface SettlementModalProps {
  visible: boolean;
  action: 'hold' | 'release';
  dashboardId: number;
  chartId: number;
  selectedRows: Record<string, any>[];
  settlementConfig: SettlementConfig;
  onClose: () => void;
}

interface TaskStatus {
  task_id: string;
  confirmation_code: string;
  celery_state: string;       // PENDING | STARTED | SUCCESS | FAILURE | RETRY
  status: 'pending' | 'success' | 'failed';
  merchant_id?: string;
  currency?: string;
  country?: string;
  amount?: string;
  error_message?: string;
  completed_at?: string;
}

type Step = 'summary' | 'reason' | 'confirm' | 'progress';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 3000;

const actionLabel = (action: 'hold' | 'release') =>
  action === 'hold' ? t('Hold Funds') : t('Release Funds');

const actionColor = (action: 'hold' | 'release') =>
  action === 'hold' ? '#fa8c16' : '#52c41a';

const TaskStatusIcon = ({ status }: { status: TaskStatus['status'] }) => {
  if (status === 'success')
    return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
  if (status === 'failed')
    return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />;
  return <LoadingOutlined style={{ color: '#1890ff' }} />;
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function SettlementModal({
  visible,
  action,
  dashboardId,
  chartId,
  selectedRows,
  settlementConfig,
  onClose,
}: SettlementModalProps) {
  const [form] = Form.useForm();
  const [currentStep, setCurrentStep] = useState<Step>('summary');
  const [submitting, setSubmitting] = useState(false);
  const [taskStatuses, setTaskStatuses] = useState<TaskStatus[]>([]);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const codeColumn = settlementConfig?.confirmation_code_column || 'ConfirmationCode';
  const defaultReason = settlementConfig?.default_reason || 'RiskVerification';
  const requireReasonInput = settlementConfig?.require_reason_input !== false;

  // Extract confirmation codes from the selected rows
  const codes: string[] = selectedRows
    .map(row => String(row[codeColumn] || '').trim())
    .filter(Boolean);

  // ── Reset on open ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (visible) {
      setCurrentStep(requireReasonInput ? 'summary' : 'confirm');
      setTaskStatuses([]);
      setSubmitting(false);
      form.setFieldsValue({ reason: defaultReason });
      if (pollingRef.current) clearInterval(pollingRef.current);
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Poll task statuses ────────────────────────────────────────────────────
  const pollTaskStatuses = useCallback(
    async (statuses: TaskStatus[]) => {
      const pending = statuses.filter(
        s => s.status === 'pending' && s.task_id,
      );
      if (pending.length === 0) {
        if (pollingRef.current) clearInterval(pollingRef.current);
        return;
      }

      const updated = await Promise.all(
        statuses.map(async s => {
          if (s.status !== 'pending' || !s.task_id) return s;
          try {
            const resp = await SupersetClient.get({
              endpoint: `/api/v1/settlement/task-status/${s.task_id}`,
            });
            const data: any = (resp.json as any)?.result || resp.json;
            return {
              ...s,
              status: data.status || s.status,
              merchant_id: data.merchant_id || s.merchant_id,
              currency: data.currency || s.currency,
              country: data.country || s.country,
              amount: data.amount || s.amount,
              error_message: data.error_message || s.error_message,
              completed_at: data.completed_at || s.completed_at,
            } as TaskStatus;
          } catch {
            return s;
          }
        }),
      );

      setTaskStatuses(updated);

      const stillPending = updated.filter(s => s.status === 'pending');
      if (stillPending.length === 0 && pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    },
    [],
  );

  // ── Execute ───────────────────────────────────────────────────────────────
  const handleExecute = async () => {
    try {
      const values = await form.validateFields();
      const reason: string = (values.reason || defaultReason).trim() || defaultReason;

      setSubmitting(true);
      setCurrentStep('progress');

      const payload = {
        action,
        dashboard_id: dashboardId,
        chart_id: chartId,
        rows: selectedRows,
        reason,
      };

      const resp = await SupersetClient.post({
        endpoint: '/api/v1/settlement/execute',
        jsonPayload: payload,
      });

      const result: any = (resp.json as any)?.result;
      const taskIds: string[] = result?.task_ids || [];

      // Build initial task status list (one per code)
      const initialStatuses: TaskStatus[] = codes.map((code, idx) => ({
        task_id: taskIds[idx] || '',
        confirmation_code: code,
        celery_state: 'PENDING',
        status: 'pending',
      }));
      setTaskStatuses(initialStatuses);

      // Start polling
      pollingRef.current = setInterval(() => {
        setTaskStatuses(prev => {
          pollTaskStatuses(prev);
          return prev;
        });
      }, POLL_INTERVAL_MS);

      // First poll immediately
      setTimeout(() => pollTaskStatuses(initialStatuses), 1000);
    } catch (err: any) {
      if (err?.errorFields) return; // Ant validation
      message.error(err?.message || t('Failed to submit settlement action.'));
      setCurrentStep('confirm');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Computed values ───────────────────────────────────────────────────────
  const successCount = taskStatuses.filter(s => s.status === 'success').length;
  const failedCount = taskStatuses.filter(s => s.status === 'failed').length;
  const pendingCount = taskStatuses.filter(s => s.status === 'pending').length;
  const totalCount = taskStatuses.length || codes.length;
  const allDone = totalCount > 0 && pendingCount === 0;

  const progressPercent =
    totalCount > 0
      ? Math.round(((successCount + failedCount) / totalCount) * 100)
      : 0;

  // ── Footer buttons per step ───────────────────────────────────────────────
  const renderFooter = () => {
    if (currentStep === 'summary') {
      return [
        <Button key="cancel" onClick={onClose}>
          {t('Cancel')}
        </Button>,
        <Button
          key="next"
          type="primary"
          onClick={() => setCurrentStep(requireReasonInput ? 'reason' : 'confirm')}
          disabled={codes.length === 0}
        >
          {t('Next')} →
        </Button>,
      ];
    }
    if (currentStep === 'reason') {
      return [
        <Button key="back" onClick={() => setCurrentStep('summary')}>
          ← {t('Back')}
        </Button>,
        <Button
          key="next"
          type="primary"
          onClick={() => setCurrentStep('confirm')}
        >
          {t('Next')} →
        </Button>,
      ];
    }
    if (currentStep === 'confirm') {
      return [
        <Button
          key="back"
          onClick={() =>
            setCurrentStep(requireReasonInput ? 'reason' : 'summary')
          }
        >
          ← {t('Back')}
        </Button>,
        <Button
          key="confirm"
          type="primary"
          danger={action === 'hold'}
          loading={submitting}
          onClick={handleExecute}
          id="settlement-confirm-btn"
        >
          {action === 'hold' ? t('Confirm Hold Funds') : t('Confirm Release Funds')}
        </Button>,
      ];
    }
    // Progress step
    return [
      <Button
        key="close"
        type={allDone ? 'primary' : 'default'}
        onClick={onClose}
      >
        {allDone ? t('Done') : t('Close')}
      </Button>,
    ];
  };

  // ── Title ─────────────────────────────────────────────────────────────────
  const titleIcon =
    action === 'hold' ? (
      <PauseCircleOutlined style={{ color: '#fa8c16', marginRight: 8 }} />
    ) : (
      <PlayCircleOutlined style={{ color: '#52c41a', marginRight: 8 }} />
    );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Modal
      title={
        <Space>
          {titleIcon}
          {actionLabel(action)}
          <Tag color={action === 'hold' ? 'orange' : 'green'}>
            {action === 'hold' ? t('Status: 1') : t('Status: 0')}
          </Tag>
        </Space>
      }
      visible={visible}
      width={620}
      onCancel={onClose}
      footer={renderFooter()}
      destroyOnClose
    >
      {/* ── STEP 1: Summary ──────────────────────────────────────────────── */}
      {currentStep === 'summary' && (
        <>
          <Alert
            type={action === 'hold' ? 'warning' : 'success'}
            icon={
              action === 'hold' ? (
                <PauseCircleOutlined />
              ) : (
                <PlayCircleOutlined />
              )
            }
            showIcon
            message={
              action === 'hold'
                ? t('You are about to place a Hold Funds request on %s transaction(s).', codes.length)
                : t('You are about to release funds on %s transaction(s).', codes.length)
            }
            style={{ marginBottom: 16 }}
          />

          {codes.length === 0 && (
            <Alert
              type="error"
              showIcon
              message={t(
                'No ConfirmationCode found in selected rows (column: "%s"). Please check the settlement configuration.',
                codeColumn,
              )}
            />
          )}

          {codes.length > 0 && (
            <>
              <Text strong>{t('Selected Transactions:')}</Text>
              <div
                style={{
                  marginTop: 8,
                  maxHeight: 200,
                  overflowY: 'auto',
                  border: '1px solid #f0f0f0',
                  borderRadius: 4,
                  padding: '8px 12px',
                  background: '#fafafa',
                }}
              >
                {codes.map((code, i) => (
                  <div key={i} style={{ marginBottom: 4 }}>
                    <Tag
                      color={action === 'hold' ? 'orange' : 'green'}
                      style={{ fontFamily: 'monospace' }}
                    >
                      {code}
                    </Tag>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ── STEP 2: Reason input ─────────────────────────────────────────── */}
      {currentStep === 'reason' && (
        <Form form={form} layout="vertical">
          <Alert
            type="info"
            showIcon
            message={t(
              'Provide a reason for this action. It will be included in the settlement payload as the "description" field.',
            )}
            style={{ marginBottom: 16 }}
          />
          <Form.Item
            name="reason"
            label={t('Reason / Description')}
            rules={[{ required: true, message: t('Reason is required.') }]}
          >
            <TextArea
              rows={3}
              placeholder={defaultReason}
              id="settlement-reason-input"
            />
          </Form.Item>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('Default: "%s"', defaultReason)}
          </Text>
        </Form>
      )}

      {/* ── STEP 3: Confirm ──────────────────────────────────────────────── */}
      {currentStep === 'confirm' && (
        <>
          <Alert
            type="warning"
            icon={<ExclamationCircleOutlined />}
            showIcon
            message={
              action === 'hold'
                ? t(
                    'You are about to HOLD FUNDS on %s transaction(s). This will prevent withdrawals for the affected merchants.',
                    codes.length,
                  )
                : t(
                    'You are about to RELEASE FUNDS on %s transaction(s). This will re-enable withdrawals for the affected merchants.',
                    codes.length,
                  )
            }
            style={{ marginBottom: 16 }}
          />
          <Paragraph>
            <Text strong>{t('Action: ')}</Text>
            <Tag color={actionColor(action)} style={{ fontWeight: 600 }}>
              {actionLabel(action)}
            </Tag>
          </Paragraph>
          <Paragraph>
            <Text strong>{t('Transactions: ')}</Text>
            <Text>{codes.length}</Text>
          </Paragraph>
          <Paragraph>
            <Text strong>{t('Reason: ')}</Text>
            <Text code>
              {form.getFieldValue('reason') || defaultReason}
            </Text>
          </Paragraph>
          <Paragraph style={{ marginBottom: 0 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t(
                'Tasks will be processed in the background. You can track their status on this screen.',
              )}
            </Text>
          </Paragraph>
        </>
      )}

      {/* ── STEP 4: Progress ─────────────────────────────────────────────── */}
      {currentStep === 'progress' && (
        <>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <Title level={5}>
              {allDone ? t('Processing complete') : t('Processing in background...')}
            </Title>
            <Progress
              percent={progressPercent}
              status={
                allDone
                  ? failedCount > 0
                    ? 'exception'
                    : 'success'
                  : 'active'
              }
              style={{ maxWidth: 400, margin: '0 auto' }}
            />
            <div style={{ marginTop: 8 }}>
              <Space size="large">
                <Badge
                  count={successCount}
                  showZero
                  style={{ backgroundColor: '#52c41a' }}
                >
                  <Text style={{ paddingRight: 4 }}>{t('Success')}</Text>
                </Badge>
                <Badge count={pendingCount} showZero color="#1890ff">
                  <Text style={{ paddingRight: 4 }}>{t('Pending')}</Text>
                </Badge>
                <Badge count={failedCount} showZero>
                  <Text style={{ paddingRight: 4 }}>{t('Failed')}</Text>
                </Badge>
              </Space>
            </div>
          </div>

          <Divider />

          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {taskStatuses.map((ts, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  padding: '8px 0',
                  borderBottom: '1px solid #f0f0f0',
                }}
              >
                <div style={{ flex: 1 }}>
                  <Space>
                    <TaskStatusIcon status={ts.status} />
                    <Text code style={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {ts.confirmation_code}
                    </Text>
                    {ts.merchant_id && (
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {ts.merchant_id} · {ts.currency} {ts.amount}
                      </Text>
                    )}
                  </Space>
                  {ts.error_message && (
                    <div style={{ marginTop: 4 }}>
                      <Text type="danger" style={{ fontSize: 11 }}>
                        {ts.error_message}
                      </Text>
                    </div>
                  )}
                </div>
                <Tag
                  color={
                    ts.status === 'success'
                      ? 'green'
                      : ts.status === 'failed'
                      ? 'red'
                      : 'blue'
                  }
                >
                  {ts.status === 'pending' ? (
                    <Spin size="small" style={{ marginRight: 4 }} />
                  ) : null}
                  {ts.status}
                </Tag>
              </div>
            ))}
          </div>

          {allDone && failedCount > 0 && (
            <Alert
              type="warning"
              showIcon
              message={t(
                '%s of %s transaction(s) failed. Check the Settlement Audit Log under Manage menu for details.',
                failedCount,
                totalCount,
              )}
              style={{ marginTop: 16 }}
            />
          )}

          {allDone && failedCount === 0 && (
            <Alert
              type="success"
              showIcon
              message={t(
                'All %s transaction(s) processed successfully.',
                successCount,
              )}
              style={{ marginTop: 16 }}
            />
          )}
        </>
      )}
    </Modal>
  );
}
