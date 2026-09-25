"""Generate src/zones.json from the Python tzdata package.

Each zone is mapped to its POSIX TZ rule (the last line of its TZif file), and each
distinct rule is parsed with the same parser ESPHome uses at build time, so the
worker's output matches what ESPHome would compile in for that zone.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from importlib import metadata, resources
from importlib.resources.abc import Traversable
import io
import json
from pathlib import Path
import sys
from zoneinfo import ZoneInfo

from aioesphomeapi.posix_tz import DSTRule, parse_posix_tz
import tzdata

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "src" / "zones.json"
TRANSITIONS = ROOT / "test" / "fixtures" / "transitions.json"
# Far enough ahead that every zone follows its POSIX rule, and two years so a
# southern hemisphere zone's year boundary is covered
TRANSITIONS_START = datetime(2028, 1, 1, tzinfo=UTC)
TRANSITIONS_STEP = timedelta(minutes=15)  # every transition falls on a 15 minute boundary
TRANSITIONS_STEPS = 2 * 366 * 24 * 4


def _walk(node: Traversable, prefix: str = ""):
    for child in sorted(node.iterdir(), key=lambda c: c.name):
        name = f"{prefix}{child.name}"
        if child.is_dir():
            yield from _walk(child, f"{name}/")
        elif not child.name.startswith("_") and not child.name.endswith(".py"):
            yield name, child


def _rule_dict(rule: DSTRule) -> dict[str, int]:
    return {
        "type": int(rule.type),
        "month": rule.month,
        "week": rule.week,
        "day_of_week": rule.day_of_week,
        "day": rule.day,
        "time_seconds": rule.time_seconds,
    }


def _transitions(data: bytes) -> dict:
    """UTC offsets from Python's zoneinfo, as a reference to test the worker against."""
    zone = ZoneInfo.from_file(io.BytesIO(data))
    start = TRANSITIONS_START
    offset = int(start.astimezone(zone).utcoffset().total_seconds())
    result = {"start": int(start.timestamp()), "offset": offset, "changes": []}
    for step in range(1, TRANSITIONS_STEPS):
        when = start + step * TRANSITIONS_STEP
        new_offset = int(when.astimezone(zone).utcoffset().total_seconds())
        if new_offset != offset:
            result["changes"].append([int(when.timestamp()), new_offset])
            offset = new_offset
    return result


def main() -> int:
    zones: dict[str, str] = {}
    rules: dict[str, dict] = {}
    transitions: dict[str, dict] = {}
    for name, file in _walk(resources.files("tzdata.zoneinfo")):
        data = file.read_bytes()
        if not data.startswith(b"TZif"):
            continue
        posix = data.split(b"\n")[-2].decode()
        if posix not in rules:
            transitions[name] = _transitions(data)
            parsed = parse_posix_tz(posix)
            rules[posix] = {
                "std_offset_seconds": parsed.std_offset_seconds,
                "dst_offset_seconds": parsed.dst_offset_seconds,
                "dst_start": _rule_dict(parsed.dst_start),
                "dst_end": _rule_dict(parsed.dst_end),
            }
        zones[name] = posix

    output = {
        "tzdata_version": tzdata.IANA_VERSION,
        "parser": f"aioesphomeapi {metadata.version('aioesphomeapi')}",
        "zones": zones,
        "rules": rules,
    }
    OUTPUT.write_text(json.dumps(output, indent=1, sort_keys=True) + "\n")
    TRANSITIONS.parent.mkdir(parents=True, exist_ok=True)
    TRANSITIONS.write_text(json.dumps(transitions, sort_keys=True) + "\n")
    print(
        f"Wrote {len(zones)} zones and {len(rules)} rules "
        f"(tzdata {tzdata.IANA_VERSION}) to {OUTPUT}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
