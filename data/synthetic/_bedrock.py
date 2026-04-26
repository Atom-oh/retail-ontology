"""
Shared Bedrock client + tool-use helper for synthetic data generation.

Uses the Converse API with forced tool-use for reliable structured output.
Default model is the apac cross-region inference profile for Claude Sonnet 4.6
so that calls origin in Seoul (ap-northeast-2) per spec § 7.

Override via env vars:
  BEDROCK_MODEL_ID, AWS_REGION, AWS_PROFILE
"""
from __future__ import annotations

import os
from typing import Any, Dict, Optional

import boto3
from botocore.config import Config

DEFAULT_MODEL_ID = "global.anthropic.claude-sonnet-4-6"
DEFAULT_REGION = "ap-northeast-2"
DEFAULT_MAX_TOKENS = 8192


def runtime_client():
    region = os.environ.get("AWS_REGION", DEFAULT_REGION)
    return boto3.client(
        "bedrock-runtime",
        region_name=region,
        config=Config(
            retries={"max_attempts": 8, "mode": "adaptive"},
            read_timeout=180,
            connect_timeout=10,
        ),
    )


def call_with_tool(
    *,
    system_prompt: str,
    user_prompt: str,
    tool_name: str,
    tool_description: str,
    input_schema: Dict[str, Any],
    model_id: Optional[str] = None,
    temperature: float = 0.7,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    client=None,
) -> Dict[str, Any]:
    """
    Single Bedrock Converse call with forced tool use. Returns the tool input dict.

    Raises RuntimeError if the model does not produce a toolUse block (rare with
    forced toolChoice but we surface it loudly so callers can retry).
    """
    client = client or runtime_client()
    mid = model_id or os.environ.get("BEDROCK_MODEL_ID", DEFAULT_MODEL_ID)
    response = client.converse(
        modelId=mid,
        system=[{"text": system_prompt}],
        messages=[{"role": "user", "content": [{"text": user_prompt}]}],
        toolConfig={
            "tools": [
                {
                    "toolSpec": {
                        "name": tool_name,
                        "description": tool_description,
                        "inputSchema": {"json": input_schema},
                    }
                }
            ],
            "toolChoice": {"tool": {"name": tool_name}},
        },
        inferenceConfig={"maxTokens": max_tokens, "temperature": temperature},
    )
    blocks = response.get("output", {}).get("message", {}).get("content", [])
    for block in blocks:
        if "toolUse" in block:
            return block["toolUse"]["input"]
    raise RuntimeError(
        f"No toolUse block in Bedrock response. stopReason="
        f"{response.get('stopReason')}, content_blocks={len(blocks)}"
    )


def array_tool_schema(item_schema: Dict[str, Any], *, min_items: int, max_items: int) -> Dict[str, Any]:
    """Wrap a single-item JSON schema into an `items` array tool input schema."""
    return {
        "type": "object",
        "required": ["items"],
        "properties": {
            "items": {
                "type": "array",
                "items": item_schema,
                "minItems": min_items,
                "maxItems": max_items,
            }
        },
    }
