#!/usr/bin/env bash
# Create Bedrock AgentCore Memory + write its ID to SSM Parameter Store.
# Pattern from whchoi98/awsops (proven working) — keeps Memory provisioning
# out of CDK because AwsCustomResource hits 5+ distinct gotchas (see memory
# entry agentcore_gotchas.md and commits c5768e7..d7907e5).
#
# Usage:
#   bash scripts/create_agentcore_memory.sh                    # dev defaults
#   PROJECT=ontology-retail ENV_NAME=dev REGION=ap-northeast-2 bash ...
#
# Prereqs: aws CLI v2 with valid credentials, jq.

set -euo pipefail

PROJECT="${PROJECT:-ontology-retail}"
ENV_NAME="${ENV_NAME:-dev}"
REGION="${REGION:-ap-northeast-2}"
# AgentCore Memory name regex: [a-zA-Z][a-zA-Z0-9_]{0,47} — no hyphens.
MEMORY_NAME="${MEMORY_NAME:-${PROJECT//-/_}_${ENV_NAME}_memory}"
SSM_KEY="/${PROJECT}-${ENV_NAME}/agentcore/memory-id"
EXPIRY_DAYS="${EXPIRY_DAYS:-7}"

echo "Project:       ${PROJECT}-${ENV_NAME}"
echo "Region:        ${REGION}"
echo "Memory name:   ${MEMORY_NAME}"
echo "SSM key:       ${SSM_KEY}"
echo "Expiry days:   ${EXPIRY_DAYS}"
echo

# Idempotent: reuse existing memory if name already taken.
EXISTING_ID="$(aws bedrock-agentcore-control list-memories \
  --region "$REGION" --max-results 100 \
  --query "memories[?name=='${MEMORY_NAME}'].id | [0]" \
  --output text 2>/dev/null || true)"

if [[ -n "$EXISTING_ID" && "$EXISTING_ID" != "None" ]]; then
  echo "→ Reusing existing memory: ${EXISTING_ID}"
  MEMORY_ID="$EXISTING_ID"
else
  echo "→ Creating new memory…"
  CREATE_RESULT="$(aws bedrock-agentcore-control create-memory \
    --name "$MEMORY_NAME" \
    --description "Ontology demo conversational memory (session + ${EXPIRY_DAYS}d long-term)" \
    --event-expiry-duration "$EXPIRY_DAYS" \
    --region "$REGION" \
    --output json)"
  MEMORY_ID="$(echo "$CREATE_RESULT" | jq -r '.memory.id // .id // empty')"
  if [[ -z "$MEMORY_ID" ]]; then
    echo "FATAL: could not extract memory id from response:" >&2
    echo "$CREATE_RESULT" >&2
    exit 1
  fi
  echo "  ✓ created: ${MEMORY_ID}"
fi

# Write to SSM (compute-stack reads from here)
aws ssm put-parameter \
  --name "$SSM_KEY" \
  --value "$MEMORY_ID" \
  --type String \
  --overwrite \
  --region "$REGION" >/dev/null
echo "→ SSM parameter ${SSM_KEY} = ${MEMORY_ID}"

echo
echo "Done. To trigger ECS service redeploy with new memory id:"
echo "  aws ecs update-service --cluster ${PROJECT}-${ENV_NAME}-cluster \\"
echo "    --service ${PROJECT}-${ENV_NAME}-api --force-new-deployment --region ${REGION}"
