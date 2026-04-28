# data/CLAUDE.md — synthetic data + Neptune/OpenSearch loader

## Role

Generates the synthetic Korean Retail/CPG dataset (40 personas, 250 products, 2,480 reviews, 30 manufacturers, 60 brands, 53 categories, 25 concerns, 30 trends, 4 channels) and loads it into Neptune (graph) + OpenSearch (BM25 + KNN). Deterministic — same input always produces same output.

## Layout

- `load.py` — main entry point. CLI flags: `--neptune`, `--opensearch`, `--all`, `--from-s3`. Runs as a one-shot ECS task using the API container image. Loads commerce + logistics + inventory in dependency order (Region → Warehouse → Carrier → Route → Shipment → Event → Inventory).
- `schemas.py` — Pydantic models for every entity. Phase 1-4: Product, Brand, Manufacturer, Persona, Review, Trend, Concern, Ingredient, Nutrient, Category, Channel. Phase 5 (logistics): Region, Warehouse, Carrier, Route, Shipment, Event, Inventory.
- `synthetic/` — generators that produce the JSON/NDJSON outputs. `logistics.py` is fully deterministic (sha1-based PRNG); commerce generators use Bedrock for narrative fields.
- `public/` — adapters for external standards: `inci.py`, `foodon.py`, `kfda.py`, `beauty_categories.py`. Each reads a CSV/JSON in `ontology/mappings/` and yields domain entities.
- `output/` — generated files. Not gitignored (we want them as ground-truth references); also synced to S3 `ontology-retail-dev-synthetic-data-<account>/data/output/`.

## Conventions

- **Deterministic IDs** — entity IDs are SHA1-derived from canonical fields (e.g. `inci:{slug(name)}`, `sku_<6-char-hash>`). Reproducible across runs.
- **Cypher: keyword-only params** — `neptune_cypher` helper expects positional query + dict params. Match the signature carefully.
- **Property flattening** — Neptune doesn't support nested properties; `_flatten_props` coerces lists to comma-joined strings before MERGE.
- **Channel assignment** — `_assign_channels()` is deterministic per SKU based on `sha1(sku_id) % 100` plus domain rules. Don't randomize.
- **FoodOn Korean hydration** — when `ingredient_id` starts with `foodon:`, look up `ontology/mappings/foodon-to-korean.json` for `name_ko`. Bundled into the image so loader has it offline.

## Running

```bash
# Local (requires Neptune reachability — VPC peering or SSM port-forward)
source .venv/bin/activate
python -m data.load --neptune --opensearch

# As a one-shot ECS task (recommended — runs inside VPC alongside the API)
aws ecs run-task --cluster ontology-retail-dev-cluster \
  --task-definition ontology-retail-dev-api \
  --overrides '{"containerOverrides":[{"name":"api","command":["python","-m","data.load","--neptune","--opensearch","--from-s3"]}]}'
```

## Adding a new entity type

1. Define the Pydantic model in `schemas.py`.
2. Add a generator under `synthetic/` that yields instances.
3. Wire it into `load.py:load_neptune` with a MERGE Cypher.
4. Update `data/output/<entity>.json` after running once.
5. If the entity needs OpenSearch indexing, also add a doc shape under `index_to_opensearch`.
6. Update `api/routers/objects.py:_TYPE_REGISTRY` so the Object Explorer can browse it.
7. Update `api/routers/ontology.py:_CLASSES` and `_RELATIONS` so the ER diagram shows it.
