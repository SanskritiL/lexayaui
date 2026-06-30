#!/usr/bin/env bash
set -euo pipefail

# Creates the two MVP scheduler jobs. Usage:
#   CRON_SECRET=... ./setup-scheduler.sh
# Optional: PROJECT_ID, REGION, SERVICE_NAME, SCHEDULE_TIMEZONE

PROJECT_ID="${PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-turtle-487402}}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-publish-service}"
SCHEDULE_TIMEZONE="${SCHEDULE_TIMEZONE:-America/Chicago}"

if [ -z "${CRON_SECRET:-}" ]; then
  echo "CRON_SECRET is required" >&2
  exit 1
fi

gcloud config set project "$PROJECT_ID" >/dev/null
gcloud services enable cloudscheduler.googleapis.com --quiet

SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" \
  --region="$REGION" --format='value(status.url)')"
TARGET_URL="${SERVICE_URL}/scheduler/process"

upsert_job() {
  local name="$1"
  local schedule="$2"

  if gcloud scheduler jobs describe "$name" --location="$REGION" >/dev/null 2>&1; then
    gcloud scheduler jobs update http "$name" \
      --location="$REGION" \
      --schedule="$schedule" \
      --time-zone="$SCHEDULE_TIMEZONE" \
      --uri="$TARGET_URL" \
      --http-method=POST \
      --headers="Authorization=Bearer ${CRON_SECRET},Content-Type=application/json" \
      --message-body='{"limit":25}' \
      --attempt-deadline=30m
  else
    gcloud scheduler jobs create http "$name" \
      --location="$REGION" \
      --schedule="$schedule" \
      --time-zone="$SCHEDULE_TIMEZONE" \
      --uri="$TARGET_URL" \
      --http-method=POST \
      --headers="Authorization=Bearer ${CRON_SECRET},Content-Type=application/json" \
      --message-body='{"limit":25}' \
      --attempt-deadline=30m
  fi
}

# Five minutes after the times stored by reserve_post_schedule().
upsert_job "publish-scheduled-am" "5 9 * * *"
upsert_job "publish-scheduled-pm" "5 17 * * *"

echo "Scheduler jobs target ${TARGET_URL} in ${SCHEDULE_TIMEZONE}"
