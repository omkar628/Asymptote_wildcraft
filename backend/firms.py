"""NASA FIRMS area client.

The map key is read from NASA_FIRMS_MAP_KEY. Request URLs contain that key,
so this module must not log URLs, response bodies, or the key itself.
"""

from __future__ import annotations

import csv
import logging
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from io import StringIO

import httpx

logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

FIRMS_PRODUCTS: dict[str, str] = {
    "VIIRS_SNPP_NRT": "VIIRS Suomi-NPP near real-time",
    "VIIRS_NOAA20_NRT": "VIIRS NOAA-20 near real-time",
    "VIIRS_NOAA21_NRT": "VIIRS NOAA-21 near real-time",
    "MODIS_NRT": "MODIS near real-time",
}

MAX_SPAN_DEGREES = 10.0
CACHE_SECONDS = 600
_cache_lock = threading.Lock()
_cache: dict[str, tuple[float, dict]] = {}


class FirmsError(Exception):
    def __init__(self, message: str, status_code: int) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def firms_map_key() -> str:
    return os.environ.get("NASA_FIRMS_MAP_KEY", "").strip()


def firms_status_payload() -> dict:
    return {
        "configured": bool(firms_map_key()),
        "max_days_per_request": 5,
        "max_days": 7,
        "products": [{"id": key, "label": label} for key, label in FIRMS_PRODUCTS.items()],
        "source": "NASA FIRMS area API",
        "documentation": "https://firms.modaps.eosdis.nasa.gov/api/area/",
    }


def scrub(text: str, map_key: str) -> str:
    if map_key and map_key in text:
        return text.replace(map_key, "[redacted]")
    return text


def area_path(product: str, west: float, south: float, east: float, north: float, days: int, date: str | None) -> str:
    area = f"{west:.4f},{south:.4f},{east:.4f},{north:.4f}"
    path = f"/api/area/csv/{{key}}/{product}/{area}/{days}"
    if date:
        path += f"/{date}"
    return path


def _validate(product: str, west: float, south: float, east: float, north: float, days: int, date: str | None) -> None:
    if product not in FIRMS_PRODUCTS:
        raise FirmsError(f"Unknown FIRMS product. Choose one of: {', '.join(FIRMS_PRODUCTS)}.", 422)
    if days < 1 or days > 7:
        raise FirmsError("FIRMS day window must be from 1 to 7. Each area call covers at most 5 days.", 422)
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise FirmsError("Area bounds must be west < east and south < north, inside the world extent.", 422)
    if east - west > MAX_SPAN_DEGREES or north - south > MAX_SPAN_DEGREES:
        raise FirmsError("The requested area is larger than 10 degrees on a side. Shrink the monitoring extent.", 422)
    if date is not None and (len(date) != 10 or date[4] != "-" or date[7] != "-"):
        raise FirmsError("Observation date must be YYYY-MM-DD.", 422)


def _windows(days: int) -> list[tuple[int, str | None]]:
    if days <= 5:
        return [(days, None)]
    today = datetime.now(timezone.utc).date()
    older_days = days - 5
    start = today - timedelta(days=days - 1)
    return [(5, None), (older_days, start.isoformat())]


def request_csv(url: str, timeout_s: float = 45.0) -> tuple[int, str]:
    try:
        response = httpx.get(url, timeout=timeout_s, headers={"Accept": "text/csv", "User-Agent": "WildcraftDesktop/0.1"})
    except httpx.TimeoutException:
        raise FirmsError("NASA FIRMS did not respond in time.", 504) from None
    except httpx.HTTPError:
        raise FirmsError("NASA FIRMS request failed.", 502) from None
    return response.status_code, response.text


def _raise_for_status(status: int, body: str) -> None:
    if status == 429:
        raise FirmsError("NASA FIRMS rate limit reached. Wait a few minutes, then refresh.", 429)
    if status in {401, 403}:
        raise FirmsError("NASA FIRMS rejected the map key.", 502)
    if status >= 400:
        raise FirmsError(f"NASA FIRMS returned HTTP {status}.", 502)
    first = body.lstrip("\ufeff").strip().splitlines()[:1]
    header = first[0].lower() if first else ""
    if "latitude" not in header:
        lowered = body.lower()
        if "invalid" in lowered or "map_key" in lowered or "map key" in lowered:
            raise FirmsError("NASA FIRMS rejected the map key.", 502)
        raise FirmsError("NASA FIRMS did not return a hotspot table.", 502)


def _optional_float(row: dict[str, str], *names: str) -> float | None:
    for name in names:
        raw = row.get(name)
        if raw is None or raw.strip() == "":
            continue
        try:
            value = float(raw)
        except ValueError:
            continue
        return value
    return None


def _acq_time(raw: str | None) -> str | None:
    if raw is None or raw.strip() == "":
        return None
    text = raw.strip()
    if text.isdigit():
        padded = text.zfill(4)
        return f"{padded[:2]}:{padded[2:4]} UTC"
    return text


def parse_hotspot_csv(text: str) -> list[dict]:
    sample = text.lstrip("\ufeff").strip()
    if not sample:
        return []
    _raise_for_status(200, sample)
    rows: list[dict] = []
    reader = csv.DictReader(StringIO(sample))
    for row in reader:
        latitude = _optional_float(row, "latitude")
        longitude = _optional_float(row, "longitude")
        if latitude is None or longitude is None:
            continue
        if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
            continue
        confidence = (row.get("confidence") or "").strip() or None
        rows.append(
            {
                "latitude": latitude,
                "longitude": longitude,
                "acq_date": (row.get("acq_date") or "").strip() or None,
                "acq_time": _acq_time(row.get("acq_time")),
                "confidence": confidence,
                "satellite": (row.get("satellite") or "").strip() or None,
                "instrument": (row.get("instrument") or "").strip() or None,
                "frp": _optional_float(row, "frp"),
                "daynight": (row.get("daynight") or "").strip() or None,
                "brightness": _optional_float(row, "bright_ti4", "brightness"),
            }
        )
    return rows


def _fetch_window(map_key: str, product: str, west: float, south: float, east: float, north: float, days: int, date: str | None) -> list[dict]:
    path = area_path(product, west, south, east, north, days, date).replace("{key}", map_key, 1)
    url = "https://firms.modaps.eosdis.nasa.gov" + path
    status, body = request_csv(url)
    _raise_for_status(status, body)
    return parse_hotspot_csv(body)


def load_hotspots(
    west: float,
    south: float,
    east: float,
    north: float,
    days: int = 1,
    product: str = "VIIRS_SNPP_NRT",
    date: str | None = None,
    refresh: bool = False,
) -> dict:
    _validate(product, west, south, east, north, days, date)
    map_key = firms_map_key()
    if not map_key:
        raise FirmsError("NASA FIRMS is not configured. Set NASA_FIRMS_MAP_KEY in backend/.env and restart the sensor API.", 503)
    cache_key = f"{product}|{west:.3f}|{south:.3f}|{east:.3f}|{north:.3f}|{days}|{date or ''}"
    now = time.time()
    if not refresh:
        with _cache_lock:
            cached = _cache.get(cache_key)
            if cached and now - cached[0] < CACHE_SECONDS:
                payload = dict(cached[1])
                payload["cached"] = True
                return payload
    if date:
        windows = [(days, date)]
        if days > 5:
            raise FirmsError("A custom observation date can cover at most 5 days in one FIRMS area call.", 422)
    else:
        windows = _windows(days)
    merged: list[dict] = []
    seen: set[tuple] = set()
    try:
        for window_days, window_date in windows:
            for hotspot in _fetch_window(map_key, product, west, south, east, north, window_days, window_date):
                identity = (
                    hotspot["latitude"],
                    hotspot["longitude"],
                    hotspot["acq_date"],
                    hotspot["acq_time"],
                    hotspot["satellite"],
                    hotspot["instrument"],
                )
                if identity in seen:
                    continue
                seen.add(identity)
                merged.append(hotspot)
    except FirmsError:
        raise
    except Exception as exc:
        safe = scrub(str(exc), map_key)
        if map_key in safe:
            raise FirmsError("NASA FIRMS request failed.", 502) from None
        raise FirmsError("NASA FIRMS request failed.", 502) from None
    payload = {
        "product": product,
        "product_label": FIRMS_PRODUCTS[product],
        "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "west": west,
        "south": south,
        "east": east,
        "north": north,
        "days": days,
        "date": date,
        "requests": len(windows),
        "count": len(merged),
        "cached": False,
        "hotspots": merged,
        "note": "Each FIRMS area call returns at most 5 days. A 6- or 7-day window uses two calls. These are satellite detections, not confirmed fire perimeters.",
    }
    with _cache_lock:
        _cache[cache_key] = (now, payload)
    return payload
