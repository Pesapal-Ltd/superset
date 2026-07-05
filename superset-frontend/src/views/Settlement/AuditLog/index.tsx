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
 * Settlement Audit Log page
 * Route: /settlement/logs/
 *
 * Admin-only view. Shows a paginated, filterable table of all
 * settlement (hold/release funds) actions with expandable details.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Table,
  Tag,
  Input,
  Select,
  Button,
  Space,
  message,
  Descriptions,
  Typography,
} from 'antd';
import { SearchOutlined, ReloadOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { SupersetClient, t } from '@superset-ui/core';
import type { ColumnsType } from 'antd/es/table';
import SettlementModal from 'src/components/Settlement/SettlementModal';

const { Option } = Select;
const { Text } = Typography;

interface SettlementLogEntry {
  id: number;
  dashboard_id: number | null;
  chart_id: number | null;
  action: 'hold' | 'release';
  confirmation_code: string;
  merchant_recovery_guid?: string | null;
  merchant_id: string | null;
  currency: string | null;
  country: string | null;
  amount: string | null;
  reason: string;
  task_id: string | null;
  status: 'pending' | 'success' | 'failed';
  error_type?: string | null;
  error_message: string | null;
  initiated_by_fk: number | null;
  initiated_by: string | null;
  request_payload: any | null;
  response_snapshot: any | null;
  initiated_at: string;
  completed_at: string | null;
  is_released?: boolean;
}


// Expanded row — shows more details and errors

function ExpandedRow({ record }: { record: SettlementLogEntry }) {
  return (
    <div style={{ padding: '8px 16px' }}>
      <Descriptions size="small" column={2} bordered>
        <Descriptions.Item label={t('Action')}>
          <Tag color={record.action === 'hold' ? 'orange' : 'green'}>
            {record.action.toUpperCase()}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label={t('Status')}>
          <Tag color={record.status === 'success' ? 'success' : record.status === 'failed' ? 'error' : 'processing'}>
            {record.status.toUpperCase()}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label={t('Confirmation Code')}>
          <Text copyable>{record.confirmation_code}</Text>
        </Descriptions.Item>
        <Descriptions.Item label={t('Merchant ID')}>{record.merchant_id ?? '—'}</Descriptions.Item>
        {record.merchant_recovery_guid && (
          <Descriptions.Item label={t('Recovery GUID')} span={2}>
            <Text copyable code>{record.merchant_recovery_guid}</Text>
          </Descriptions.Item>
        )}
        <Descriptions.Item label={t('Amount')}>
          {record.amount ? `${record.currency ?? ''} ${record.amount}` : '—'}
        </Descriptions.Item>
        <Descriptions.Item label={t('Reason')}>{record.reason}</Descriptions.Item>
        <Descriptions.Item label={t('Dashboard ID')}>{record.dashboard_id ?? '—'}</Descriptions.Item>
        <Descriptions.Item label={t('Chart ID')}>{record.chart_id ?? '—'}</Descriptions.Item>
        <Descriptions.Item label={t('Initiated By')}>{record.initiated_by ?? 'System'}</Descriptions.Item>
        <Descriptions.Item label={t('Completed At')}>
          {record.completed_at ? new Date(record.completed_at).toLocaleString() : '—'}
        </Descriptions.Item>
        <Descriptions.Item label={t('Task ID')} span={2}>
          {record.task_id ? <Text code>{record.task_id}</Text> : '—'}
        </Descriptions.Item>
        {record.request_payload && (
          <Descriptions.Item label={t('Request Body')} span={2}>
            <pre style={{
              backgroundColor: '#f5f5f5',
              padding: '8px',
              borderRadius: '4px',
              maxHeight: '200px',
              overflow: 'auto',
              fontSize: '11px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {JSON.stringify(record.request_payload, null, 2)}
            </pre>
          </Descriptions.Item>
        )}
        {record.response_snapshot && (
          <Descriptions.Item label={t('Response Body')} span={2}>
            <pre style={{
              backgroundColor: '#f5f5f5',
              padding: '8px',
              borderRadius: '4px',
              maxHeight: '200px',
              overflow: 'auto',
              fontSize: '11px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {JSON.stringify(record.response_snapshot, null, 2)}
            </pre>
          </Descriptions.Item>
        )}
        {(record.error_message || record.error_type) && (
          <Descriptions.Item label={t('Error Details')} span={2}>
            <div style={{
              backgroundColor: '#fff1f0',
              border: '1px solid #ffa39e',
              padding: '8px',
              borderRadius: '4px',
              maxHeight: '150px',
              overflow: 'auto',
              color: '#cf1322',
              fontSize: '11px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: 'monospace',
            }}>
              {record.error_type && (
                <div style={{ fontWeight: 'bold', marginBottom: record.error_message ? '4px' : '0' }}>
                  {t('Error Type:')} {record.error_type}
                </div>
              )}
              {record.error_message && (
                <div>{record.error_message}</div>
              )}
            </div>
          </Descriptions.Item>
        )}
      </Descriptions>
    </div>
  );
}

// Main component

export default function SettlementAuditLog() {
  const [logs, setLogs] = useState<SettlementLogEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);

  // Filters
  const [confirmationCode, setConfirmationCode] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [actionFilter, setActionFilter] = useState<string | undefined>(undefined);

  // Pagination
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  // Settlement Modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<SettlementLogEntry | null>(null);
  const [settlementConfig, setSettlementConfig] = useState<any>({ enabled: true });

  const handleReleaseClick = async (record: SettlementLogEntry) => {
    setSelectedRecord(record);
    try {
      const resp = await SupersetClient.get({
        endpoint: `/api/v1/settlement/config?dashboard_id=${record.dashboard_id}`,
      });
      setSettlementConfig(resp.json.result || { enabled: true });
    } catch {
      setSettlementConfig({ enabled: true });
    } finally {
      setModalVisible(true);
    }
  };

  const handleRetryClick = async (record: SettlementLogEntry) => {
    try {
      await SupersetClient.post({
        endpoint: `/api/v1/settlement/retry/${record.id}`,
      });
      message.success(t('Action re-enqueued successfully.'));
      fetchLogs();
    } catch (err: any) {
      const msg = err?.message || t('Failed to retry action.');
      message.error(msg);
    }
  };

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('page_size', String(pageSize));
      if (confirmationCode) params.set('confirmation_code', confirmationCode);
      if (statusFilter) params.set('status', statusFilter);
      if (actionFilter) params.set('action', actionFilter);

      const resp = await SupersetClient.get({
        endpoint: `/api/v1/settlement/logs?${params.toString()}`,
      });
      // The Superset implementation uses 'result' for the array and also provides 'count'
      const data = resp.json;
      setLogs(data?.result || []);
      setTotalCount(data?.count || 0);
    } catch {
      message.error(t('Failed to load settlement audit logs.'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, confirmationCode, statusFilter, actionFilter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleSearch = () => {
    setPage(0);
    fetchLogs();
  };

  const columns: ColumnsType<SettlementLogEntry> = [
    {
      title: t('Initiated At'),
      dataIndex: 'initiated_at',
      key: 'initiated_at',
      render: (d: string) => new Date(d).toLocaleString(),
      sorter: (a, b) => new Date(a.initiated_at).getTime() - new Date(b.initiated_at).getTime(),
      defaultSortOrder: 'descend',
    },
    {
      title: t('Initiated By'),
      dataIndex: 'initiated_by',
      key: 'initiated_by',
      render: (v: string | null) => v || 'System',
    },
    {
      title: t('Action'),
      dataIndex: 'action',
      key: 'action',
      render: (action: string) => (
        <Tag color={action === 'hold' ? 'orange' : 'green'}>
          {action.toUpperCase()}
        </Tag>
      ),
    },
    {
      title: t('Confirmation Code'),
      dataIndex: 'confirmation_code',
      key: 'confirmation_code',
      render: (code: string) => <Text code>{code}</Text>,
    },
    {
      title: t('Merchant'),
      dataIndex: 'merchant_id',
      key: 'merchant_id',
      render: (v: string | null) => v || '—',
    },
    {
      title: t('Amount'),
      key: 'amount',
      render: (_, r) => r.amount ? `${r.currency || ''} ${r.amount}` : '—',
    },
    {
      title: t('Status'),
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag color={status === 'success' ? 'success' : status === 'failed' ? 'error' : 'processing'}>
          {status.toUpperCase()}
        </Tag>
      ),
    },
    {
      dataIndex: 'reason',
      key: 'reason',
      ellipsis: true,
    },
    {
      title: t('Actions'),
      key: 'actions',
      render: (_, record) => {
        const canRelease =
          record.action === 'hold' &&
          record.status === 'success' &&
          !record.is_released;

        const canRetry = record.status === 'failed';

        if (!canRelease && !canRetry) return null;

        return (
          <Space size="middle">
            {canRelease && (
              <Button
                type="link"
                size="small"
                icon={<PlayCircleOutlined />}
                onClick={() => handleReleaseClick(record)}
                style={{ color: '#52c41a', padding: 0 }}
              >
                {t('Release Funds')}
              </Button>
            )}
            {canRetry && (
              <Button
                type="link"
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => handleRetryClick(record)}
                style={{ color: '#1890ff', padding: 0 }}
              >
                {t('Retry')}
              </Button>
            )}
          </Space>
        );
      }
    }
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0 }}>{t('Settlement Audit Log')}</h2>
        <p style={{ color: '#666', margin: '4px 0 0' }}>
          {t('A record of all Hold Funds and Release Funds actions performed on transactions.')}
        </p>
      </div>

      <Space wrap style={{ marginBottom: 16 }}>
        <Input
          prefix={<SearchOutlined />}
          placeholder={t('Filter by Confirmation Code')}
          value={confirmationCode}
          onChange={e => setConfirmationCode(e.target.value)}
          allowClear
          style={{ width: 250 }}
          id="settlement-log-code-filter"
        />
        <Select
          allowClear
          placeholder={t('Action')}
          value={actionFilter}
          onChange={(v: any) => setActionFilter(v as string | undefined)}
          style={{ width: 130 }}
          id="settlement-log-action-filter"
        >
          <Option value="hold">{t('Hold')}</Option>
          <Option value="release">{t('Release')}</Option>
        </Select>
        <Select
          allowClear
          placeholder={t('Status')}
          value={statusFilter}
          onChange={(v: any) => setStatusFilter(v as string | undefined)}
          style={{ width: 130 }}
          id="settlement-log-status-filter"
        >
          <Option value="pending">{t('Pending')}</Option>
          <Option value="success">{t('Success')}</Option>
          <Option value="failed">{t('Failed')}</Option>
        </Select>
        <Button type="primary" onClick={handleSearch}>
          {t('Search')}
        </Button>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => {
            setConfirmationCode('');
            setStatusFilter(undefined);
            setActionFilter(undefined);
            setPage(0);
          }}
        >
          {t('Reset')}
        </Button>
      </Space>

      <Table<SettlementLogEntry>
        rowKey="id"
        columns={columns}
        dataSource={logs}
        loading={loading}
        expandable={{
          expandedRowRender: (record: SettlementLogEntry) => <ExpandedRow record={record} />,
        }}
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

      {selectedRecord && (
        <SettlementModal
          visible={modalVisible}
          action="release"
          dashboardId={selectedRecord.dashboard_id || 0}
          chartId={selectedRecord.chart_id || 0}
          onClose={() => {
            setModalVisible(false);
            fetchLogs();
          }}
          selectedRows={[{
            ...selectedRecord,
            [settlementConfig?.confirmation_code_column || 'ConfirmationCode']: selectedRecord.confirmation_code
          }]}
          settlementConfig={settlementConfig}
        />
      )}
    </div>
  );
}
