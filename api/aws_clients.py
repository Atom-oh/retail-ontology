"""
boto3 client singletons + secret fetcher.

Single Session shared across clients so credentials/region resolve once.
Clients are thread-safe per boto3 docs as long as not mutated.
"""
from __future__ import annotations

import json
from functools import lru_cache
from typing import Any, Dict

import boto3
from botocore.config import Config

from api.config import get_settings


_RETRY_CONFIG = Config(
    retries={"max_attempts": 8, "mode": "adaptive"},
    read_timeout=120,
    connect_timeout=10,
)


@lru_cache(maxsize=1)
def session() -> boto3.session.Session:
    return boto3.session.Session(region_name=get_settings().aws_region)


@lru_cache(maxsize=1)
def bedrock_runtime():
    return session().client("bedrock-runtime", config=_RETRY_CONFIG)


@lru_cache(maxsize=1)
def bedrock_agent_runtime():
    return session().client("bedrock-agent-runtime", config=_RETRY_CONFIG)


@lru_cache(maxsize=1)
def bedrock_agentcore_control():
    """AgentCore control plane (memory CRUD). Service evolving — may need newer SDK."""
    return session().client("bedrock-agentcore-control", config=_RETRY_CONFIG)


@lru_cache(maxsize=1)
def bedrock_agentcore():
    """AgentCore data plane (memory ops, agent invoke)."""
    return session().client("bedrock-agentcore", config=_RETRY_CONFIG)


@lru_cache(maxsize=1)
def secretsmanager():
    return session().client("secretsmanager", config=_RETRY_CONFIG)


@lru_cache(maxsize=1)
def s3():
    return session().client("s3", config=_RETRY_CONFIG)


@lru_cache(maxsize=1)
def aoss_serverless():
    return session().client("opensearchserverless", config=_RETRY_CONFIG)


@lru_cache(maxsize=1)
def cloudwatch():
    return session().client("cloudwatch", config=_RETRY_CONFIG)


@lru_cache(maxsize=1)
def aurora_credentials() -> Dict[str, str]:
    """Fetch and cache Aurora credentials at startup."""
    secret_arn = get_settings().aurora_secret_arn
    resp = secretsmanager().get_secret_value(SecretId=secret_arn)
    return json.loads(resp["SecretString"])


@lru_cache(maxsize=1)
def origin_auth_secret() -> str:
    """Fetch and cache the X-Origin-Auth-Token shared secret."""
    import os
    arn = os.environ.get("ORIGIN_AUTH_SECRET_ARN")
    if not arn:
        return ""
    resp = secretsmanager().get_secret_value(SecretId=arn)
    return resp["SecretString"]
