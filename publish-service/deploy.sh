#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-turtle-487402}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="publish-service"
IMAGE_NAME="gcr.io/$PROJECT_ID/$SERVICE_NAME"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

echo -e "${YELLOW}═══ Lexaya Publish Service — Cloud Run Deploy ═══${NC}"

if ! command -v gcloud &>/dev/null; then
  echo -e "${RED}Error: gcloud not found. Install Google Cloud SDK first.${NC}"
  exit 1
fi

gcloud config set project "$PROJECT_ID" >/dev/null 2>&1
echo -e "${GREEN}[✓]${NC} Project: $PROJECT_ID"

echo "Enabling required APIs..."
gcloud services enable run.googleapis.com artifactregistry.googleapis.com --quiet >/dev/null 2>&1 || true

echo -e "${YELLOW}[1/3] Building Docker image locally...${NC}"
docker build -t "$IMAGE_NAME" .

echo -e "${YELLOW}[2/3] Pushing to Container Registry...${NC}"
docker push "$IMAGE_NAME"

echo -e "${YELLOW}[3/3] Deploying to Cloud Run...${NC}"
gcloud run deploy "$SERVICE_NAME" \
  --image="$IMAGE_NAME" \
  --platform=managed \
  --region="$REGION" \
  --memory=2Gi \
  --timeout=900 \
  --concurrency=10 \
  --min-instances=0 \
  --max-instances=10 \
  --allow-unauthenticated \
  --set-env-vars="SUPABASE_URL=https://bcyhcsphmqizzvzmdqxc.supabase.co" \
  --set-env-vars="SUPABASE_SERVICE_KEY=$(grep SUPABASE_SERVICE_KEY ../.env.local | cut -d'=' -f2)" \
  --set-env-vars="R2_ACCESS_KEY_ID=$(grep R2_ACCESS_KEY_ID ../.env.local | cut -d'=' -f2)" \
  --set-env-vars="R2_SECRET_ACCESS_KEY=$(grep R2_SECRET_ACCESS_KEY ../.env.local | cut -d'=' -f2)" \
  --set-env-vars="R2_BUCKET_NAME=lexaya-videos" \
  --set-env-vars="R2_PUBLIC_URL=https://pub-d8491ccfbb3a45e2bb038d9ae60a1957.r2.dev" \
  --set-env-vars="YOUTUBE_CLIENT_ID=$(grep YOUTUBE_CLIENT_ID ../.env.local | cut -d'=' -f2)" \
  --set-env-vars="YOUTUBE_CLIENT_SECRET=$(grep YOUTUBE_CLIENT_SECRET ../.env.local | cut -d'=' -f2)" \
  --quiet

SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
  --region="$REGION" --format='value(status.url)' 2>/dev/null || echo "")

if [ -n "$SERVICE_URL" ]; then
  echo ""
  echo -e "${GREEN}══════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  Deployed! URL: ${YELLOW}$SERVICE_URL${NC}"
  echo ""
  echo -e "${YELLOW}Set this in the frontend:${NC}"
  echo "  echo 'window.API_BASE_URL = \"$SERVICE_URL\";' > ../js/api-base.js"
  echo ""
  echo -e "${YELLOW}Test:${NC}  curl $SERVICE_URL/health"
fi
