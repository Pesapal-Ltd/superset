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
import {
  escapeAttrValue,
  FilterXSS,
  getDefaultWhiteList,
  IWhiteList,
} from 'xss';

const COMMON_ATTRS = ['style', 'class', 'id', 'title', 'role', 'dir', 'lang'];

const SVG_ATTRS = [
  ...COMMON_ATTRS,
  'viewBox',
  'width',
  'height',
  'x',
  'y',
  'x1',
  'x2',
  'y1',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'd',
  'points',
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'transform',
  'text-anchor',
  'dominant-baseline',
  'font-size',
  'font-weight',
  'preserveAspectRatio',
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientTransform',
  'xmlns',
];

const SVG_TAGS = [
  'svg',
  'g',
  'rect',
  'circle',
  'ellipse',
  'line',
  'path',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'defs',
  'linearGradient',
  'radialGradient',
  'stop',
  'title',
];

function buildWhiteList(): IWhiteList {
  const base = getDefaultWhiteList();
  const list: IWhiteList = {};
  Object.entries(base).forEach(([tag, attrs]) => {
    list[tag] = Array.from(new Set([...(attrs || []), ...COMMON_ATTRS]));
  });
  [
    'section',
    'article',
    'header',
    'footer',
    'main',
    'nav',
    'figure',
    'figcaption',
    'mark',
    'progress',
    'meter',
  ].forEach(tag => {
    list[tag] = [
      ...COMMON_ATTRS,
      'value',
      'max',
      'min',
      'low',
      'high',
      'optimum',
    ];
  });
  ['td', 'th'].forEach(tag => {
    list[tag] = [
      ...(list[tag] || []),
      'colspan',
      'rowspan',
      'align',
      'valign',
      'width',
    ];
  });
  list.a = [...(list.a || []), 'href', 'target', 'rel'];
  list.img = [...(list.img || []), 'src', 'alt', 'width', 'height', 'loading'];
  SVG_TAGS.forEach(tag => {
    list[tag] = SVG_ATTRS;
  });
  return list;
}

const filter = new FilterXSS({
  whiteList: buildWhiteList(),
  stripIgnoreTag: true,
  stripIgnoreTagBody: ['script', 'style', 'iframe', 'object', 'embed'],
  // keep inline styles as written (same as Superset's own sanitizer)
  css: false,
  onIgnoreTagAttr(_tag, name, value) {
    if (/^(data|aria)-[\w-]+$/.test(name)) {
      return `${name}="${escapeAttrValue(value)}"`;
    }
    return undefined;
  },
});

/**
 * Remove scripts, event handlers and javascript: URLs while keeping layout
 * markup, inline styles and inline SVG.
 */
export function sanitize(html: string): string {
  return filter.process(html);
}

/** Read Superset's HTML_SANITIZATION setting from the bootstrap payload. */
export function isSanitizationEnabled(): boolean {
  try {
    const app = document.getElementById('app');
    const { common } = JSON.parse(app?.getAttribute('data-bootstrap') || '{}');
    return common?.conf?.HTML_SANITIZATION ?? true;
  } catch (e) {
    return true;
  }
}
