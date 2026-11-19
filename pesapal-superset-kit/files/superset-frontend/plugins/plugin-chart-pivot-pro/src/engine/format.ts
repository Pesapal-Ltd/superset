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
/** Conditional formatting: colour scales, data bars and icon sets. */

export type Palette = 'red_green' | 'green_red' | 'blue' | 'orange' | 'purple';
export type IconSet = 'arrows' | 'traffic' | 'flags';

export const PALETTES: Record<Palette, { label: string; stops: string[] }> = {
  red_green: {
    label: 'Red → Yellow → Green (high is good)',
    stops: ['#E04355', '#FDE380', '#5AC189'],
  },
  green_red: {
    label: 'Green → Yellow → Red (low is good)',
    stops: ['#5AC189', '#FDE380', '#E04355'],
  },
  blue: { label: 'White → Blue', stops: ['#F3F8FA', '#79CADE', '#156378'] },
  orange: { label: 'White → Orange', stops: ['#FFF4EC', '#FFB078', '#D9530F'] },
  purple: { label: 'White → Purple', stops: ['#F5F5F8', '#B4B8CA', '#363E63'] },
};

export const ICON_SETS: Record<
  IconSet,
  { label: string; icons: [string, string, string] }
> = {
  arrows: { label: 'Arrows ▲ ► ▼', icons: ['▲', '►', '▼'] },
  traffic: { label: 'Traffic lights ● ● ●', icons: ['●', '●', '●'] },
  flags: { label: 'Flags ⚑', icons: ['⚑', '⚑', '⚑'] },
};

const ICON_COLORS = ['#2B8A3E', '#E8A317', '#C92A2A'];

export interface Stats {
  min: number;
  max: number;
  p33: number;
  p67: number;
}

const quantile = (sorted: number[], q: number) => {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

export function stats(values: (number | null)[]): Stats | null {
  const v = values.filter((x): x is number => x !== null && Number.isFinite(x));
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  return {
    min: s[0],
    max: s[s.length - 1],
    p33: quantile(s, 1 / 3),
    p67: quantile(s, 2 / 3),
  };
}

const hex = (c: string) => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const toHex = (rgb: number[]) =>
  `#${rgb.map(x => Math.round(x).toString(16).padStart(2, '0')).join('')}`;

export function interpolate(stops: string[], t: number): string {
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(Math.floor(x), stops.length - 2);
  const f = x - i;
  const a = hex(stops[i]);
  const b = hex(stops[i + 1]);
  return toHex(a.map((v, k) => v + (b[k] - v) * f));
}

/** Readable text colour for a background. */
export function textOn(bg: string): string {
  const [r, g, b] = hex(bg);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum < 0.55 ? '#FFFFFF' : '#1B1F31';
}

const position = (v: number, s: Stats) =>
  s.max === s.min ? 0.5 : (v - s.min) / (s.max - s.min);

export function heat(v: number, s: Stats, palette: Palette) {
  const bg = interpolate(
    (PALETTES[palette] || PALETTES.red_green).stops,
    position(v, s),
  );
  return { background: bg, color: textOn(bg) };
}

/** Bar length 0..1; a zero baseline is kept when values cross zero. */
export function barWidth(v: number, s: Stats): number {
  const lo = Math.min(0, s.min);
  const hi = Math.max(0, s.max);
  if (hi === lo) return 0;
  return Math.abs(v) / (hi - lo);
}

export function icon(v: number, s: Stats, set: IconSet, lowerIsBetter = false) {
  const def = ICON_SETS[set] || ICON_SETS.arrows;
  let tier = v >= s.p67 ? 0 : v >= s.p33 ? 1 : 2; // 0 = top third
  if (s.max === s.min) tier = 1;
  const colorTier = lowerIsBetter ? 2 - tier : tier;
  return { char: def.icons[tier], color: ICON_COLORS[colorTier] };
}
