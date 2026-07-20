# Configuration

Lexaya has two kinds of configuration.

## Public browser config

Stored in `js/config.js`. These values are visible in the browser.

| Key | Required | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | Yes | Supabase project URL. |
| `SUPABASE_ANON_KEY` | Yes | Supabase anon/public key. RLS must protect data. |
| `STRIPE_PUBLISHABLE_KEY` | No | Required only for checkout flows. |
| `APP_BASE_URL` | No | Public app URL. Defaults to `window.location.origin`. |
| `API_BASE_URL` | Yes for local/static | Empty string means same-origin `/api/**`. |
| `PUBLISH_BASE_URL` | Yes for publishing | Cloud Run publish-service URL unless you add a same-origin rewrite. |
| `ADMIN_EMAILS` | No | Emails allowed into `/admin`. |
| `PRODUCTS.*` | No | Stripe Price IDs for product flows. |

## Server env

Stored in `.env.local` locally and in Secret Manager/Cloud Run in production.

| Key | Required for | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | all server APIs | Same Supabase project URL. |
| `SUPABASE_SERVICE_KEY` | all server APIs | Service-role key. Never expose in browser. |
| `APP_BASE_URL` | Stripe fallback redirects | Public app URL. |
| `STRIPE_SECRET_KEY` | checkout | Secret key. |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhooks | Used with raw request body. |
| `CRON_SECRET` | scheduler | Shared bearer token for Cloud Scheduler. |
| `R2_*` | media uploads | Cloudflare R2 credentials and public base URL. |
| `INSTAGRAM_APP_ID` | Instagram OAuth/webhooks | App ID. |
| `INSTAGRAM_APP_SECRET` | Instagram OAuth/webhooks | App secret and webhook signature key. |
| `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` | Instagram webhooks | Meta webhook verification token. |
| `INSTAGRAM_REDIRECT_URI` | Instagram OAuth | Must match Meta app settings. |
| `INSTAGRAM_PUBLISHING_ENABLED` | Instagram publishing | Defaults off; requires content publish permission. |
| `META_GRAPH_VERSION` | Instagram API | Example: `v25.0`. |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | LinkedIn OAuth | Optional unless LinkedIn is enabled. |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | TikTok OAuth/publish | Optional unless TikTok is enabled. |
| `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET` | X/Twitter OAuth/publish | Optional unless X is enabled. |
| `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` | YouTube OAuth/publish | Optional unless YouTube is enabled. |
