#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}}"
ENV_FILE="${1:-.env.local}"

if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "(unset)" ]; then
  echo "Set GOOGLE_CLOUD_PROJECT or run: gcloud config set project YOUR_PROJECT_ID" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Environment file not found: $ENV_FILE" >&2
  exit 1
fi

gcloud config set project "$PROJECT_ID" >/dev/null
gcloud services enable secretmanager.googleapis.com --quiet

SECRETS=(
  SUPABASE_URL
  SUPABASE_SERVICE_KEY
  STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET
  GOOGLE_API_KEY
  FACEBOOK_APP_ID
  FACEBOOK_APP_SECRET
  INSTAGRAM_APP_SECRET
  INSTAGRAM_APP_ID
  INSTAGRAM_WEBHOOK_VERIFY_TOKEN
  LINKEDIN_CLIENT_ID
  LINKEDIN_CLIENT_SECRET
  TIKTOK_CLIENT_KEY
  TIKTOK_CLIENT_SECRET
  TWITTER_CLIENT_ID
  TWITTER_CLIENT_SECRET
  YOUTUBE_CLIENT_ID
  YOUTUBE_CLIENT_SECRET
)

read_value() {
  local name="$1"
  node -e '
    const fs = require("fs");
    const name = process.argv[1];
    const file = process.argv[2];
    const line = fs.readFileSync(file, "utf8").split(/\r?\n/)
      .find((entry) => entry.match(new RegExp(`^(export\\s+)?${name}=`)));
    if (!line) process.exit(2);
    let value = line.slice(line.indexOf("=") + 1).trim();
    const first = value.charCodeAt(0);
    const last = value.charCodeAt(value.length - 1);
    if ((first === 34 && last === 34) || (first === 39 && last === 39)) {
      value = value.slice(1, -1);
    }
    value = value.replace(/\\n/g, "\n");
    process.stdout.write(value);
  ' "$name" "$ENV_FILE"
}

for name in "${SECRETS[@]}"; do
  if ! value=$(read_value "$name"); then
    echo "Skipping missing value: $name"
    continue
  fi

  if ! gcloud secrets describe "$name" --project="$PROJECT_ID" >/dev/null 2>&1; then
    gcloud secrets create "$name" --replication-policy=automatic --project="$PROJECT_ID" --quiet
  fi

  printf '%s' "$value" | gcloud secrets versions add "$name" \
    --data-file=- \
    --project="$PROJECT_ID" \
    --quiet
  echo "Updated $name"
done
