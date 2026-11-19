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
import fetchMock from 'fetch-mock';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from 'spec/helpers/testing-library';
import WhatIfFilterPlugin from './WhatIfFilterPlugin';
import { parseSettings, whatIfDataMask } from './types';

const extra = JSON.stringify({
  whatif: {
    name: 'Price change %',
    min: -20,
    max: 20,
    step: 5,
    default: 0,
    suffix: '%',
  },
});

test('settings come from the column extra; junk is rejected', () => {
  expect(parseSettings(extra, 'x')).toEqual({
    name: 'Price change %',
    min: -20,
    max: 20,
    step: 5,
    default: 0,
    suffix: '%',
  });
  expect(
    parseSettings('{"whatif":{"min":5,"max":1,"step":-1,"default":99}}', 'p'),
  ).toEqual({
    name: 'p',
    min: 5,
    max: 6,
    step: 1,
    default: 1,
    suffix: '',
  });
  expect(parseSettings('{}', 'x')).toBeNull();
  expect(parseSettings('not json', 'x')).toBeNull();
});

test('data mask is a == filter on the parameter column', () => {
  expect(whatIfDataMask('whatif_price', 10, '%')).toEqual({
    extraFormData: { filters: [{ col: 'whatif_price', op: '==', val: 10 }] },
    filterState: { value: [10], label: '10%' },
  });
});

const base = {
  formData: {
    datasource: '5__table',
    groupby: ['whatif_price_change_pct'],
    viz_type: 'filter_whatif',
  },
  filterState: {},
  data: [],
  width: 220,
  height: 40,
  behaviors: [],
  inputRef: { current: null },
  setHoveredFilter: jest.fn(),
  unsetHoveredFilter: jest.fn(),
  setFocusedFilter: jest.fn(),
  unsetFocusedFilter: jest.fn(),
  setFilterActive: jest.fn(),
};

test('slider applies the default, then the chosen value', async () => {
  fetchMock.get('glob:*/api/v1/dataset/5?q=*', {
    result: { columns: [{ column_name: 'whatif_price_change_pct', extra }] },
  });
  const setDataMask = jest.fn();
  render(<WhatIfFilterPlugin {...(base as any)} setDataMask={setDataMask} />);
  const slider = await screen.findByRole('slider', { name: 'Price change %' });
  await waitFor(() =>
    expect(setDataMask).toHaveBeenCalledWith(
      whatIfDataMask('whatif_price_change_pct', 0, '%'),
    ),
  );
  fireEvent.change(slider, { target: { value: '10' } });
  fireEvent.mouseUp(slider);
  expect(setDataMask).toHaveBeenLastCalledWith(
    whatIfDataMask('whatif_price_change_pct', 10, '%'),
  );
  expect(screen.getByText('+10%')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reset to 0%' }));
  expect(setDataMask).toHaveBeenLastCalledWith(
    whatIfDataMask('whatif_price_change_pct', 0, '%'),
  );
});

test('a normal column is refused with a clear message', async () => {
  fetchMock.get('glob:*/api/v1/dataset/6?q=*', {
    result: { columns: [{ column_name: 'sales', extra: null }] },
  });
  render(
    <WhatIfFilterPlugin
      {...(base as any)}
      formData={{
        datasource: '6__table',
        groupby: ['sales'],
        viz_type: 'filter_whatif',
      }}
      setDataMask={jest.fn()}
    />,
  );
  expect(
    await screen.findByText('"sales" is not a what-if parameter column'),
  ).toBeInTheDocument();
});
