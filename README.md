# Lexaya

Lexaya is a vanilla HTML/CSS/JS site hosted on Vercel, with Vercel serverless API routes for checkout/auth utilities and a separate Cloud Run service for media publishing.

## Structure

```text
.
├── index.html                 # Public marketing page
├── login.html                 # Supabase magic-link login
├── members.html               # Authenticated account page
├── privacy.html, terms.html   # Legal pages
├── style.css, script.js       # Shared public-site styling and behavior
├── js/                        # Shared browser config, Supabase, and app layout helpers
├── api/                       # Vercel serverless functions
├── broadcast/                 # Broadcast product UI and SQL schemas
├── cs/                        # CS resource pages and downloads
├── blog/                      # Blog index and static posts
├── kit/                       # Public media kit page
├── publish-service/           # Express service deployed to Cloud Run
└── resources/                 # Static PDFs, images, and video assets
```

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Use `npm run vercel:dev` when you need Vercel API routes locally. Use `npm run dev` for a fast static preview at `http://localhost:3000`.

The browser config in `js/config.js` contains public Supabase and Stripe publishable keys. Keep private keys only in `.env.local`, Vercel environment variables, or Cloud Run environment variables.

## Deployment

### Site and Vercel API routes

```bash
npm run deploy:site
```

This runs `vercel --prod`. Required Vercel environment variables are listed in `.env.example`.

### Publish service

```bash
npm run deploy:service
```

This runs `publish-service/deploy.sh`, which deploys the Express service to Google Cloud Run. It reads values from `.env.local` or `.env` first, then falls back to the current Cloud Run service environment.

### Full deploy

```bash
npm run deploy
```

This deploys the Vercel site/API, then deploys the Cloud Run publish service.

## Runtime Notes

- `vercel.json` rewrites publish endpoints to the Cloud Run service.
- `broadcast/*.sql` files are database schema and migration references. Apply them deliberately in Supabase; they are not run automatically.
- `publish-service/env.yaml.example` is useful for manual Cloud Run configuration, but the default deployment path is `npm run deploy:service`.
- `node_modules`, `.vercel`, `.claude`, `.env*`, and OS files are local-only and ignored.
