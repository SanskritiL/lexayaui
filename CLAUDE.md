# Lexaya Project Context

## Overview
Personal brand site for a UGC creator. Transparent creator model - sharing tips, behind the scenes, resources with free signup to access content. Also offers paid services via Stripe.

## Tech Stack
- **Frontend**: Vanilla HTML/CSS/JS (no framework)
- **Hosting**: Vercel (configured, not yet deployed)
- **Auth**: Supabase (magic link email auth)
- **Payments**: Stripe Checkout
- **Analytics**: Plausible

## Design Style
- **Theme**: White background, blue text (#1e40af primary, #3b82f6 secondary)
- **Font**: Caveat (handwriting style) from Google Fonts
- **Aesthetic**: Hand-drawn/sketchy borders using irregular border-radius (e.g., `255px 15px 225px 15px/15px 225px 15px 255px`)
- **Borders**: Dashed lines for section dividers, solid for cards
- **Hover effects**: Slight rotation + box-shadow offset

## Site Structure

```
lexayaui/
├── index.html          # Public landing - teaser + signup CTA
├── login.html          # Magic link email auth
├── members.html        # Protected content (tips, BTS, resources, services)
├── dashboard.html      # Legacy - can be removed
├── style.css           # Main styles (sketchy theme)
├── script.js           # Smooth scroll, mobile menu, animations
├── vercel.json         # Vercel deployment config
├── package.json        # Dependencies (stripe, supabase)
├── .env.example        # Environment variables template
├── CNAME               # Domain: lexaya.io
├── js/
│   ├── config.js       # API keys placeholder (user fills in)
│   └── supabase.js     # Auth & database functions
├── api/
│   ├── create-checkout.js   # Stripe checkout session creator
│   └── webhook.js           # Stripe webhook handler
└── cs/
    ├── index.html      # CS resources page (public)
    └── style.css       # CS page styles
```

## Pages

### Public Landing (index.html)
- Hero: "I make UGC. You learn how."
- What's Inside: 4 feature cards (Tips, BTS, Resources, Real Talk)
- About section with photo placeholder
- CTA section

### Login (login.html)
- Email input form
- Sends magic link via Supabase
- Redirects to /members.html after verification

### Members Area (members.html)
- Auth protected (redirects to login if not authenticated)
- Sections:
  - Tips & Learnings (3 placeholder posts)
  - Behind the Scenes (2 placeholder posts)
  - Resources & Templates (3 downloadable items)
  - Services (3 pricing cards with Stripe checkout)

### CS Resources (cs/)
- Public page with curated CS study resources
- Categories: Programming, DSA, Web Dev, System Design, Interview Prep, Tools
- Same sketchy design style

## User Flow
```
Visit site → See teaser → Click "Join Free" → Enter email →
Get magic link → Click link → Redirected to members area (authenticated)
```

## Setup Required (User Action)

### 1. Supabase Setup
- Create project at supabase.com
- Enable Email auth (magic links on by default)
- Run SQL to create tables:
```sql
create table leads (
  id uuid default gen_random_uuid() primary key,
  email text not null,
  source text,
  created_at timestamp with time zone default now()
);

create table purchases (
  id uuid default gen_random_uuid() primary key,
  user_id uuid,
  stripe_session_id text,
  product_id text,
  amount integer,
  customer_email text,
  status text,
  created_at timestamp with time zone default now()
);
```
- Get API keys from Settings → API

### 2. Stripe Setup
- Create account at stripe.com
- Create products and get Price IDs
- Set up webhook endpoint: `https://yourdomain.com/api/webhook`
- Events to listen: `checkout.session.completed`

### 3. Update Config
Edit `js/config.js`:
```js
SUPABASE_URL: 'https://xxxxx.supabase.co',
SUPABASE_ANON_KEY: 'eyJxxxxx',
STRIPE_PUBLISHABLE_KEY: 'pk_xxxxx',
PRODUCTS: {
    ugcPackage: 'price_xxxxx',
    marketingVideo: 'price_xxxxx',
    socialAds: 'price_xxxxx'
}
```

### 4. Vercel Deployment
```bash
npm i -g vercel
vercel
```
Add environment variables in Vercel dashboard:
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`

### 5. DNS Setup
- `ad.lexaya.io` → CNAME to lexaya.io
- `cs.lexaya.io` → Redirect to lexaya.io/cs/

## Content to Update
- `index.html`: Photo placeholder in about section
- `members.html`: Replace placeholder content with real tips/resources
- `js/config.js`: Add real API keys and Stripe price IDs

## Social Links (already configured)
- Instagram: @lexaya.io
- X/Twitter: @LamsalSans
- TikTok: @lexaya_io
- Email: hello@lexaya.io

## Commands
```bash
# Local dev with Vercel
npm install
vercel dev

# Or just open index.html directly for static preview
open index.html
```

## Git Status
On main branch, changes not yet committed. Ready to push to GitHub and deploy to Vercel.
