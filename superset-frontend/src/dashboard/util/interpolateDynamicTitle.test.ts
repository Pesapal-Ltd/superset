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
import { interpolateDynamicTitle } from './interpolateDynamicTitle';

describe('interpolateDynamicTitle', () => {
    test('returns a plain title unchanged when there are no placeholders', () => {
        expect(interpolateDynamicTitle('Total Revenue', {})).toBe('Total Revenue');
        expect(
            interpolateDynamicTitle('Total Revenue', { country: 'Kenya' }),
        ).toBe('Total Revenue');
    });

    test('replaces a placeholder with the corresponding filter value', () => {
        expect(
            interpolateDynamicTitle('Sales in {Country}', { country: 'Kenya' }),
        ).toBe('Sales in Kenya');
    });

    test('uses bracket notation when the filter value is null (unset)', () => {
        expect(
            interpolateDynamicTitle('Sales in {Country}', { country: null }),
        ).toBe('Sales in [Country]');
    });

    test('uses bracket notation when the filter value is an empty string', () => {
        expect(
            interpolateDynamicTitle('Sales in {Country}', { country: '' }),
        ).toBe('Sales in [Country]');
    });

    test('replaces multiple placeholders correctly', () => {
        expect(
            interpolateDynamicTitle('{Region} - {Year} Revenue', {
                region: 'East Africa',
                year: '2024',
            }),
        ).toBe('East Africa - 2024 Revenue');
    });

    test('handles mixed set and unset placeholders', () => {
        expect(
            interpolateDynamicTitle('{Region} - {Year} Revenue', {
                region: 'East Africa',
                year: null,
            }),
        ).toBe('East Africa - [Year] Revenue');
    });

    test('matches filter names case-insensitively', () => {
        expect(
            interpolateDynamicTitle('Sales in {COUNTRY}', { country: 'Kenya' }),
        ).toBe('Sales in Kenya');
        expect(
            interpolateDynamicTitle('Sales in {country}', { COUNTRY: 'Kenya' }),
        ).toBe('Sales in Kenya');
        expect(
            interpolateDynamicTitle('Sales in {CoUnTrY}', { Country: 'Kenya' }),
        ).toBe('Sales in Kenya');
    });

    test('leaves unknown placeholders unchanged', () => {
        expect(
            interpolateDynamicTitle('Sales in {UnknownFilter}', { country: 'Kenya' }),
        ).toBe('Sales in {UnknownFilter}');
    });

    test('handles an empty template string', () => {
        expect(interpolateDynamicTitle('', { country: 'Kenya' })).toBe('');
    });

    test('handles an empty filter map with placeholders present', () => {
        expect(interpolateDynamicTitle('Sales in {Country}', {})).toBe(
            'Sales in {Country}',
        );
    });
});
