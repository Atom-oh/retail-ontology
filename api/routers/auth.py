"""Cognito OAuth callback (/api/auth/callback).

Lambda@Edge redirects unauthenticated browsers to the Cognito Hosted UI;
Cognito redirects back here with ?code=XXX. We exchange the code for tokens
and set them as cookies, then redirect to /.

All Cognito identifiers come from required env vars wired by the ECS task
definition (`infra-cdk/lib/compute-stack.ts`). No hardcoded fallbacks —
falling back to a literal default would silently exchange auth codes against
the wrong identity provider if the User Pool were ever recreated.
"""
from __future__ import annotations

import os
from typing import Optional

import requests
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse

router = APIRouter(tags=["auth"])


def _required_env(key: str) -> str:
    val = os.environ.get(key)
    if not val:
        raise RuntimeError(
            f"required env var missing: {key}. "
            f"Compute stack must inject all Cognito identifiers; falling back "
            f"to a hardcoded default would silently exchange auth codes against "
            f"the wrong identity provider."
        )
    return val


PROJECT = _required_env("ONTOLOGY_PROJECT")
ENV_NAME = _required_env("ONTOLOGY_ENV")
ACCOUNT = _required_env("AWS_ACCOUNT_ID")
REGION = _required_env("AWS_REGION")
CLIENT_ID = _required_env("COGNITO_USER_POOL_CLIENT_ID")
COGNITO_DOMAIN = f"{PROJECT}-{ENV_NAME}-{ACCOUNT}.auth.{REGION}.amazoncognito.com"

# Host header allowlist for the OAuth callback. The redirect_uri sent to
# Cognito's token endpoint is constructed from the request Host header — an
# attacker-controlled Host (DNS spoof, CloudFront alternate-alias misconfig,
# direct-to-ALB request bypassing the SG) would otherwise let them craft
# `redirect_uri=https://evil.example/...` and intercept the auth code.
#
# Cognito's token endpoint also rejects redirect_uri mismatches against the
# Hosted UI's callback allowlist, but this in-app check is the defense-in-depth
# layer. Multiple comma-separated hosts are supported (e.g. apex + www).
PUBLIC_DOMAIN = _required_env("PUBLIC_DOMAIN")
_ALLOWED_HOSTS = {h.strip().lower() for h in PUBLIC_DOMAIN.split(",") if h.strip()}


def _validate_host(host: str) -> str:
    """Return the host if it matches the allowlist; raise 400 otherwise."""
    if not host:
        raise HTTPException(status_code=400, detail="missing Host header")
    # Strip optional :port (the OAuth callback runs over HTTPS so port is
    # implied 443; explicit port in Host is uncommon but legal).
    bare = host.split(":")[0].lower()
    if bare not in _ALLOWED_HOSTS:
        raise HTTPException(
            status_code=400,
            detail=f"Host {bare!r} not in allowlist (PUBLIC_DOMAIN={PUBLIC_DOMAIN!r})",
        )
    return bare


@router.get("/auth/callback")
def auth_callback(request: Request, code: Optional[str] = None) -> RedirectResponse:
    if not code:
        raise HTTPException(status_code=400, detail="missing code parameter")
    host = _validate_host(request.headers.get("host", ""))
    redirect_uri = f"https://{host}/api/auth/callback"
    resp = requests.post(
        f"https://{COGNITO_DOMAIN}/oauth2/token",
        data={
            "grant_type": "authorization_code",
            "client_id": CLIENT_ID,
            "code": code,
            "redirect_uri": redirect_uri,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=10,
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"token exchange failed: {resp.text[:200]}")
    tokens = resp.json()
    redir = RedirectResponse(url="/", status_code=302)
    # Set tokens as HttpOnly Secure cookies. Lambda@Edge reads id_token /
    # access_token cookies for structural validation. Production should
    # also set SameSite=Strict; demo uses Lax to allow OAuth redirect flow.
    cookie_kwargs = {"httponly": True, "secure": True, "samesite": "lax", "max_age": 3600}
    if "id_token" in tokens:
        redir.set_cookie("id_token", tokens["id_token"], **cookie_kwargs)
    if "access_token" in tokens:
        redir.set_cookie("access_token", tokens["access_token"], **cookie_kwargs)
    if "refresh_token" in tokens:
        redir.set_cookie("refresh_token", tokens["refresh_token"], httponly=True, secure=True,
                          samesite="lax", max_age=7 * 24 * 3600)
    return redir
