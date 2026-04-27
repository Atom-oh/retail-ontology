"""
Cognito JWT validation middleware.

Modes:
  - PUBLIC (DEMO_PUBLIC_MODE=true, default for now): pass through, no auth.
    Acknowledged as demo posture in spec § 6.1; production must flip.
  - ENFORCED (DEMO_PUBLIC_MODE=false): validate Authorization: Bearer <jwt>
    against Cognito JWKS. Reject if missing/expired/wrong issuer.

Health endpoints (/healthz, /api/health-web) bypass regardless of mode.

The CloudFront → ALB layer ALSO requires an X-Origin-Auth-Token header
(set as CF custom origin header). This is a separate defense-in-depth check
that ensures even unauthenticated requests must originate from CF — not
from anyone with the ALB DNS who manages to reach it. ALB SG already
restricts to the CF managed prefix list, but plaintext-over-public-internet
between CF and ALB (spec § 5.3 demo trade-off) makes this header valuable.
"""
from __future__ import annotations

import json
import logging
import os
import time
from functools import lru_cache
from typing import Optional

import requests
from fastapi import HTTPException, Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

logger = logging.getLogger("ontology.auth")

PUBLIC_PATHS = {"/healthz", "/api/health-web"}


def _is_public(path: str) -> bool:
    if path in PUBLIC_PATHS:
        return True
    return path.startswith("/api/health-web") or path == "/healthz"


@lru_cache(maxsize=1)
def _jwks(region: str, user_pool_id: str) -> dict:
    url = f"https://cognito-idp.{region}.amazonaws.com/{user_pool_id}/.well-known/jwks.json"
    return requests.get(url, timeout=10).json()


def _verify_jwt(token: str, region: str, user_pool_id: str, client_id: str) -> dict:
    """Minimal JWT verification — Phase 5 hardening should swap for python-jose
    or PyJWT with full RS256 signature check. For demo we validate iss/aud/exp
    structurally and trust the token if structure checks pass + JWKS kid match."""
    try:
        from base64 import urlsafe_b64decode
        header_b64, payload_b64, _sig_b64 = token.split(".")
        pad = "=" * (-len(payload_b64) % 4)
        payload = json.loads(urlsafe_b64decode(payload_b64 + pad))
        hdr = json.loads(urlsafe_b64decode(header_b64 + "=" * (-len(header_b64) % 4)))
    except Exception:
        raise HTTPException(status_code=401, detail="malformed token")

    expected_iss = f"https://cognito-idp.{region}.amazonaws.com/{user_pool_id}"
    if payload.get("iss") != expected_iss:
        raise HTTPException(status_code=401, detail="bad issuer")
    if payload.get("aud") and payload["aud"] != client_id:
        raise HTTPException(status_code=401, detail="bad audience")
    if payload.get("client_id") and payload["client_id"] != client_id:
        raise HTTPException(status_code=401, detail="bad client_id")
    if payload.get("exp", 0) < time.time():
        raise HTTPException(status_code=401, detail="token expired")

    jwks = _jwks(region, user_pool_id)
    kid = hdr.get("kid")
    if not any(k.get("kid") == kid for k in jwks.get("keys", [])):
        raise HTTPException(status_code=401, detail="unknown key id")
    # TODO Phase 5: verify RS256 signature with the matched JWK using
    # cryptography.hazmat. Current check is structural + kid presence,
    # NOT cryptographic — sufficient for demo when ENFORCE_AUTH=false default.
    return payload


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if _is_public(path):
            return await call_next(request)

        # Defense-in-depth: CloudFront → ALB origin custom header.
        # Phase 4 hardening: emit + validate. Currently optional via env flag
        # so the demo URL still works without the CF redeploy that adds it.
        require_origin = os.environ.get("REQUIRE_ORIGIN_AUTH", "false").lower() == "true"
        if require_origin:
            expected = os.environ.get("ORIGIN_AUTH_SECRET", "")
            received = request.headers.get("x-origin-auth-token", "")
            if not expected or received != expected:
                logger.warning("origin auth missing/mismatch path=%s", path)
                return Response(status_code=403, content="origin not allowed")

        # Cognito JWT — bypass when DEMO_PUBLIC_MODE=true (default).
        if os.environ.get("DEMO_PUBLIC_MODE", "true").lower() == "true":
            return await call_next(request)

        token = _extract_bearer(request)
        if not token:
            raise HTTPException(status_code=401, detail="missing Authorization Bearer")
        region = os.environ["AWS_REGION"]
        user_pool_id = os.environ.get("COGNITO_USER_POOL_ID", "")
        client_id = os.environ.get("COGNITO_USER_POOL_CLIENT_ID", "")
        if not user_pool_id or not client_id:
            raise HTTPException(status_code=500, detail="cognito env missing")
        claims = _verify_jwt(token, region, user_pool_id, client_id)
        request.state.user = {
            "sub": claims.get("sub"),
            "email": claims.get("email"),
            "groups": claims.get("cognito:groups", []),
        }
        return await call_next(request)


def _extract_bearer(request: Request) -> Optional[str]:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:]
    return None
