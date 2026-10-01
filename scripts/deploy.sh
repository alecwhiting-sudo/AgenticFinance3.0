#!/usr/bin/env bash
# Deploy a service to Railway: scripts/deploy.sh <web|api|worker>
# Requires `railway login` (or RAILWAY_TOKEN) and the project linked
# (`railway link`) at the repo root. Builds use apps/<name>/Dockerfile from
# the repo root, per apps/<name>/railway.json.
set -euo pipefail

if [[ $# -ne 1 ]] || [[ ! -d "$(dirname "$0")/../apps/$1" ]]; then
  echo "usage: $0 <web|api|worker>" >&2
  exit 1
fi

cd "$(dirname "$0")/.."
echo "Deploying $1 ..."
railway up --service "$1" --path-as-root . --config "apps/$1/railway.json" 2>/dev/null \
  || railway up --service "$1"
