"""Extract ELECTRIC supplier cutoff master from sheet NEW."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import openpyxl


DAY_NUMBER = {"SENIN": 1, "SELASA": 2, "RABU": 3, "KAMIS": 4, "JUMAT": 5}


def text(value: object) -> str:
    return " ".join(str(value).split()).strip() if value is not None else ""


def slug(value: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "-", value.upper()).strip("-")


def clock(value: object) -> str | None:
    raw = text(value).replace(".", ":")
    if not raw:
        return None
    if not re.fullmatch(r"\d{1,2}:\d{2}", raw):
        raise ValueError(f"jam tidak valid: {value!r}")
    hour, minute = (int(part) for part in raw.split(":"))
    if hour > 23 or minute > 59:
        raise ValueError(f"jam tidak valid: {value!r}")
    return f"{hour:02d}:{minute:02d}:00"


def days(value: object) -> tuple[str, str | None]:
    label = text(value).upper().replace("JUM'AT", "JUMAT")
    if label == "BY SCHEDULE":
        return "BY SCHEDULE", None
    if label == "DAILY":
        return "DAILY", "1,2,3,4,5"
    names = [part.strip() for part in re.split(r"[&,]", label) if part.strip()]
    try:
        values = sorted({DAY_NUMBER[name] for name in names})
    except KeyError as error:
        raise ValueError(f"hari tidak valid: {value!r}") from error
    if not values:
        raise ValueError(f"hari kosong: {value!r}")
    return ", ".join(name for name in DAY_NUMBER if DAY_NUMBER[name] in values), ",".join(map(str, values))


def extract(source: Path) -> list[dict[str, object]]:
    sheet = openpyxl.load_workbook(source, data_only=True)["NEW"]
    result: list[dict[str, object]] = []
    for row in range(6, sheet.max_row + 1, 2):
        name = text(sheet.cell(row, 2).value)
        if not name:
            continue
        code = text(sheet.cell(row, 3).value)
        day_label, delivery_days = days(sheet.cell(row + 1, 3).value)
        cutoff_time = clock(sheet.cell(row, 5).value)
        arrival_time = clock(sheet.cell(row, 4).value)
        if bool(cutoff_time) != bool(arrival_time):
            raise ValueError(f"shipping/delivery time tidak lengkap untuk {name}")
        if day_label == "BY SCHEDULE" and (cutoff_time or arrival_time):
            raise ValueError(f"By Schedule tidak boleh punya jam tetap: {name}")
        sap_no = code if code and code != "-" else None
        result.append({
            "plantCode": "ELECTRIC",
            "truckStation": None,
            "name": name,
            "scheduleCode": sap_no,
            "sapVendorNo": sap_no,
            "deliveryCycle": text(sheet.cell(row, 8).value).replace("-", ":") or None,
            "truckType": None,
            "deliveryDayLabel": day_label,
            "deliveryDays": delivery_days,
            "palletPerDelivery": None,
            "loadingOperator": None,
            "location": None,
            "product": text(sheet.cell(row, 6).value) or None,
            "cutoffTime": cutoff_time,
            "arrivalTime": arrival_time,
            "sourceKey": f"ELECTRIC-CYCLE:{slug(name)}",
        })
    return result


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: extract-electric-suppliers.py SOURCE.xlsx OUTPUT.ts")
    source, output = map(lambda value: Path(value).resolve(), sys.argv[1:])
    rows = extract(source)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        "// Generated from sheet NEW in List Suppllier Cycle Issue.xlsx.\n"
        "// Regenerate with scripts/extract-electric-suppliers.py; do not edit by hand.\n"
        f"export const ELECTRIC_SUPPLIERS = {json.dumps(rows, ensure_ascii=False, indent=2)} as const;\n",
        encoding="utf-8",
    )
    fixed = sum(1 for row in rows if row["cutoffTime"])
    print(f"wrote {len(rows)} ELECTRIC suppliers ({fixed} fixed cutoff, {len(rows) - fixed} by schedule)")


if __name__ == "__main__":
    main()
