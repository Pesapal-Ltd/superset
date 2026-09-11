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
/* eslint-disable theme-colors/no-literal-colors */
import { type SerializableThemeConfig, ThemeAlgorithm } from './types';

const exampleThemes: Record<string, SerializableThemeConfig> = {
  superset: {
    token: {
      colorBgElevated: '#fafafa',
    },
  },
  supersetDark: {
    token: {},
    algorithm: ThemeAlgorithm.DARK,
  },
  supersetCompact: {
    token: {},
    algorithm: ThemeAlgorithm.COMPACT,
  },
  funky: {
    token: {
      colorPrimary: '#f759ab', // hot pink
      colorSuccess: '#52c41a',
      colorWarning: '#faad14',
      colorError: '#ff4d4f',
      colorInfo: '#40a9ff',
      borderRadius: 12,
      fontFamily: 'Comic Sans MS, cursive',
    },
    algorithm: ThemeAlgorithm.DEFAULT,
  },
  funkyDark: {
    token: {
      colorPrimary: '#f759ab', // hot pink
      colorSuccess: '#52c41a',
      colorWarning: '#faad14',
      colorError: '#ff4d4f',
      colorInfo: '#40a9ff',
      borderRadius: 12,
      fontFamily: 'Comic Sans MS, cursive',
    },
    algorithm: ThemeAlgorithm.DARK,
  },
  pesapal: {
    token: {
      headerBg: '#0084ff',
      headerColor: 'rgba(255, 255, 255, 0.95)',
      brandLogoUrl: '/static/assets/images/Pesapal_Logo.png',
      brandLogoHeight: '26px',
      brandLogoMargin: '12px 0',
      brandLogoAlt: 'Pesapal',
      brandLogoHref: '/',
      colorPrimary: '#0084ff',
      colorLink: '#0084ff',
      colorSuccess: '#10b981',
      colorWarning: '#f59e0b',
      colorError: '#ef4444',
      colorInfo: '#0084ff',
      borderRadius: 8,
      borderRadiusLG: 12,
      borderRadiusSM: 6,
      borderRadiusXS: 4,
      controlHeight: 38,
      controlHeightSM: 30,
      controlHeightLG: 46,
      fontUrls: [
        'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap',
      ],
      fontFamily:
        "'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      colorBgBase: '#ffffff',
      colorBgLayout: '#f8fafc',
      colorBgContainer: '#ffffff',
      colorBgElevated: '#ffffff',
      colorBorder: '#e2e8f0',
      colorBorderSecondary: '#f1f5f9',
      colorText: '#1e293b',
      colorTextHeading: '#0f172a',
      colorTextSecondary: '#64748b',
      colorTextTertiary: '#94a3b8',
      buttonBorderRadius: 8,
      labelBorderRadius: 6,
      dashboardTileBorderRadius: 12,
      dashboardTileBg: '#ffffff',
      dashboardTileBorder: '1px solid #e2e8f0',
      dashboardTileBoxShadow:
        '0 1px 3px 0 rgba(0, 0, 0, 0.04), 0 1px 2px -1px rgba(0, 0, 0, 0.04)',
      labelPublishedColor: '#15803d',
      labelPublishedBg: '#f0fdf4',
      labelPublishedBorderColor: '#bbf7d0',
      labelPublishedIconColor: '#16a34a',
      labelDraftColor: '#0284c7',
      labelDraftBg: '#f0f9ff',
      labelDraftBorderColor: '#bae6fd',
      labelDraftIconColor: '#0284c7',
      buttonSecondaryColor: '#0084ff',
      buttonSecondaryBg: '#ffffff',
      buttonSecondaryBorderColor: '#0084ff',
      buttonSecondaryHoverColor: '#0066cc',
      buttonSecondaryHoverBg: '#eff6ff',
      buttonSecondaryHoverBorderColor: '#0066cc',
    },
    components: {
      Button: {
        borderRadius: 8,
        controlHeight: 38,
      },
      Card: {
        borderRadiusLG: 12,
        colorBorderSecondary: '#e2e8f0',
      },
      Table: {
        headerBg: '#f8fafc',
        headerColor: '#475569',
        headerBorderRadius: 8,
        rowHoverBg: '#f8fafc',
      },
      Menu: {
        itemBorderRadius: 8,
        itemSelectedBg: '#0084ff',
        itemSelectedColor: '#ffffff',
      },
      Tabs: {
        inkBarColor: '#0084ff',
        itemSelectedColor: '#0084ff',
        itemHoverColor: '#38bdf8',
      },
      Input: {
        borderRadius: 8,
        controlHeight: 38,
      },
      Select: {
        borderRadius: 8,
        controlHeight: 38,
      },
      DatePicker: {
        borderRadius: 8,
        controlHeight: 38,
      },
    },
    echartsOptionsOverrides: {
      color: [
        '#0084ff',
        '#00b894',
        '#f59e0b',
        '#ef4444',
        '#8b5cf6',
        '#06b6d4',
        '#f97316',
        '#ec4899',
        '#10b981',
        '#6366f1',
      ],
    },
    algorithm: ThemeAlgorithm.DEFAULT,
  },
  pesapalDark: {
    token: {
      headerBg: '#0b192c',
      headerColor: 'rgba(255, 255, 255, 0.95)',
      brandLogoUrl: '/static/assets/images/Pesapal_Logo.png',
      colorPrimary: '#0084ff',
      colorLink: '#38bdf8',
      colorSuccess: '#10b981',
      colorWarning: '#f59e0b',
      colorError: '#ef4444',
      colorInfo: '#0084ff',
      borderRadius: 8,
      borderRadiusLG: 12,
      borderRadiusSM: 6,
      borderRadiusXS: 4,
      fontUrls: [
        'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap',
      ],
      fontFamily:
        "'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      dashboardTileBorderRadius: 12,
      buttonBorderRadius: 8,
      labelBorderRadius: 6,
    },
    algorithm: ThemeAlgorithm.DARK,
  },
};
export default exampleThemes;
