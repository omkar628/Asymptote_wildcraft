"""Explainable screening and spread scenario.

This is an experimental rule model. It is not a validated wildfire-physics
simulator and it does not produce an operational forecast, an arrival time, or
a fire perimeter. Vegetation, fuel, slope, and aspect stay unused until a
dataset is connected. Missing inputs are omitted. They are not treated as zero
and they are not treated as safe.
"""

from __future__ import annotations

import math
from typing import Any

MODEL_VERSION = "wildcraft-screen-1"
SPREAD_LABEL = "Illustrative spread scenario — not an operational forecast"
FORECAST_STEPS = (0, 1, 3, 6, 12, 24)
VEGETATION_GAP = 0.85
TERRAIN_GAP = 0.85

WEIGHTS = {
    "temperature": 16.0,
    "humidity": 16.0,
    "precipitation": 14.0,
    "wind": 14.0,
    "soil_moisture": 10.0,
    "firms_proximity": 12.0,
    "sensor_alert": 8.0,
    "rain_window": 10.0,
}

UNAVAILABLE_INPUTS = (
    "Vegetation and NDVI are not connected. Sentinel-2 is not queried.",
    "Fuel moisture is not connected.",
    "Slope and aspect are not connected. No digital elevation model is loaded.",
)


def _finite(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    if not math.isfinite(number):
        return None
    return number


def _band(score: float) -> tuple[str, str]:
    if score <= 24:
        return "Lower sensitivity", "#2f7d46"
    if score <= 49:
        return "Moderate sensitivity", "#d6c24a"
    if score <= 74:
        return "High sensitivity", "#e08a2c"
    return "Very high sensitivity", "#c4473a"


def temperature_points(celsius: float | None) -> float | None:
    value = _finite(celsius)
    if value is None:
        return None
    if value <= 30:
        return 0.0
    if value >= 42:
        return WEIGHTS["temperature"]
    return WEIGHTS["temperature"] * (value - 30) / 12


def humidity_points(percent: float | None) -> float | None:
    value = _finite(percent)
    if value is None:
        return None
    if value >= 65:
        return 0.0
    if value <= 25:
        return WEIGHTS["humidity"]
    return WEIGHTS["humidity"] * (65 - value) / 40


def precipitation_points(mm: float | None) -> float | None:
    value = _finite(mm)
    if value is None:
        return None
    if value >= 2:
        return 0.0
    if value <= 0:
        return WEIGHTS["precipitation"]
    return WEIGHTS["precipitation"] * (1 - value / 2)


def wind_points(kmh: float | None) -> float | None:
    value = _finite(kmh)
    if value is None:
        return None
    if value <= 10:
        return 0.0
    if value >= 40:
        return WEIGHTS["wind"]
    return WEIGHTS["wind"] * (value - 10) / 30


def soil_moisture_points(cubic: float | None) -> float | None:
    value = _finite(cubic)
    if value is None:
        return None
    if value >= 0.35:
        return 0.0
    if value <= 0.10:
        return WEIGHTS["soil_moisture"]
    return WEIGHTS["soil_moisture"] * (0.35 - value) / 0.25


def firms_proximity_points(distance_m: float | None, firms_known: bool, hotspot_count: int) -> float | None:
    if not firms_known:
        return None
    if hotspot_count <= 0 or distance_m is None:
        return 0.0
    distance = _finite(distance_m)
    if distance is None:
        return None
    if distance <= 1000:
        return WEIGHTS["firms_proximity"]
    if distance <= 3000:
        return 8.0
    if distance <= 8000:
        return 4.0
    return 0.0


def sensor_alert_points(located: bool, fresh: bool, alert: bool) -> float | None:
    if not located or not fresh:
        return None
    return WEIGHTS["sensor_alert"] if alert else 0.0


def rain_window_points(sum_mm: float | None) -> float | None:
    value = _finite(sum_mm)
    if value is None:
        return None
    if value < 20:
        return WEIGHTS["rain_window"]
    if value < 50:
        return 5.0
    return 0.0


def _factor(name: str, points: float | None, reading: str, note: str) -> dict[str, Any]:
    return {"name": name, "points": None if points is None else round(points, 2), "reading": reading, "note": note}


def sensitivity_score(
    *,
    temperature_c: float | None = None,
    humidity_pct: float | None = None,
    precipitation_mm: float | None = None,
    wind_kmh: float | None = None,
    soil_moisture: float | None = None,
    firms_known: bool = False,
    hotspot_count: int = 0,
    firms_distance_m: float | None = None,
    sensor_located: bool = False,
    sensor_fresh: bool = False,
    sensor_alert: bool = False,
    rain_window_mm: float | None = None,
) -> dict[str, Any]:
    """Environmental sensitivity from connected inputs only.

    The numeric score is the sum of present factors. It is not rescaled upward
    when inputs are missing. Confidence falls when a factor is missing and is
    capped because vegetation and terrain are not connected.
    """
    factors = [
        _factor("Temperature", temperature_points(temperature_c), _reading(temperature_c, "°C"), "0 at or below 30 °C, 16 at or above 42 °C."),
        _factor("Relative humidity", humidity_points(humidity_pct), _reading(humidity_pct, "%"), "0 at or above 65%, 16 at or below 25%."),
        _factor(
            "Recent precipitation",
            precipitation_points(precipitation_mm),
            _reading(precipitation_mm, "mm"),
            "14 at 0 mm, 0 at or above 2 mm. This is Open-Meteo precipitation, not vegetation dryness.",
        ),
        _factor("Wind speed", wind_points(wind_kmh), _reading(wind_kmh, "km/h"), "0 at or below 10 km/h, 14 at or above 40 km/h."),
        _factor(
            "Soil moisture",
            soil_moisture_points(soil_moisture),
            _reading(soil_moisture, "m³/m³"),
            "10 at or below 0.10, 0 at or above 0.35. This is not fuel moisture.",
        ),
        _factor(
            "FIRMS proximity",
            firms_proximity_points(firms_distance_m, firms_known, hotspot_count),
            "Unavailable" if not firms_known else (f"{hotspot_count} detections" if firms_distance_m is None else f"{firms_distance_m:.0f} m"),
            "12 within 1 km, 8 within 3 km, 4 within 8 km, otherwise 0 when FIRMS responded. A missing FIRMS response is not zero.",
        ),
        _factor(
            "Sensor alert",
            sensor_alert_points(sensor_located, sensor_fresh, sensor_alert),
            "Not assigned to this cell" if not sensor_located else ("Stale" if not sensor_fresh else ("Raw MQ above 650" if sensor_alert else "Raw MQ at or below 650")),
            "8 points only when a configured sensor coordinate falls in this cell, the packet is fresh, and MQ9 or MQ135 is strictly above 650 raw. Exactly 650 does not count. Raw values are not concentrations.",
        ),
        _factor(
            "30-day rain sum",
            rain_window_points(rain_window_mm),
            _reading(rain_window_mm, "mm"),
            "10 below 20 mm, 5 below 50 mm, 0 at or above 50 mm. One Open-Meteo archive sample, not a cell measurement.",
        ),
    ]
    present = [factor for factor in factors if factor["points"] is not None]
    missing = [factor["name"] for factor in factors if factor["points"] is None]
    if not present:
        return {
            "score": None,
            "band": None,
            "color": None,
            "confidence": 0.0,
            "factors": factors,
            "missing": missing + list(UNAVAILABLE_INPUTS),
            "uncertainty": "No connected sensitivity input was available, so this cell is not scored.",
            "model_version": MODEL_VERSION,
        }
    present_weight = 0.0
    for factor in factors:
        if factor["points"] is None:
            continue
        present_weight += WEIGHTS[_weight_key(factor["name"])]
    score = int(round(sum(factor["points"] for factor in present)))
    score = max(0, min(100, score))
    confidence = (present_weight / 100) * VEGETATION_GAP * TERRAIN_GAP
    band, color = _band(score)
    if confidence < 0.45:
        band = f"{band} · incomplete"
    return {
        "score": score,
        "band": band,
        "color": color,
        "confidence": round(confidence, 3),
        "factors": factors,
        "missing": missing + list(UNAVAILABLE_INPUTS),
        "uncertainty": "Initial screening tool. It is not validated against local fire history. Missing inputs reduce confidence and are not filled in.",
        "model_version": MODEL_VERSION,
    }


def _weight_key(name: str) -> str:
    return {
        "Temperature": "temperature",
        "Relative humidity": "humidity",
        "Recent precipitation": "precipitation",
        "Wind speed": "wind",
        "Soil moisture": "soil_moisture",
        "FIRMS proximity": "firms_proximity",
        "Sensor alert": "sensor_alert",
        "30-day rain sum": "rain_window",
    }[name]


def _reading(value: float | None, unit: str) -> str:
    number = _finite(value)
    if number is None:
        return "Unavailable"
    return f"{number:.2f} {unit}"


def forecast_steps(forecast_hours: int) -> list[int]:
    hours = int(forecast_hours)
    if hours < 1:
        return [0]
    return [step for step in FORECAST_STEPS if step <= hours]


def downwind_bearing(wind_from_deg: float) -> float:
    return (wind_from_deg + 180.0) % 360.0


def _sample_for_hour(samples: list[dict[str, Any]], hour: int) -> dict[str, Any]:
    usable = [sample for sample in samples if isinstance(sample.get("hour_offset"), int)]
    if not usable:
        return samples[0] if samples else {}
    return min(usable, key=lambda sample: (abs(int(sample["hour_offset"]) - hour), int(sample["hour_offset"]) > hour))


def spread_rate(sample: dict[str, Any]) -> dict[str, Any]:
    wind = _finite(sample.get("wind_kmh"))
    notes: list[str] = []
    if wind is None or wind < 0:
        return {"rate_kmh": None, "directional": False, "confidence": 0.0, "notes": ["Wind speed is missing, so no spread distance is calculated."]}
    if wind < 5:
        rate = 0.12
        directional = False
        notes.append("Wind is below 5 km/h. The zone stays short and only weakly oriented. It is not a fixed-radius circle.")
    else:
        rate = min(1.6, 0.06 + 0.022 * wind)
        directional = True
        notes.append("Downwind rate starts at 0.06 + 0.022 × wind km/h, capped at 1.6 km/h, before modifiers.")
    modifier = 1.0
    humidity = _finite(sample.get("humidity_pct"))
    if humidity is None:
        notes.append("Humidity is missing, so it does not change the rate.")
    elif humidity <= 30:
        modifier *= 1.2
        notes.append("Humidity at or below 30% multiplies the rate by 1.2.")
    elif humidity >= 70:
        modifier *= 0.75
        notes.append("Humidity at or above 70% multiplies the rate by 0.75.")
    precip = _finite(sample.get("precip_mm"))
    if precip is None:
        notes.append("Precipitation is missing, so it does not change the rate.")
    elif precip >= 2:
        modifier *= 0.65
        notes.append("Precipitation of at least 2 mm multiplies the rate by 0.65.")
    elif precip <= 0:
        modifier *= 1.05
        notes.append("No precipitation multiplies the rate by 1.05.")
    temperature = _finite(sample.get("temperature_c"))
    if temperature is None:
        notes.append("Temperature is missing, so it does not change the rate.")
    elif temperature >= 38:
        modifier *= 1.1
        notes.append("Temperature at or above 38 °C multiplies the rate by 1.1.")
    elif temperature <= 25:
        modifier *= 0.9
        notes.append("Temperature at or below 25 °C multiplies the rate by 0.9.")
    fuel = _finite(sample.get("fuel_modifier"))
    if fuel is None:
        notes.append("Fuel and vegetation are unavailable, so they do not change the rate.")
    else:
        modifier *= fuel
        notes.append("A supplied fuel modifier was applied.")
    slope = _finite(sample.get("slope_modifier"))
    if slope is None:
        notes.append("Slope and aspect are unavailable, so they do not change the rate.")
    else:
        modifier *= slope
        notes.append("A supplied slope modifier was applied.")
    if sample.get("sensor_alert") is True:
        modifier *= 1.08
        notes.append("A fresh raw MQ reading above 650 near the ignition multiplies the rate by 1.08. This is not a concentration and not a confirmed fire.")
    confidence = 0.55 if directional else 0.35
    if humidity is None:
        confidence -= 0.05
    if precip is None:
        confidence -= 0.05
    confidence -= 0.1
    confidence -= 0.1
    return {
        "rate_kmh": rate * modifier,
        "directional": directional,
        "confidence": round(max(0.15, confidence), 3),
        "notes": notes,
    }


def ellipse_axes(rate_kmh: float, hours: int, directional: bool) -> dict[str, float] | None:
    if hours <= 0 or rate_kmh < 0:
        return None
    down = rate_kmh * hours
    if directional:
        up = down * 0.16
        cross = down * 0.34
    else:
        up = down * 0.62
        cross = down * 0.78
    return {"downwind_km": down, "upwind_km": up, "crosswind_km": cross}


def ellipse_ring(lat: float, lon: float, bearing_deg: float, down_km: float, up_km: float, cross_km: float, vertex_count: int = 48) -> list[list[float]]:
    km_lat = 111.32
    km_lon = 111.32 * math.cos(math.radians(lat))
    center_along = (down_km - up_km) / 2
    semi_major = (down_km + up_km) / 2
    semi_minor = max(cross_km, 0.001)
    radians = math.radians(bearing_deg)
    east_hat = math.sin(radians)
    north_hat = math.cos(radians)
    ring: list[list[float]] = []
    for index in range(vertex_count):
        theta = 2 * math.pi * index / vertex_count
        along = center_along + semi_major * math.cos(theta)
        cross = semi_minor * math.sin(theta)
        east = along * east_hat + cross * north_hat
        north = along * north_hat - cross * east_hat
        ring.append([round(lon + east / km_lon, 6), round(lat + north / km_lat, 6)])
    ring.append(ring[0])
    return ring


def point_in_ellipse(lat: float, lon: float, origin_lat: float, origin_lon: float, bearing_deg: float, down_km: float, up_km: float, cross_km: float) -> bool:
    km_lat = 111.32
    km_lon = 111.32 * math.cos(math.radians(origin_lat))
    east = (lon - origin_lon) * km_lon
    north = (lat - origin_lat) * km_lat
    radians = math.radians(bearing_deg)
    east_hat = math.sin(radians)
    north_hat = math.cos(radians)
    along = east * east_hat + north * north_hat
    cross = east * north_hat - north * east_hat
    center_along = (down_km - up_km) / 2
    semi_major = (down_km + up_km) / 2
    semi_minor = max(cross_km, 0.001)
    if semi_major <= 0:
        return False
    normalized_along = (along - center_along) / semi_major
    normalized_cross = cross / semi_minor
    return normalized_along * normalized_along + normalized_cross * normalized_cross <= 1


def build_scenario(body: dict[str, Any]) -> dict[str, Any]:
    forecast_hours = body.get("forecast_hours", 24)
    try:
        hours = int(forecast_hours)
    except (TypeError, ValueError):
        hours = 24
    hours = max(0, min(24, hours))
    steps = forecast_steps(hours)
    ignition = body.get("ignition")
    samples = body.get("samples") if isinstance(body.get("samples"), list) else []
    fuel = _finite(body.get("fuel_modifier"))
    slope = _finite(body.get("slope_modifier"))
    base = {
        "model_version": MODEL_VERSION,
        "label": SPREAD_LABEL,
        "assumptions": [
            "Wind direction is the primary direction. Spread is downwind, which is the reported from-direction plus 180 degrees.",
            "Wind speed changes the downwind distance. The crosswind axis is 0.34 of that distance when the wind is at least 5 km/h, and 0.78 when it is lighter.",
            "The upwind axis is 0.16 of the downwind distance in a directional case, so the ignition sits toward the upwind edge.",
            "Hour 0 is the observation. It has no forecast polygon.",
            "Fuel, vegetation, slope, and aspect are omitted unless a modifier is supplied.",
            "The polygon is the model zone. It can cross a reserve boundary. The boundary is not treated as a fire break.",
            SPREAD_LABEL,
        ],
        "fuel_connected": fuel is not None,
        "terrain_connected": slope is not None,
        "vegetation_connected": False,
        "steps": [],
    }
    if not isinstance(ignition, dict) or _finite(ignition.get("lat")) is None or _finite(ignition.get("lon")) is None:
        base["ignition"] = None
        base["message"] = "No ignition location is selected. Choose a FIRMS detection or set a hypothetical point. An ignition is not invented."
        return base
    lat = float(ignition["lat"])
    lon = float(ignition["lon"])
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        base["ignition"] = None
        base["message"] = "The ignition coordinate is outside the world extent, so no scenario is drawn."
        return base
    kind = ignition.get("kind") if ignition.get("kind") in {"firms", "hypothetical"} else "hypothetical"
    base["ignition"] = {"lat": lat, "lon": lon, "kind": kind}
    base["message"] = SPREAD_LABEL
    for step in steps:
        if step == 0:
            base["steps"].append(
                {
                    "hour": 0,
                    "polygon": None,
                    "bearing_deg": None,
                    "rate_kmh": None,
                    "axes_km": None,
                    "confidence": None,
                    "notes": ["Current observation. No forecast zone is drawn at this step."],
                }
            )
            continue
        sample = dict(_sample_for_hour(samples, step))
        if fuel is not None:
            sample["fuel_modifier"] = fuel
        if slope is not None:
            sample["slope_modifier"] = slope
        wind_from = _finite(sample.get("wind_from_deg"))
        rated = spread_rate(sample)
        if rated["rate_kmh"] is None or wind_from is None:
            base["steps"].append(
                {
                    "hour": step,
                    "polygon": None,
                    "bearing_deg": None,
                    "rate_kmh": rated["rate_kmh"],
                    "axes_km": None,
                    "confidence": rated["confidence"],
                    "notes": rated["notes"] + (["Wind direction is missing, so the zone is not drawn."] if wind_from is None else []),
                }
            )
            continue
        bearing = downwind_bearing(wind_from)
        axes = ellipse_axes(rated["rate_kmh"], step, rated["directional"])
        assert axes is not None
        ring = ellipse_ring(lat, lon, bearing, axes["downwind_km"], axes["upwind_km"], axes["crosswind_km"])
        base["steps"].append(
            {
                "hour": step,
                "polygon": {"type": "Polygon", "coordinates": [ring]},
                "bearing_deg": round(bearing, 2),
                "rate_kmh": round(rated["rate_kmh"], 4),
                "axes_km": {key: round(value, 4) for key, value in axes.items()},
                "confidence": rated["confidence"],
                "directional": rated["directional"],
                "notes": rated["notes"],
            }
        )
    return base
