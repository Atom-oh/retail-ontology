"""
Scenario C wow corner: PDF upload → Claude structured extraction → Neptune.

Flow (spec § 7.3 LLM 자동 추출 코너):
  1. MD uploads PDF (e.g., new product spec sheet) to UploadsBucket
  2. We parse PDF with pdfplumber to text
  3. Claude tool-use produces ontology-shaped JSON (Product/Ingredient/...)
  4. We MERGE into Neptune (idempotent on sku_id)
  5. KB sync triggers (separate job) for new docs
"""
from __future__ import annotations

import io
import json
from typing import Any, Dict, List

from api.aws_clients import bedrock_runtime, s3
from api.config import get_settings
from api.services import neptune

EXTRACTION_TOOL = {
    "toolSpec": {
        "name": "save_extracted",
        "description": "Save the structured product entities extracted from the PDF.",
        "inputSchema": {"json": {
            "type": "object",
            "required": ["product"],
            "properties": {
                "product": {
                    "type": "object",
                    "required": ["sku_id", "name_ko", "domain", "brand_id"],
                    "properties": {
                        "sku_id": {"type": "string"},
                        "name_ko": {"type": "string"},
                        "name_en": {"type": "string"},
                        "domain": {"type": "string", "enum": ["grocery", "beauty"]},
                        "gs1_brick_code": {"type": "string"},
                        "brand_id": {"type": "string"},
                        "ingredients": {
                            "type": "array",
                            "items": {"type": "object",
                                      "properties": {"ingredient_id": {"type": "string"},
                                                     "amount_note_ko": {"type": "string"}}},
                        },
                        "nutrients": {
                            "type": "array",
                            "items": {"type": "object",
                                      "properties": {"nutrient_id": {"type": "string"},
                                                     "value": {"type": "number"},
                                                     "per_100g_or_ml": {"type": "boolean"}}},
                        },
                        "claims_ko": {"type": "array", "items": {"type": "string"}},
                        "description_ko": {"type": "string"},
                    },
                },
            },
        }},
    }
}


def fetch_pdf_text(bucket: str, key: str) -> str:
    """Pull PDF from S3 and extract plain text. Uses pdfplumber if available."""
    body = s3().get_object(Bucket=bucket, Key=key)["Body"].read()
    try:
        import pdfplumber  # type: ignore
    except ImportError:
        return body.decode("utf-8", errors="ignore")
    text_parts: List[str] = []
    with pdfplumber.open(io.BytesIO(body)) as pdf:
        for page in pdf.pages:
            t = page.extract_text() or ""
            if t.strip():
                text_parts.append(t)
    return "\n\n".join(text_parts)


def extract_with_claude(text: str) -> Dict[str, Any]:
    """Tool-use forced extraction → ontology-shaped JSON dict."""
    s = get_settings()
    resp = bedrock_runtime().converse(
        modelId=s.bedrock_chat_model_id,
        system=[{"text":
            "당신은 한국 retail/CPG 신상품 PDF에서 제품 정보를 온톨로지 스키마에 맞게 "
            "추출합니다. 모르는 필드는 누락하고, 추정하지 마세요."}],
        messages=[{"role": "user", "content": [{"text": text[:30000]}]}],
        toolConfig={"tools": [EXTRACTION_TOOL],
                    "toolChoice": {"tool": {"name": "save_extracted"}}},
        inferenceConfig={"maxTokens": 4096, "temperature": 0.1},
    )
    blocks = resp["output"]["message"]["content"]
    for b in blocks:
        if "toolUse" in b:
            return b["toolUse"]["input"]
    raise RuntimeError("extraction did not return structured output")


def merge_into_neptune(extracted: Dict[str, Any]) -> Dict[str, Any]:
    """
    MERGE the extracted product into Neptune (upsert).
    Returns {"sku_id": ..., "merged_nodes": N, "merged_edges": M}.
    """
    p = extracted["product"]
    sku_id = p["sku_id"]
    cypher = """
        MERGE (prod:Product {sku_id: $sku_id})
          ON CREATE SET prod += $props
          ON MATCH SET prod += $props
        WITH prod
        OPTIONAL MATCH (b:Brand {brand_id: $brand_id})
        FOREACH (_ IN CASE WHEN b IS NULL THEN [] ELSE [1] END |
            MERGE (prod)-[:BY_BRAND]->(b))
        RETURN prod.sku_id AS sku_id
    """
    props = {k: p.get(k) for k in
             ("name_ko", "name_en", "domain", "gs1_brick_code", "description_ko") if p.get(k)}
    rows = neptune.open_cypher(cypher, parameters={
        "sku_id": sku_id, "brand_id": p.get("brand_id"), "props": props,
    })
    edges_added = 0
    for ing in p.get("ingredients", []) or []:
        neptune.open_cypher(
            "MATCH (prod:Product {sku_id: $sku_id}), (i:Ingredient {ingredient_id: $iid}) "
            "MERGE (prod)-[:HAS_INGREDIENT]->(i) RETURN i.ingredient_id",
            parameters={"sku_id": sku_id, "iid": ing["ingredient_id"]},
        )
        edges_added += 1
    return {"sku_id": sku_id, "merged_nodes": len(rows), "merged_edges": edges_added}
