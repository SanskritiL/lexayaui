#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT_DIR"

echo "Checking JavaScript syntax..."
find api js publish-service/src web-service/src scripts \
  -type f -name '*.js' \
  -not -path '*/node_modules/*' \
  -print0 | xargs -0 -n1 node --check

echo "Checking service entrypoints..."
node --check web-service/src/index.js
node --check publish-service/src/index.js

echo "Building Firebase Hosting allowlist..."
npm run build:hosting

echo "Checks passed."
