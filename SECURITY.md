# Security Policy

## Supported versions

This repository currently supports the `main` branch.

## Reporting a vulnerability

Do not open a public issue for credential leaks, auth bypasses, webhook verification bugs, or data exposure.

Email the project maintainer listed by the repository owner, or open a private security advisory if GitHub Security Advisories are enabled.

## Secret handling

- Never commit `.env`, `.env.local`, service-role keys, OAuth app secrets, refresh tokens, access tokens, Stripe secrets, webhook secrets, Cloudflare R2 keys, or Google service account credentials.
- Browser keys such as Supabase anon keys and Stripe publishable keys are public, but forks should still replace them with their own project values.
- If this repo is made public after private development, rotate every credential that ever appeared in local files, deploy logs, screenshots, or git history.
- Use Google Secret Manager or your host’s secret store for production server-side variables.

## Webhook security

- Stripe webhooks require the raw request body and `STRIPE_WEBHOOK_SECRET`.
- Instagram webhooks require the raw request body and `INSTAGRAM_APP_SECRET`.
- Do not put webhook endpoints behind middleware that mutates the request body before signature verification.
