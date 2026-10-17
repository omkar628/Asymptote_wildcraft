"""Simulation mission log.

Records stay in mission_records.jsonl. This module never opens a serial port
and never writes sensor_readings.csv.
"""

from __future__ import annotations

import json
import math
import uuid
from datetime import datetime, timezone
from pathlib import Path

from config import BACKEND_DIR

NODES_PATH = BACKEND_DIR / "data" / "simulated_nodes.json"
REAL_NODE_ID = "real-lora-1"
TERMINAL = {"MISSION_COMPLETED", "MISSION_CANCELLED", "MISSION_FAILED"}
STATES = {
    "IDLE",
    "INCIDENT_DETECTED",
    "AWAITING_DISPATCH_RULE",
    "MISSION_PLANNED",
    "TAKEOFF_SIMULATED",
    "EN_ROUTE",
    "APPROACHING_DESTINATION",
    "ARRIVED",
    "INSPECTING_NODE",
    "RETURNING_TO_BASE",
    "MISSION_COMPLETED",
    "MISSION_CANCELLED",
    "MISSION_FAILED",
}
KINDS = {"observed", "rule_alert", "simulated_test", "mission_event", "confirmed_field"}


class MissionError(Exception):
    def __init__(self, status: int, message: str) -> None:
        self.status = status
        self.message = message


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _finite(value: object, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise MissionError(422, f"{name} must be a finite number.")
    return float(value)


def _coord(lat: object, lon: object) -> tuple[float, float]:
    latitude = _finite(lat, "latitude")
    longitude = _finite(lon, "longitude")
    if latitude < -90 or latitude > 90 or longitude < -180 or longitude > 180:
        raise MissionError(422, "Latitude or longitude is outside the valid range.")
    return latitude, longitude


def _text(value: object, name: str, limit: int = 80) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise MissionError(422, f"{name} is required.")
    return value.strip()


class MissionLog:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.missions: dict[str, dict] = {}
        self.incidents: list[dict] = []
        self.listeners: set = set()
        self._replay()

    def _replay(self) -> None:
        if not self.path.exists():
            return
        for line in self.path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(record, dict):
                self._apply(record, persist=False)

    def _append(self, record: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, separators=(",", ":")) + "\n")

    def _apply(self, record: dict, persist: bool) -> dict:
        action = record.get("action")
        if action == "incident":
            self.incidents.append(record)
            if len(self.incidents) > 200:
                self.incidents = self.incidents[-200:]
        elif action == "create" and isinstance(record.get("mission_id"), str):
            self.missions[record["mission_id"]] = record
        elif action in {"transition", "position", "cancel"} and isinstance(record.get("mission_id"), str):
            current = self.missions.get(record["mission_id"])
            if current is not None:
                merged = dict(current)
                merged.update({key: value for key, value in record.items() if value is not None})
                self.missions[record["mission_id"]] = merged
                record = merged
        if persist:
            self._append(record)
        return record

    def _active_for(self, incident_id: str) -> dict | None:
        for mission in self.missions.values():
            if mission.get("incident_id") == incident_id and mission.get("state") not in TERMINAL:
                return mission
        return None

    def create(self, body: dict) -> dict:
        if body.get("simulation") is not True:
            raise MissionError(422, "This API records simulated missions only. It does not command an aircraft.")
        incident_id = _text(body.get("incident_id"), "incident_id")
        mission_id = _text(body.get("mission_id"), "mission_id")
        if self._active_for(incident_id) is not None or (
            mission_id in self.missions and self.missions[mission_id].get("state") not in TERMINAL
        ):
            raise MissionError(409, "That incident already has an active simulated mission.")
        lat, lon = _coord(body.get("launch_lat"), body.get("launch_lon"))
        dest_lat, dest_lon = _coord(body.get("destination_lat"), body.get("destination_lon"))
        state = body.get("state") or "TAKEOFF_SIMULATED"
        if state not in STATES:
            raise MissionError(422, "Unknown mission state.")
        kind = body.get("kind") or "mission_event"
        if kind not in KINDS or kind == "confirmed_field":
            raise MissionError(422, "Confirmed field incidents are not created by the simulation API.")
        record = {
            "record_id": uuid.uuid4().hex,
            "kind": kind,
            "action": "create",
            "incident_id": incident_id,
            "mission_id": mission_id,
            "state": state,
            "summary": str(body.get("summary") or "Simulated mission created."),
            "simulation": True,
            "created_at": _now(),
            "launch_lat": lat,
            "launch_lon": lon,
            "destination_lat": dest_lat,
            "destination_lon": dest_lon,
            "destination_kind": body.get("destination_kind"),
            "destination_node_id": body.get("destination_node_id"),
            "evidence_class": body.get("evidence_class"),
            "payload": body.get("payload") if isinstance(body.get("payload"), dict) else {},
        }
        return self._apply(record, persist=True)

    def transition(self, mission_id: str, body: dict) -> dict:
        current = self.missions.get(mission_id)
        if current is None:
            raise MissionError(404, "No simulated mission has that id.")
        if current.get("state") in TERMINAL:
            raise MissionError(409, "That simulated mission is already finished.")
        state = body.get("state")
        if state not in STATES:
            raise MissionError(422, "Unknown mission state.")
        if body.get("simulation") is False:
            raise MissionError(422, "This API records simulated missions only.")
        record = {
            "record_id": uuid.uuid4().hex,
            "kind": "mission_event",
            "action": "cancel" if state == "MISSION_CANCELLED" else "transition",
            "incident_id": current.get("incident_id"),
            "mission_id": mission_id,
            "state": state,
            "summary": str(body.get("summary") or state),
            "simulation": True,
            "created_at": _now(),
            "outcome": body.get("outcome"),
        }
        return self._apply(record, persist=True)

    def position(self, mission_id: str, body: dict) -> dict:
        current = self.missions.get(mission_id)
        if current is None:
            raise MissionError(404, "No simulated mission has that id.")
        if body.get("simulation") is not True:
            raise MissionError(422, "Position updates are simulated values only.")
        lat, lon = _coord(body.get("lat"), body.get("lon"))
        state = body.get("state") or current.get("state")
        if state not in STATES:
            raise MissionError(422, "Unknown mission state.")
        record = {
            "record_id": uuid.uuid4().hex,
            "kind": "mission_event",
            "action": "position",
            "incident_id": current.get("incident_id"),
            "mission_id": mission_id,
            "state": state,
            "summary": "Simulated position",
            "simulation": True,
            "created_at": _now(),
            "lat": lat,
            "lon": lon,
            "heading_deg": _finite(body.get("heading_deg", 0), "heading_deg"),
            "distance_remaining_m": _finite(body.get("distance_remaining_m", 0), "distance_remaining_m"),
        }
        persist = bool(body.get("persist"))
        return self._apply(record, persist=persist)

    def add_incident(self, body: dict) -> dict:
        kind = body.get("kind")
        if kind not in KINDS or kind == "confirmed_field":
            raise MissionError(422, "Confirmed field incidents are not created by the simulation API.")
        if kind == "observed" and body.get("evidence_class") == "simulated_test":
            raise MissionError(422, "Simulated test evidence cannot be stored as an observed field event.")
        record = {
            "record_id": uuid.uuid4().hex,
            "kind": kind,
            "action": "incident",
            "incident_id": _text(body.get("incident_id"), "incident_id"),
            "mission_id": body.get("mission_id"),
            "state": body.get("state"),
            "summary": _text(body.get("summary"), "summary", 400),
            "simulation": kind != "observed",
            "created_at": _now(),
            "evidence_class": body.get("evidence_class"),
            "category": body.get("category"),
            "payload": body.get("payload") if isinstance(body.get("payload"), dict) else {},
        }
        return self._apply(record, persist=True)

    def current(self) -> dict | None:
        active = [item for item in self.missions.values() if item.get("state") not in TERMINAL]
        if active:
            return active[-1]
        if not self.missions:
            return None
        return list(self.missions.values())[-1]

    def nodes(self) -> dict:
        simulated: list[dict] = []
        note = "Simulated nodes are demonstration points. They are not field measurements."
        if NODES_PATH.exists():
            try:
                parsed = json.loads(NODES_PATH.read_text(encoding="utf-8"))
                rows = parsed.get("nodes") if isinstance(parsed, dict) else None
                if isinstance(rows, list):
                    simulated = [row for row in rows if isinstance(row, dict)]
                if isinstance(parsed, dict) and isinstance(parsed.get("note"), str):
                    note = parsed["note"]
            except json.JSONDecodeError:
                note = "The simulated node file could not be read."
        return {
            "real": {
                "id": REAL_NODE_ID,
                "name": "LoRa sensor node",
                "kind": "real",
                "badge": "REAL HARDWARE",
                "latitude": None,
                "longitude": None,
                "note": "Coordinates are not in the sensor packet. Set the location on the map. Readings come from the serial API and are never replaced with simulated values.",
            },
            "simulated": [
                {
                    "id": row.get("id"),
                    "name": row.get("name"),
                    "kind": "simulated",
                    "badge": "SIMULATED",
                    "latitude": row.get("latitude"),
                    "longitude": row.get("longitude"),
                    "profile": row.get("profile"),
                }
                for row in simulated
            ],
            "note": note,
        }
