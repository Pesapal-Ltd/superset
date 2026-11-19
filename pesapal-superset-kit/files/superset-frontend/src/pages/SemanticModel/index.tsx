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
import { useCallback, useEffect, useState } from 'react';
import { t } from '@superset-ui/core';
import {
  DatasetListItem,
  getDataset,
  listDatasets,
} from 'src/features/semantic/api';
import {
  ApiDataset,
  measuresOf,
  parametersOf,
} from 'src/features/semantic/model';
import MeasuresTab from './MeasuresTab';
import ParametersTab from './ParametersTab';
import StarSchemaTab from './StarSchemaTab';
import { errorText, Page } from './styles';

type Tab = 'measures' | 'relationships' | 'parameters';

export default function SemanticModel() {
  const params = new URLSearchParams(window.location.search);
  const [datasets, setDatasets] = useState<DatasetListItem[]>([]);
  const [datasetId, setDatasetId] = useState<number | null>(
    Number(params.get('dataset')) || null,
  );
  const [dataset, setDataset] = useState<ApiDataset | null>(null);
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) || 'measures');
  const [error, setError] = useState('');

  useEffect(() => {
    listDatasets()
      .then(setDatasets)
      .catch(e => setError(errorText(e)));
  }, []);

  const reload = useCallback(
    async (id = datasetId) => {
      if (!id) return;
      try {
        setDataset(await getDataset(id));
        setError('');
      } catch (e) {
        setError(errorText(e));
      }
    },
    [datasetId],
  );

  useEffect(() => {
    setDataset(null);
    reload(datasetId);
    if (datasetId) {
      const url = new URL(window.location.href);
      url.searchParams.set('dataset', String(datasetId));
      window.history.replaceState(null, '', url.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId]);

  const openDataset = async (id: number) => {
    setDatasets(await listDatasets());
    setDatasetId(id);
  };

  return (
    <Page>
      <div className="sm-head">
        <div>
          <h1>{t('Semantic Model')}</h1>
          <div className="sm-sub">
            {t(
              'Reusable DAX measures, star-schema relationships and what-if parameters for your datasets.',
            )}
          </div>
        </div>
        <div className="sm-field" style={{ minWidth: 320, marginBottom: 0 }}>
          <span>{t('Dataset')}</span>
          <select
            aria-label="Dataset"
            value={datasetId ?? ''}
            onChange={e => setDatasetId(Number(e.target.value) || null)}
          >
            <option value="">{t('Choose a dataset…')}</option>
            {datasets.map(d => (
              <option key={d.id} value={d.id}>
                {d.table_name}
                {d.schema ? ` (${d.schema})` : ''}
                {d.kind === 'virtual' ? ' · virtual' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && <div className="sm-msg err">{error}</div>}
      <div className="sm-tabs" role="tablist">
        {(
          [
            [
              'measures',
              `${t('Measures')}${dataset ? ` (${measuresOf(dataset).length})` : ''}`,
            ],
            ['relationships', t('Relationships')],
            [
              'parameters',
              `${t('What-if parameters')}${dataset ? ` (${parametersOf(dataset).length})` : ''}`,
            ],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            className={tab === k ? 'on' : ''}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'relationships' && (
        <StarSchemaTab
          dataset={dataset}
          onSaved={openDataset}
          onReload={() => reload()}
        />
      )}
      {tab !== 'relationships' && !dataset && (
        <div className="sm-empty">
          {datasetId
            ? t('Loading…')
            : t(
                'Choose a dataset above, or build a star-schema model on the Relationships tab.',
              )}
        </div>
      )}
      {tab === 'measures' && dataset && (
        <MeasuresTab dataset={dataset} onSaved={() => reload()} />
      )}
      {tab === 'parameters' && dataset && (
        <ParametersTab dataset={dataset} onSaved={() => reload()} />
      )}
    </Page>
  );
}
