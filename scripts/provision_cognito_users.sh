#!/usr/bin/env bash
# Provision Cognito demo users + groups (spec § 6.1).
# Idempotent — `admin-create-user` returns 409 if user exists; we handle.
#
# Usage:  bash scripts/provision_cognito_users.sh [TEMP_PASSWORD]

set -euo pipefail

PROJECT="${PROJECT:-ontology-retail}"
ENV_NAME="${ENV_NAME:-dev}"
REGION="${REGION:-ap-northeast-2}"

# Temporary password from env or stdin — never hardcoded, never echoed.
# Operator must rotate after first sign-in regardless.
if [[ -n "${COGNITO_TEMP_PASSWORD:-}" ]]; then
  TEMP_PW="$COGNITO_TEMP_PASSWORD"
elif [[ ! -t 0 ]]; then
  read -r TEMP_PW
else
  read -rsp "Temporary password (will not echo, min 10 chars + mix): " TEMP_PW
  echo
fi
if [[ ${#TEMP_PW} -lt 10 ]]; then
  echo "FATAL: temporary password must be ≥10 chars" >&2
  exit 1
fi

USER_POOL_ID="$(aws cloudformation describe-stacks \
  --stack-name OntologyRetailEdge --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)"

if [[ -z "$USER_POOL_ID" || "$USER_POOL_ID" == "None" ]]; then
  echo "FATAL: UserPoolId not in OntologyRetailEdge outputs" >&2
  exit 1
fi
echo "User pool: $USER_POOL_ID"

# 6 demo users — 4 shoppers (matching wow personas), 1 MD, 1 admin.
# Real customer-facing demos should provision actual customer emails.
declare -a USERS=(
  "shopper-pregnant@demo.local|shopper|임산부 6개월"
  "shopper-mom@demo.local|shopper|워킹맘 자녀 글루텐알레르기"
  "shopper-sensitive@demo.local|shopper|민감성 24세"
  "shopper-fitness@demo.local|shopper|헬스챌린저 35세"
  "md-lotte@demo.local|md|롯데마트 MD"
  "admin@demo.local|admin|데모 운영"
)

for entry in "${USERS[@]}"; do
  IFS='|' read -r email group label <<< "$entry"
  echo "→ $email ($group, $label)"
  if aws cognito-idp admin-get-user --user-pool-id "$USER_POOL_ID" --username "$email" --region "$REGION" >/dev/null 2>&1; then
    echo "  • exists — skipping create"
  else
    aws cognito-idp admin-create-user \
      --user-pool-id "$USER_POOL_ID" \
      --username "$email" \
      --user-attributes Name=email,Value="$email" Name=email_verified,Value=true Name=name,Value="$label" \
      --temporary-password "$TEMP_PW" \
      --message-action SUPPRESS \
      --region "$REGION" >/dev/null
    echo "  ✓ created with temporary password (force change on first login)"
  fi
  aws cognito-idp admin-add-user-to-group \
    --user-pool-id "$USER_POOL_ID" --username "$email" --group-name "$group" \
    --region "$REGION" >/dev/null 2>&1 || true
done

echo
# Never echo the password. Operator already entered it; recall via the
# secure entry method or rotate via cognito-idp admin-set-user-password.
echo "Hosted UI: https://${PROJECT}-${ENV_NAME}-061525506239.auth.${REGION}.amazoncognito.com/oauth2/authorize"
echo
echo "To enforce auth on the API after users sign in once:"
echo "  aws ecs update-service --cluster ${PROJECT}-${ENV_NAME}-cluster \\"
echo "    --service ${PROJECT}-${ENV_NAME}-api --force-new-deployment --region ${REGION}"
echo "  (with DEMO_PUBLIC_MODE=false in compute-stack and re-deployed)"
