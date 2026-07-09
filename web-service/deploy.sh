#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="lexaya-web-api"
REPOSITORY="lexaya"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${SERVICE_NAME}:$(date +%Y%m%d-%H%M%S)"

if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "(unset)" ]; then
  echo "Set GOOGLE_CLOUD_PROJECT or run: gcloud config set project YOUR_PROJECT_ID" >&2
  exit 1
fi

gcloud config set project "$PROJECT_ID" >/dev/null
gcloud services enable \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com \
  --quiet

if ! gcloud artifacts repositories describe "$REPOSITORY" --location="$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$REPOSITORY" \
    --repository-format=docker \
    --location="$REGION" \
    --quiet
fi

gcloud builds submit . \
  --config web-service/cloudbuild.yaml \
  --substitutions "_IMAGE=$IMAGE" \
  --project "$PROJECT_ID" \
  --quiet

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

SECRET_FLAGS=()
for name in "${SECRETS[@]}"; do
  if gcloud secrets describe "$name" --project="$PROJECT_ID" >/dev/null 2>&1; then
    SECRET_FLAGS+=("${name}=${name}:latest")
  else
    echo "Missing Secret Manager secret: $name" >&2
    exit 1
  fi
done

SECRET_ARG=$(IFS=,; echo "${SECRET_FLAGS[*]}")

gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE" \
  --region "$REGION" \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --concurrency 40 \
  --min-instances 0 \
  --max-instances 10 \
  --timeout 300 \
  --set-env-vars "NODE_ENV=production,META_GRAPH_VERSION=v25.0,FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID:-$PROJECT_ID}" \
  --set-secrets "$SECRET_ARG" \
  --quiet

gcloud run services describe "$SERVICE_NAME" \
  --region "$REGION" \
  --format='value(status.url)'
