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

import hmac
import json
import logging
import os
from typing import Optional

import requests
from cachetools import TTLCache, cached
from fastapi import HTTPException, Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

logger = logging.getLogger("ontology.auth")

PUBLIC_PATHS = {"/healthz", "/api/health-web", "/api/auth/callback"}


def _is_public(path: str) -> bool:
    if path in PUBLIC_PATHS:
        return True
    return (path.startswith("/api/health-web") or path == "/healthz"
            or path.startswith("/api/auth/"))


# 1-hour TTL — Cognito rotates JWKS keys (rarely, but it happens). lru_cache
# would lock us in until process restart, rejecting freshly-signed valid
# tokens after rotation.
@cached(TTLCache(maxsize=4, ttl=3600))
def _jwks(region: str, user_pool_id: str) -> dict:
    url = f"https://cognito-idp.{region}.amazonaws.com/{user_pool_id}/.well-known/jwks.json"
    return requests.get(url, timeout=10).json()


def _verify_jwt(token: str, region: str, user_pool_id: str, client_id: str) -> dict:
    """Full RS256 verification via PyJWT + cryptography. Validates:
       - Signature against the matched JWK from Cognito's JWKS endpoint
       - iss claim equals the expected Cognito issuer URL
       - exp/nbf claims (auto-checked by PyJWT)
       - client_id (access tokens) or aud (id tokens) matches our app client
    """
    import jwt as pyjwt
    from jwt.algorithms import RSAAlgorithm
    try:
        unverified_header = pyjwt.get_unverified_header(token)
    except pyjwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"malformed token: {e}")

    kid = unverified_header.get("kid")
    if not kid:
        raise HTTPException(status_code=401, detail="missing kid header")
    jwks = _jwks(region, user_pool_id)
    matched = next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)
    if not matched:
        raise HTTPException(status_code=401, detail="unknown key id")
    public_key = RSAAlgorithm.from_jwk(json.dumps(matched))

    expected_iss = f"https://cognito-idp.{region}.amazonaws.com/{user_pool_id}"
    try:
        # Cognito access tokens use 'client_id' claim, id tokens use 'aud'.
        # Verify signature + iss/exp/nbf via PyJWT, check audience manually
        # because access tokens lack 'aud'.
        claims = pyjwt.decode(
            token, key=public_key, algorithms=["RS256"],
            issuer=expected_iss, options={"verify_aud": False},
        )
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="token expired")
    except pyjwt.InvalidSignatureError:
        raise HTTPException(status_code=401, detail="bad signature")
    except pyjwt.InvalidIssuerError:
        raise HTTPException(status_code=401, detail="bad issuer")
    except pyjwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"invalid token: {e}")

    aud_or_client = claims.get("client_id") or claims.get("aud")
    if isinstance(aud_or_client, list):
        if client_id not in aud_or_client:
            raise HTTPException(status_code=401, detail="bad client_id/aud")
    elif aud_or_client != client_id:
        raise HTTPException(status_code=401, detail="bad client_id/aud")
    return claims


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
            from api.aws_clients import origin_auth_secret
            expected = origin_auth_secret()
            received = request.headers.get("x-origin-auth-token", "")
            # Constant-time comparison — `==` would leak byte-by-byte timing
            # to an attacker who reaches the ALB directly (defense in depth
            # since SG already restricts to CF prefix list, but still).
            if not expected or not hmac.compare_digest(received, expected):
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
