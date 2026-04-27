"""
Neptune client wrapper. Uses HTTPS to the cluster endpoint with SigV4 auth
(IAM database authentication, enabled in DataStack).

Two query interfaces per spec § 8:
- openCypher: property-graph queries (preferred for product-graph traversal)
- SPARQL: ontology-style queries when working with RDF schema.ttl

For Scenario A's right-panel subgraph rendering, openCypher is used.
"""
from __future__ import annotations

import json
from functools import lru_cache
from typing import Any, Dict, List, Optional

import boto3

from api.aws_clients import session
from api.config import get_settings


@lru_cache(maxsize=1)
def _neptunedata():
    settings = get_settings()
    return boto3.client(
        "neptunedata", region_name=settings.aws_region,
        endpoint_url=f"https://{settings.neptune_endpoint}:{settings.neptune_port}",
    )


def open_cypher(query: str, *, parameters: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    kwargs: Dict[str, Any] = {"openCypherQuery": query}
    if parameters:
        kwargs["parameters"] = json.dumps(parameters)
    return _neptunedata().execute_open_cypher_query(**kwargs).get("results", [])


def sparql(query: str) -> Dict[str, Any]:
    return _neptunedata().execute_sparql_query(sparqlQuery=query)


def subgraph_for_skus(sku_ids: List[str], *, hops: int = 2) -> Dict[str, Any]:
    """
    Returns a Cytoscape.js-friendly subgraph JSON: nodes + edges.
    Used by Scenario A right panel for live ontology highlight.
    """
    if not sku_ids:
        return {"nodes": [], "edges": []}
    # sku_ids parameterized via $sku_ids. openCypher doesn't support
    # parameterized variable-length path bounds (`*1..$hops`), so we whitelist
    # the path clause to a fixed dict — even if upstream code stops clamping,
    # only the predefined strings can enter the query (no f-string injection).
    _PATH_CLAUSES = {1: "*1..1", 2: "*1..2", 3: "*1..3"}
    clause = _PATH_CLAUSES.get(int(hops), _PATH_CLAUSES[2])
    cypher = (
        "MATCH (p:Product) WHERE p.sku_id IN $sku_ids "
        f"OPTIONAL MATCH path = (p)-[{clause}]-(neighbor) "
        "WITH collect(DISTINCT p) + collect(DISTINCT neighbor) AS nodes, "
        "     collect(DISTINCT relationships(path)) AS edge_groups "
        "UNWIND edge_groups AS edges UNWIND edges AS r "
        "WITH nodes, collect(DISTINCT r) AS edges "
        "RETURN nodes, edges LIMIT 1"
    )
    rows = open_cypher(cypher, parameters={"sku_ids": list(sku_ids)})
    if not rows:
        return {"nodes": [], "edges": []}
    nodes_raw = rows[0].get("nodes", [])
    edges_raw = rows[0].get("edges", [])
    return {
        "nodes": [{"data": {"id": _node_id(n), **_node_props(n)}} for n in nodes_raw],
        "edges": [{"data": {"source": _node_id(e["~start"]), "target": _node_id(e["~end"]),
                            "label": e.get("~type", ""), **e.get("~properties", {})}}
                  for e in edges_raw],
    }


def _node_id(n: Any) -> str:
    if isinstance(n, dict):
        return str(n.get("~id") or n.get("id") or "")
    return str(n)


def _node_props(n: Any) -> Dict[str, Any]:
    if isinstance(n, dict):
        return {**n.get("~properties", {}), "label": n.get("~labels", [""])[0]}
    return {}


# Manual SigV4 helper removed — boto3 neptunedata client handles all
# signing internally. Manual versions (botocore SigV4Auth + requests, OR
# requests-aws4auth) both produced canonical-request mismatches that
# Neptune rejected with 403.
