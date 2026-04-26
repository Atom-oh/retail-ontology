"""
Create the OpenSearch Serverless index that Bedrock KB requires (precondition).

Run order:
    1. cdk deploy OntologyRetailNetwork OntologyRetailData
    2. python scripts/create_kb_index.py
    3. cdk deploy OntologyRetailAi

Why this isn't in CDK: aws-cdk-lib has no construct for OS Serverless index
creation (data plane HTTP), and Bedrock KB requires the index pre-existing
with specific field mappings. Bootstrapping data plane is a separate step.

Usage:
    python scripts/create_kb_index.py \
        --collection-endpoint https://xxx.aoss.amazonaws.com \
        --index-name ontology-retail-dev-kb-index \
        --region ap-northeast-2

If args omitted, looks them up via CloudFormation outputs of OntologyRetailData
and OntologyRetailAi stacks.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Optional

import boto3
import requests
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest

REGION_DEFAULT = os.environ.get("AWS_REGION", "ap-northeast-2")
SERVICE = "aoss"


def lookup_from_outputs(stack_name: str, output_key: str, region: str) -> Optional[str]:
    cfn = boto3.client("cloudformation", region_name=region)
    try:
        resp = cfn.describe_stacks(StackName=stack_name)
    except cfn.exceptions.ClientError:
        return None
    outputs = resp["Stacks"][0].get("Outputs", [])
    for o in outputs:
        if o["OutputKey"] == output_key:
            return o["OutputValue"]
    return None


def index_body() -> dict:
    """Vector + Nori-friendly hybrid mapping for KB."""
    return {
        "settings": {
            "index": {
                "knn": True,
                "knn.algo_param.ef_search": 512,
            },
            "analysis": {
                "analyzer": {
                    "korean_nori": {
                        "type": "custom",
                        "tokenizer": "nori_tokenizer",
                        "filter": ["nori_part_of_speech", "lowercase"],
                    }
                }
            },
        },
        "mappings": {
            "properties": {
                "bedrock-knowledge-base-default-vector": {
                    "type": "knn_vector",
                    "dimension": 1024,
                    "method": {
                        "name": "hnsw",
                        "engine": "faiss",
                        "space_type": "l2",
                        "parameters": {"ef_construction": 512, "m": 16},
                    },
                },
                "AMAZON_BEDROCK_TEXT_CHUNK": {
                    "type": "text",
                    "analyzer": "korean_nori",
                    "fields": {"keyword": {"type": "keyword", "ignore_above": 256}},
                },
                "AMAZON_BEDROCK_METADATA": {"type": "text", "index": False},
            }
        },
    }


def signed_request(method: str, url: str, body: Optional[dict], region: str) -> requests.Response:
    session = boto3.Session()
    creds = session.get_credentials().get_frozen_credentials()
    req = AWSRequest(
        method=method,
        url=url,
        data=json.dumps(body) if body is not None else None,
        headers={"Content-Type": "application/json"},
    )
    SigV4Auth(creds, SERVICE, region).add_auth(req)
    return requests.request(
        method=method, url=url, headers=dict(req.headers),
        data=req.body, timeout=60,
    )


def create_index(endpoint: str, index_name: str, region: str) -> None:
    url = f"{endpoint.rstrip('/')}/{index_name}"
    print(f"PUT {url}")
    resp = signed_request("PUT", url, index_body(), region)
    if resp.status_code in (200, 201):
        print(f"  ✓ created (status {resp.status_code})")
    elif resp.status_code == 400 and "resource_already_exists" in resp.text:
        print(f"  • already exists (idempotent)")
    else:
        print(f"  ✗ failed: {resp.status_code}\n{resp.text}", file=sys.stderr)
        sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--collection-endpoint", help="https://xxx.aoss.amazonaws.com")
    parser.add_argument("--index-name", help="e.g., ontology-retail-dev-kb-index")
    parser.add_argument("--region", default=REGION_DEFAULT)
    parser.add_argument("--data-stack", default="OntologyRetailData")
    parser.add_argument("--ai-stack", default="OntologyRetailAi")
    args = parser.parse_args()

    endpoint = args.collection_endpoint or lookup_from_outputs(
        args.data_stack, "OpenSearchCollectionEndpoint", args.region
    )
    if not endpoint:
        sys.exit(f"Could not resolve collection endpoint. Pass --collection-endpoint.")

    index_name = args.index_name or lookup_from_outputs(
        args.ai_stack, "KBVectorIndexName", args.region
    )
    if not index_name:
        # AI stack may not be deployed yet; fall back to convention
        project = os.environ.get("ONTOLOGY_PROJECT", "ontology-retail")
        envn = os.environ.get("ONTOLOGY_ENV", "dev")
        index_name = f"{project}-{envn}-kb-index"
        print(f"  (using conventional index name: {index_name})")

    create_index(endpoint, index_name, args.region)


if __name__ == "__main__":
    main()
