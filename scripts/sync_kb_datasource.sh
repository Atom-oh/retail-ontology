#!/usr/bin/env bash
# Trigger Bedrock Knowledge Base ingestion job for the raw-docs S3 data source.
# Run after uploading reference docs (product catalogs, brand manuals, etc.) to:
#   s3://ontology-retail-dev-raw-docs-061525506239/
#
# Usage:
#   bash scripts/sync_kb_datasource.sh
#   PROJECT=ontology-retail ENV_NAME=dev REGION=ap-northeast-2 bash ...

set -euo pipefail

PROJECT="${PROJECT:-ontology-retail}"
ENV_NAME="${ENV_NAME:-dev}"
REGION="${REGION:-ap-northeast-2}"
AI_STACK="OntologyRetailAi"

# Resolve KB ID from CFN output
KB_ID="$(aws cloudformation describe-stacks \
  --stack-name "$AI_STACK" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='KnowledgeBaseId'].OutputValue" \
  --output text)"

if [[ -z "$KB_ID" || "$KB_ID" == "None" ]]; then
  echo "FATAL: could not resolve KB ID from $AI_STACK" >&2
  exit 1
fi

echo "Knowledge Base: $KB_ID"

# List data sources
DS_ID="$(aws bedrock-agent list-data-sources --knowledge-base-id "$KB_ID" \
  --region "$REGION" --query 'dataSourceSummaries[0].dataSourceId' --output text)"
echo "Data source:    $DS_ID"

# Start ingestion job (idempotent — Bedrock returns 200 even with no new files)
JOB="$(aws bedrock-agent start-ingestion-job \
  --knowledge-base-id "$KB_ID" --data-source-id "$DS_ID" \
  --description "scripts/sync_kb_datasource.sh $(date -u +%Y%m%dT%H%M%SZ)" \
  --region "$REGION" --output json)"

JOB_ID="$(echo "$JOB" | jq -r '.ingestionJob.ingestionJobId')"
echo "Ingestion job:  $JOB_ID"

# Poll until COMPLETE / FAILED (timeout 30 min)
echo -n "Polling status..."
for _ in $(seq 1 90); do
  STATE="$(aws bedrock-agent get-ingestion-job \
    --knowledge-base-id "$KB_ID" --data-source-id "$DS_ID" \
    --ingestion-job-id "$JOB_ID" --region "$REGION" \
    --query 'ingestionJob.status' --output text 2>/dev/null || echo UNKNOWN)"
  case "$STATE" in
    COMPLETE) echo " $STATE"; break ;;
    FAILED|STOPPED) echo " $STATE"; exit 1 ;;
    *) echo -n " $STATE"; sleep 20 ;;
  esac
done

aws bedrock-agent get-ingestion-job \
  --knowledge-base-id "$KB_ID" --data-source-id "$DS_ID" \
  --ingestion-job-id "$JOB_ID" --region "$REGION" \
  --query 'ingestionJob.statistics' --output json
