# Deployment

## Firebase Hosting

1. Create a Firebase project.
2. Copy `.firebaserc.example` to `.firebaserc`.
3. Replace `your-firebase-project-id`.
4. Deploy:

   ```bash
   npm run deploy:site
   ```

`scripts/build-hosting.sh` publishes an allowlisted static directory (`.firebase-public`) so SQL, Markdown, local env files, and source-only files are not hosted.

## Cloud Run web API

The web API deploy script builds `web-service` and mounts handlers from `api/`.

```bash
GOOGLE_CLOUD_PROJECT=your-project-id npm run deploy:web-api
```

Before deploying, create required Secret Manager secrets:

```bash
./scripts/sync-gcp-secrets.sh .env.local
```

The script only syncs the server-side secret names listed in `scripts/sync-gcp-secrets.sh`.

## Cloud Run publish service

```bash
GOOGLE_CLOUD_PROJECT=your-project-id npm run deploy:service
```

The publish service reads existing Cloud Run env vars first, then local `.env.local`/`.env` values when a value is missing. Set `PREFER_LOCAL_ENV=true` only when intentionally overwriting deployed values from local files.

## Scheduler

After deploying `publish-service`, create scheduler jobs:

```bash
CRON_SECRET=your-long-random-secret \
GOOGLE_CLOUD_PROJECT=your-project-id \
./publish-service/setup-scheduler.sh
```

The scheduler calls `POST /scheduler/process` on the publish service.

## Custom domain

Firebase custom domains are configured in Firebase Hosting. If your host needs a `CNAME` file, copy `CNAME.example` to `CNAME` and replace the domain. `CNAME` is ignored by git.
