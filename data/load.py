"""
Load synthetic + deterministic data into Neptune (graph) + OpenSearch (search).

Run order:
    python -m data.synthetic.deterministic                    # if not yet
    python -m data.synthetic.personas
    python -m data.synthetic.products
    python -m data.synthetic.reviews
    python -m data.load                                        # this script

Reads from data/output/* and writes to:
    - Neptune (via SigV4-signed openCypher) — nodes + edges
    - OpenSearch Serverless (via opensearch-py) — embedded chunks for KB
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List
from urllib.parse import urlparse

import boto3
import requests
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from opensearchpy import AWSV4SignerAuth, OpenSearch, RequestsHttpConnection, helpers

OUTPUT_DIR = Path(__file__).resolve().parent / "output"
REGION = os.environ.get("AWS_REGION", "ap-northeast-2")
NEPTUNE_ENDPOINT = os.environ.get("NEPTUNE_ENDPOINT")
OPENSEARCH_ENDPOINT = os.environ.get("OPENSEARCH_ENDPOINT")
OPENSEARCH_INDEX = os.environ.get("OPENSEARCH_INDEX", "ontology-retail-dev-kb-index")
EMBED_MODEL_ID = os.environ.get("BEDROCK_EMBED_MODEL_ID", "global.cohere.embed-v4:0")


# --------------------------------------------------------------------------
# Resource lookup from CFN outputs (defaults if env not set)
# --------------------------------------------------------------------------
def _resolve_endpoints() -> None:
    """Fill missing endpoints from CFN outputs."""
    global NEPTUNE_ENDPOINT, OPENSEARCH_ENDPOINT
    if NEPTUNE_ENDPOINT and OPENSEARCH_ENDPOINT:
        return
    cfn = boto3.client("cloudformation", region_name=REGION)
    try:
        outs = cfn.describe_stacks(StackName="OntologyRetailData")["Stacks"][0]["Outputs"]
        for o in outs:
            if not NEPTUNE_ENDPOINT and o["OutputKey"] == "NeptuneClusterEndpoint":
                NEPTUNE_ENDPOINT = o["OutputValue"]
            elif not OPENSEARCH_ENDPOINT and o["OutputKey"] == "OpenSearchCollectionEndpoint":
                OPENSEARCH_ENDPOINT = o["OutputValue"]
    except Exception as e:
        print(f"warn: CFN lookup failed: {e}", file=sys.stderr)


# --------------------------------------------------------------------------
# Neptune helpers
# --------------------------------------------------------------------------
_NEPTUNE_CLIENT = None


def _neptune_client():
    global _NEPTUNE_CLIENT
    if _NEPTUNE_CLIENT is None:
        if not NEPTUNE_ENDPOINT:
            raise RuntimeError("NEPTUNE_ENDPOINT not resolved")
        # boto3 neptunedata client — internal SigV4 handles all canonical
        # request edge cases. `requests-aws4auth` and manual SigV4 both
        # returned 403 Forbidden for the same underlying signing-format
        # mismatch (probably Host header port handling).
        _NEPTUNE_CLIENT = boto3.client(
            "neptunedata", region_name=REGION,
            endpoint_url=f"https://{NEPTUNE_ENDPOINT}:8182",
        )
    return _NEPTUNE_CLIENT


def neptune_cypher(query: str, parameters: Dict[str, Any] | None = None) -> List[Dict[str, Any]]:
    kwargs: Dict[str, Any] = {"openCypherQuery": query}
    if parameters:
        kwargs["parameters"] = json.dumps(parameters)
    resp = _neptune_client().execute_open_cypher_query(**kwargs)
    return resp.get("results", [])


def load_jsonish(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        print(f"  skip {path.name} (not found)")
        return []
    if path.suffix == ".json":
        return json.loads(path.read_text(encoding="utf-8"))
    items: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                items.append(json.loads(line))
    return items


def _flatten_props(d: Dict[str, Any]) -> Dict[str, Any]:
    """Neptune Cypher SET n += $p only accepts scalar property values.
    Lists/dicts → JSON-encoded string. Edge collections handled separately
    via explicit relationships (so we drop them from node properties)."""
    out: Dict[str, Any] = {}
    for k, v in d.items():
        if v is None:
            continue
        if isinstance(v, (str, int, float, bool)):
            out[k] = v
        elif isinstance(v, list):
            # Encode as semicolon-joined string for searchability; complex
            # list-of-dict gets JSON.
            if all(isinstance(x, (str, int, float, bool)) for x in v):
                out[k] = ";".join(str(x) for x in v)
            else:
                out[k] = json.dumps(v, ensure_ascii=False)
        else:
            out[k] = json.dumps(v, ensure_ascii=False, default=str)
    return out


def load_neptune() -> Dict[str, int]:
    counts: Dict[str, int] = {}

    # Manufacturers
    items = load_jsonish(OUTPUT_DIR / "manufacturers.json")
    for m in items:
        neptune_cypher(
            "MERGE (n:Manufacturer {mfr_id: $id}) SET n += $p",
            {"id": m["mfr_id"], "p": _flatten_props({k: v for k, v in m.items() if k != "mfr_id"})},
        )
    counts["manufacturers"] = len(items)

    # Brands
    items = load_jsonish(OUTPUT_DIR / "brands.json")
    for b in items:
        neptune_cypher(
            "MERGE (n:Brand {brand_id: $id}) SET n += $p "
            "WITH n MATCH (m:Manufacturer {mfr_id: $mid}) MERGE (n)-[:MANUFACTURED_BY]->(m)",
            {"id": b["brand_id"],
             "p": _flatten_props({k: v for k, v in b.items() if k != "brand_id"}),
             "mid": b["manufacturer_id"]},
        )
    counts["brands"] = len(items)

    # Concerns
    items = load_jsonish(OUTPUT_DIR / "concerns.json")
    for c in items:
        prefer = c.get("prefers_ingredient_ids", [])
        avoid = c.get("avoids_ingredient_ids", [])
        plain = _flatten_props({k: v for k, v in c.items() if k not in ("prefers_ingredient_ids", "avoids_ingredient_ids")})
        neptune_cypher(
            "MERGE (n:Concern {concern_id: $id}) SET n += $p", {"id": c["concern_id"], "p": plain},
        )
        for iid in prefer:
            neptune_cypher(
                "MATCH (c:Concern {concern_id: $cid}) "
                "MERGE (i:Ingredient {ingredient_id: $iid}) "
                "MERGE (c)-[:PREFERS_INGREDIENT]->(i)",
                {"cid": c["concern_id"], "iid": iid},
            )
        for iid in avoid:
            neptune_cypher(
                "MATCH (c:Concern {concern_id: $cid}) "
                "MERGE (i:Ingredient {ingredient_id: $iid}) "
                "MERGE (c)-[:AVOIDS_INGREDIENT]->(i)",
                {"cid": c["concern_id"], "iid": iid},
            )
    counts["concerns"] = len(items)

    # Trends
    items = load_jsonish(OUTPUT_DIR / "trends.json")
    for t in items:
        ings = t.get("involves_ingredient_ids", [])
        cats = t.get("involves_brick_codes", [])
        plain = _flatten_props({k: v for k, v in t.items() if k not in ("involves_ingredient_ids", "involves_brick_codes")})
        neptune_cypher(
            "MERGE (n:Trend {trend_id: $id}) SET n += $p", {"id": t["trend_id"], "p": plain},
        )
        for iid in ings:
            neptune_cypher(
                "MATCH (tr:Trend {trend_id: $tid}) "
                "MERGE (i:Ingredient {ingredient_id: $iid}) "
                "MERGE (tr)-[:INVOLVES]->(i)",
                {"tid": t["trend_id"], "iid": iid},
            )
        for cc in cats:
            neptune_cypher(
                "MATCH (tr:Trend {trend_id: $tid}) "
                "MERGE (c:Category {gs1_brick_code: $cc}) "
                "MERGE (tr)-[:INVOLVES]->(c)",
                {"tid": t["trend_id"], "cc": cc},
            )
    counts["trends"] = len(items)

    # Personas
    items = load_jsonish(OUTPUT_DIR / "personas.ndjson")
    for p in items:
        cids = p.get("concern_ids", [])
        plain = _flatten_props({k: v for k, v in p.items() if k not in ("concern_ids",)})
        neptune_cypher(
            "MERGE (n:Persona {persona_id: $id}) SET n += $p", {"id": p["persona_id"], "p": plain},
        )
        for cid in cids:
            neptune_cypher(
                "MATCH (per:Persona {persona_id: $pid}), (c:Concern {concern_id: $cid}) "
                "MERGE (per)-[:HAS_CONCERN]->(c)",
                {"pid": p["persona_id"], "cid": cid},
            )
    counts["personas"] = len(items)

    # Products + reviews
    items = load_jsonish(OUTPUT_DIR / "products.ndjson")
    for prod in items:
        ings = prod.get("ingredients", [])
        target = prod.get("target_concern_ids", [])
        plain = _flatten_props({k: v for k, v in prod.items() if k not in ("ingredients", "nutrients", "target_concern_ids")})
        neptune_cypher(
            "MERGE (n:Product {sku_id: $id}) SET n += $p", {"id": prod["sku_id"], "p": plain},
        )
        # brand
        if prod.get("brand_id"):
            neptune_cypher(
                "MATCH (p:Product {sku_id: $sid}), (b:Brand {brand_id: $bid}) "
                "MERGE (p)-[:BY_BRAND]->(b)",
                {"sid": prod["sku_id"], "bid": prod["brand_id"]},
            )
        # category
        if prod.get("gs1_brick_code"):
            neptune_cypher(
                "MATCH (p:Product {sku_id: $sid}) "
                "MERGE (c:Category {gs1_brick_code: $cc}) "
                "MERGE (p)-[:IN_CATEGORY]->(c)",
                {"sid": prod["sku_id"], "cc": prod["gs1_brick_code"]},
            )
        for ing in ings:
            neptune_cypher(
                "MATCH (p:Product {sku_id: $sid}) "
                "MERGE (i:Ingredient {ingredient_id: $iid}) "
                "MERGE (p)-[:HAS_INGREDIENT]->(i)",
                {"sid": prod["sku_id"], "iid": ing["ingredient_id"]},
            )
        for cid in target:
            neptune_cypher(
                "MATCH (p:Product {sku_id: $sid}), (c:Concern {concern_id: $cid}) "
                "MERGE (p)-[:TARGETS_CONCERN]->(c)",
                {"sid": prod["sku_id"], "cid": cid},
            )
    counts["products"] = len(items)

    items = load_jsonish(OUTPUT_DIR / "reviews.ndjson")
    for r in items:
        plain = _flatten_props({k: v for k, v in r.items() if k not in ("sku_id", "persona_id")})
        neptune_cypher(
            "MERGE (rv:Review {review_id: $id}) SET rv += $p "
            "WITH rv MATCH (p:Product {sku_id: $sid}) MERGE (rv)-[:ABOUT]->(p) "
            "WITH rv MATCH (per:Persona {persona_id: $pid}) MERGE (rv)-[:WRITTEN_BY]->(per)",
            {"id": r["review_id"], "p": plain, "sid": r["sku_id"], "pid": r["persona_id"]},
        )
    counts["reviews"] = len(items)
    return counts


# --------------------------------------------------------------------------
# OpenSearch indexing — products + reviews as searchable text + embeddings
# --------------------------------------------------------------------------
def os_client() -> OpenSearch:
    if not OPENSEARCH_ENDPOINT:
        raise RuntimeError("OPENSEARCH_ENDPOINT not resolved")
    host = urlparse(OPENSEARCH_ENDPOINT).netloc or OPENSEARCH_ENDPOINT
    creds = boto3.Session().get_credentials()
    return OpenSearch(
        hosts=[{"host": host, "port": 443}],
        http_auth=AWSV4SignerAuth(creds, REGION, "aoss"),
        use_ssl=True, verify_certs=True,
        connection_class=RequestsHttpConnection, pool_maxsize=4, timeout=60,
    )


def embed_texts(texts: List[str]) -> List[List[float]]:
    bedrock = boto3.client("bedrock-runtime", region_name=REGION)
    body = {"texts": texts, "input_type": "search_document", "embedding_types": ["float"]}
    resp = bedrock.invoke_model(modelId=EMBED_MODEL_ID, body=json.dumps(body),
                                contentType="application/json", accept="application/json")
    payload = json.loads(resp["body"].read())
    embs = payload["embeddings"]
    return embs["float"] if isinstance(embs, dict) else embs


def docs_for_product(p: Dict[str, Any]) -> Dict[str, Any]:
    text = " ".join([
        p.get("name_ko", ""),
        p.get("description_ko", ""),
        " ".join(p.get("claims_ko", []) or []),
    ]).strip()
    return {
        "_id": p["sku_id"],
        "AMAZON_BEDROCK_TEXT_CHUNK": text,
        "AMAZON_BEDROCK_METADATA": json.dumps({
            "type": "product",
            "sku_id": p["sku_id"],
            "domain": p.get("domain"),
            "brand_id": p.get("brand_id"),
            "gs1_brick_code": p.get("gs1_brick_code"),
            "is_wow": p.get("is_wow", False),
        }),
    }


def docs_for_review(r: Dict[str, Any]) -> Dict[str, Any]:
    text = " ".join([r.get("title_ko", "") or "", r.get("body_ko", "")]).strip()
    return {
        "_id": r["review_id"],
        "AMAZON_BEDROCK_TEXT_CHUNK": text,
        "AMAZON_BEDROCK_METADATA": json.dumps({
            "type": "review", "review_id": r["review_id"],
            "sku_id": r.get("sku_id"), "persona_id": r.get("persona_id"),
            "sentiment": r.get("sentiment"), "rating": r.get("rating"),
        }),
    }


def index_to_opensearch(batch_size: int = 32) -> Dict[str, int]:
    client = os_client()
    counts: Dict[str, int] = {"products": 0, "reviews": 0}
    products = load_jsonish(OUTPUT_DIR / "products.ndjson")
    reviews = load_jsonish(OUTPUT_DIR / "reviews.ndjson")

    def chunked(seq: List[Dict[str, Any]], n: int) -> Iterable[List[Dict[str, Any]]]:
        for i in range(0, len(seq), n):
            yield seq[i:i + n]

    for label, items, builder in (("products", products, docs_for_product),
                                   ("reviews", reviews, docs_for_review)):
        if not items:
            continue
        print(f"  indexing {len(items)} {label}…")
        for batch in chunked(items, batch_size):
            docs = [builder(it) for it in batch]
            embs = embed_texts([d["AMAZON_BEDROCK_TEXT_CHUNK"] for d in docs if d["AMAZON_BEDROCK_TEXT_CHUNK"]])
            actions = []
            ei = 0
            for d in docs:
                if not d["AMAZON_BEDROCK_TEXT_CHUNK"]:
                    continue
                d["bedrock-knowledge-base-default-vector"] = embs[ei]
                ei += 1
                actions.append({"_index": OPENSEARCH_INDEX, "_id": d.pop("_id"), "_source": d})
            if actions:
                helpers.bulk(client, actions, refresh=False, raise_on_error=False)
            counts[label] += len(actions)
    return counts


# --------------------------------------------------------------------------
def _sync_from_s3() -> None:
    """When running in Fargate (no local data/output), pull from S3."""
    bucket = os.environ.get("SYNTHETIC_DATA_BUCKET")
    if not bucket:
        return
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    s3 = boto3.client("s3", region_name=REGION)
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix="data/output/"):
        for obj in page.get("Contents", []) or []:
            key = obj["Key"]
            if not (key.endswith(".json") or key.endswith(".ndjson")):
                continue
            local = OUTPUT_DIR / Path(key).name
            s3.download_file(bucket, key, str(local))
            print(f"  s3://{bucket}/{key} → {local}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--neptune", action="store_true", default=False)
    parser.add_argument("--opensearch", action="store_true", default=False)
    parser.add_argument("--all", action="store_true", default=False)
    parser.add_argument("--from-s3", action="store_true", default=False,
                        help="Download data/output/ from $SYNTHETIC_DATA_BUCKET first")
    args = parser.parse_args()
    if args.from_s3:
        print("Syncing data/output/ from S3…")
        _sync_from_s3()
    if args.all or (not args.neptune and not args.opensearch):
        args.neptune = args.opensearch = True

    _resolve_endpoints()
    print(f"Neptune: {NEPTUNE_ENDPOINT}")
    print(f"OpenSearch: {OPENSEARCH_ENDPOINT} ({OPENSEARCH_INDEX})")
    print()

    if args.neptune:
        print("Loading into Neptune…")
        n_counts = load_neptune()
        for k, v in n_counts.items():
            print(f"  {k:14s} {v:5d}")
    if args.opensearch:
        print("\nIndexing into OpenSearch…")
        os_counts = index_to_opensearch()
        for k, v in os_counts.items():
            print(f"  {k:14s} {v:5d}")
    print("\nDone.")


if __name__ == "__main__":
    main()
