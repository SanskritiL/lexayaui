# Lexaya

Lexaya is an open-source social publishing and Instagram comment automation app.

It uses a static browser UI, Supabase for auth/data, Firebase Hosting for the web app, and Cloud Run services for trusted server work.

## What it does

- Supabase magic-link authentication.
- Connect social accounts with OAuth.
- Create and schedule cross-platform posts.
- Upload reusable media through Cloudflare R2.
- Run Instagram comment automations:
  - select one specific post/reel;
  - define keyword triggers;
  - send a private reply/DM;
  - add a public “check your DMs” style reply.
- Track publish results and recent activity.

Instagram publishing is disabled by default so Meta permissions remain least-privilege for the automation use case. See [Meta app review](docs/META_APP_REVIEW.md).

## Tech stack

| Layer | Technology |
| --- | --- |
| Browser app | Static HTML/CSS/JS |
| Hosting | Firebase Hosting |
| Auth/database | Supabase |
| Web API | Express on Google Cloud Run |
| Publish worker | Express on Google Cloud Run |
| Media storage | Cloudflare R2 |
| Payments | Stripe |
| Social APIs | Instagram, LinkedIn, TikTok, YouTube, X/Twitter |

## Repository structure

```text
.
├── api/                # Shared request handlers mounted by web-service
├── broadcast/          # Broadcast UI and SQL schema/migration files
├── docs/               # Setup, config, deployment, architecture docs
├── js/                 # Browser config and shared frontend helpers
├── publish-service/    # Cloud Run service for uploads/publishing/scheduler
├── scripts/            # Build/check/secret-sync scripts
├── web-service/        # Cloud Run web API wrapper
└── *.html              # Static public pages
```

## Quick start

```bash
git clone <your-fork-url>
cd lexayaui
npm run install:all
cp .env.example .env.local
cp .firebaserc.example .firebaserc
```

Then:

1. Fill `.env.local` with server-side values.
2. Fill `js/config.js` with public browser values.
3. Apply the Supabase SQL files you need from `broadcast/`.
4. Run the services:

```bash
npm run dev
npm run api:dev
npm run publish:dev
```

Open `http://localhost:3000`.

Full setup instructions: [docs/SETUP.md](docs/SETUP.md).

## Configuration

- Public browser config lives in [js/config.js](js/config.js).
- Server/private config lives in `.env.local` locally and Secret Manager/Cloud Run in production.
- Example env values are in [.env.example](.env.example).

More detail: [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Deployment

- Firebase Hosting: `npm run deploy:site`
- Web API Cloud Run service: `npm run deploy:web-api`
- Publish Cloud Run service: `npm run deploy:service`
- Everything: `npm run deploy`

Deployment guide: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Development checks

```bash
npm run check
```

This runs JavaScript syntax checks and builds the Firebase Hosting allowlist into `.firebase-public`.

## Security before making a fork public

Real `.env` files are intentionally ignored, but private development can still leak credentials through screenshots, terminal logs, or old git history.

Before making a repo public, follow [docs/OPEN_SOURCE_CHECKLIST.md](docs/OPEN_SOURCE_CHECKLIST.md). At minimum, rotate every credential that ever appeared outside a secret manager.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Local setup](docs/SETUP.md)
- [Configuration](docs/CONFIGURATION.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Meta app review](docs/META_APP_REVIEW.md)
- [Open-source checklist](docs/OPEN_SOURCE_CHECKLIST.md)
- [Posting architecture](broadcast/POSTING-ARCHITECTURE.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

See [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
