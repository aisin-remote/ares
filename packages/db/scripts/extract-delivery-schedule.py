"""Extract the recurring truck-station blocks from the approved XLSX source."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import openpyxl


ROWS = {
    7: (1, "SENIN"),
    8: (1, "SENIN"),
    10: (2, "SELASA"),
    11: (2, "SELASA"),
    13: (3, "RABU"),
    14: (3, "RABU"),
    16: (4, "KAMIS"),
    17: (4, "KAMIS"),
    19: (5, "JUMAT"),
    20: (5, "JUMAT"),
}


def clock_for_column(column: int) -> str:
    minutes = (6 * 60 + (column - 4) * 10) % (24 * 60)
    return f"{minutes // 60:02d}:{minutes % 60:02d}:00"


def merged_width(sheet: openpyxl.worksheet.worksheet.Worksheet, coordinate: str) -> int:
    for merged in sheet.merged_cells.ranges:
        if coordinate in merged:
            return merged.max_col - merged.min_col + 1
    return 1


def extract(source: Path) -> list[dict[str, object]]:
    workbook = openpyxl.load_workbook(source, data_only=True)
    result: list[dict[str, object]] = []
    for plant in ("UNIT", "BODY"):
        sheet = workbook[plant]
        for row, (day_of_week, day_label) in ROWS.items():
            station = " ".join(str(sheet.cell(row, 3).value).split())
            for cell in sheet[row][3:147]:  # D:EQ is the 24-hour timeline.
                if cell.value is None:
                    continue
                supplier_label = " ".join(str(cell.value).replace("\n", ", ").split())
                supplier_codes = ",".join(part.strip() for part in supplier_label.split(",") if part.strip())
                result.append(
                    {
                        "plantCode": plant,
                        "supplierLabel": supplier_label,
                        "supplierCodes": supplier_codes,
                        "truckStation": station,
                        "dayOfWeek": day_of_week,
                        "dayLabel": day_label,
                        "arrivalTime": clock_for_column(cell.column),
                        "durationMinutes": merged_width(sheet, cell.coordinate) * 10,
                        "sourceKey": f"TRUCK-STATION-DIAGRAM:{plant}:{cell.coordinate}",
                    }
                )
    return result


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: extract-delivery-schedule.py SOURCE.xlsx OUTPUT.ts")
    source = Path(sys.argv[1]).resolve()
    output = Path(sys.argv[2]).resolve()
    rows = extract(source)
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(rows, ensure_ascii=False, indent=2)
    output.write_text(
        "// Generated from Truck Station Diagram.xlsx; regenerate with scripts/extract-delivery-schedule.py.\n"
        f"export const REAL_DELIVERY_SCHEDULES = {payload} as const;\n",
        encoding="utf-8",
    )
    print(f"wrote {len(rows)} schedule slots to {output}")


if __name__ == "__main__":
    main()
