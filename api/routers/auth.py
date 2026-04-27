"""Cognito OAuth callback (/api/auth/callback).

Lambda@Edge redirects unauthenticated browsers to the Cognito Hosted UI;
Cognito redirects back here with ?code=XXX. We exchange the code for tokens
and set them as cookies, then redirect to /.
"""
from __future__ import annotations

import os
from typing import Optional

import requests
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse

router = APIRouter(tags=["auth"])

PROJECT = os.environ.get("ONTOLOGY_PROJECT", "ontology-retail")
ENV_NAME = os.environ.get("ONTOLOGY_ENV", "dev")
ACCOUNT = os.environ.get("AWS_ACCOUNT_ID", "061525506239")
REGION = os.environ.get("AWS_REGION", "ap-northeast-2")
CLIENT_ID = os.environ.get("COGNITO_USER_POOL_CLIENT_ID", "1tnhln5rbcpq4t2c7el9lvords")
COGNITO_DOMAIN = f"{PROJECT}-{ENV_NAME}-{ACCOUNT}.auth.{REGION}.amazoncognito.com"


@router.get("/auth/callback")
def auth_callback(request: Request, code: Optional[str] = None) -> RedirectResponse:
    if not code:
        raise HTTPException(status_code=400, detail="missing code parameter")
    host = request.headers.get("host", "")
    if not host:
        raise HTTPException(status_code=400, detail="missing Host header")
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
