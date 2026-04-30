#!/bin/bash
# scripts/setup.sh — one-shot setup for new contributors.
# Idempotent — safe to re-run.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo ">>> ontology-retail setup"

# 1. Python venv + backend deps
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --quiet -r api/requirements.txt
echo "  api/ deps installed"

# 2. Web deps
if [ -d web ]; then
  (cd web && npm ci --prefer-offline --no-audit --no-fund) >/dev/null
  echo "  web/ deps installed"
fi

# 3. Infra deps
if [ -d infra-cdk ]; then
  (cd infra-cdk && npm ci --prefer-offline --no-audit --no-fund) >/dev/null
  echo "  infra-cdk/ deps installed"
fi

# 4. Local env file
if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  echo "  .env created from .env.example — fill in values before running"
fi

echo ">>> done. Next steps:"
echo "    - Fill in .env values (or pull from CDK outputs)"
echo "    - Read CLAUDE.md and docs/onboarding.md"
echo "    - Run /test-all to verify the project state"
