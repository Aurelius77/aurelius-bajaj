"""Fetch and align Elexon wind actuals and day-ahead forecast records."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, time, timedelta, timezone
from statistics import mean
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo
import json

API_ROOT = "https://data.elexon.co.uk/bmrs/api/v1/datasets"
LONDON = ZoneInfo("Europe/London")
UTC = timezone.utc


class ElexonDataError(Exception):
    """Raised when Elexon data cannot be fetched or cannot be safely aligned."""


def _get_json(dataset: str, params: dict[str, str]) -> list[dict]:
    url = f"{API_ROOT}/{dataset}/stream?{urlencode(params)}"
    request = Request(url, headers={"Accept": "application/json"})
    try:
        with urlopen(request, timeout=90) as response:
            payload = json.load(response)
    except Exception as exc:
        raise ElexonDataError(f"Could not retrieve {dataset} data from Elexon: {exc}") from exc
    if not isinstance(payload, list):
        raise ElexonDataError(f"Elexon returned an unexpected response for {dataset}.")
    return payload


def _parse_timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _as_zulu(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _generation(row: dict) -> float:
    value = row.get("generation")
    if value is None:
        raise ElexonDataError("Elexon returned a row without a generation value.")
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise ElexonDataError("Elexon returned a non-numeric generation value.") from exc


def load_january_2026_analysis() -> dict:
    """Return hourly January 2026 pairs using the latest forecast by 11:00 UK D-1."""
    month_start = datetime(2026, 1, 1, tzinfo=UTC)
    month_end = datetime(2026, 2, 1, tzinfo=UTC)
    forecast_from = datetime(2025, 12, 31, tzinfo=UTC)
    expected_hours = int((month_end - month_start).total_seconds() // 3600)
    expected_half_hours = expected_hours * 2

    actual_rows = _get_json(
        "FUELHH",
        {
            "settlementDateFrom": "2026-01-01",
            "settlementDateTo": "2026-01-31",
            "fuelType": "WIND",
        },
    )
    forecast_rows = _get_json(
        "WINDFOR",
        {
            "publishDateTimeFrom": _as_zulu(forecast_from),
            "publishDateTimeTo": _as_zulu(month_end),
        },
    )

    actuals_by_hour: dict[datetime, list[float]] = defaultdict(list)
    for row in actual_rows:
        if row.get("fuelType") != "WIND":
            continue
        start = _parse_timestamp(row["startTime"])
        if month_start <= start < month_end:
            actuals_by_hour[start.replace(minute=0, second=0, microsecond=0)].append(_generation(row))

    forecasts_by_hour: dict[datetime, dict] = {}
    duplicate_forecasts = 0
    for row in forecast_rows:
        start = _parse_timestamp(row["startTime"])
        if not month_start <= start < month_end or start.minute != 0:
            continue
        published = _parse_timestamp(row["publishTime"])
        delivery_date = start.astimezone(LONDON).date()
        cutoff = datetime.combine(delivery_date - timedelta(days=1), time(11, 0), LONDON).astimezone(UTC)
        if published > cutoff:
            continue
        existing = forecasts_by_hour.get(start)
        if existing is not None:
            existing_published = _parse_timestamp(existing["publishTime"])
            if published == existing_published:
                if _generation(existing) != _generation(row):
                    raise ElexonDataError(
                        f"Conflicting forecast rows for {row['startTime']} published at {row['publishTime']}."
                    )
                duplicate_forecasts += 1
                continue
            if published < existing_published:
                continue
        forecasts_by_hour[start] = row

    periods = []
    missing_actual_hours = []
    invalid_actual_hours = []
    missing_forecast_hours = []
    for offset in range(expected_hours):
        start = month_start + timedelta(hours=offset)
        actual_values = actuals_by_hour.get(start, [])
        forecast = forecasts_by_hour.get(start)
        if len(actual_values) == 0:
            missing_actual_hours.append(_as_zulu(start))
        elif len(actual_values) != 2:
            invalid_actual_hours.append(_as_zulu(start))
        if forecast is None:
            missing_forecast_hours.append(_as_zulu(start))
        if len(actual_values) != 2 or forecast is None:
            continue

        actual_mw = mean(actual_values)
        forecast_mw = _generation(forecast)
        error_mw = forecast_mw - actual_mw
        periods.append(
            {
                "startTime": _as_zulu(start),
                "forecastPublishTime": forecast["publishTime"],
                "forecastMW": forecast_mw,
                "actualMW": actual_mw,
                "errorMW": error_mw,
                "absoluteErrorMW": abs(error_mw),
            }
        )

    if not periods:
        raise ElexonDataError("No complete forecast/actual periods were available for January 2026.")

    errors = [period["absoluteErrorMW"] for period in periods]
    total_actual = sum(period["actualMW"] for period in periods)
    wape = sum(errors) / total_actual * 100 if total_actual else None
    return {
        "month": "2026-01",
        "source": "Elexon BMRS",
        "decisionRule": {
            "description": "For each delivery day, select the newest WINDFOR forecast published by 11:00 Europe/London on the previous calendar day.",
            "cutoffLocalTime": "11:00 Europe/London on delivery date minus one day",
            "status": "Pilot assumption; confirm with the client if their operational cutoff differs.",
        },
        "resolution": {
            "forecast": "hourly",
            "actual": "half-hourly, averaged into hourly values to match WINDFOR",
            "unit": "MW",
        },
        "summary": {
            "expectedHours": expected_hours,
            "actualHalfHoursReturned": sum(len(values) for values in actuals_by_hour.values()),
            "matchedHours": len(periods),
            "coveragePercent": len(periods) / expected_hours * 100,
            "maeMW": mean(errors),
            "biasMW": mean(period["errorMW"] for period in periods),
            "wapePercent": wape,
            "duplicateForecastRowsIgnored": duplicate_forecasts,
        },
        "dataQuality": {
            "missingActualHours": missing_actual_hours,
            "invalidActualHours": invalid_actual_hours,
            "missingForecastHours": missing_forecast_hours,
        },
        "periods": periods,
    }
