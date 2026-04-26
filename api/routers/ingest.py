"""Scenario C wow — POST /api/ingest/pdf (PDF→Claude→Neptune)."""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from api.config import get_settings
from api.services import ingest

router = APIRouter(tags=["ingest"])


class IngestPdfRequest(BaseModel):
    s3_key: str = Field(min_length=1, max_length=512,
                        description="Key of the PDF object in UploadsBucket")


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
