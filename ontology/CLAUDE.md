# ontology/CLAUDE.md — standards mappings

## Role

External-standard mapping files used by `data/load.py` to hydrate Korean labels and category codes onto synthetic entities. Bundled into the API container at build time so the loader has them offline.

## Layout

- `mappings/inci-to-korean.csv` — INCI cosmetic ingredient names → Korean labels, function, regulatory class, concerns. ~600+ rows.
- `mappings/gs1-gpc-to-kfda-food.csv` — GS1 GPC brick codes (8-digit) → 식약처 식품 카테고리 path → Korean retail category. Food domain only; beauty bricks are out of scope for the food adapter.
- `mappings/foodon-to-korean.json` — FoodOn IDs (`foodon:NNNNNNN`) → `{name_ko, name_en}`. 219 entries covering all food ingredients referenced by the synthetic product feed.
- `mappings/korea-regions.csv` — KOSTAT 행정구역코드 (17 광역시도 + 34 주요 시군구) with `lat`, `lng`, `population`. Consumed by `data/synthetic/logistics.py:load_regions()` and joined to `Warehouse.region_code` at load time.

## Conventions

- **CSV column names are canonical** — never rename a column without updating every consumer (`data/public/*.py`, `api/routers/ontology.py:validation_report`).
- **Slugification rules** — INCI ingredients become Neptune IDs via `inci:{lowercase().replace(' ','-').replace('/','-').replace(',','').replace('(','').replace(')','')}`. The validation report mirrors this slugification when comparing CSV ↔ Neptune.
- **JSON over CSV for sparse maps** — FoodOn was added as JSON because most entries don't need every column; CSV would have many empty cells.
- **Don't add a non-standard field** — if a mapping needs a Korean-only column (e.g., 시카케어 분류), add it to a new CSV for the Korean adapter rather than polluting the global standard CSV.

## When you change a mapping

1. Run the validation report after `data/load.py --neptune` to confirm coverage stays ≥95%.
2. Update `ontology/mappings/README.md` (if added) noting the new field/row count.
3. Bump CHANGELOG.md `Added` or `Changed` entry.
