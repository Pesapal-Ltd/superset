# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.
import logging
from datetime import datetime, timedelta
from typing import Any, Optional, Union
from uuid import UUID

import pandas as pd
from celery.exceptions import SoftTimeLimitExceeded

from superset import app, db, security_manager
from superset.commands.base import BaseCommand
from superset.commands.dashboard.permalink.create import CreateDashboardPermalinkCommand
from superset.commands.exceptions import CommandException, UpdateFailedError
from superset.commands.report.alert import AlertCommand
from superset.commands.report.csv_query import AlertCsvQueryCommand
from superset.commands.report.exceptions import (
    AlertCsvAttachmentSizeError,
    AlertCsvQueryEmptyError,
    AlertCsvQueryError,
    AlertCsvQueryTimeout,
    ReportScheduleAlertGracePeriodError,
    ReportScheduleClientErrorsException,
    ReportScheduleCsvFailedError,
    ReportScheduleCsvTimeout,
    ReportScheduleDataFrameFailedError,
    ReportScheduleDataFrameTimeout,
    ReportScheduleExecuteUnexpectedError,
    ReportScheduleNotFoundError,
    ReportSchedulePreviousWorkingError,
    ReportScheduleScreenshotFailedError,
    ReportScheduleScreenshotTimeout,
    ReportScheduleStateNotFoundError,
    ReportScheduleSystemErrorsException,
    ReportScheduleUnexpectedError,
    ReportScheduleWorkingTimeoutError,
)
from superset.common.chart_data import ChartDataResultFormat, ChartDataResultType
from superset.daos.report import (
    REPORT_SCHEDULE_ERROR_NOTIFICATION_MARKER,
    ReportScheduleDAO,
)
from superset.dashboards.permalink.types import DashboardPermalinkState
from superset.errors import ErrorLevel, SupersetError, SupersetErrorType
from superset.exceptions import SupersetErrorsException, SupersetException
from superset.extensions import feature_flag_manager, machine_auth_provider_factory
from superset.reports.models import (
    ReportDataFormat,
    ReportExecutionLog,
    ReportRecipients,
    ReportRecipientType,
    ReportSchedule,
    ReportScheduleType,
    ReportSourceFormat,
    ReportState,
)
from superset.reports.notifications import create_notification
from superset.reports.notifications.base import NotificationContent
from superset.reports.notifications.exceptions import (
    NotificationError,
    NotificationParamException,
    SlackV1NotificationError,
)
from superset.tasks.utils import get_executor
from superset.utils import json
from superset.utils.core import HeaderDataType, override_user, recipients_string_to_list
from superset.utils.csv import get_chart_csv_data, get_chart_dataframe
from superset.utils.decorators import logs_context, transaction
from superset.utils.pdf import build_pdf_from_screenshots
from superset.utils.screenshots import ChartScreenshot, DashboardScreenshot
from superset.utils.slack import get_channels_with_search, SlackChannelTypes
from superset.utils.urls import get_url_path

logger = logging.getLogger(__name__)


class BaseReportState:
    current_states: list[ReportState] = []
    initial: bool = False

    @logs_context()
    def __init__(
        self,
        report_schedule: ReportSchedule,
        scheduled_dttm: datetime,
        execution_id: UUID,
    ) -> None:
        self._report_schedule = report_schedule
        self._scheduled_dttm = scheduled_dttm
        self._start_dttm = datetime.utcnow()
        self._execution_id = execution_id

    def update_report_schedule_and_log(
        self,
        state: ReportState,
        error_message: Optional[str] = None,
    ) -> None:
        """
        Update the report schedule state et al. and reflect the change in the execution
        log.
        """
        self.update_report_schedule(state)
        self.create_log(error_message)

    def update_report_schedule(self, state: ReportState) -> None:
        """
        Update the report schedule state et al.

        When the report state is WORKING we must ensure that the values from the last
        execution run are cleared to ensure that they are not propagated to the
        execution log.
        """

        if state == ReportState.WORKING:
            self._report_schedule.last_value = None
            self._report_schedule.last_value_row_json = None

        self._report_schedule.last_state = state
        self._report_schedule.last_eval_dttm = datetime.utcnow()

    def update_report_schedule_slack_v2(self) -> None:
        """
        Update the report schedule type and channels for all slack recipients to v2.
        V2 uses ids instead of names for channels.
        """
        try:
            for recipient in self._report_schedule.recipients:
                if recipient.type == ReportRecipientType.SLACK:
                    recipient.type = ReportRecipientType.SLACKV2
                    slack_recipients = json.loads(recipient.recipient_config_json)
                    # V1 method allowed to use leading `#` in the channel name
                    channel_names = (slack_recipients["target"] or "").replace("#", "")
                    # we need to ensure that existing reports can also fetch
                    # ids from private channels
                    channels = get_channels_with_search(
                        search_string=channel_names,
                        types=[
                            SlackChannelTypes.PRIVATE,
                            SlackChannelTypes.PUBLIC,
                        ],
                        exact_match=True,
                    )
                    channels_list = recipients_string_to_list(channel_names)
                    if len(channels_list) != len(channels):
                        missing_channels = set(channels_list) - {
                            channel["name"] for channel in channels
                        }
                        msg = (
                            "Could not find the following channels: "
                            f"{', '.join(missing_channels)}"
                        )
                        raise UpdateFailedError(msg)
                    channel_ids = ",".join(channel["id"] for channel in channels)
                    recipient.recipient_config_json = json.dumps(
                        {
                            "target": channel_ids,
                        }
                    )
        except Exception as ex:
            # Revert to v1 to preserve configuration (requires manual fix)
            recipient.type = ReportRecipientType.SLACK
            msg = f"Failed to update slack recipients to v2: {str(ex)}"
            logger.exception(msg)
            raise UpdateFailedError(msg) from ex

    def create_log(self, error_message: Optional[str] = None) -> None:
        """
        Creates a Report execution log, uses the current computed last_value for Alerts
        """
        log = ReportExecutionLog(
            scheduled_dttm=self._scheduled_dttm,
            start_dttm=self._start_dttm,
            end_dttm=datetime.utcnow(),
            value=self._report_schedule.last_value,
            value_row_json=self._report_schedule.last_value_row_json,
            state=self._report_schedule.last_state,
            error_message=error_message,
            report_schedule=self._report_schedule,
            uuid=self._execution_id,
        )
        db.session.add(log)
        db.session.commit()  # pylint: disable=consider-using-transaction

    def _get_url(
        self,
        user_friendly: bool = False,
        result_format: Optional[ChartDataResultFormat] = None,
        **kwargs: Any,
    ) -> str:
        """
        Get the url for this report schedule: chart or dashboard
        """
        force = "true" if self._report_schedule.force_screenshot else "false"
        # In CSV-only alert mode neither a chart nor a dashboard is configured;
        # return None so callers can skip URL-dependent rendering gracefully.
        if (
            not self._report_schedule.chart
            and not self._report_schedule.dashboard
        ):
            return None  # type: ignore[return-value]
        if self._report_schedule.chart:
            dashboard_state = (self._report_schedule.extra or {}).get("dashboard") or {}
            data_mask = dashboard_state.get("dataMask") or {}
            from superset.utils.core import get_adhoc_filters_from_data_mask

            logger.info(
                "Report execution: chart_id=%s, data_mask=%s",
                self._report_schedule.chart_id,
                data_mask,
            )

            adhoc_filters = get_adhoc_filters_from_data_mask(data_mask)

            extra_form_data: dict[str, Any] = {}
            for filter_state in data_mask.values():
                filter_extra = filter_state.get("extraFormData", {})
                for k, v in filter_extra.items():
                    if k in ("filters", "adhoc_filters") and isinstance(v, list):
                        extra_form_data.setdefault(k, []).extend(v)
                    else:
                        extra_form_data[k] = v

            has_filters = bool(adhoc_filters or extra_form_data)

            # Build merged form_data starting from the chart's full DB form_data.
            # This is crucial: datasource, viz_type, metrics, etc. must all be present
            # so the backend can correctly resolve the chart's data source.
            chart = self._report_schedule.chart
            merged_form_data: dict[str, Any] = chart.form_data.copy()

            if adhoc_filters:
                # Combine injected filters with any existing ones from the chart
                existing = merged_form_data.get("adhoc_filters") or []
                merged_form_data["adhoc_filters"] = existing + adhoc_filters

            if extra_form_data:
                # extra_form_data contains overrides like time_range, extra filters
                merged_form_data["extra_form_data"] = extra_form_data
                if "time_range" in extra_form_data:
                    merged_form_data["time_range"] = extra_form_data["time_range"]
                if "granularity_sqla" in extra_form_data:
                    merged_form_data["granularity_sqla"] = extra_form_data[
                        "granularity_sqla"
                    ]

            logger.info(
                "Report URL generation: chart_id=%s, has_filters=%s, adhoc_filter_count=%s",
                self._report_schedule.chart_id,
                has_filters,
                len(adhoc_filters),
            )

            if result_format in {
                ChartDataResultFormat.CSV,
                ChartDataResultFormat.JSON,
            }:
                if has_filters:
                    # Pass the full merged form_data (with datasource) to explore_json.
                    # The old Superset.explore_json view reads form_data from URL args via
                    # get_form_data(), and with datasource present it resolves correctly.
                    kwargs[result_format.value] = "true"
                    return get_url_path(
                        "Superset.explore_json",
                        user_friendly=user_friendly,
                        form_data=json.dumps(merged_form_data),
                        force=force,
                        **kwargs,
                    )
                return get_url_path(
                    "ChartDataRestApi.get_data",
                    pk=self._report_schedule.chart_id,
                    format=result_format.value,
                    type=ChartDataResultType.POST_PROCESSED.value,
                    force=force,
                )

            if has_filters:
                # For screenshot URLs, passing form_data raw in the URL does NOT work.
                # The React frontend calls GET api/v1/explore/?slice_id=... which ignores
                # adhoc_filters/extra_form_data from URL params entirely and only loads
                # the chart's DB-stored form_data.
                #
                # Fix: store the merged form_data in the explore cache and pass
                # form_data_key so the frontend fetches the correct filtered state.
                from superset.extensions import cache_manager
                from superset.key_value.utils import random_key
                from superset.commands.explore.form_data.state import (
                    TemporaryExploreState,
                )
                from superset.utils.core import DatasourceType as _DatasourceType

                form_data_key = random_key()
                datasource_id = chart.datasource_id
                datasource_type = chart.datasource_type or "table"

                state: TemporaryExploreState = {
                    "owner": None,
                    "datasource_id": datasource_id,
                    "datasource_type": _DatasourceType(datasource_type),
                    "chart_id": self._report_schedule.chart_id,
                    "form_data": json.dumps(merged_form_data),
                }
                cache_manager.explore_form_data_cache.set(form_data_key, state)
                logger.info(
                    "Cached filtered form_data with key=%s for chart_id=%s",
                    form_data_key,
                    self._report_schedule.chart_id,
                )
                return get_url_path(
                    "ExploreView.root",
                    user_friendly=user_friendly,
                    form_data_key=form_data_key,
                    force=force,
                    standalone="true",
                    **kwargs,
                )

            # No dashboard filters — use slice_id directly (no cache write needed)
            return get_url_path(
                "ExploreView.root",
                user_friendly=user_friendly,
                slice_id=self._report_schedule.chart_id,
                force=force,
                standalone="true",
                **kwargs,
            )
        # If we need to render dashboard in a specific state, use stateful permalink
        if (
            dashboard_state := self._report_schedule.extra.get("dashboard")
        ) and feature_flag_manager.is_feature_enabled("ALERT_REPORT_TABS"):
            return self._get_tab_url(dashboard_state, user_friendly=user_friendly)

        dashboard = self._report_schedule.dashboard
        dashboard_id_or_slug = (
            dashboard.uuid if dashboard and dashboard.uuid else dashboard.id
        )
        return get_url_path(
            "Superset.dashboard",
            user_friendly=user_friendly,
            dashboard_id_or_slug=dashboard_id_or_slug,
            force=force,
            **kwargs,
        )

    def get_dashboard_urls(
        self, user_friendly: bool = False, **kwargs: Any
    ) -> list[str]:
        """
        Retrieve the URL for the dashboard tabs, or return the dashboard URL if no tabs are available.
        """  # noqa: E501
        force = "true" if self._report_schedule.force_screenshot else "false"
        if (
            dashboard_state := self._report_schedule.extra.get("dashboard")
        ) and feature_flag_manager.is_feature_enabled("ALERT_REPORT_TABS"):
            if anchor := dashboard_state.get("anchor"):
                try:
                    anchor_list: list[str] = json.loads(anchor)
                    return self._get_tabs_urls(anchor_list, user_friendly=user_friendly)
                except json.JSONDecodeError:
                    logger.debug("Anchor value is not a list, Fall back to single tab")
            return [self._get_tab_url(dashboard_state)]

        dashboard = self._report_schedule.dashboard
        dashboard_id_or_slug = (
            dashboard.uuid if dashboard and dashboard.uuid else dashboard.id
        )

        return [
            get_url_path(
                "Superset.dashboard",
                user_friendly=user_friendly,
                dashboard_id_or_slug=dashboard_id_or_slug,
                force=force,
                **kwargs,
            )
        ]

    def _get_tab_url(
        self, dashboard_state: DashboardPermalinkState, user_friendly: bool = False
    ) -> str:
        """
        Get one tab url
        """
        permalink_key = CreateDashboardPermalinkCommand(
            dashboard_id=str(self._report_schedule.dashboard.uuid),
            state=dashboard_state,
        ).run()
        return get_url_path(
            "Superset.dashboard_permalink",
            key=permalink_key,
            user_friendly=user_friendly,
        )

    def _get_tabs_urls(
        self, tab_anchors: list[str], user_friendly: bool = False
    ) -> list[str]:
        """
        Get multple tabs urls
        """
        return [
            self._get_tab_url(
                {
                    "anchor": tab_anchor,
                    "dataMask": None,
                    "activeTabs": None,
                    "urlParams": None,
                },
                user_friendly=user_friendly,
            )
            for tab_anchor in tab_anchors
        ]

    def _get_screenshots(self) -> list[bytes]:
        """
        Get chart or dashboard screenshots
        :raises: ReportScheduleScreenshotFailedError
        """
        _, username = get_executor(
            executors=app.config["ALERT_REPORTS_EXECUTORS"],
            model=self._report_schedule,
        )
        user = security_manager.find_user(username)

        max_width = app.config["ALERT_REPORTS_MAX_CUSTOM_SCREENSHOT_WIDTH"]

        if self._report_schedule.chart:
            url = self._get_url()

            window_width, window_height = app.config["WEBDRIVER_WINDOW"]["slice"]
            width = min(max_width, self._report_schedule.custom_width or window_width)
            height = self._report_schedule.custom_height or window_height
            window_size = (width, height)

            screenshots: list[Union[ChartScreenshot, DashboardScreenshot]] = [
                ChartScreenshot(
                    url,
                    self._report_schedule.chart.digest,
                    window_size=window_size,
                    thumb_size=app.config["WEBDRIVER_WINDOW"]["slice"],
                )
            ]
        else:
            urls = self.get_dashboard_urls()

            window_width, window_height = app.config["WEBDRIVER_WINDOW"]["dashboard"]
            width = min(max_width, self._report_schedule.custom_width or window_width)
            height = self._report_schedule.custom_height or window_height
            window_size = (width, height)

            screenshots = [
                DashboardScreenshot(
                    url,
                    self._report_schedule.dashboard.digest,
                    window_size=window_size,
                    thumb_size=app.config["WEBDRIVER_WINDOW"]["dashboard"],
                )
                for url in urls
            ]
        try:
            imges = []
            for screenshot in screenshots:
                if imge := screenshot.get_screenshot(user=user):
                    imges.append(imge)
        except SoftTimeLimitExceeded as ex:
            logger.warning("A timeout occurred while taking a screenshot.")
            raise ReportScheduleScreenshotTimeout() from ex
        except Exception as ex:
            raise ReportScheduleScreenshotFailedError(
                f"Failed taking a screenshot {str(ex)}"
            ) from ex
        if not imges:
            raise ReportScheduleScreenshotFailedError()
        return imges

    def _get_pdf(self) -> bytes:
        """
        Get chart or dashboard pdf
        :raises: ReportSchedulePdfFailedError
        """
        screenshots = self._get_screenshots()
        pdf = build_pdf_from_screenshots(screenshots)

        return pdf

    def _get_csv_data(self) -> bytes:
        url = self._get_url(result_format=ChartDataResultFormat.CSV)
        _, username = get_executor(
            executors=app.config["ALERT_REPORTS_EXECUTORS"],
            model=self._report_schedule,
        )
        user = security_manager.find_user(username)
        auth_cookies = machine_auth_provider_factory.instance.get_auth_cookies(user)

        if self._report_schedule.chart.query_context is None:
            logger.warning("No query context found, taking a screenshot to generate it")
            self._update_query_context()

        try:
            logger.info("Getting chart from %s as user %s", url, user.username)
            csv_data = get_chart_csv_data(chart_url=url, auth_cookies=auth_cookies)
        except SoftTimeLimitExceeded as ex:
            raise ReportScheduleCsvTimeout() from ex
        except Exception as ex:
            raise ReportScheduleCsvFailedError(
                f"Failed generating csv {str(ex)}"
            ) from ex
        if not csv_data:
            raise ReportScheduleCsvFailedError()
        return csv_data

    def _get_embedded_data(self) -> pd.DataFrame:
        """
        Return data as a Pandas dataframe, to embed in notifications as a table.
        """
        url = self._get_url(result_format=ChartDataResultFormat.JSON)
        _, username = get_executor(
            executors=app.config["ALERT_REPORTS_EXECUTORS"],
            model=self._report_schedule,
        )
        user = security_manager.find_user(username)
        auth_cookies = machine_auth_provider_factory.instance.get_auth_cookies(user)

        if self._report_schedule.chart.query_context is None:
            logger.warning("No query context found, taking a screenshot to generate it")
            self._update_query_context()

        try:
            logger.info("Getting chart from %s as user %s", url, user.username)
            dataframe = get_chart_dataframe(url, auth_cookies)
        except SoftTimeLimitExceeded as ex:
            raise ReportScheduleDataFrameTimeout() from ex
        except Exception as ex:
            raise ReportScheduleDataFrameFailedError(
                f"Failed generating dataframe {str(ex)}"
            ) from ex
        if dataframe is None:
            raise ReportScheduleCsvFailedError()
        return dataframe

    def _update_query_context(self) -> None:
        """
        Update chart query context.

        To load CSV data from the endpoint the chart must have been saved
        with its query context. For charts without saved query context we
        get a screenshot to force the chart to produce and save the query
        context.
        """
        try:
            self._get_screenshots()
        except (
            ReportScheduleScreenshotFailedError,
            ReportScheduleScreenshotTimeout,
        ) as ex:
            raise ReportScheduleCsvFailedError(
                "Unable to fetch data because the chart has no query context "
                "saved, and an error occurred when fetching it via a screenshot. "
                "Please try loading the chart and saving it again."
            ) from ex

    def _get_alert_csv_attachment(self) -> Optional[bytes]:
        """
        Execute the optional CSV query attachment and return the result as
        UTF-8 CSV bytes.

        This method applies graceful degradation: if the query fails, returns
        zero rows, times out, or exceeds the size limit the method logs a
        warning and returns ``None`` so the caller can still send the email
        without the attachment.

        :return: CSV bytes on success, ``None`` on any recoverable failure.
        """
        try:
            csv_bytes = AlertCsvQueryCommand(
                self._report_schedule, self._execution_id
            ).run()
            logger.info(
                "CSV attachment query succeeded for alert '%s' (%d bytes)",
                self._report_schedule.name,
                len(csv_bytes),
            )
            return csv_bytes
        except AlertCsvQueryEmptyError:
            logger.warning(
                "CSV attachment query for alert '%s' returned no rows; "
                "skipping attachment.",
                self._report_schedule.name,
            )
        except AlertCsvQueryTimeout:
            logger.warning(
                "CSV attachment query for alert '%s' timed out; "
                "skipping attachment.",
                self._report_schedule.name,
            )
        except AlertCsvAttachmentSizeError:
            logger.warning(
                "CSV attachment for alert '%s' exceeded the size limit; "
                "skipping attachment.",
                self._report_schedule.name,
            )
        except AlertCsvQueryError as ex:
            logger.error(
                "CSV attachment query for alert '%s' failed: %s; "
                "skipping attachment.",
                self._report_schedule.name,
                ex.message,
            )
        except Exception as ex:  # pylint: disable=broad-except
            logger.exception(
                "Unexpected error while generating CSV attachment for alert '%s': %s",
                self._report_schedule.name,
                str(ex),
            )
        return None

    def _get_log_data(self) -> HeaderDataType:
        chart_id = None
        dashboard_id = None
        report_source = None
        slack_channels = None
        if self._report_schedule.chart:
            report_source = ReportSourceFormat.CHART
            chart_id = self._report_schedule.chart_id
        else:
            report_source = ReportSourceFormat.DASHBOARD
            dashboard_id = self._report_schedule.dashboard_id

        if self._report_schedule.recipients:
            slack_channels = [
                recipient.recipient_config_json
                for recipient in self._report_schedule.recipients
                if recipient.type
                in [ReportRecipientType.SLACK, ReportRecipientType.SLACKV2]
            ]

        log_data: HeaderDataType = {
            "notification_type": self._report_schedule.type,
            "notification_source": report_source,
            "notification_format": self._report_schedule.report_format,
            "chart_id": chart_id,
            "dashboard_id": dashboard_id,
            "owners": self._report_schedule.owners,
            "slack_channels": slack_channels,
        }
        return log_data

    def _get_notification_content(self) -> NotificationContent:  # noqa: C901
        """
        Gets a notification content, this is composed by a title and a screenshot

        :raises: ReportScheduleScreenshotFailedError
        """
        csv_data = None
        screenshot_data = []
        pdf_data = None
        embedded_data = None
        error_text = None
        header_data = self._get_log_data()
        url = self._get_url(user_friendly=True)
        # In CSV-only alert mode there is no chart or dashboard to render.
        # Skip all screenshot / PDF / chart-CSV generation so we don't crash
        # inside _get_screenshots() / _get_pdf() when they call _get_url()
        # again, and avoid the spurious "Unexpected missing screenshot" error
        # from blocking the email before the CSV attachment is produced.
        csv_only_mode = (
            self._report_schedule.type == ReportScheduleType.ALERT
            and not self._report_schedule.chart
            and not self._report_schedule.dashboard
        )
        if not csv_only_mode and (
            feature_flag_manager.is_feature_enabled("ALERTS_ATTACH_REPORTS")
            or self._report_schedule.type == ReportScheduleType.REPORT
        ):
            if self._report_schedule.report_format == ReportDataFormat.PNG:
                screenshot_data = self._get_screenshots()
                if not screenshot_data:
                    error_text = "Unexpected missing screenshot"
            elif self._report_schedule.report_format == ReportDataFormat.PDF:
                pdf_data = self._get_pdf()
                if not pdf_data:
                    error_text = "Unexpected missing pdf"
            elif (
                self._report_schedule.chart
                and self._report_schedule.report_format == ReportDataFormat.CSV
            ):
                csv_data = self._get_csv_data()
                if not csv_data:
                    error_text = "Unexpected missing csv file"
            if error_text:
                return NotificationContent(
                    name=self._report_schedule.name,
                    text=error_text,
                    header_data=header_data,
                    url=url,
                )

        if (
            self._report_schedule.chart
            and self._report_schedule.report_format == ReportDataFormat.TEXT
        ):
            embedded_data = self._get_embedded_data()

        # CSV Query Attachment (alert-only, opt-in via extra.csv_enabled)
        
        # This path is completely independent of the chart-CSV path above.
        # It executes a user-defined SQL query *after* the threshold has
        # fired and attaches the results as a CSV to the outgoing email.
        # Failures are handled with graceful degradation: the email is sent
        # even when the CSV cannot be generated.
        if (
            self._report_schedule.type == ReportScheduleType.ALERT
            and (extra := (self._report_schedule.extra or {}))
            and extra.get("csv_enabled")
            and extra.get("csv_query")
        ):
            alert_csv = self._get_alert_csv_attachment()
            # Only override csv_data when not already populated by the
            # standard chart-CSV path so the two paths remain independent.
            if alert_csv is not None and csv_data is None:
                csv_data = alert_csv

        if self._report_schedule.email_subject:
            name = self._report_schedule.email_subject
        else:
            if self._report_schedule.chart:
                name = (
                    f"{self._report_schedule.name}: "
                    f"{self._report_schedule.chart.slice_name}"
                )
            elif self._report_schedule.dashboard:
                name = (
                    f"{self._report_schedule.name}: "
                    f"{self._report_schedule.dashboard.dashboard_title}"
                )
            else:
                # CSV-only alert: no chart or dashboard attached
                name = self._report_schedule.name

        return NotificationContent(
            name=name,
            url=url,
            screenshots=screenshot_data,
            pdf=pdf_data,
            description=self._report_schedule.description,
            csv=csv_data,
            embedded_data=embedded_data,
            header_data=header_data,
        )

    def _send(
        self,
        notification_content: NotificationContent,
        recipients: list[ReportRecipients],
    ) -> None:
        """
        Sends a notification to all recipients

        :raises: CommandException
        """
        notification_errors: list[SupersetError] = []
        for recipient in recipients:
            notification = create_notification(recipient, notification_content)
            try:
                try:
                    if app.config["ALERT_REPORTS_NOTIFICATION_DRY_RUN"]:
                        logger.info(
                            "Would send notification for alert %s, to %s. "
                            "ALERT_REPORTS_NOTIFICATION_DRY_RUN is enabled, "
                            "set it to False to send notifications.",
                            self._report_schedule.name,
                            recipient.recipient_config_json,
                        )
                    else:
                        notification.send()
                except SlackV1NotificationError as ex:
                    # The slack notification should be sent with the v2 api
                    logger.info(
                        "Attempting to upgrade the report to Slackv2: %s", str(ex)
                    )
                    self.update_report_schedule_slack_v2()
                    recipient.type = ReportRecipientType.SLACKV2
                    notification = create_notification(recipient, notification_content)
                    notification.send()
            except (
                UpdateFailedError,
                NotificationParamException,
                NotificationError,
                SupersetException,
            ) as ex:
                # collect errors but keep processing them
                notification_errors.append(
                    SupersetError(
                        message=ex.message,
                        error_type=SupersetErrorType.REPORT_NOTIFICATION_ERROR,
                        level=(
                            ErrorLevel.ERROR if ex.status >= 500 else ErrorLevel.WARNING
                        ),
                    )
                )
        if notification_errors:
            # log all errors but raise based on the most severe
            for error in notification_errors:
                logger.warning(str(error))

            if any(error.level == ErrorLevel.ERROR for error in notification_errors):
                raise ReportScheduleSystemErrorsException(errors=notification_errors)
            if any(error.level == ErrorLevel.WARNING for error in notification_errors):
                raise ReportScheduleClientErrorsException(errors=notification_errors)

    def send(self) -> None:
        """
        Creates the notification content and sends them to all recipients

        :raises: CommandException
        """
        notification_content = self._get_notification_content()
        self._send(notification_content, self._report_schedule.recipients)

    def send_error(self, name: str, message: str) -> None:
        """
        Creates and sends a notification for an error, to all recipients

        :raises: CommandException
        """
        header_data = self._get_log_data()
        url = self._get_url(user_friendly=True)
        logger.info(
            "header_data in notifications for alerts and reports %s, taskid, %s",
            header_data,
            self._execution_id,
        )
        notification_content = NotificationContent(
            name=name, text=message, header_data=header_data, url=url
        )

        # filter recipients to recipients who are also owners
        owner_recipients = [
            ReportRecipients(
                type=ReportRecipientType.EMAIL,
                recipient_config_json=json.dumps({"target": owner.email}),
            )
            for owner in self._report_schedule.owners
        ]

        self._send(notification_content, owner_recipients)

    def is_in_grace_period(self) -> bool:
        """
        Checks if an alert is in it's grace period
        """
        last_success = ReportScheduleDAO.find_last_success_log(self._report_schedule)
        return (
            last_success is not None
            and self._report_schedule.grace_period
            and datetime.utcnow()
            - timedelta(seconds=self._report_schedule.grace_period)
            < last_success.end_dttm
        )

    def is_in_error_grace_period(self) -> bool:
        """
        Checks if an alert/report on error is in it's notification grace period
        """
        last_success = ReportScheduleDAO.find_last_error_notification(
            self._report_schedule
        )
        if not last_success:
            return False
        return (
            last_success is not None
            and self._report_schedule.grace_period
            and datetime.utcnow()
            - timedelta(seconds=self._report_schedule.grace_period)
            < last_success.end_dttm
        )

    def is_on_working_timeout(self) -> bool:
        """
        Checks if an alert is in a working timeout
        """
        last_working = ReportScheduleDAO.find_last_entered_working_log(
            self._report_schedule
        )
        if not last_working:
            return False
        return (
            self._report_schedule.working_timeout is not None
            and self._report_schedule.last_eval_dttm is not None
            and datetime.utcnow()
            - timedelta(seconds=self._report_schedule.working_timeout)
            > last_working.end_dttm
        )

    def next(self) -> None:
        raise NotImplementedError()


class ReportNotTriggeredErrorState(BaseReportState):
    """
    Handle Not triggered and Error state
    next final states:
    - Not Triggered
    - Success
    - Error
    """

    current_states = [ReportState.NOOP, ReportState.ERROR]
    initial = True

    def next(self) -> None:
        self.update_report_schedule_and_log(ReportState.WORKING)
        try:
            # If it's an alert check if the alert is triggered
            if self._report_schedule.type == ReportScheduleType.ALERT:
                if not AlertCommand(self._report_schedule, self._execution_id).run():
                    self.update_report_schedule_and_log(ReportState.NOOP)
                    return
            self.send()
            self.update_report_schedule_and_log(ReportState.SUCCESS)
        except (SupersetErrorsException, Exception) as first_ex:
            error_message = str(first_ex)
            if isinstance(first_ex, SupersetErrorsException):
                error_message = ";".join([error.message for error in first_ex.errors])

            self.update_report_schedule_and_log(
                ReportState.ERROR, error_message=error_message
            )

            # TODO (dpgaspar) convert this logic to a new state eg: ERROR_ON_GRACE
            if not self.is_in_error_grace_period():
                second_error_message = REPORT_SCHEDULE_ERROR_NOTIFICATION_MARKER
                try:
                    self.send_error(
                        f"Error occurred for {self._report_schedule.type}:"
                        f" {self._report_schedule.name}",
                        str(first_ex),
                    )

                except SupersetErrorsException as second_ex:
                    second_error_message = ";".join(
                        [error.message for error in second_ex.errors]
                    )
                except Exception as second_ex:  # pylint: disable=broad-except
                    second_error_message = str(second_ex)
                finally:
                    self.update_report_schedule_and_log(
                        ReportState.ERROR, error_message=second_error_message
                    )
            raise


class ReportWorkingState(BaseReportState):
    """
    Handle Working state
    next states:
    - Error
    - Working
    """

    current_states = [ReportState.WORKING]

    def next(self) -> None:
        if self.is_on_working_timeout():
            exception_timeout = ReportScheduleWorkingTimeoutError()
            self.update_report_schedule_and_log(
                ReportState.ERROR,
                error_message=str(exception_timeout),
            )
            raise exception_timeout
        exception_working = ReportSchedulePreviousWorkingError()
        self.update_report_schedule_and_log(
            ReportState.WORKING,
            error_message=str(exception_working),
        )
        raise exception_working


class ReportSuccessState(BaseReportState):
    """
    Handle Success, Grace state
    next states:
    - Grace
    - Not triggered
    - Success
    """

    current_states = [ReportState.SUCCESS, ReportState.GRACE]

    def next(self) -> None:
        if self._report_schedule.type == ReportScheduleType.ALERT:
            if self.is_in_grace_period():
                self.update_report_schedule_and_log(
                    ReportState.GRACE,
                    error_message=str(ReportScheduleAlertGracePeriodError()),
                )
                return
            self.update_report_schedule_and_log(ReportState.WORKING)
            try:
                if not AlertCommand(self._report_schedule, self._execution_id).run():
                    self.update_report_schedule_and_log(ReportState.NOOP)
                    return
            except Exception as ex:
                self.send_error(
                    f"Error occurred for {self._report_schedule.type}:"
                    f" {self._report_schedule.name}",
                    str(ex),
                )
                self.update_report_schedule_and_log(
                    ReportState.ERROR,
                    error_message=REPORT_SCHEDULE_ERROR_NOTIFICATION_MARKER,
                )
                raise

        try:
            self.send()
            self.update_report_schedule_and_log(ReportState.SUCCESS)
        except Exception as ex:  # pylint: disable=broad-except
            self.update_report_schedule_and_log(
                ReportState.ERROR, error_message=str(ex)
            )


class ReportScheduleStateMachine:  # pylint: disable=too-few-public-methods
    """
    Simple state machine for Alerts/Reports states
    """

    states_cls = [ReportWorkingState, ReportNotTriggeredErrorState, ReportSuccessState]

    def __init__(
        self,
        task_uuid: UUID,
        report_schedule: ReportSchedule,
        scheduled_dttm: datetime,
    ):
        self._execution_id = task_uuid
        self._report_schedule = report_schedule
        self._scheduled_dttm = scheduled_dttm

    @transaction()
    def run(self) -> None:
        for state_cls in self.states_cls:
            if (self._report_schedule.last_state is None and state_cls.initial) or (
                self._report_schedule.last_state in state_cls.current_states
            ):
                state_cls(
                    self._report_schedule,
                    self._scheduled_dttm,
                    self._execution_id,
                ).next()
                break
        else:
            raise ReportScheduleStateNotFoundError()


class AsyncExecuteReportScheduleCommand(BaseCommand):
    """
    Execute all types of report schedules.
    - On reports takes chart or dashboard screenshots and sends configured notifications
    - On Alerts uses related Command AlertCommand and sends configured notifications
    """

    def __init__(self, task_id: str, model_id: int, scheduled_dttm: datetime):
        self._model_id = model_id
        self._model: Optional[ReportSchedule] = None
        self._scheduled_dttm = scheduled_dttm
        self._execution_id = UUID(task_id)

    @transaction()
    def run(self) -> None:
        try:
            self.validate()
            if not self._model:
                raise ReportScheduleExecuteUnexpectedError()
            _, username = get_executor(
                executors=app.config["ALERT_REPORTS_EXECUTORS"],
                model=self._model,
            )
            user = security_manager.find_user(username)
            with override_user(user):
                logger.info(
                    "Running report schedule %s as user %s",
                    self._execution_id,
                    username,
                )
                ReportScheduleStateMachine(
                    self._execution_id, self._model, self._scheduled_dttm
                ).run()
        except CommandException:
            raise
        except Exception as ex:
            raise ReportScheduleUnexpectedError(str(ex)) from ex

    def validate(self) -> None:
        # Validate/populate model exists
        logger.info(
            "session is validated: id %s, executionid: %s",
            self._model_id,
            self._execution_id,
        )
        self._model = (
            db.session.query(ReportSchedule).filter_by(id=self._model_id).one_or_none()
        )
        if not self._model:
            raise ReportScheduleNotFoundError()
