#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="publish-service"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
CURRENT_SERVICE_JSON=""

echo -e "${YELLOW}═══ Lexaya Publish Service — Cloud Run Deploy ═══${NC}"

if ! command -v gcloud &>/dev/null; then
  echo -e "${RED}Error: gcloud not found. Install Google Cloud SDK first.${NC}"
  exit 1
fi

if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "(unset)" ]; then
  echo -e "${RED}Set GOOGLE_CLOUD_PROJECT or run: gcloud config set project YOUR_PROJECT_ID${NC}" >&2
  exit 1
fi

get_env_var() {
  local name="$1"
  local value=""
  local file

  # Preserve the production service configuration by default. Local env files
  # can lag behind OAuth credentials managed in Vercel and must not silently
  # overwrite working Cloud Run secrets on every source deploy.
  value="$(get_deployed_env_var "$name")"

  if [ -z "$value" ] || [ "${PREFER_LOCAL_ENV:-false}" = "true" ]; then
    for file in ../.env.local ../.env; do
      if [ -f "$file" ]; then
        value="$(grep -E "^(export[[:space:]]+)?${name}=" "$file" 2>/dev/null | tail -n1 | cut -d'=' -f2- || true)"
        if [ -n "$value" ]; then
          break
        fi
      fi
    done
  fi

  value="${value%$'\r'}"
  value="${value#\"}"
  value="${value%\"}"
  value="${value#\'}"
  value="${value%\'}"

  if [ -z "$value" ]; then
    echo -e "${YELLOW}[!] ${name} is empty in local env and current Cloud Run env${NC}" >&2
  fi

  printf '%s' "$value"
}

get_deployed_env_var() {
  local name="$1"

  if [ -z "$CURRENT_SERVICE_JSON" ]; then
    CURRENT_SERVICE_JSON="$(gcloud run services describe "$SERVICE_NAME" --region="$REGION" --format=json 2>/dev/null || true)"
  fi

  SERVICE_JSON="$CURRENT_SERVICE_JSON" node -e '
    const name = process.argv[1];
    const service = JSON.parse(process.env.SERVICE_JSON || "{}");
    const env = service?.spec?.template?.spec?.containers?.[0]?.env || [];
    const value = (env.find((entry) => entry.name === name) || {}).value || "";
    process.stdout.write(value);
  ' "$name"
}

gcloud config set project "$PROJECT_ID" >/dev/null 2>&1
echo -e "${GREEN}[✓]${NC} Project: $PROJECT_ID"

echo "Enabling required APIs..."
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com --quiet >/dev/null 2>&1 || true

echo -e "${YELLOW}[1/1] Building & deploying to Cloud Run (using Cloud Build)...${NC}"
gcloud run deploy "$SERVICE_NAME" \
  --source=. \
  --region="$REGION" \
  --memory=2Gi \
  --timeout=900 \
  --concurrency=10 \
  --min-instances=0 \
  --max-instances=10 \
  --allow-unauthenticated \
  --set-env-vars="SUPABASE_URL=$(get_env_var SUPABASE_URL)" \
  --set-env-vars="SUPABASE_SERVICE_KEY=$(get_env_var SUPABASE_SERVICE_KEY)" \
  --set-env-vars="CRON_SECRET=$(get_env_var CRON_SECRET)" \
  --set-env-vars="R2_ACCOUNT_ID=$(get_env_var R2_ACCOUNT_ID)" \
  --set-env-vars="R2_ACCESS_KEY_ID=$(get_env_var R2_ACCESS_KEY_ID)" \
  --set-env-vars="R2_SECRET_ACCESS_KEY=$(get_env_var R2_SECRET_ACCESS_KEY)" \
  --set-env-vars="R2_BUCKET_NAME=$(get_env_var R2_BUCKET_NAME)" \
  --set-env-vars="R2_PUBLIC_URL=$(get_env_var R2_PUBLIC_URL)" \
  --set-env-vars="YOUTUBE_CLIENT_ID=$(get_env_var YOUTUBE_CLIENT_ID)" \
  --set-env-vars="YOUTUBE_CLIENT_SECRET=$(get_env_var YOUTUBE_CLIENT_SECRET)" \
  --set-env-vars="TIKTOK_CLIENT_KEY=$(get_env_var TIKTOK_CLIENT_KEY)" \
  --set-env-vars="TIKTOK_CLIENT_SECRET=$(get_env_var TIKTOK_CLIENT_SECRET)" \
  --quiet

SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
  --region="$REGION" --format='value(status.url)' 2>/dev/null || echo "")

if [ -n "$SERVICE_URL" ]; then
  echo ""
  echo -e "${GREEN}══════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  Deployed! URL: ${YELLOW}$SERVICE_URL${NC}"
  echo ""
  echo -e "${YELLOW}Test:${NC}  curl $SERVICE_URL/health"
fi
