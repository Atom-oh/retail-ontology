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
import os
import sys
from typing import Optional
from urllib.parse import urlparse

import boto3
from opensearchpy import AWSV4SignerAuth, OpenSearch, RequestsHttpConnection
from opensearchpy.exceptions import RequestError

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


def _client(endpoint: str, region: str) -> OpenSearch:
    """opensearch-py with SigV4 — reliable for AOSS data plane (manual
    signing via botocore had inconsistent header normalization)."""
    host = urlparse(endpoint).netloc or endpoint
    creds = boto3.Session().get_credentials()
    return OpenSearch(
        hosts=[{"host": host, "port": 443}],
        http_auth=AWSV4SignerAuth(creds, region, SERVICE),
        use_ssl=True, verify_certs=True,
        connection_class=RequestsHttpConnection,
        pool_maxsize=4,
    )


def create_index(endpoint: str, index_name: str, region: str) -> None:
    print(f"PUT {endpoint.rstrip('/')}/{index_name}")
    client = _client(endpoint, region)
    try:
        resp = client.indices.create(index=index_name, body=index_body())
        print(f"  ✓ created: {resp}")
    except RequestError as e:
        if "resource_already_exists" in str(e):
            print("  • already exists (idempotent)")
        else:
            print(f"  ✗ failed: {e}", file=sys.stderr)
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
