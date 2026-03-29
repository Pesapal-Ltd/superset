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
 * Email Verification Templates page
 * Route: /emailverify/templates/list/
 *
 * Accessible to users with can_manage_email_templates permission.
 * Shows all templates in a searchable table; allows creating, editing,
 * previewing, and toggling the status of each template.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Button,
  Input,
  Select,
  Table,
  Tag,
  Switch,
  Tooltip,
  Modal,
  Form,
  Upload,
  Tabs,
  message,
  Space,
  Badge,
  Popconfirm,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  EyeOutlined,
  UploadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { SupersetClient, t } from '@superset-ui/core';
import type { ColumnsType } from 'antd/es/table';

const { Option } = Select;
const { TextArea } = Input;
const { TabPane } = Tabs;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Template {
  id: number;
  name: string;
  type: string;
  subject: string;
  html_body: string;
  text_body?: string;
  variables: string[];
  is_active: boolean;
  created_at: string;
}

// Variable regex — mirrors backend regex `r'\{\{\s*(\w+)\s*\}\}'`
const VAR_REGEX = /\{\{\s*(\w+)\s*\}\}/g;

function extractVariables(text: string): string[] {
  const vars: string[] = [];
  let match;
  const re = new RegExp(VAR_REGEX.source, 'g');
  while ((match = re.exec(text)) !== null) {
    if (!vars.includes(match[1])) vars.push(match[1]);
  }
  return vars;
}

// ─────────────────────────────────────────────────────────────────────────────
// Upload / Edit modal
// ─────────────────────────────────────────────────────────────────────────────

interface TemplateModalProps {
  visible: boolean;
  editTemplate?: Template | null;
  onClose: () => void;
  onSaved: () => void;
}

function TemplateModal({ visible, editTemplate, onClose, onSaved }: TemplateModalProps) {
  const [form] = Form.useForm();
  const [detectedVars, setDetectedVars] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [htmlBody, setHtmlBody] = useState('');

  useEffect(() => {
    if (visible) {
      form.resetFields();
      const initialHtml = editTemplate?.html_body || '';
      setHtmlBody(initialHtml);
      if (editTemplate) {
        form.setFieldsValue(editTemplate);
        setDetectedVars(editTemplate.variables || []);
      } else {
        setDetectedVars([]);
      }
    }
  }, [visible, editTemplate, form]);

  const updateHtmlBody = useCallback(
    (value: string) => {
      setHtmlBody(value);
      form.setFieldsValue({ html_body: value });
      // Re-validate the html_body field so the error clears immediately
      form.validateFields(['html_body']).catch(() => {});
      const subject = form.getFieldValue('subject') || '';
      setDetectedVars(
        Array.from(new Set([...extractVariables(value), ...extractVariables(subject)])),
      );
    },
    [form],
  );

  const handleSubjectChange = useCallback(() => {
    const body = form.getFieldValue('html_body') || '';
    const subject = form.getFieldValue('subject') || '';
    setDetectedVars(
      Array.from(new Set([...extractVariables(body), ...extractVariables(subject)])),
    );
  }, [form]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const method = editTemplate ? 'PUT' : 'POST';
      const endpoint = editTemplate
        ? `/api/v1/email-verify/templates/${editTemplate.id}`
        : '/api/v1/email-verify/templates';

      const response = await SupersetClient.request({
        method,
        endpoint,
        jsonPayload: values,
      });

      if (response.json) {
        message.success(t(editTemplate ? 'Template updated!' : 'Template created!'));
        onSaved();
        onClose();
      }
    } catch (err: any) {
      // Only show the generic error if it's a network/API error,
      // not an Ant Design form validation error (those show inline).
      if (err?.errorFields === undefined) {
        message.error(t('Failed to save template. Please check all fields.'));
      }
    } finally {
      setSaving(false);
    }
  };

  const readFile = (file: File): Promise<string> =>
    new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = e => resolve((e.target?.result as string) || '');
      reader.readAsText(file);
    });

  const handleFileUpload = async (file: File) => {
    const content = await readFile(file);
    updateHtmlBody(content);
    return false; // prevent Ant Upload from auto-uploading
  };

  return (
    <Modal
      title={editTemplate ? t('Edit Template') : t('Create Email Template')}
      visible={visible}
      width={800}
      onCancel={onClose}
      footer={[
        <Button key="cancel" onClick={onClose}>
          {t('Cancel')}
        </Button>,
        <Button key="save" type="primary" loading={saving} onClick={handleSave}>
          {t('Save')}
        </Button>,
      ]}
    >
      <Form form={form} layout="vertical">
        <Form.Item name="name" label={t('Template Name')} rules={[{ required: true }]}>
          <Input placeholder={t('e.g. Mobile Verification Email')} />
        </Form.Item>

        <Form.Item name="type" label={t('Type')} rules={[{ required: true }]}>
          <Select placeholder={t('Select type')}>
            <Option value="transaction_verification">{t('Transaction Verification')}</Option>
            <Option value="merchant_verification">{t('Merchant Verification')}</Option>
          </Select>
        </Form.Item>

        <Form.Item name="subject" label={t('Subject Line')} rules={[{ required: true }]}>
          <Input
            placeholder={t('e.g. Verify your {{merchant_name}} transaction')}
            onChange={handleSubjectChange}
          />
        </Form.Item>

        {/* Hidden form item drives validation; the visible textarea updates it via updateHtmlBody */}
        <Form.Item
          name="html_body"
          label={t('HTML Body')}
          rules={[{ required: true, message: t("'html_body' is required") }]}
          style={{ marginBottom: 0 }}
        >
          {/* This Input is intentionally hidden; value is kept in sync by updateHtmlBody */}
          <Input type="hidden" />
        </Form.Item>
        <div style={{ marginBottom: 24 }}>
          <Tabs defaultActiveKey="paste">
            <TabPane tab={t('Paste HTML')} key="paste">
              <TextArea
                rows={12}
                value={htmlBody}
                placeholder={t('Paste your HTML template here. Use {{ variable_name }} for variables.')}
                onChange={e => updateHtmlBody(e.target.value)}
              />
            </TabPane>
            <TabPane tab={t('Upload File')} key="upload">
              <Upload
                accept=".html,.htm"
                beforeUpload={(file: any) => {
                  handleFileUpload(file);
                  return false;
                }}
                showUploadList={false}
              >
                <Button icon={<UploadOutlined />}>{t('Upload HTML file')}</Button>
              </Upload>
              {htmlBody && (
                <p style={{ marginTop: 8, color: '#52c41a' }}>
                  ✓ {t('File loaded — HTML body is ready.')}
                </p>
              )}
            </TabPane>
          </Tabs>
        </div>

        <Form.Item name="text_body" label={t('Plain Text Fallback (optional)')}>
          <TextArea rows={4} placeholder={t('Plain text version of the email')} />
        </Form.Item>

        {detectedVars.length > 0 && (
          <Form.Item label={t('Detected Variables')}>
            <Space wrap>
              {detectedVars.map(v => (
                <Tag key={v} color="blue">
                  {`{{${v}}}`}
                </Tag>
              ))}
            </Space>
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Preview modal
// ─────────────────────────────────────────────────────────────────────────────

interface PreviewModalProps {
  visible: boolean;
  template: Template | null;
  onClose: () => void;
}

function PreviewModal({ visible, template, onClose }: PreviewModalProps) {
  const [varValues, setVarValues] = useState<Record<string, string>>({});
  const [renderedHtml, setRenderedHtml] = useState<string>('');
  const [renderedSubject, setRenderedSubject] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible && template) {
      const init: Record<string, string> = {};
      (template.variables || []).forEach(v => {
        init[v] = `[${v}]`;
      });
      setVarValues(init);
    }
  }, [visible, template]);

  const handlePreview = async () => {
    if (!template) return;
    setLoading(true);
    try {
      const resp = await SupersetClient.post({
        endpoint: `/api/v1/email-verify/templates/${template.id}/preview`,
        jsonPayload: { variables: varValues },
      });
      const data: any = resp.json;
      setRenderedHtml(data?.result?.html_body || '');
      setRenderedSubject(data?.result?.subject || '');
    } catch {
      message.error(t('Preview failed. Check that all required variables are filled.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={t('Preview: {{name}}', { name: template?.name })}
      visible={visible}
      width={900}
      onCancel={onClose}
      footer={[
        <Button key="close" onClick={onClose}>
          {t('Close')}
        </Button>,
        <Button key="preview" type="primary" loading={loading} onClick={handlePreview}>
          {t('Render Preview')}
        </Button>,
      ]}
    >
      {template && (template.variables || []).length > 0 && (
        <Form layout="vertical" style={{ marginBottom: 16 }}>
          <p style={{ fontWeight: 600 }}>{t('Variables')}</p>
          {(template.variables || []).map(v => (
            <Form.Item key={v} label={`{{${v}}}`}>
              <Input
                value={varValues[v] || ''}
                onChange={e =>
                  setVarValues(prev => ({ ...prev, [v]: e.target.value }))
                }
              />
            </Form.Item>
          ))}
        </Form>
      )}

      {renderedSubject && (
        <p>
          <strong>{t('Subject:')}</strong> {renderedSubject}
        </p>
      )}

      {renderedHtml ? (
        <div
          style={{ border: '1px solid #e8e8e8', borderRadius: 4, padding: 8 }}
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
      ) : (
        <p style={{ color: '#aaa' }}>
          {t('Click "Render Preview" to see the rendered template.')}
        </p>
      )}
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main list page
// ─────────────────────────────────────────────────────────────────────────────

export default function EmailTemplateList() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string | undefined>(undefined);
  const [showModal, setShowModal] = useState(false);
  const [editTemplate, setEditTemplate] = useState<Template | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (typeFilter) params.set('type', typeFilter);
      const resp = await SupersetClient.get({
        endpoint: `/api/v1/email-verify/templates?${params.toString()}`,
      });
      const data: any = resp.json;
      setTemplates(data?.result || []);
    } catch {
      message.error(t('Failed to load templates.'));
    } finally {
      setLoading(false);
    }
  }, [typeFilter]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const toggleActive = async (id: number, active: boolean) => {
    try {
      await SupersetClient.request({
        method: 'PATCH',
        endpoint: `/api/v1/email-verify/templates/${id}`,
        jsonPayload: { is_active: active },
      });
      message.success(active ? t('Template enabled.') : t('Template disabled.'));
      fetchTemplates();
    } catch {
      message.error(t('Failed to update template status.'));
    }
  };

  const filtered = templates.filter(
    t =>
      !search ||
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.subject.toLowerCase().includes(search.toLowerCase()),
  );

  const columns: ColumnsType<Template> = [
    {
      title: t('Name'),
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    {
      title: t('Type'),
      dataIndex: 'type',
      key: 'type',
      render: (type: string) => (
        <Tag color={type === 'transaction_verification' ? 'gold' : 'geekblue'}>
          {type === 'transaction_verification' ? t('Transaction') : t('Merchant')}
        </Tag>
      ),
    },
    {
      title: t('Subject'),
      dataIndex: 'subject',
      key: 'subject',
      ellipsis: true,
    },
    {
      title: t('Variables'),
      dataIndex: 'variables',
      key: 'variables',
      render: (vars: string[]) => (
        <Space wrap>
          {(vars || []).map(v => (
            <Tag key={v}>{`{{${v}}}`}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: t('Status'),
      dataIndex: 'is_active',
      key: 'is_active',
      render: (active: boolean, record: Template) => (
        <Popconfirm
          title={active ? t('Disable this template?') : t('Enable this template?')}
          onConfirm={() => toggleActive(record.id, !active)}
        >
          <Switch
            checked={active}
            checkedChildren={t('Active')}
            unCheckedChildren={t('Inactive')}
          />
        </Popconfirm>
      ),
    },
    {
      title: t('Created'),
      dataIndex: 'created_at',
      key: 'created_at',
      render: (date: string) => new Date(date).toLocaleDateString(),
      sorter: (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    },
    {
      title: t('Actions'),
      key: 'actions',
      render: (_: any, record: Template) => (
        <Space>
          <Tooltip title={t('Edit')}>
            <Button
              type="text"
              icon={<EditOutlined />}
              onClick={() => {
                setEditTemplate(record);
                setShowModal(true);
              }}
            />
          </Tooltip>
          <Tooltip title={t('Preview')}>
            <Button
              type="text"
              icon={<EyeOutlined />}
              onClick={() => setPreviewTemplate(record)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: '24px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>{t('Email Verification Templates')}</h2>
          <p style={{ color: '#666', margin: '4px 0 0' }}>
            {t('Manage HTML email templates for merchant verification workflows.')}
          </p>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            setEditTemplate(null);
            setShowModal(true);
          }}
          id="create-email-template-btn"
        >
          {t('Create Template')}
        </Button>
      </div>

      <Space style={{ marginBottom: 16 }}>
        <Input
          prefix={<SearchOutlined />}
          placeholder={t('Search templates...')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 260 }}
          id="email-template-search"
          allowClear
        />
        <Select
          allowClear
          placeholder={t('Filter by type')}
          style={{ width: 200 }}
          value={typeFilter}
          onChange={(v: any) => setTypeFilter(v as string | undefined)}
          id="email-template-type-filter"
        >
          <Option value="transaction_verification">{t('Transaction Verification')}</Option>
          <Option value="merchant_verification">{t('Merchant Verification')}</Option>
        </Select>
        <Badge count={filtered.length} showZero color="#108ee9" />
      </Space>

      <Table<Template>
        rowKey="id"
        columns={columns}
        dataSource={filtered}
        loading={loading}
        pagination={{ pageSize: 20, showSizeChanger: true }}
      />

      <TemplateModal
        visible={showModal}
        editTemplate={editTemplate}
        onClose={() => setShowModal(false)}
        onSaved={fetchTemplates}
      />

      <PreviewModal
        visible={!!previewTemplate}
        template={previewTemplate}
        onClose={() => setPreviewTemplate(null)}
      />
    </div>
  );
}
