"""
Bedrock ApplyGuardrail wrapper for input/output PII scrub.

Per spec § 10: must run BEFORE Reranker call (cross-region) to avoid PII leaving
ap-northeast-2 even ephemerally.
"""
from __future__ import annotations

from typing import Literal, Optional, Tuple

from api.aws_clients import bedrock_runtime
from api.config import get_settings


GuardrailSource = Literal["INPUT", "OUTPUT"]


def apply(text: str, source: GuardrailSource = "INPUT") -> Tuple[str, bool]:
    """
    Returns (scrubbed_text, was_intervened).
    On guardrail intervention (BLOCK/ANONYMIZE), the returned text is the
    sanitized version (or canned blocked message if BLOCK).
    """
    s = get_settings()
    resp = bedrock_runtime().apply_guardrail(
        guardrailIdentifier=s.bedrock_guardrail_id,
        guardrailVersion=s.bedrock_guardrail_version,
        source=source,
        content=[{"text": {"text": text}}],
    )
    action = resp.get("action", "NONE")
    intervened = action != "NONE"
    if intervened and resp.get("outputs"):
        scrubbed = resp["outputs"][0].get("text", text)
    else:
        scrubbed = text
    return scrubbed, intervened


def apply_or_none(text: Optional[str], source: GuardrailSource = "INPUT") -> Optional[str]:
    if not text:
        return text
    scrubbed, _ = apply(text, source)
    return scrubbed
