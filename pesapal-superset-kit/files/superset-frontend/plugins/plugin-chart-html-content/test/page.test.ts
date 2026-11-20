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
import { buildPageDocument, DEFAULT_PAGE } from '../src/page';

const rows = [
  { region: 'Nairobi', amount: 10 },
  { region: 'Mombasa', amount: 5 },
];

test('injects data, placeholders and nonce into the pasted page', () => {
  const doc = buildPageDocument(
    '<html><head><script src="https://cdn.example/chart.js"></script></head>' +
      '<body><h1>{{ sum(amount) }}</h1><script>draw()</script></body></html>',
    rows,
    ['region', 'amount'],
    'n0nce',
  );
  expect(doc.startsWith('<!DOCTYPE html>')).toBe(true);
  expect(doc).toContain('<h1>15</h1>');
  expect(doc).toContain('window.supersetData = {"rows":[{"region":"Nairobi"');
  expect(doc.match(/nonce="n0nce"/g)).toHaveLength(3);
  expect(doc).toContain('<base target="_blank">');
});

test('data cannot break out of the injected script', () => {
  const doc = buildPageDocument(
    '<p>x</p>',
    [{ a: '</script><img src=x onerror=alert(1)>' }],
    ['a'],
  );
  expect(doc).not.toContain('</script><img');
  expect(doc).toContain('\\u003c/script>');
});

test('fragments and the default page work', () => {
  expect(buildPageDocument('<b>hi</b>', rows, [])).toContain(
    '<b>hi</b></body>',
  );
  expect(buildPageDocument(DEFAULT_PAGE, rows, ['region', 'amount'])).toContain(
    'My chart (2 rows)',
  );
});

test('adds a "scripts blocked" banner and an error reporter', () => {
  const doc = buildPageDocument('<p>x</p>', rows, ['region'], 'n');
  expect(doc).toContain('id="__superset_diag"');
  expect(doc).toContain('did not run');
  expect(doc).toContain("window.addEventListener('error'");
});

test('injects the viewing user', () => {
  const doc = buildPageDocument('<p>x</p>', rows, [], '', {
    firstName: 'Erick',
    lastName: 'N',
    username: 'erick',
  });
  expect(doc).toContain('window.supersetUser = {"firstName":"Erick"');
  expect(buildPageDocument('<p>x</p>', rows, [])).toContain(
    'window.supersetUser = null;',
  );
});
