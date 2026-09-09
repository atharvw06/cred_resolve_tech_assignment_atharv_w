from __future__ import annotations
import csv
import json
import os
from typing import Any


def write_json_report(filepath: str, data: dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def write_csv_report(filepath: str, rows: list[dict[str, Any]]) -> None:
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    if not rows:
        return

    headers = [
        "tick_id",
        "ts",
        "A",
        "R",
        "C",
        "p_hat",
        "n_proposed",
        "n_approved",
        "clamp_reasons",
        "utilization",
        "abandonment_rate",
    ]

    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        for r in rows:
            # Flatten clamp_reasons to semicolon-separated string for CSV readability
            row_dict = dict(r)
            if isinstance(row_dict.get("clamp_reasons"), (list, tuple)):
                row_dict["clamp_reasons"] = ";".join(row_dict["clamp_reasons"])
            writer.writerow({k: row_dict.get(k, "") for k in headers})
