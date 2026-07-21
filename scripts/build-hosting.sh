#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PUBLIC_DIR="$ROOT_DIR/.firebase-public"

rm -rf "$PUBLIC_DIR"
mkdir -p "$PUBLIC_DIR"

rsync -a \
  "$ROOT_DIR/index.html" \
  "$ROOT_DIR/fire.html" \
  "$ROOT_DIR/login.html" \
  "$ROOT_DIR/members.html" \
  "$ROOT_DIR/privacy.html" \
  "$ROOT_DIR/terms.html" \
  "$ROOT_DIR/style.css" \
  "$ROOT_DIR/script.js" \
  "$PUBLIC_DIR/"

for directory in admin blog broadcast cs js kit resources; do
  rsync -a \
    --exclude='*.sql' \
    --exclude='*.md' \
    "$ROOT_DIR/$directory/" \
    "$PUBLIC_DIR/$directory/"
done

echo "Prepared Firebase Hosting assets in $PUBLIC_DIR"
