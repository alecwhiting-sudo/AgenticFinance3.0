#!/usr/bin/env bash
# Deploy an agent to Railway: scripts/deploy.sh <agent-name>
# Assumes `railway login` has been done and the agent directory has been
# linked to its Railway service with `railway link`.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <agent-name>" >&2
  echo "agents:" >&2
  ls "$(dirname "$0")/../agents" >&2
  exit 1
fi

AGENT_DIR="$(cd "$(dirname "$0")/../agents/$1" && pwd)"

if [[ ! -f "$AGENT_DIR/railway.json" ]]; then
  echo "error: $AGENT_DIR has no railway.json" >&2
  exit 1
fi

cd "$AGENT_DIR"
echo "Deploying $1 from $AGENT_DIR ..."
railway up
