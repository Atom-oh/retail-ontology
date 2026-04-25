"""Loader for ontology/mappings/gs1-gpc-to-kfda-food.csv (Phase 0 v0.1)."""
from __future__ import annotations

import csv
from pathlib import Path
from typing import List

from data.schemas import Category

GS1_CSV = (
    Path(__file__).resolve().parents[2]
    / "ontology"
    / "mappings"
    / "gs1-gpc-to-kfda-food.csv"
)


def load_categories() -> List[Category]:
    items: List[Category] = []
    with open(GS1_CSV, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            items.append(
                Category(
                    gs1_brick_code=row["gs1_brick_code"].strip(),
                    gs1_brick_name_en=row["gs1_brick_name_en"].strip(),
                    kfda_category_path=row["kfda_category_path"].strip(),
                    retail_category_ko=row["retail_category_ko"].strip(),
                    synonyms_ko=[s.strip() for s in row["synonyms_ko"].split(";") if s.strip()],
                    domain=row["domain"].strip(),
                )
            )
    return items


if __name__ == "__main__":
    cats = load_categories()
    print(f"Loaded {len(cats)} categories")
    domains = sorted({c.domain for c in cats})
    print(f"Domains: {domains}")
