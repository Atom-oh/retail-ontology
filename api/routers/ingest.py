"""Scenario C wow — POST /api/ingest/pdf (PDF→Claude→Neptune)."""
from __future__ import annotations

import re
from typing import Any, Dict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from api.config import get_settings
from api.services import ingest

router = APIRouter(tags=["ingest"])

# Restrict keys to a controlled prefix (`pdf/{actor_id}/{filename}.pdf`) of
# allowed chars only. No '..', no leading '/', no whitespace, must end .pdf.
_KEY_PATTERN = re.compile(r"^pdf/[A-Za-z0-9_\-]{1,64}/[A-Za-z0-9_\-]{1,128}\.pdf$")


class IngestPdfRequest(BaseModel):
    s3_key: str = Field(
        min_length=8, max_length=256,
        description="S3 key under UploadsBucket. Must match pdf/{actor}/{name}.pdf",
    )

    @field_validator("s3_key")
    @classmethod
    def _validate_key(cls, v: str) -> str:
        # Defense in depth: explicit checks before regex (clearer error messages
        # than regex misses; regex catches everything else).
        if ".." in v or "//" in v or v.startswith("/") or "\x00" in v:
            raise ValueError("s3_key contains forbidden pattern (.., //, leading /, NUL)")
        if not _KEY_PATTERN.match(v):
            raise ValueError("s3_key must match pdf/{actor}/{name}.pdf with [A-Za-z0-9_-] only")
        return v


class IngestPdfResponse(BaseModel):
    extracted: Dict[str, Any]
    merge_result: Dict[str, Any]


@router.post("/ingest/pdf", response_model=IngestPdfResponse)
def ingest_pdf(req: IngestPdfRequest) -> IngestPdfResponse:
    s = get_settings()
    text = ingest.fetch_pdf_text(s.uploads_bucket, req.s3_key)
    if not text.strip():
        raise HTTPException(status_code=400, detail="empty PDF text")
    extracted = ingest.extract_with_claude(text)
    merge_result = ingest.merge_into_neptune(extracted)
    return IngestPdfResponse(extracted=extracted, merge_result=merge_result)
