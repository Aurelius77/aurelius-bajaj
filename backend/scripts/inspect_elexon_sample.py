"""Inspect one delivery day of Elexon wind actuals and forecast revisions.

Example:
    python backend/scripts/inspect_elexon_sample.py 2026-01-13 --cutoff 11:00

The 11:00 Europe/London cutoff is a pilot assumption based on the day-ahead
auction close; confirm the client's operational decision time before relying on it.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from statistics import mean
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

API_ROOT = "https://data.elexon.co.uk/bmrs/api/v1/datasets"
LONDON = ZoneInfo("Europe/London")


def get_json(dataset: str, params: dict[str, str]) -> list[dict]:
    url = f"{API_ROOT}/{dataset}/stream?{urlencode(params)}"
    request = Request(url, headers={"Accept": "application/json"})
    with urlopen(request, timeout=60) as response:
        payload = json.load(response)
    if not isinstance(payload, list):
        raise ValueError(f"Expected a list from {dataset}; got {type(payload).__name__}")
    return payload


def utc_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("delivery_date", nargs="?", default="2026-01-13")
    parser.add_argument("--cutoff", default="11:00", help="Decision cutoff in UK local time (HH:MM)")
    args = parser.parse_args()

    delivery_day = date.fromisoformat(args.delivery_date)
    cutoff_clock = time.fromisoformat(args.cutoff)
    decision_time = datetime.combine(delivery_day - timedelta(days=1), cutoff_clock, LONDON)
    decision_time_utc = decision_time.astimezone(timezone.utc)
    delivery_start = datetime.combine(delivery_day, time.min, timezone.utc)
    delivery_end = delivery_start + timedelta(days=1)
    forecast_search_start = delivery_start - timedelta(days=1)

    actual_rows = get_json(
        "FUELHH",
        {
            "settlementDateFrom": delivery_day.isoformat(),
            "settlementDateTo": delivery_day.isoformat(),
            "fuelType": "WIND",
        },
    )
    forecast_rows = get_json(
        "WINDFOR",
        {
            "publishDateTimeFrom": forecast_search_start.isoformat().replace("+00:00", "Z"),
            "publishDateTimeTo": delivery_start.isoformat().replace("+00:00", "Z"),
        },
    )

    actuals_by_hour: dict[datetime, list[float]] = defaultdict(list)
    for row in actual_rows:
        start = utc_datetime(row["startTime"])
        if delivery_start <= start < delivery_end:
            hour_start = start.replace(minute=0, second=0, microsecond=0)
            actuals_by_hour[hour_start].append(float(row["generation"]))

    eligible_forecasts: dict[datetime, dict] = {}
    for row in forecast_rows:
        start = utc_datetime(row["startTime"])
        published = utc_datetime(row["publishTime"])
        if not (delivery_start <= start < delivery_end) or published > decision_time_utc:
            continue
        previous = eligible_forecasts.get(start)
        if previous is None or published > utc_datetime(previous["publishTime"]):
            eligible_forecasts[start] = row

    aligned = []
    for start, forecast in sorted(eligible_forecasts.items()):
        actual_values = actuals_by_hour.get(start, [])
        if len(actual_values) != 2:
            continue
        actual_mw = mean(actual_values)
        forecast_mw = float(forecast["generation"])
        aligned.append(
            {
                "startTime": start.isoformat().replace("+00:00", "Z"),
                "forecastPublishTime": forecast["publishTime"],
                "forecastMW": forecast_mw,
                "actualMW": actual_mw,
                "errorMW": forecast_mw - actual_mw,
            }
        )

    releases = sorted({row["publishTime"] for row in forecast_rows})
    print(f"Delivery date: {delivery_day} (UTC; January is GMT in the UK)")
    print(f"Decision cutoff: {decision_time.isoformat()} ({decision_time_utc.isoformat()})")
    print(f"Actual rows: {len(actual_rows)}; unique actual half-hours: {sum(map(len, actuals_by_hour.values()))}")
    print(f"Forecast rows returned: {len(forecast_rows)}")
    print(f"Forecast publication times: {', '.join(releases)}")
    print(f"Matched hourly periods (2 actual half-hours + eligible forecast): {len(aligned)}")
    if aligned:
        mae = mean(abs(row["errorMW"]) for row in aligned)
        print(f"Mean absolute error: {mae:.1f} MW")
        print("First aligned periods:")
        print(json.dumps(aligned[:3], indent=2))
    else:
        print("No complete hourly periods matched. Check API query parameters and returned records.")

    missing_actual = [hour for hour in eligible_forecasts if len(actuals_by_hour.get(hour, [])) != 2]
    missing_forecast = [hour for hour in actuals_by_hour if len(actuals_by_hour[hour]) == 2 and hour not in eligible_forecasts]
    print(f"Hours missing exactly two actual half-hours: {len(missing_actual)}")
    print(f"Hours without an eligible forecast: {len(missing_forecast)}")


if __name__ == "__main__":
    main()
