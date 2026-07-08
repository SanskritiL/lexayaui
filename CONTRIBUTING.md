# Contributing

Thanks for improving Lexaya. This project is intentionally simple: static HTML/CSS/JS for the browser, Express services for API work, and Supabase for auth/data.

## Local workflow

1. Install dependencies:

   ```bash
   npm run install:all
   ```

2. Copy and fill environment values:

   ```bash
   cp .env.example .env.local
   cp .firebaserc.example .firebaserc
   ```

3. Run the app pieces you need:

   ```bash
   npm run dev
   npm run api:dev
   npm run publish:dev
   ```

4. Before opening a PR:

   ```bash
   npm run check
   ```

## Expectations

- Do not commit `.env`, `.env.local`, OAuth credentials, access tokens, database dumps, or customer data.
- Keep platform permissions least-privilege. If a feature needs a new Meta/TikTok/Google/LinkedIn scope, document the exact endpoint that requires it.
- Prefer small, focused changes. This codebase has several integrations, so narrow diffs are easier to review.
- Update docs when behavior, setup, permissions, or deployment changes.

## Commit style

Use short imperative commit messages, for example:

```text
Add Instagram automation setup docs
Make publish service project-agnostic
```
