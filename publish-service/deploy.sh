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

deployed_env_is_secret_ref() {
  local name="$1"

  if [ -z "$CURRENT_SERVICE_JSON" ]; then
    CURRENT_SERVICE_JSON="$(gcloud run services describe "$SERVICE_NAME" --region="$REGION" --format=json 2>/dev/null || true)"
  fi

  SERVICE_JSON="$CURRENT_SERVICE_JSON" node -e '
    const name = process.argv[1];
    const service = JSON.parse(process.env.SERVICE_JSON || "{}");
    const env = service?.spec?.template?.spec?.containers?.[0]?.env || [];
    const entry = env.find((item) => item.name === name);
    process.exit(entry && entry.valueFrom ? 0 : 1);
  ' "$name"
}

gcloud config set project "$PROJECT_ID" >/dev/null 2>&1
echo -e "${GREEN}[✓]${NC} Project: $PROJECT_ID"

# Publishing authorization fails closed, so an empty ADMIN_EMAILS would deploy a
# service that rejects every publish — including the owner's. Fail here instead.
if [ -z "$(get_env_var ADMIN_EMAILS)" ]; then
  echo -e "${RED}ADMIN_EMAILS is not set. Publishing would be rejected for every account.${NC}" >&2
  echo -e "${RED}Set it in .env.local (comma-separated) or export it, then re-run.${NC}" >&2
  exit 1
fi

# CRON_SECRET is bound to a Secret Manager reference in production. Setting it as a
# string literal fails the deploy outright, and an empty literal would silently break
# scheduled publishing — so leave an existing binding untouched.
CRON_SECRET_ARGS=()
if deployed_env_is_secret_ref CRON_SECRET; then
  echo -e "${GREEN}[✓]${NC} CRON_SECRET: keeping existing Secret Manager binding"
else
  CRON_SECRET_VALUE="$(get_env_var CRON_SECRET)"
  if [ -n "$CRON_SECRET_VALUE" ]; then
    CRON_SECRET_ARGS=(--set-env-vars="CRON_SECRET=$CRON_SECRET_VALUE")
  else
    echo -e "${YELLOW}[!] CRON_SECRET is unset — scheduled publishing will reject requests${NC}" >&2
  fi
fi

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
  --set-env-vars="FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID:-$PROJECT_ID}" \
  ${CRON_SECRET_ARGS[@]+"${CRON_SECRET_ARGS[@]}"} \
  --set-env-vars="R2_ACCOUNT_ID=$(get_env_var R2_ACCOUNT_ID)" \
  --set-env-vars="R2_ACCESS_KEY_ID=$(get_env_var R2_ACCESS_KEY_ID)" \
  --set-env-vars="R2_SECRET_ACCESS_KEY=$(get_env_var R2_SECRET_ACCESS_KEY)" \
  --set-env-vars="R2_BUCKET_NAME=$(get_env_var R2_BUCKET_NAME)" \
  --set-env-vars="R2_PUBLIC_URL=$(get_env_var R2_PUBLIC_URL)" \
  --set-env-vars="YOUTUBE_CLIENT_ID=$(get_env_var YOUTUBE_CLIENT_ID)" \
  --set-env-vars="YOUTUBE_CLIENT_SECRET=$(get_env_var YOUTUBE_CLIENT_SECRET)" \
  --set-env-vars="TIKTOK_CLIENT_KEY=$(get_env_var TIKTOK_CLIENT_KEY)" \
  --set-env-vars="TIKTOK_CLIENT_SECRET=$(get_env_var TIKTOK_CLIENT_SECRET)" \
  --set-env-vars="INSTAGRAM_PUBLISHING_ENABLED=$(get_env_var INSTAGRAM_PUBLISHING_ENABLED)" \
  --set-env-vars="^##^ADMIN_EMAILS=$(get_env_var ADMIN_EMAILS)" \
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
