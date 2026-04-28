"""Shared pytest configuration.

Sets dummy env vars before any test or `api.*` import touches `api.config.Settings`.
The Pydantic settings class declares many fields without defaults (intentional —
in production every value is wired by ECS task-def in `infra-cdk/lib/compute-stack.ts`),
so the test environment must supply something for each one. Real AWS calls are
mocked separately at the test level.

This module is collected by pytest before test files, so module-level side effects
land in time for `api.config` and `api.main` imports during test collection.
"""
from __future__ import annotations

import os

# AWS — region only; credentials are not needed because tests mock boto3 calls.
os.environ.setdefault("AWS_REGION", "ap-northeast-2")

# Aurora
os.environ.setdefault(
    "AURORA_SECRET_ARN",
    "arn:aws:secretsmanager:ap-northeast-2:000000000000:secret:test-aurora-secret",
)
os.environ.setdefault("AURORA_DATABASE_NAME", "ontology_test")

# Neptune
os.environ.setdefault("NEPTUNE_ENDPOINT", "test-neptune.cluster.ap-northeast-2.neptune.amazonaws.com")

# OpenSearch Serverless
os.environ.setdefault(
    "OPENSEARCH_ENDPOINT",
    "https://test.ap-northeast-2.aoss.amazonaws.com",
)
os.environ.setdefault("OPENSEARCH_INDEX", "test-index")

# Bedrock
os.environ.setdefault("BEDROCK_KB_ID", "TESTKB1234")
os.environ.setdefault("BEDROCK_GUARDRAIL_ID", "test-guardrail-id")
os.environ.setdefault("BEDROCK_GUARDRAIL_VERSION", "1")

# AgentCore
os.environ.setdefault("AGENTCORE_MEMORY_ID", "test_memory")

# S3 buckets
os.environ.setdefault("RAW_DOCS_BUCKET", "test-raw-docs")
os.environ.setdefault("UPLOADS_BUCKET", "test-uploads")

# Cognito + project metadata (read at module import in api.routers.auth)
os.environ.setdefault("ONTOLOGY_PROJECT", "ontology-retail")
os.environ.setdefault("ONTOLOGY_ENV", "test")
os.environ.setdefault("AWS_ACCOUNT_ID", "000000000000")
os.environ.setdefault("COGNITO_USER_POOL_CLIENT_ID", "test-client-id")
os.environ.setdefault("PUBLIC_DOMAIN", "retail-ontology.test.invalid")
