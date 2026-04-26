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
from typing import Any, Dict, List, Optional

import requests
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest

from api.aws_clients import session
from api.config import get_settings


def open_cypher(query: str, *, parameters: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    settings = get_settings()
    url = f"https://{settings.neptune_endpoint}:{settings.neptune_port}/openCypher"
    body = {"query": query}
    if parameters:
        body["parameters"] = json.dumps(parameters)
    return _signed_post(url, body, service="neptune-db").get("results", [])


def sparql(query: str) -> Dict[str, Any]:
    settings = get_settings()
    url = f"https://{settings.neptune_endpoint}:{settings.neptune_port}/sparql"
    return _signed_post(url, {"query": query}, service="neptune-db")


def subgraph_for_skus(sku_ids: List[str], *, hops: int = 2) -> Dict[str, Any]:
    """
    Returns a Cytoscape.js-friendly subgraph JSON: nodes + edges.
    Used by Scenario A right panel for live ontology highlight.
    """
    if not sku_ids:
        return {"nodes": [], "edges": []}
    placeholders = ",".join(f"'{s}'" for s in sku_ids)
    cypher = f"""
        MATCH (p:Product)
        WHERE p.sku_id IN [{placeholders}]
        OPTIONAL MATCH path = (p)-[*1..{hops}]-(neighbor)
        WITH collect(DISTINCT p) + collect(DISTINCT neighbor) AS nodes,
             collect(DISTINCT relationships(path)) AS edge_groups
        UNWIND edge_groups AS edges
        UNWIND edges AS r
        WITH nodes, collect(DISTINCT r) AS edges
        RETURN nodes, edges
    """
    rows = open_cypher(cypher)
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


def _signed_post(url: str, body: Dict[str, Any], *, service: str) -> Dict[str, Any]:
    settings = get_settings()
    creds = session().get_credentials().get_frozen_credentials()
    data = "&".join(f"{k}={requests.utils.quote(str(v))}" for k, v in body.items())
    req = AWSRequest(
        method="POST",
        url=url,
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    SigV4Auth(creds, service, settings.aws_region).add_auth(req)
    resp = requests.post(
        url, headers=dict(req.headers), data=data,
        timeout=settings.request_timeout_seconds, verify=True,
    )
    resp.raise_for_status()
    return resp.json()
