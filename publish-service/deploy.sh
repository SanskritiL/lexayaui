#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-turtle-487402}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="publish-service"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

echo -e "${YELLOW}═══ Lexaya Publish Service — Cloud Run Deploy ═══${NC}"

if ! command -v gcloud &>/dev/null; then
  echo -e "${RED}Error: gcloud not found. Install Google Cloud SDK first.${NC}"
  exit 1
fi

get_env_var() {
  local name="$1"
  local value
  value="$(grep -E "^(export[[:space:]]+)?${name}=" ../.env.local | tail -n1 | cut -d'=' -f2-)"
  value="${value%$'\r'}"
  value="${value#\"}"
  value="${value%\"}"
  value="${value#\'}"
  value="${value%\'}"
  printf '%s' "$value"
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
  --set-env-vars="YOUTUBE_CLIENT_ID=$(get_env_var YOUTUBE_CLIENT_ID)" \
  --set-env-vars="YOUTUBE_CLIENT_SECRET=$(get_env_var YOUTUBE_CLIENT_SECRET)" \
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
