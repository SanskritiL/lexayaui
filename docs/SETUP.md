# Local setup

## Prerequisites

- Node.js 20+
- npm
- Supabase project
- Firebase CLI, if deploying Hosting
- Google Cloud CLI, if deploying Cloud Run
- Cloudflare R2 bucket, if using media uploads/publishing
- Social developer apps for the platforms you enable

## Clone and install

```bash
git clone <your-fork-url>
cd lexayaui
npm run install:all
```

## Configure environment

```bash
cp .env.example .env.local
cp .firebaserc.example .firebaserc
```

Fill `.env.local` with server-side secrets.

Then edit `js/config.js` with public browser values:

- Supabase project URL
- Supabase anon key
- Stripe publishable key, if using checkout
- `API_BASE_URL`
- `PUBLISH_BASE_URL`
- product price IDs, if using paid products
- `ADMIN_EMAILS`, if using `/admin`

For local static preview:

```js
API_BASE_URL: 'http://localhost:8080'
PUBLISH_BASE_URL: 'http://localhost:8081'
```

For Firebase Hosting with `/api/**` rewrites:

```js
API_BASE_URL: ''
PUBLISH_BASE_URL: 'https://YOUR_PUBLISH_SERVICE_URL'
```

## Database

Apply the SQL files in `broadcast/` deliberately in Supabase. A typical new setup starts with:

1. `broadcast/database.sql`
2. `broadcast/multi-account-migration.sql`
3. `broadcast/post-scheduling-schema.sql`
4. `broadcast/media-kit-schema.sql`
5. `broadcast/automation-schema.sql`
6. `broadcast/automation-hardening-migration.sql`

Review each file before running it. These migrations are not automatically applied.

## Run locally

Open three terminals:

```bash
npm run dev
```

```bash
npm run api:dev
```

```bash
npm run publish:dev
```

Then open `http://localhost:3000`.

## Checks

```bash
npm run check
```
