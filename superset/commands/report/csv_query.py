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

from __future__ import annotations

import io
import logging
from timeit import default_timer
from uuid import UUID

import pandas as pd
from celery.exceptions import SoftTimeLimitExceeded
from flask_babel import lazy_gettext as _

from superset import app, jinja_context, security_manager
from superset.commands.base import BaseCommand
from superset.commands.report.exceptions import (
    AlertCsvAttachmentSizeError,
    AlertCsvQueryEmptyError,
    AlertCsvQueryError,
    AlertCsvQueryTimeout,
)
from superset.reports.models import ReportSchedule
from superset.tasks.utils import get_executor
from superset.utils.core import override_user
from superset.utils.decorators import logs_context

logger = logging.getLogger(__name__)

# Safety cap on rows fetched by the CSV query (overridable via config).
_DEFAULT_CSV_MAX_ROWS = 1_000
# Maximum attachment size in megabytes (overridable via config).
_DEFAULT_CSV_MAX_ATTACHMENT_SIZE_MB = 10


class AlertCsvQueryCommand(BaseCommand):
    """
    Execute the CSV attachment query for an alert and return the result as
    UTF-8-encoded CSV bytes.

    Parameters
    ----------
    report_schedule:
        The ``ReportSchedule`` ORM object.  Must have ``database`` populated and
        ``extra`` containing ``csv_query``.
    execution_id:
        UUID of the current execution (used for structured logging).
    """

    def __init__(self, report_schedule: ReportSchedule, execution_id: UUID) -> None:
        self._report_schedule = report_schedule
        self._execution_id = execution_id

    # Public interface

    def run(self) -> bytes:
        """
        Execute the CSV attachment query and return the result as CSV bytes.

        :raises AlertCsvQueryError: query failed to execute
        :raises AlertCsvQueryEmptyError: query returned zero rows
        :raises AlertCsvQueryTimeout: Celery soft-timeout exceeded
        :raises AlertCsvAttachmentSizeError: generated CSV exceeds size limit
        """
        df = self._execute_csv_query()
        if df.empty:
            raise AlertCsvQueryEmptyError()

        return self._dataframe_to_csv_bytes(df)

    def validate(self) -> None:
        """Intentionally a no-op — validation is performed inside run()."""


    def _get_csv_metadata_from_object(self) -> dict:
        return {
            "report_schedule_id": self._report_schedule.id,
            "execution_id": self._execution_id,
        }

    @logs_context(context_func=_get_csv_metadata_from_object)
    def _execute_csv_query(self) -> pd.DataFrame:
        """
        Render Jinja in the configured CSV query, apply the row cap, and
        execute it against the alert's database.

        :raises AlertCsvQueryError: any execution-level failure
        :raises AlertCsvQueryTimeout: Celery soft-timeout
        """
        csv_query: str = (self._report_schedule.extra or {}).get("csv_query", "")
        if not csv_query or not csv_query.strip():
            raise AlertCsvQueryError(
                message=_("CSV query is empty or not configured.")
            )

        # Render Jinja template (same pipeline as the threshold query).
        sql_template = jinja_context.get_template_processor(
            database=self._report_schedule.database
        )
        try:
            rendered_sql = sql_template.process_template(csv_query)
        except Exception as ex:  # pylint: disable=broad-except
            raise AlertCsvQueryError(
                message=_("Failed to render CSV query template: %(err)s", err=str(ex))
            ) from ex

        # Apply row limit to prevent unbounded result sets.
        max_rows: int = app.config.get("ALERT_CSV_MAX_ROWS", _DEFAULT_CSV_MAX_ROWS)
        try:
            limited_sql = self._report_schedule.database.apply_limit_to_sql(
                rendered_sql, max_rows
            )
        except Exception as ex:  # pylint: disable=broad-except
            logger.warning("Could not apply row limit to CSV query: %s", ex)
            limited_sql = rendered_sql

        # Execute as the configured executor user.
        _, username = get_executor(
            executors=app.config["ALERT_REPORTS_EXECUTORS"],
            model=self._report_schedule,
        )
        user = security_manager.find_user(username)

        try:
            with override_user(user):
                start = default_timer()
                df = self._report_schedule.database.get_df(sql=limited_sql)
                elapsed = (default_timer() - start) * 1000.0
                logger.info(
                    "CSV attachment query for alert '%s' returned %d rows in %.2f ms",
                    self._report_schedule.name,
                    len(df),
                    elapsed,
                )
                return df
        except SoftTimeLimitExceeded as ex:
            logger.warning(
                "Soft time-limit exceeded while executing CSV attachment query "
                "for alert '%s'",
                self._report_schedule.name,
            )
            raise AlertCsvQueryTimeout() from ex
        except Exception as ex:  # pylint: disable=broad-except
            logger.warning(
                "An error occurred while executing the CSV attachment query "
                "for alert '%s': %s",
                self._report_schedule.name,
                ex,
            )
            raise AlertCsvQueryError(
                message=_(
                    "An error occurred while executing the CSV attachment query."
                )
            ) from ex

    def _dataframe_to_csv_bytes(self, df: pd.DataFrame) -> bytes:
        """
        Serialize *df* to UTF-8 CSV bytes and validate against the configured
        attachment-size limit.

        :raises AlertCsvAttachmentSizeError: CSV exceeds the size limit
        """
        buffer = io.StringIO()
        df.to_csv(buffer, index=False)
        csv_str = buffer.getvalue()
        csv_bytes = csv_str.encode("utf-8")

        max_size_mb: float = app.config.get(
            "ALERT_CSV_MAX_ATTACHMENT_SIZE_MB", _DEFAULT_CSV_MAX_ATTACHMENT_SIZE_MB
        )
        max_size_bytes = int(max_size_mb * 1024 * 1024)

        if len(csv_bytes) > max_size_bytes:
            logger.warning(
                "CSV attachment for alert '%s' is %.2f MB which exceeds the "
                "%.1f MB limit; attachment will be skipped.",
                self._report_schedule.name,
                len(csv_bytes) / (1024 * 1024),
                max_size_mb,
            )
            raise AlertCsvAttachmentSizeError()

        return csv_bytes
