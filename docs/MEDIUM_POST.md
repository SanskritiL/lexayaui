# How I Built Lexaya: A Cross-Platform Social Publishing App with No Frontend Framework

*The architecture behind an open-source tool that posts to TikTok, LinkedIn, YouTube, X, and Instagram — and automates Instagram comment replies — built on static HTML, two small Cloud Run services, and a handful of managed products.*

---

Lexaya started as a simple idea: write a post once, attach a video, and publish it everywhere — TikTok, LinkedIn, YouTube Shorts, X, Instagram — from one screen. Along the way it grew a second superpower: Instagram comment automation, where a keyword comment on a chosen reel triggers an automatic DM and a public "check your DMs" reply.

This post is a tour of the architecture: what the pieces are, why they're shaped the way they are, and a few lessons that only showed up in production.

## The 30-second overview

Lexaya runs on three surfaces:

```
Browser (Firebase Hosting)
  Static HTML / CSS / vanilla JS — no framework, no build step
  Firebase Auth for sign-in, Supabase client for data

lexaya-web-api (Google Cloud Run)
  OAuth callbacks, Stripe checkout + webhooks, Instagram webhooks
  Trusted server work with the Supabase service role

publish-service (Google Cloud Run)
  Presigned media uploads, the publish engine, scheduled posting
  Talks to Supabase, Cloudflare R2, and every social platform API
```

And four managed products doing the heavy lifting:

- **Firebase** — hosting and authentication
- **Supabase** — Postgres, row-level security, and realtime
- **Cloudflare R2** — media storage that social platforms fetch from directly
- **Stripe** — payments

Everything the browser needs from a server goes through one of the two Cloud Run services. Firebase Hosting rewrites `/api/**` to the web API, so the frontend never has to know where the backend lives.

## Choice #1: A static frontend in 2026

The UI is plain HTML, CSS, and browser JavaScript. No React, no bundler, no build pipeline — `npm run dev` is literally a Python static file server.

This sounds like a constraint, but it's been a feature. Every page is independently loadable and debuggable. Deploys are file copies. There's no hydration, no framework upgrades, and the whole "build" step is a script that assembles an allowlist of files that are safe to publish. For an app that is mostly forms, lists, and status dashboards, a framework would earn its complexity budget nowhere.

Shared logic (config, the Supabase client, an API-URL helper, layout) lives in a small `js/` directory that pages pull in with script tags. That's the whole frontend architecture.

## Choice #2: Firebase for auth, Supabase for data

The app originally used Supabase magic-link auth end to end. It now uses **Firebase Authentication** (Google sign-in popup) for identity, while **Supabase stays as the data and realtime backend** through its third-party auth support.

The flow: Firebase issues the ID token, the Supabase client presents it, and Postgres row-level security policies key off the JWT's `sub` claim. Both Cloud Run services verify Firebase ID tokens on every request. Migrating meant a one-time SQL migration (user IDs became `TEXT`, RLS rewritten around the JWT subject) and a user import script — but no data moved anywhere.

The payoff is using each product for what it's best at: Firebase's polished sign-in flows and token infrastructure, Supabase's Postgres with RLS and realtime subscriptions.

## Choice #3: Media never touches my servers

This is the decision I'd defend hardest. Uploading a 500MB video *through* a server means that server's memory, timeout, and bandwidth are all in the critical path. So Lexaya's media path is:

1. The browser asks the publish service for a **presigned PUT URL** (authenticated with the user's token).
2. The browser uploads the file **directly to Cloudflare R2**.
3. The public R2 URL is stored on the post row.
4. When publishing, platforms that support it **pull the media from R2 themselves** — TikTok via `PULL_FROM_URL`, Instagram via its media-container flow with a `video_url`.

Cloud Run never buffers the video. R2 has no egress fees, which matters when five platforms each download the same file. And after a successful publish, the service deletes the object from R2 — media storage is a staging area, not an archive.

## The publish engine

A post row in Postgres carries the caption, the media URL, the target `platforms[]`, and a `platform_results` JSONB column. Publishing is one request: `{ postId, platforms }` with the user's bearer token.

The engine's contract is built around **partial failure being normal**:

- All platform adapters run in parallel with `Promise.allSettled`.
- After *each* platform finishes, its result merges into `platform_results` — progress persists even if the process dies mid-way.
- Retries send only the failed platforms; anything already `success` (or Instagram's `pending`) is skipped, so retries are idempotent.
- The post status transitions `publishing → published | partial | failed`, and the browser watches the row over Supabase Realtime while the modal is open.

Each platform gets an adapter that hides its quirks: LinkedIn's URN resolution and REST upload flows, X's chunked media upload with a text-only fallback, YouTube's resumable uploads with automatic `#Shorts` tagging, and Instagram's two-step container dance — create the media container, poll until processing finishes, then call `media_publish`. That polling is its own endpoint, so scheduled posts can complete Instagram publishes without a browser being open.

## Scheduling without a queue

Scheduled posting uses no message queue — just Postgres constraints and Cloud Scheduler:

- Users pick a date and an AM (9:00) or PM (17:00) Central window.
- A `post_schedule_targets` table with a **unique constraint** guarantees at most one AM and one PM post per account per day, even under concurrent requests. A single atomic function reserves every target or rolls back all of them.
- Google Cloud Scheduler fires at 9:05 and 5:05, hitting the publish service with a secret bearer token.
- The service claims due rows by flipping `scheduled → publishing` (so two runs can't double-publish) and pushes them through the same `publishPost()` path the UI uses.

One code path for interactive and scheduled publishing means every fix applies to both.

## Instagram comment automation

The second half of the product: a user picks *one specific* post or reel, defines keyword triggers, and writes a DM plus an optional public reply. Then:

1. Meta sends a comment webhook to the web API.
2. The handler **verifies the webhook signature**, matches the professional account, checks the specific post ID and keywords.
3. It sends the private DM first, and only posts the public comment reply if the DM succeeded.

Scoping rules to one post and explicit keywords isn't just UX — it keeps the Meta permission footprint minimal. Instagram *publishing* is actually disabled by default for the same reason: the automation use case doesn't need `instagram_business_content_publish`, so the app doesn't ask for it. Least-privilege as a product decision, not just a security checkbox.

## Lessons that only production teaches

**Tokens must never reach the browser.** An early version cached connected-account rows in `localStorage` — including OAuth tokens. That mechanism is gone; API responses now send a `has_refresh_token` boolean instead of the token itself, and the old cache key gets actively purged. If the browser doesn't need a secret to render, it should never receive it.

**Standing connections are a standing cost.** Always-on realtime subscriptions (an activity bell, a live dashboard) kept database load high for near-zero user value. They're now TTL caches in `localStorage` that refetch on interaction, with realtime reserved for the moments it earns its keep — like watching a publish complete. 

**Webhooks get expensive quietly.** The Instagram webhook originally fetched every connected Instagram account per incoming comment. Popular reel, hundreds of comments, hundreds of scans. Now the lookup is a single SQL match with per-delivery caching.

## Closing

The through-line of Lexaya's architecture is *doing less on purpose*: a frontend with no framework, servers that never touch media bytes, a scheduler that's just database constraints, and permission scopes trimmed to the actual use case. Every piece that was removed is a piece that can't break, cost money, or leak.

Lexaya is open source (MIT). If cross-platform publishing or Instagram automation is your problem too, the repo has full setup, configuration, and deployment docs.
