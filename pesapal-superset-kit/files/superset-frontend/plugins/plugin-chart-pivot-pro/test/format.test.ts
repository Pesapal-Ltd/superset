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
  barWidth,
  heat,
  icon,
  interpolate,
  stats,
  textOn,
} from '../src/engine/format';

test('stats and quantiles', () => {
  const s = stats([1, 2, 3, 4, 5, 6, 7, null])!;
  expect(s.min).toBe(1);
  expect(s.max).toBe(7);
  expect(s.p33).toBeCloseTo(3);
  expect(s.p67).toBeCloseTo(5);
  expect(stats([null])).toBeNull();
});

test('interpolation and contrast', () => {
  expect(interpolate(['#000000', '#FFFFFF'], 0.5)).toBe('#808080');
  expect(interpolate(['#E04355', '#FDE380', '#5AC189'], 1)).toBe('#5ac189');
  expect(textOn('#156378')).toBe('#FFFFFF');
  expect(textOn('#F3F8FA')).toBe('#1B1F31');
});

test('heat, bars and icons', () => {
  const s = stats([0, 50, 100])!;
  expect(heat(100, s, 'red_green').background).toBe('#5ac189');
  expect(heat(0, s, 'red_green').background).toBe('#e04355');
  expect(barWidth(50, s)).toBe(0.5);
  expect(barWidth(-50, stats([-100, 100])!)).toBe(0.25);
  expect(icon(100, s, 'arrows')).toEqual({ char: '▲', color: '#2B8A3E' });
  expect(icon(0, s, 'arrows')).toEqual({ char: '▼', color: '#C92A2A' });
  expect(icon(0, s, 'traffic', true).color).toBe('#2B8A3E');
});
