"""Loader for ontology/mappings/inci-to-korean.csv (Phase 0 v0.1)."""
from __future__ import annotations

import csv
from pathlib import Path
from typing import List

from data.schemas import Ingredient

INCI_CSV = (
    Path(__file__).resolve().parents[2]
    / "ontology"
    / "mappings"
    / "inci-to-korean.csv"
)


def _slug(name: str) -> str:
    return (
        name.lower()
        .replace(" ", "-")
        .replace("/", "-")
        .replace(",", "")
        .replace("(", "")
        .replace(")", "")
    )


def load_inci_ingredients() -> List[Ingredient]:
    items: List[Ingredient] = []
    with open(INCI_CSV, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            inci_name = row["inci_name"].strip()
            items.append(
                Ingredient(
                    ingredient_id=f"inci:{_slug(inci_name)}",
                    name_en=inci_name,
                    name_ko=row["korean_name"].strip(),
                    synonyms_ko=[s.strip() for s in row["synonyms_ko"].split(";") if s.strip()],
                    function_ko=row["function_ko"].strip() or None,
                    concerns_ko=[c.strip() for c in row["concerns_ko"].split(";") if c.strip()],
                    regulatory_class=row["regulatory_class"].strip() or None,
                    standard="INCI",
                )
            )
    return items


if __name__ == "__main__":
    ingredients = load_inci_ingredients()
    print(f"Loaded {len(ingredients)} INCI ingredients")
    print(f"First 3:")
    for ing in ingredients[:3]:
        print(ing.model_dump_json(indent=2, exclude_none=True))
