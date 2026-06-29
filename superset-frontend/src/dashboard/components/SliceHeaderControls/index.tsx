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
  MouseEvent,
  Key,
  KeyboardEvent,
  useState,
  useRef,
  RefObject,
} from 'react';

import { RouteComponentProps, useHistory } from 'react-router-dom';
import { extendedDayjs } from 'src/utils/dates';
import {
  Behavior,
  css,
  isFeatureEnabled,
  FeatureFlag,
  getChartMetadataRegistry,
  styled,
  t,
  VizType,
  BinaryQueryObjectFilterClause,
  QueryFormData,
} from '@superset-ui/core';
import { useSelector } from 'react-redux';
import { Menu } from 'src/components/Menu';
import { NoAnimationDropdown } from 'src/components/Dropdown';
import ShareMenuItems from 'src/dashboard/components/menu/ShareMenuItems';
import downloadAsImage from 'src/utils/downloadAsImage';
import { getSliceHeaderTooltip } from 'src/dashboard/util/getSliceHeaderTooltip';
import { Tooltip } from 'src/components/Tooltip';
import { Icons } from 'src/components/Icons';
import ModalTrigger from 'src/components/ModalTrigger';
import ViewQueryModal from 'src/explore/components/controls/ViewQueryModal';
import { ResultsPaneOnDashboard } from 'src/explore/components/DataTablesPane';
import { DrillDetailMenuItems } from 'src/components/Chart/DrillDetail';
import { LOG_ACTIONS_CHART_DOWNLOAD_AS_IMAGE } from 'src/logger/LogUtils';
import { MenuKeys, RootState } from 'src/dashboard/types';
import DrillDetailModal from 'src/components/Chart/DrillDetail/DrillDetailModal';
import { usePermissions } from 'src/hooks/usePermissions';
import Button from 'src/components/Button';
import SendVerifyModal from 'src/components/EmailVerify/SendVerifyModal';
import SettlementModal from 'src/components/Settlement/SettlementModal';
import DeviceFingerprintBlockModal from 'src/components/DeviceFingerprint/DeviceFingerprintBlockModal';
import { useCrossFiltersScopingModal } from '../nativeFilters/FilterBar/CrossFilters/ScopingModal/useCrossFiltersScopingModal';
import { ViewResultsModalTrigger } from './ViewResultsModalTrigger';

// TODO: replace 3 dots with an icon
const VerticalDotsContainer = styled.div`
  padding: ${({ theme }) => theme.gridUnit / 4}px
    ${({ theme }) => theme.gridUnit * 1.5}px;

  .dot {
    display: block;

    height: ${({ theme }) => theme.gridUnit}px;
    width: ${({ theme }) => theme.gridUnit}px;
    border-radius: 50%;
    margin: ${({ theme }) => theme.gridUnit / 2}px 0;

    background-color: ${({ theme }) => theme.colors.text.label};
  }

  &:hover {
    cursor: pointer;
  }
`;

const RefreshTooltip = styled.div`
  height: auto;
  margin: ${({ theme }) => theme.gridUnit}px 0;
  color: ${({ theme }) => theme.colors.grayscale.base};
  line-height: 21px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
`;

const getScreenshotNodeSelector = (chartId: string | number) =>
  `.dashboard-chart-id-${chartId}`;

const VerticalDotsTrigger = () => (
  <VerticalDotsContainer>
    <span className="dot" />
    <span className="dot" />
    <span className="dot" />
  </VerticalDotsContainer>
);

export interface SliceHeaderControlsProps {
  slice: {
    description: string;
    viz_type: string;
    slice_name: string;
    slice_id: number;
    slice_description: string;
    datasource: string;
  };

  defaultOpen?: boolean;
  componentId: string;
  dashboardId: number;
  chartStatus: string;
  isCached: boolean[];
  cachedDttm: string[] | null;
  isExpanded?: boolean;
  updatedDttm: number | null;
  isFullSize?: boolean;
  isDescriptionExpanded?: boolean;
  formData: QueryFormData;
  exploreUrl: string;

  forceRefresh: (sliceId: number, dashboardId: number) => void;
  logExploreChart?: (sliceId: number) => void;
  logEvent?: (eventName: string, eventData?: object) => void;
  toggleExpandSlice?: (sliceId: number) => void;
  exportCSV?: (sliceId: number) => void;
  exportPivotCSV?: (sliceId: number) => void;
  exportFullCSV?: (sliceId: number) => void;
  exportXLSX?: (sliceId: number) => void;
  exportFullXLSX?: (sliceId: number) => void;
  handleToggleFullSize: () => void;

  addDangerToast: (message: string) => void;
  addSuccessToast: (message: string) => void;

  supersetCanExplore?: boolean;
  supersetCanShare?: boolean;
  supersetCanCSV?: boolean;

  crossFiltersEnabled?: boolean;
}
type SliceHeaderControlsPropsWithRouter = SliceHeaderControlsProps &
  RouteComponentProps;

const dropdownIconsStyles = css`
  &&.anticon > .anticon:first-child {
    margin-right: 0;
    vertical-align: 0;
  }
`;

const SliceHeaderControls = (
  props: SliceHeaderControlsPropsWithRouter | SliceHeaderControlsProps,
) => {
  const [drillModalIsOpen, setDrillModalIsOpen] = useState(false);
  // setting openKeys undefined falls back to uncontrolled behaviour
  const [isDropdownVisible, setIsDropdownVisible] = useState(false);
  const [sendVerifyModalOpen, setSendVerifyModalOpen] = useState(false);
  const [settlementModalOpen, setSettlementModalOpen] = useState(false);
  const [deviceFingerprintModalOpen, setDeviceFingerprintModalOpen] = useState(false);
  const [pendingSettlementAction, setPendingSettlementAction] = useState<'hold'>('hold');
  const [openScopingModal, scopingModal] = useCrossFiltersScopingModal(
    props.slice.slice_id,
  );
  const history = useHistory();

  const queryMenuRef: RefObject<any> = useRef(null);
  const resultsMenuRef: RefObject<any> = useRef(null);

  const [modalFilters, setFilters] = useState<BinaryQueryObjectFilterClause[]>(
    [],
  );

  // email_verify_enabled and settlement_enabled are injected into formData by Chart.jsx
  // from the chart-level params (email_verify_config / settlement_config).
  const emailVerifyEnabled = props.formData?.email_verify_enabled === true;

  const settlementEnabled = props.formData?.settlement_enabled === true;
  const settlementConfig = props.formData?.settlement_config;

  const deviceFingerprintBlockEnabled = props.formData?.device_fingerprint_block_enabled === true;
  const deviceFingerprintConfig = props.formData?.device_fingerprint_config;

  const selectedRows = useSelector<RootState, any[]>(
    state =>
      (state.dataMask[props.slice.slice_id] as any)?.customState?.selectedRows ||
      state.dataMask[props.slice.slice_id]?.ownState?.selectedRows ||
      [],
  );
  const hasRowsSelected = selectedRows.length > 0;

  const canEditCrossFilters =
    useSelector<RootState, boolean>(
      ({ dashboardInfo }) => dashboardInfo.dash_edit_perm,
    ) &&
    getChartMetadataRegistry()
      .get(props.slice.viz_type)
      ?.behaviors?.includes(Behavior.InteractiveChart);
  const canExplore = props.supersetCanExplore;
  const { canDrillToDetail, canViewQuery, canViewTable } = usePermissions();
  const refreshChart = () => {
    if (props.updatedDttm) {
      props.forceRefresh(props.slice.slice_id, props.dashboardId);
    }
  };

  const handleMenuClick = ({
    key,
    domEvent,
  }: {
    key: Key;
    domEvent: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>;
  }) => {
    switch (key) {
      case MenuKeys.ForceRefresh:
        refreshChart();
        props.addSuccessToast(t('Data refreshed'));
        break;
      case MenuKeys.ToggleChartDescription:
        // eslint-disable-next-line no-unused-expressions
        props.toggleExpandSlice?.(props.slice.slice_id);
        break;
      case MenuKeys.ExploreChart:
        // eslint-disable-next-line no-unused-expressions
        props.logExploreChart?.(props.slice.slice_id);
        if (domEvent.metaKey || domEvent.ctrlKey) {
          domEvent.preventDefault();
          window.open(props.exploreUrl, '_blank');
        } else {
          history.push(props.exploreUrl);
        }
        break;
      case MenuKeys.ExportCsv:
        // eslint-disable-next-line no-unused-expressions
        props.exportCSV?.(props.slice.slice_id);
        break;
      case MenuKeys.ExportPivotCsv:
        // eslint-disable-next-line no-unused-expressions
        props.exportPivotCSV?.(props.slice.slice_id);
        break;
      case MenuKeys.Fullscreen:
        props.handleToggleFullSize();
        break;
      case MenuKeys.ExportFullCsv:
        // eslint-disable-next-line no-unused-expressions
        props.exportFullCSV?.(props.slice.slice_id);
        break;
      case MenuKeys.ExportFullXlsx:
        // eslint-disable-next-line no-unused-expressions
        props.exportFullXLSX?.(props.slice.slice_id);
        break;
      case MenuKeys.ExportXlsx:
        // eslint-disable-next-line no-unused-expressions
        props.exportXLSX?.(props.slice.slice_id);
        break;
      case MenuKeys.DownloadAsImage: {
        // menu closes with a delay, we need to hide it manually,
        // so that we don't capture it on the screenshot
        const menu = document.querySelector(
          '.antd5-dropdown:not(.antd5-dropdown-hidden)',
        ) as HTMLElement;
        if (menu) {
          menu.style.visibility = 'hidden';
        }
        downloadAsImage(
          getScreenshotNodeSelector(props.slice.slice_id),
          props.slice.slice_name,
          true,
          // @ts-ignore
        )(domEvent).then(() => {
          if (menu) {
            menu.style.visibility = 'visible';
          }
        });
        props.logEvent?.(LOG_ACTIONS_CHART_DOWNLOAD_AS_IMAGE, {
          chartId: props.slice.slice_id,
        });
        break;
      }
      case MenuKeys.CrossFilterScoping: {
        openScopingModal();
        break;
      }
      case MenuKeys.ViewResults: {
        if (resultsMenuRef.current && !resultsMenuRef.current.showModal) {
          resultsMenuRef.current.open(domEvent);
        }
        break;
      }
      case MenuKeys.DrillToDetail: {
        setDrillModalIsOpen(!drillModalIsOpen);
        break;
      }
      case MenuKeys.ViewQuery: {
        if (queryMenuRef.current && !queryMenuRef.current.showModal) {
          queryMenuRef.current.open(domEvent);
        }
        break;
      }
      case MenuKeys.SendVerificationEmail: {
        setSendVerifyModalOpen(true);
        break;
      }
      case MenuKeys.HoldFunds: {
        setPendingSettlementAction('hold');
        setSettlementModalOpen(true);
        break;
      }
      case MenuKeys.BlockDeviceFingerprint: {
        setDeviceFingerprintModalOpen(true);
        break;
      }
      default:
        break;
    }
    setIsDropdownVisible(false);
  };

  const {
    componentId,
    dashboardId,
    slice,
    isFullSize,
    cachedDttm = [],
    updatedDttm = null,
    addSuccessToast = () => {},
    addDangerToast = () => {},
    supersetCanShare = false,
    isCached = [],
  } = props;
  const isTable = slice.viz_type === VizType.Table;
  const isPivotTable = slice.viz_type === VizType.PivotTable;
  const cachedWhen = (cachedDttm || []).map(itemCachedDttm =>
    extendedDayjs.utc(itemCachedDttm).fromNow(),
  );
  const updatedWhen = updatedDttm
    ? extendedDayjs.utc(updatedDttm).fromNow()
    : '';
  const getCachedTitle = (itemCached: boolean) => {
    if (itemCached) {
      return t('Cached %s', cachedWhen);
    }
    if (updatedWhen) {
      return t('Fetched %s', updatedWhen);
    }
    return '';
  };
  const refreshTooltipData = [...new Set(isCached.map(getCachedTitle) || '')];
  // If all queries have same cache time we can unit them to one
  const refreshTooltip = refreshTooltipData.map((item, index) => (
    <div key={`tooltip-${index}`}>
      {refreshTooltipData.length > 1
        ? t('Query %s: %s', index + 1, item)
        : item}
    </div>
  ));
  const fullscreenLabel = isFullSize
    ? t('Exit fullscreen')
    : t('Enter fullscreen');

  // @z-index-below-dashboard-header (100) - 1 = 99 for !isFullSize and 101 for isFullSize
  const dropdownOverlayStyle = {
    zIndex: isFullSize ? 101 : 99,
    animationDuration: '0s',
  };

  const menu = (
    <Menu
      onClick={handleMenuClick}
      data-test={`slice_${slice.slice_id}-menu`}
      id={`slice_${slice.slice_id}-menu`}
      selectable={false}
    >
      <Menu.Item
        key={MenuKeys.ForceRefresh}
        disabled={props.chartStatus === 'loading'}
        style={{ height: 'auto', lineHeight: 'initial' }}
        data-test="refresh-chart-menu-item"
      >
        {t('Force refresh')}
        <RefreshTooltip data-test="dashboard-slice-refresh-tooltip">
          {refreshTooltip}
        </RefreshTooltip>
      </Menu.Item>

      <Menu.Item key={MenuKeys.Fullscreen}>{fullscreenLabel}</Menu.Item>

      <Menu.Divider />

      {slice.description && (
        <Menu.Item key={MenuKeys.ToggleChartDescription}>
          {props.isDescriptionExpanded
            ? t('Hide chart description')
            : t('Show chart description')}
        </Menu.Item>
      )}

      {canExplore && (
        <Menu.Item
          key={MenuKeys.ExploreChart}
          data-test-edit-chart-name={slice.slice_name}
        >
          <Tooltip title={getSliceHeaderTooltip(props.slice.slice_name)}>
            {t('Edit chart')}
          </Tooltip>
        </Menu.Item>
      )}

      {canEditCrossFilters && (
        <Menu.Item key={MenuKeys.CrossFilterScoping}>
          {t('Cross-filtering scoping')}
        </Menu.Item>
      )}

      {(canExplore || canEditCrossFilters) && <Menu.Divider />}

      {(canExplore || canViewQuery) && (
        <Menu.Item key={MenuKeys.ViewQuery}>
          <ModalTrigger
            triggerNode={
              <div data-test="view-query-menu-item">{t('View query')}</div>
            }
            modalTitle={t('View query')}
            modalBody={<ViewQueryModal latestQueryFormData={props.formData} />}
            draggable
            resizable
            responsive
            ref={queryMenuRef}
          />
        </Menu.Item>
      )}

      {(canExplore || canViewTable) && (
        <Menu.Item key={MenuKeys.ViewResults}>
          <ViewResultsModalTrigger
            canExplore={props.supersetCanExplore}
            exploreUrl={props.exploreUrl}
            triggerNode={
              <div data-test="view-query-menu-item">{t('View as table')}</div>
            }
            modalRef={resultsMenuRef}
            modalTitle={t('Chart Data: %s', slice.slice_name)}
            modalBody={
              <ResultsPaneOnDashboard
                queryFormData={props.formData}
                queryForce={false}
                dataSize={20}
                isRequest
                isVisible
                canDownload={!!props.supersetCanCSV}
              />
            }
          />
        </Menu.Item>
      )}

      {isFeatureEnabled(FeatureFlag.DrillToDetail) && canDrillToDetail && (
        <DrillDetailMenuItems
          setFilters={setFilters}
          filters={modalFilters}
          formData={props.formData}
          key={MenuKeys.DrillToDetail}
          setShowModal={setDrillModalIsOpen}
        />
      )}

      {(slice.description || canExplore) && <Menu.Divider />}

      {emailVerifyEnabled && hasRowsSelected && (
        <>
          <Menu.Item
            key={MenuKeys.SendVerificationEmail}
            data-test="send-verification-email-menu-item"
          >
            <Icons.MailOutlined
              css={css`
                margin-right: 8px;
                color: #1890ff;
              `}
            />
            {t('Send verification email')}
          </Menu.Item>
          <Menu.Divider />
        </>
      )}

      {settlementEnabled && hasRowsSelected && (
        <>
          <Menu.Item
            key={MenuKeys.HoldFunds}
            data-test="hold-funds-menu-item"
          >
            <Icons.LockOutlined
              css={css`
                margin-right: 8px;
                color: #fa8c16;
              `}
            />
            {t('Hold Funds')}
          </Menu.Item>
          <Menu.Divider />
        </>
      )}

      {deviceFingerprintBlockEnabled && hasRowsSelected && (
        <>
          <Menu.Item
            key={MenuKeys.BlockDeviceFingerprint}
            data-test="block-device-fingerprint-menu-item"
          >
            <Icons.WarningOutlined
              css={css`
                margin-right: 8px;
                color: #ff4d4f;
              `}
            />
            {t('Block Device Fingerprint')}
          </Menu.Item>
          <Menu.Divider />
        </>
      )}

      {supersetCanShare && (
        <ShareMenuItems
          dashboardId={dashboardId}
          dashboardComponentId={componentId}
          copyMenuItemTitle={t('Copy permalink to clipboard')}
          emailMenuItemTitle={t('Share chart by email')}
          emailSubject={t('Superset chart')}
          emailBody={t('Check out this chart: ')}
          addSuccessToast={addSuccessToast}
          addDangerToast={addDangerToast}
          title={t('Share')}
        />
      )}

      {props.supersetCanCSV && (
        <Menu.SubMenu title={t('Download')} key={MenuKeys.Download}>
          <Menu.Item
            key={MenuKeys.ExportCsv}
            icon={<Icons.FileOutlined css={dropdownIconsStyles} />}
          >
            {t('Export to .CSV')}
          </Menu.Item>
          {isPivotTable && (
            <Menu.Item
              key={MenuKeys.ExportPivotCsv}
              icon={<Icons.FileOutlined css={dropdownIconsStyles} />}
            >
              {t('Export to Pivoted .CSV')}
            </Menu.Item>
          )}
          <Menu.Item
            key={MenuKeys.ExportXlsx}
            icon={<Icons.FileOutlined css={dropdownIconsStyles} />}
          >
            {t('Export to Excel')}
          </Menu.Item>

          {isFeatureEnabled(FeatureFlag.AllowFullCsvExport) &&
            props.supersetCanCSV &&
            isTable && (
              <>
                <Menu.Item
                  key={MenuKeys.ExportFullCsv}
                  icon={<Icons.FileOutlined css={dropdownIconsStyles} />}
                >
                  {t('Export to full .CSV')}
                </Menu.Item>
                <Menu.Item
                  key={MenuKeys.ExportFullXlsx}
                  icon={<Icons.FileOutlined css={dropdownIconsStyles} />}
                >
                  {t('Export to full Excel')}
                </Menu.Item>
              </>
            )}

          <Menu.Item
            key={MenuKeys.DownloadAsImage}
            icon={<Icons.FileImageOutlined css={dropdownIconsStyles} />}
          >
            {t('Download as image')}
          </Menu.Item>
        </Menu.SubMenu>
      )}
    </Menu>
  );

  return (
    <>
      {isFullSize && (
        <Icons.FullscreenExitOutlined
          style={{ fontSize: 22 }}
          onClick={() => {
            props.handleToggleFullSize();
          }}
        />
      )}
      <NoAnimationDropdown
        dropdownRender={() => menu}
        overlayStyle={dropdownOverlayStyle}
        trigger={['click']}
        placement="bottomRight"
        open={isDropdownVisible}
        onOpenChange={visible => setIsDropdownVisible(visible)}
      >
        <Button
          type="link"
          id={`slice_${slice.slice_id}-controls`}
          aria-label="More Options"
          aria-haspopup="true"
        >
          <VerticalDotsTrigger />
        </Button>
      </NoAnimationDropdown>
      <DrillDetailModal
        formData={props.formData}
        initialFilters={[]}
        onHideModal={() => {
          setDrillModalIsOpen(false);
        }}
        chartId={slice.slice_id}
        showModal={drillModalIsOpen}
      />

      {emailVerifyEnabled && (
        <SendVerifyModal
          visible={sendVerifyModalOpen}
          dashboardId={dashboardId}
          chartId={slice.slice_id}
          selectedRows={selectedRows}
          onClose={() => setSendVerifyModalOpen(false)}
        />
      )}

      {settlementEnabled && (
        <SettlementModal
          visible={settlementModalOpen}
          action={pendingSettlementAction}
          dashboardId={dashboardId}
          chartId={slice.slice_id}
          selectedRows={selectedRows}
          settlementConfig={settlementConfig || { enabled: true }}
          onClose={() => setSettlementModalOpen(false)}
        />
      )}

      {deviceFingerprintBlockEnabled && (
        <DeviceFingerprintBlockModal
          visible={deviceFingerprintModalOpen}
          dashboardId={dashboardId}
          chartId={slice.slice_id}
          selectedRows={selectedRows}
          deviceFingerprintConfig={deviceFingerprintConfig || { enabled: true }}
          onClose={() => setDeviceFingerprintModalOpen(false)}
        />
      )}

      {canEditCrossFilters && scopingModal}
    </>
  );
};

export default SliceHeaderControls;
