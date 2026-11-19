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
import { styled } from '@superset-ui/core';

export const Page = styled.div`
  ${({ theme }) => `
  padding: ${theme.gridUnit * 4}px ${theme.gridUnit * 6}px;
  font-size: ${theme.typography.sizes.m}px;
  color: ${theme.colors.grayscale.dark1};
  h1 { font-size: 22px; margin: 0; }
  h3 { font-size: 15px; margin: 0 0 8px; }
  .sm-sub { color: ${theme.colors.grayscale.base}; margin-top: 2px; }
  .sm-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
  .sm-tabs { display: flex; gap: 20px; border-bottom: 1px solid ${theme.colors.grayscale.light2}; margin-bottom: 16px; }
  .sm-tabs button { border: 0; background: none; padding: 8px 0; cursor: pointer; font: inherit; color: ${theme.colors.grayscale.base}; border-bottom: 2px solid transparent; }
  .sm-tabs button.on { color: ${theme.colors.primary.dark1}; border-bottom-color: ${theme.colors.primary.base}; font-weight: ${theme.typography.weights.bold}; }
  .sm-grid { display: grid; grid-template-columns: 280px 1fr; gap: 20px; align-items: start; }
  .sm-card { background: ${theme.colors.grayscale.light5}; border: 1px solid ${theme.colors.grayscale.light2}; border-radius: ${theme.gridUnit * 2}px; padding: 16px; }
  .sm-list { display: flex; flex-direction: column; gap: 4px; max-height: 65vh; overflow: auto; }
  .sm-list button { text-align: left; border: 1px solid transparent; background: none; border-radius: 6px; padding: 7px 10px; cursor: pointer; font: inherit; display: flex; justify-content: space-between; gap: 8px; color: inherit; }
  .sm-list button:hover { background: ${theme.colors.grayscale.light4}; }
  .sm-list button.on { background: ${theme.colors.primary.light4}; border-color: ${theme.colors.primary.light2}; }
  .sm-badge { font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 8px; background: ${theme.colors.grayscale.light3}; color: ${theme.colors.grayscale.dark1}; align-self: center; }
  .sm-badge.dax { background: ${theme.colors.primary.light3}; color: ${theme.colors.primary.dark2}; }
  .sm-field { display: block; margin-bottom: 12px; }
  .sm-field > span { display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px; color: ${theme.colors.grayscale.dark1}; }
  input[type='text'], input[type='number'], select, textarea {
    font: inherit; width: 100%; box-sizing: border-box; padding: 6px 8px;
    border: 1px solid ${theme.colors.grayscale.light2}; border-radius: 4px; background: ${theme.colors.grayscale.light5};
  }
  textarea.sm-code { font-family: ${theme.typography.families.monospace}; font-size: 13px; min-height: 140px; line-height: 1.5; }
  .sm-row { display: flex; gap: 12px; }
  .sm-row > * { flex: 1; }
  .sm-ok { color: ${theme.colors.success.dark1}; }
  .sm-err { color: ${theme.colors.error.base}; white-space: pre-wrap; }
  .sm-warn { color: ${theme.colors.warning.dark1}; font-size: 12px; }
  pre.sm-sql { background: ${theme.colors.grayscale.light4}; border-radius: 4px; padding: 10px; font-size: 12px; white-space: pre-wrap; max-height: 220px; overflow: auto; margin: 6px 0 0; }
  .sm-actions { display: flex; gap: 8px; align-items: center; margin-top: 12px; flex-wrap: wrap; }
  .sm-btn { font: inherit; padding: 6px 14px; border-radius: 4px; border: 1px solid ${theme.colors.grayscale.light2}; background: ${theme.colors.grayscale.light5}; cursor: pointer; }
  .sm-btn.primary { background: ${theme.colors.primary.base}; border-color: ${theme.colors.primary.base}; color: ${theme.colors.grayscale.light5}; }
  .sm-btn.danger { color: ${theme.colors.error.base}; }
  .sm-btn:disabled { opacity: 0.5; cursor: default; }
  table.sm-table { border-collapse: collapse; width: 100%; font-size: 13px; margin-top: 8px; }
  table.sm-table th, table.sm-table td { text-align: left; padding: 5px 8px; border-bottom: 1px solid ${theme.colors.grayscale.light3}; }
  table.sm-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .sm-help { font-size: 12px; color: ${theme.colors.grayscale.base}; line-height: 1.5; }
  .sm-help code, .sm-card code { background: ${theme.colors.grayscale.light4}; padding: 0 4px; border-radius: 3px; }
  .sm-msg { margin-top: 10px; padding: 8px 12px; border-radius: 4px; }
  .sm-msg.ok { background: ${theme.colors.success.light2}; color: ${theme.colors.success.dark2}; }
  .sm-msg.err { background: ${theme.colors.error.light2}; color: ${theme.colors.error.dark1}; }
  .sm-empty { color: ${theme.colors.grayscale.base}; padding: 24px 0; }
  details summary { cursor: pointer; font-size: 12px; color: ${theme.colors.primary.dark1}; margin-top: 8px; }
  `}
`;

export const errorText = (e: unknown) => {
  const anyE = e as any;
  return anyE?.message || anyE?.statusText || anyE?.error || String(e);
};
