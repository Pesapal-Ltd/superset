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
 * Email Verification Audit Log page
 * Route: /emailverify/logs/
 *
 * Admin-only view. Shows a paginated, filterable table of all
 * email verification send attempts with expandable payload snapshots.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Table,
  Tag,
  DatePicker,
  Input,
  Select,
  Button,
  Space,
  message,
  Descriptions,
  Typography,
  Tooltip,
  Popconfirm,
} from 'antd';
import {
  SearchOutlined,
  ReloadOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { SupersetClient, t } from '@superset-ui/core';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';

const { RangePicker } = DatePicker;
const { Option } = Select;
const { Text, Paragraph } = Typography;

interface LogEntry {
  id: number;
  template_id: number;
  template_name: string | null;
  template_type: string | null;
  sent_by_fk: number;
  sent_by_name: string | null;
  recipient_email: string;
  merchant_id: string | null;
  dashboard_id: number | null;
  chart_id: number | null;
  payload_snapshot: Record<string, string>;
  status: 'sent' | 'failed';
  error_message: string | null;
  sent_at: string;
  confirmation_code: string | null;
  cc_address: string;
  bcc_address: string;
}

interface LogResponse {
  result: LogEntry[];
  count: number;
  page: number;
  page_size: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Expanded row — shows payload and error
// ─────────────────────────────────────────────────────────────────────────────

function ExpandedRow({ record }: { record: LogEntry }) {
  // Parse comma/semicolon-separated email strings into individual chips
  const emailTags = (raw: string) =>
    raw
      ? raw.split(/[,;]\s*/).map(e => e.trim()).filter(Boolean)
      : [];

  return (
    <div style={{ padding: '8px 16px' }}>
      <Descriptions size="small" column={2} bordered>
        <Descriptions.Item label={t('Template')}>
          {record.template_name || record.template_id}
        </Descriptions.Item>
        <Descriptions.Item label={t('Type')}>
          {record.template_type || '—'}
        </Descriptions.Item>
        <Descriptions.Item label={t('Confirmation Code')}>
          {record.confirmation_code ? (
            <Text code>{record.confirmation_code}</Text>
          ) : (
            '—'
          )}
        </Descriptions.Item>
        <Descriptions.Item label={t('Merchant ID')}>
          {record.merchant_id || '—'}
        </Descriptions.Item>
        <Descriptions.Item label={t('Dashboard ID')}>
          {record.dashboard_id ?? '—'}
        </Descriptions.Item>
        <Descriptions.Item label={t('Chart ID')}>{record.chart_id ?? '—'}</Descriptions.Item>

        {/* CC recipients */}
        <Descriptions.Item label={t('CC')} span={2}>
          {emailTags(record.cc_address).length > 0 ? (
            <Space wrap>
              {emailTags(record.cc_address).map(addr => (
                <Tag key={addr} color="blue" style={{ fontFamily: 'monospace' }}>
                  {addr}
                </Tag>
              ))}
            </Space>
          ) : (
            <Text type="secondary">{t('None')}</Text>
          )}
        </Descriptions.Item>

        {/* BCC recipients */}
        <Descriptions.Item label={t('BCC')} span={2}>
          {emailTags(record.bcc_address).length > 0 ? (
            <Space wrap>
              {emailTags(record.bcc_address).map(addr => (
                <Tag key={addr} color="purple" style={{ fontFamily: 'monospace' }}>
                  {addr}
                </Tag>
              ))}
            </Space>
          ) : (
            <Text type="secondary">{t('None')}</Text>
          )}
        </Descriptions.Item>

        <Descriptions.Item label={t('Payload Variables')} span={2}>
          {Object.entries(record.payload_snapshot || {}).length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {Object.entries(record.payload_snapshot).map(([k, v]) => (
                <li key={k}>
                  <Text code>{`{{${k}}}`}</Text>: {v}
                </li>
              ))}
            </ul>
          ) : (
            <Text type="secondary">{t('No variables')}</Text>
          )}
        </Descriptions.Item>
        {record.error_message && (
          <Descriptions.Item label={t('Error')} span={2}>
            <Paragraph style={{ color: 'red', margin: 0 }}>{record.error_message}</Paragraph>
          </Descriptions.Item>
        )}
      </Descriptions>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function EmailAuditLog() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [resendingId, setResendingId] = useState<number | null>(null);

  // Filters
  const [merchantId, setMerchantId] = useState('');
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);

  // Pagination
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('page_size', String(pageSize));
      if (merchantId) params.set('merchant_id', merchantId);
      if (statusFilter) params.set('status', statusFilter);
      if (dateRange) {
        params.set('date_from', dateRange[0].format('YYYY-MM-DD'));
        params.set('date_to', dateRange[1].format('YYYY-MM-DD'));
      }

      const resp = await SupersetClient.get({
        endpoint: `/api/v1/email-verify/logs?${params.toString()}`,
      });
      const data = resp.json as LogResponse;
      setLogs(data?.result || []);
      setTotalCount(data?.count || 0);
    } catch {
      message.error(t('Failed to load audit logs.'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, merchantId, statusFilter, dateRange]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleSearch = () => {
    setPage(0);
    fetchLogs();
  };

  const handleResend = async (logId: number) => {
    setResendingId(logId);
    try {
      const resp = await SupersetClient.post({
        endpoint: `/api/v1/email-verify/resend/${logId}`,
        jsonPayload: {},
      });
      const data: any = resp.json;
      if (data?.result?.success) {
        message.success(t('Email resent successfully.'));
        // Refresh the log table so the new entry appears
        fetchLogs();
      } else {
        message.error(
          t(`Resend failed: ${data?.result?.error || 'Unknown error'}`),
        );
      }
    } catch (e: any) {
      const errMsg =
        e?.responseJSON?.message ||
        e?.message ||
        t('Failed to resend email.');
      message.error(errMsg);
    } finally {
      setResendingId(null);
    }
  };

  const columns: ColumnsType<LogEntry> = [
    {
      title: t('Sent At'),
      dataIndex: 'sent_at',
      key: 'sent_at',
      render: (d: string) => new Date(d).toLocaleString(),
      sorter: (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime(),
      defaultSortOrder: 'descend',
    },
    {
      title: t('Sent By'),
      dataIndex: 'sent_by_name',
      key: 'sent_by_name',
      render: (name: string | null) => name || '—',
    },
    {
      title: t('Recipient'),
      dataIndex: 'recipient_email',
      key: 'recipient_email',
      ellipsis: true,
    },
    {
      title: t('Confirmation Code'),
      dataIndex: 'confirmation_code',
      key: 'confirmation_code',
      render: (v: string | null) =>
        v ? <Text code style={{ fontSize: 12 }}>{v}</Text> : '—',
    },
    {
      title: t('Merchant'),
      dataIndex: 'merchant_id',
      key: 'merchant_id',
      render: (v: string | null) => v || '—',
    },
    {
      title: t('Template'),
      dataIndex: 'template_name',
      key: 'template_name',
      render: (name: string | null, r: LogEntry) => name || String(r.template_id),
    },
    {
      title: t('Type'),
      dataIndex: 'template_type',
      key: 'template_type',
      render: (type: string | null) =>
        type ? (
          <Tag color={type === 'transaction_verification' ? 'gold' : 'geekblue'}>
            {type === 'transaction_verification' ? t('Transaction') : t('Merchant')}
          </Tag>
        ) : (
          '—'
        ),
    },
    {
      title: t('Status'),
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag color={status === 'sent' ? 'success' : 'error'}>
          {status === 'sent' ? t('Sent') : t('Failed')}
        </Tag>
      ),
    },
    {
      title: t('Actions'),
      key: 'actions',
      width: 100,
      render: (_: unknown, record: LogEntry) => (
        <Popconfirm
          title={
            <span>
              {t('Resend verification email to')}{' '}
              <strong>{record.recipient_email}</strong>
              {t(' using the original template and variables?')}
            </span>
          }
          okText={t('Yes, Resend')}
          cancelText={t('Cancel')}
          onConfirm={() => handleResend(record.id)}
        >
          <Tooltip title={t('Resend email')}>
            <Button
              size="small"
              type="text"
              icon={<SendOutlined />}
              loading={resendingId === record.id}
              id={`resend-btn-${record.id}`}
            >
              {t('Resend')}
            </Button>
          </Tooltip>
        </Popconfirm>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0 }}>{t('Email Verification Audit Log')}</h2>
        <p style={{ color: '#666', margin: '4px 0 0' }}>
          {t('Full record of all verification emails sent through Superset.')}
        </p>
      </div>

      <Space wrap style={{ marginBottom: 16 }}>
        <Input
          prefix={<SearchOutlined />}
          placeholder={t('Filter by Merchant ID')}
          value={merchantId}
          onChange={e => setMerchantId(e.target.value)}
          allowClear
          style={{ width: 220 }}
          id="audit-log-merchant-filter"
        />
        <Select
          allowClear
          placeholder={t('Status')}
          value={statusFilter}
          onChange={(v: any) => setStatusFilter(v as string | undefined)}
          style={{ width: 130 }}
          id="audit-log-status-filter"
        >
          <Option value="sent">{t('Sent')}</Option>
          <Option value="failed">{t('Failed')}</Option>
        </Select>
        <RangePicker
          value={dateRange as any}
          onChange={val => setDateRange(val as [dayjs.Dayjs, dayjs.Dayjs] | null)}
          id="audit-log-date-filter"
        />
        <Button type="primary" onClick={handleSearch}>
          {t('Search')}
        </Button>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => {
            setMerchantId('');
            setStatusFilter(undefined);
            setDateRange(null);
            setPage(0);
          }}
        >
          {t('Reset')}
        </Button>
      </Space>

      <Table<LogEntry>
        rowKey="id"
        columns={columns}
        dataSource={logs}
        loading={loading}
        expandable={{
          expandedRowRender: (record: LogEntry) => <ExpandedRow record={record} />,
        }}
        scroll={{ x: 'max-content' }}
        pagination={{
          current: page + 1,
          pageSize,
          total: totalCount,
          showSizeChanger: true,
          pageSizeOptions: ['10', '25', '50', '100'],
          onChange: (p: number, ps: number | undefined) => {
            setPage(p - 1);
            if (ps !== undefined) setPageSize(ps);
          },
          showTotal: (total: number) => t(`${total} entries total`),
        }}
      />
    </div>
  );
}
