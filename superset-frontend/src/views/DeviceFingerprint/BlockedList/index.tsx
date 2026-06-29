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
 * Blocked Device Fingerprints page
 * Route: /device-fingerprint/logs/
 *
 * Admin-only view. Shows a paginated, filterable table of all
 * blocked device fingerprints with toggle status actions.
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
import { SearchOutlined, ReloadOutlined, LockOutlined, UnlockOutlined } from '@ant-design/icons';
import { SupersetClient, t } from '@superset-ui/core';
import type { ColumnsType } from 'antd/es/table';

const { Option } = Select;
const { Text } = Typography;

interface BlockedLogEntry {
  id: number;
  device_fingerprint: string;
  blocked_by: string;
  blocked_by_id: number;
  blocked_at: string;
  block_reason: string | null;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
  dashboard_id: number | null;
  chart_id: number | null;
}

// Expanded row details
function ExpandedRow({ record }: { record: BlockedLogEntry }) {
  return (
    <div style={{ padding: '8px 16px' }}>
      <Descriptions size="small" column={2} bordered>
        <Descriptions.Item label={t('Device Fingerprint')}>
          <Text code copyable>{record.device_fingerprint}</Text>
        </Descriptions.Item>
        <Descriptions.Item label={t('Status')}>
          <Tag color={record.status === 'active' ? 'error' : 'default'}>
            {record.status.toUpperCase()}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label={t('Blocked By')}>{record.blocked_by}</Descriptions.Item>
        <Descriptions.Item label={t('Blocked At')}>
          {record.blocked_at ? new Date(record.blocked_at).toLocaleString() : '—'}
        </Descriptions.Item>
        <Descriptions.Item label={t('Block Reason')} span={2}>
          {record.block_reason || '—'}
        </Descriptions.Item>
        <Descriptions.Item label={t('Dashboard ID')}>{record.dashboard_id ?? '—'}</Descriptions.Item>
        <Descriptions.Item label={t('Chart ID')}>{record.chart_id ?? '—'}</Descriptions.Item>
        <Descriptions.Item label={t('Created At')}>
          {record.created_at ? new Date(record.created_at).toLocaleString() : '—'}
        </Descriptions.Item>
        <Descriptions.Item label={t('Updated At')}>
          {record.updated_at ? new Date(record.updated_at).toLocaleString() : '—'}
        </Descriptions.Item>
      </Descriptions>
    </div>
  );
}

export default function BlockedList() {
  const [logs, setLogs] = useState<BlockedLogEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);

  // Filters
  const [fingerprint, setFingerprint] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>('active');

  // Pagination
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('page_size', String(pageSize));
      if (fingerprint) params.set('fingerprint', fingerprint);
      if (statusFilter) params.set('status', statusFilter);

      const resp = await SupersetClient.get({
        endpoint: `/api/v1/device-fingerprint/blocked?${params.toString()}`,
      });
      const data = resp.json;
      setLogs(data?.result || []);
      setTotalCount(data?.count || 0);
    } catch {
      message.error(t('Failed to load blocked device fingerprints.'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, fingerprint, statusFilter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleSearch = () => {
    setPage(0);
    fetchLogs();
  };

  const handleStatusToggle = async (record: BlockedLogEntry) => {
    const nextStatus = record.status === 'active' ? 'inactive' : 'active';
    try {
      await SupersetClient.request({
        method: 'PATCH',
        endpoint: `/api/v1/device-fingerprint/blocked/${record.id}`,
        jsonPayload: { status: nextStatus },
      });
      message.success(
        nextStatus === 'inactive'
          ? t('Device fingerprint unblocked successfully.')
          : t('Device fingerprint re-blocked successfully.'),
      );
      fetchLogs();
    } catch {
      message.error(t('Failed to update device fingerprint status.'));
    }
  };

  const columns: ColumnsType<BlockedLogEntry> = [
    {
      title: t('Blocked At'),
      dataIndex: 'blocked_at',
      key: 'blocked_at',
      render: (d: string) => new Date(d).toLocaleString(),
      sorter: (a, b) => new Date(a.blocked_at).getTime() - new Date(b.blocked_at).getTime(),
      defaultSortOrder: 'descend',
    },
    {
      title: t('Device Fingerprint'),
      dataIndex: 'device_fingerprint',
      key: 'device_fingerprint',
      render: (code: string) => <Text code>{code}</Text>,
    },
    {
      title: t('Blocked By'),
      dataIndex: 'blocked_by',
      key: 'blocked_by',
    },
    {
      title: t('Block Reason'),
      dataIndex: 'block_reason',
      key: 'block_reason',
      ellipsis: true,
      render: (v: string | null) => v || '—',
    },
    {
      title: t('Status'),
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag color={status === 'active' ? 'error' : 'default'}>
          {status.toUpperCase()}
        </Tag>
      ),
    },
    {
      title: t('Actions'),
      key: 'actions',
      render: (_, record) => (
        <Button
          type="link"
          size="small"
          icon={record.status === 'active' ? <UnlockOutlined /> : <LockOutlined />}
          onClick={() => handleStatusToggle(record)}
          style={{ color: record.status === 'active' ? '#52c41a' : '#ff4d4f', padding: 0 }}
        >
          {record.status === 'active' ? t('Unblock') : t('Re-block')}
        </Button>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0 }}>{t('Blocked Device Fingerprints')}</h2>
        <p style={{ color: '#666', margin: '4px 0 0' }}>
          {t('A record of all blocked device fingerprints and their active status across the platform.')}
        </p>
      </div>

      <Space wrap style={{ marginBottom: 16 }}>
        <Input
          prefix={<SearchOutlined />}
          placeholder={t('Filter by Device Fingerprint')}
          value={fingerprint}
          onChange={e => setFingerprint(e.target.value)}
          allowClear
          style={{ width: 250 }}
          id="fingerprint-log-code-filter"
        />
        <Select
          allowClear
          placeholder={t('Status')}
          value={statusFilter}
          onChange={(v: any) => setStatusFilter(v as string | undefined)}
          style={{ width: 130 }}
          id="fingerprint-log-status-filter"
        >
          <Option value="active">{t('Active')}</Option>
          <Option value="inactive">{t('Inactive')}</Option>
        </Select>
        <Button type="primary" onClick={handleSearch}>
          {t('Search')}
        </Button>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => {
            setFingerprint('');
            setStatusFilter('active');
            setPage(0);
          }}
        >
          {t('Reset')}
        </Button>
      </Space>

      <Table<BlockedLogEntry>
        rowKey="id"
        columns={columns}
        dataSource={logs}
        loading={loading}
        expandable={{
          expandedRowRender: (record: BlockedLogEntry) => <ExpandedRow record={record} />,
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
    </div>
  );
}
