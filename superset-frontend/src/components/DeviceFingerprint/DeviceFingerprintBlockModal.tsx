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
import React, { useState, useEffect } from 'react';
import { Modal, Button, Input, List, Typography, Space, Spin, Alert } from 'antd';
import { WarningOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { SupersetClient, t } from '@superset-ui/core';

const { Text, Title, Paragraph } = Typography;
const { TextArea } = Input;

interface DeviceFingerprintConfig {
  enabled: boolean;
  allowed_roles?: string[];
  fingerprint_column?: string;
}

interface DeviceFingerprintBlockModalProps {
  visible: boolean;
  dashboardId: number;
  chartId: number;
  selectedRows: Record<string, any>[];
  deviceFingerprintConfig: DeviceFingerprintConfig;
  onClose: () => void;
}

export default function DeviceFingerprintBlockModal({
  visible,
  dashboardId,
  chartId,
  selectedRows,
  deviceFingerprintConfig,
  onClose,
}: DeviceFingerprintBlockModalProps) {
  const [step, setStep] = useState<'confirm' | 'submitting' | 'result'>('confirm');
  const [blockReason, setBlockReason] = useState('');
  const [submitResult, setSubmitResult] = useState<{
    blocked: number;
    skipped: number;
    error?: string;
  } | null>(null);

  const fingerprintColumn = deviceFingerprintConfig.fingerprint_column || 'DeviceFingerPrint';

  // Extract unique, non-empty fingerprints from selected rows
  const fingerprints = Array.from(
    new Set(
      selectedRows
        .map(row => row[fingerprintColumn])
        .filter(val => typeof val === 'string' && val.trim() !== '')
        .map(val => val.trim()),
    ),
  );

  useEffect(() => {
    if (visible) {
      setStep('confirm');
      setBlockReason('');
      setSubmitResult(null);
    }
  }, [visible]);

  const handleConfirm = async () => {
    setStep('submitting');
    try {
      const response = await SupersetClient.post({
        endpoint: '/api/v1/device-fingerprint/block',
        jsonPayload: {
          dashboard_id: dashboardId,
          chart_id: chartId,
          rows: selectedRows,
          block_reason: blockReason,
        },
      });

      const data = response.json.result;
      setSubmitResult({
        blocked: data.blocked,
        skipped: data.skipped,
      });
      setStep('result');
    } catch (err: any) {
      const errMsg = err?.message || t('An error occurred while blocking device fingerprints.');
      setSubmitResult({
        blocked: 0,
        skipped: 0,
        error: errMsg,
      });
      setStep('result');
    }
  };

  return (
    <Modal
      title={
        <Space>
          <WarningOutlined style={{ color: '#ff4d4f' }} />
          <span>{t('Block Device Fingerprint')}</span>
        </Space>
      }
      visible={visible}
      onCancel={onClose}
      footer={
        step === 'confirm' ? [
          <Button key="back" onClick={onClose}>
            {t('Cancel')}
          </Button>,
          <Button
            key="submit"
            type="primary"
            danger
            disabled={fingerprints.length === 0}
            onClick={handleConfirm}
          >
            {t('Confirm Block')}
          </Button>,
        ] : step === 'result' ? [
          <Button key="close" type="primary" onClick={onClose}>
            {t('Close')}
          </Button>,
        ] : null
      }
      destroyOnClose
      width={600}
    >
      {step === 'confirm' && (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Alert
            message={t('Warning')}
            description={t(
              'Blocking a device fingerprint will restrict transactions associated with that device accross the system.',
            )}
            type="warning"
            showIcon
          />

          <div>
            <Title level={5}>{t('Selected Fingerprints to Block (%s)', fingerprints.length)}</Title>
            {fingerprints.length === 0 ? (
              <Text type="danger">
                {t('No valid device fingerprints found in the selected rows (column name: %s).', fingerprintColumn)}
              </Text>
            ) : (
              <List
                size="small"
                bordered
                dataSource={fingerprints}
                renderItem={item => (
                  <List.Item>
                    <Text code>{item}</Text>
                  </List.Item>
                )}
                style={{ maxHeight: 150, overflow: 'auto' }}
              />
            )}
          </div>

          <div>
            <Title level={5}>{t('Reason for Blocking')}</Title>
            <TextArea
              rows={4}
              placeholder={t('Enter the reason for blocking this device fingerprint...')}
              value={blockReason}
              onChange={e => setBlockReason(e.target.value)}
            />
          </div>
        </Space>
      )}

      {step === 'submitting' && (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Spin size="large" />
          <Paragraph style={{ marginTop: 16 }}>{t('Saving the Device Fingerprint...')}</Paragraph>
        </div>
      )}

      {step === 'result' && submitResult && (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          {submitResult.error ? (
            <>
              <CloseCircleOutlined style={{ fontSize: 50, color: '#ff4d4f' }} />
              <Title level={4} style={{ marginTop: 16 }}>{t('Blocking Failed')}</Title>
              <Paragraph type="danger">{submitResult.error}</Paragraph>
            </>
          ) : (
            <>
              <CheckCircleOutlined style={{ fontSize: 50, color: '#52c41a' }} />
              <Title level={4} style={{ marginTop: 16 }}>{t('Action Completed')}</Title>
              <Space direction="vertical" size="small">
                <Text>
                  {t('Blocked:')} <Text strong>{submitResult.blocked}</Text>
                </Text>
                <Text>
                  {t('Skipped (already blocked or empty):')} <Text strong>{submitResult.skipped}</Text>
                </Text>
              </Space>
            </>
          )}

        </div>
      )}
    </Modal>
  );
}
