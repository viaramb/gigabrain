#!/usr/bin/env bash
# deploy.sh — Promote ~/gigabrain/ (production branch) to the active plugin
# Usage: ./deploy.sh
# This script is called automatically by the cron pipeline after a PR merges.

set -euo pipefail

PROD_SRC="$HOME/gigabrain"
PLUGIN_DST="$HOME/.openclaw/extensions/gigabrain"
CORE_FILES=(
  projection-store.js
  memory-actions.js
  native-memory.js
  native-promotion.js
  review-queue.js
  http-routes.js
  event-store.js
)

echo "[deploy] Pulling latest main into production folder..."
cd "$PROD_SRC"
git fetch origin
git checkout main
git pull origin main

echo "[deploy] Copying core files to plugin..."
for file in "${CORE_FILES[@]}"; do
  src="$PROD_SRC/lib/core/$file"
  dst="$PLUGIN_DST/lib/core/$file"
  if [ -f "$src" ]; then
    cp "$src" "$dst"
    echo "  copied: $file"
  else
    echo "  WARNING: $src not found, skipping"
  fi
done

echo "[deploy] Restarting OpenClaw gateway..."
openclaw gateway restart

echo "[deploy] Done. Plugin is live."
