# Lexaya Project Context

## Overview
Personal brand site for a UGC creator at **lexaya.io** (LIVE). Offers free resources (require login) and paid digital products. All resource access is tracked in database.

## Tech Stack
- **Frontend**: Vanilla HTML/CSS/JS (no framework)
- **Hosting**: Vercel (LIVE at lexaya.io)
- **Auth**: Supabase (magic link email auth)
- **Payments**: Stripe Checkout
- **File Storage**: Supabase Storage (signed URLs for protected downloads)
- **Booking**: Cal.com (for 1:1 calls)
- **Analytics**: Plausible

## Design Style
- **Theme**: White background, blue text (#1e40af primary, #3b82f6 secondary)
- **Font**: Inter (clean, readable)
- **Aesthetic**: Hand-drawn/sketchy borders using irregular border-radius
- **Borders**: Dashed lines for section dividers, solid for cards

## Site Structure

```
lexayaui/
├── index.html              # Landing - hero, brands carousel, UGC resources
├── login.html              # Magic link email auth
├── members.html            # Protected content area
├── style.css               # Main styles
├── script.js               # Animations, mobile menu
├── vercel.json             # Vercel config + crons
├── package.json            # Dependencies
├── js/
│   ├── config.js           # Supabase & Stripe keys
│   └── supabase.js         # Auth functions
├── api/
│   ├── create-checkout.js  # Stripe checkout session
│   ├── webhook.js          # Stripe webhook (saves purchases)
│   ├── download.js         # Paid content signed URLs
│   ├── free-download.js    # Free content signed URLs (requires login)
│   └── broadcast/          # Multi-platform publishing APIs
│       ├── auth/
│       │   ├── linkedin.js     # LinkedIn OAuth
│       │   ├── tiktok.js       # TikTok OAuth
│       │   └── instagram.js    # Instagram/Meta OAuth
│       ├── publish.js          # Publish to all platforms
│       └── cron/
│           └── process-scheduled.js  # Scheduled posts cron
├── broadcast/              # Multi-platform publishing app
│   ├── index.html          # Dashboard
│   ├── upload.html         # Upload & create posts
│   ├── connect.html        # Connect social accounts
│   ├── scheduled.html      # View scheduled posts
│   ├── history.html        # Post history
│   ├── style.css           # Broadcast styles
│   └── database.sql        # Supabase schema
└── cs/
    ├── index.html          # CS courses page
    ├── download.html       # Paid download page
    ├── free-download.html  # Free download page (requires login)
    └── ai-projects.html    # AI project ideas page
```

## Key Features

### Resource Protection
ALL resources require login. Access is tracked in `purchases` table:
- `user_id`, `customer_email`, `product_id`, `amount`, `status`
- Free resources: `amount: 0`, `status: 'free_access'`
- Paid resources: `amount: price`, `status: 'completed'`

### Free Resources (api/free-download.js)
Files stored in Supabase Storage → `resources` bucket → `free/` folder:
- CS: `resume`, `colleges`, `ai-projects` (page redirect)
- UGC: `portfolio`, `pitch`, `ratecard`, `calendar`

### Paid Resources (api/download.js)
Files in Supabase Storage → `resources` bucket → `paid/` folder:
- `regularDigital` → AI Roadmap guide

### Booking
Cal.com integration for $50/30min calls on CS page.

## Pages

### Landing (index.html)
- Hero: "engineer figuring out marketing"
- Brands carousel (Claude, Replit, Lovable, etc.)
- UGC Resources grid (4 free resources, require login)
- Navbar shows user email when logged in, "login" when not

### CS Courses (cs/index.html)
- Free: Resume, Colleges list, AI Project Ideas
- Paid ($25): AI Roadmap, AI Projects Premium
- Booking: 1:1 Call ($50/30min via Cal.com)

### Login Flow
1. User clicks resource → redirected to free-download.html
2. If not logged in → shown login prompt
3. Login via magic link → redirected back
4. Access granted + tracked in database

## Environment Variables (Vercel)
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `LINKEDIN_CLIENT_ID` - LinkedIn app client ID
- `LINKEDIN_CLIENT_SECRET` - LinkedIn app secret
- `TIKTOK_CLIENT_KEY` - TikTok app client key
- `TIKTOK_CLIENT_SECRET` - TikTok app secret
- `FACEBOOK_APP_ID` - Meta/Facebook app ID (for Instagram)
- `FACEBOOK_APP_SECRET` - Meta/Facebook app secret
- `CRON_SECRET` - Secret for cron job authentication

---

## Broadcast Feature

### Overview
Multi-platform publishing tool at `/broadcast`. Upload once, publish to TikTok, Instagram, and LinkedIn.

### Database Tables (run `broadcast/database.sql` in Supabase)

**connected_accounts**
- Stores OAuth tokens for each platform
- `user_id`, `platform`, `access_token`, `refresh_token`, `token_expires_at`

**posts**
- Stores all posts (draft, scheduled, published)
- `user_id`, `video_url`, `caption`, `platforms[]`, `status`, `scheduled_at`, `platform_results`

### Supabase Storage
Create bucket: `videos` (public, 500MB limit, video/* MIME types)

### Platform Setup Required

**LinkedIn** (easiest)
1. Create app at https://developer.linkedin.com/
2. Add "Share on LinkedIn" product
3. Get `w_member_social` scope
4. Add OAuth redirect: `https://lexaya.io/api/broadcast/auth/linkedin`

**TikTok**
1. Create app at https://developers.tiktok.com/
2. Add "Content Posting API"
3. Request `video.upload` scope
4. Note: Unaudited apps post to DRAFTS only (user must publish in TikTok app)

**Instagram**
1. Create Meta app at https://developers.facebook.com/
2. Add Instagram Graph API
3. Request `instagram_content_publish` scope
4. Requires: Business/Creator account linked to Facebook Page

### Post Flow
1. User uploads video → stored in Supabase `videos` bucket
2. User writes caption, selects platforms
3. Immediate publish OR schedule for later
4. Cron job runs every minute to process scheduled posts
5. Results stored in `platform_results` JSONB field

## Supabase Storage Structure
```
resources/
├── free/
│   ├── sans_lamsal_resume.pdf
│   ├── college_with_sch.pdf
│   ├── ugc_portfolio_template.pdf
│   ├── brand_pitch_emails.pdf
│   ├── rate_card_template.pdf
│   └── content_calendar.pdf
└── paid/
    └── ai_engineer_resources_guide.pdf
```

## Social Links
- Instagram: @lexaya.io
- X/Twitter: @LamsalSans
- TikTok: @lexaya_io
- Email: sans@lexaya.io

## Commands
```bash
vercel dev          # Local development
git push            # Deploy (auto-deploys on Vercel)
npx vercel --prod   # Deploy directly via CLI
```

---

## Current State (Dec 24, 2025)

### Broadcast Feature - IN PROGRESS

**What's Done:**
- All Broadcast pages created (`/broadcast/`)
- OAuth API handlers created for LinkedIn, Instagram, TikTok
- Detailed error handling added to Instagram OAuth
- DNS configured: lexaya.io → Vercel (Cloudflare proxy OFF)
- API functions deployed and working on lexaya.io

**What's NOT Working:**

1. **LinkedIn OAuth** - Getting "Bummer, something went wrong" error
   - Redirect URL added: `https://lexaya.io/api/broadcast/auth/linkedin`
   - Client ID might have newline issue - CHECK `LINKEDIN_CLIENT_ID` env var in Vercel
   - Make sure no trailing `%0A` in the value

2. **Instagram OAuth** - Was showing "Invalid App ID" error
   - Correct App ID: `1391901732240133`
   - Verify `FACEBOOK_APP_ID` in Vercel matches this
   - Add redirect URL in Meta Developer Console: `https://lexaya.io/api/broadcast/auth/instagram`
   - App must be in LIVE mode (not Development)
   - Need Facebook Page connected to Instagram Business account

**Vercel Environment Variables to Check:**
- `LINKEDIN_CLIENT_ID` - NO trailing newlines/spaces
- `LINKEDIN_CLIENT_SECRET` - NO trailing newlines/spaces
- `FACEBOOK_APP_ID` - Should be `1391901732240133`
- `FACEBOOK_APP_SECRET` - Get from Meta Developer Console

**OAuth Redirect URLs to Configure:**

LinkedIn Developer Console → Auth → Authorized redirect URLs:
```
https://lexaya.io/api/broadcast/auth/linkedin
```

Meta Developer Console → Facebook Login → Settings → Valid OAuth Redirect URIs:
```
https://lexaya.io/api/broadcast/auth/instagram
```

**DNS Setup (Cloudflare):**
```
Type: CNAME, Name: @, Target: cname.vercel-dns.com, Proxy: OFF
Type: CNAME, Name: www, Target: cname.vercel-dns.com, Proxy: OFF
```

### Database Tables (NOT YET CREATED)
Run `broadcast/database.sql` in Supabase SQL Editor to create:
- `connected_accounts` table
- `posts` table

### Supabase Storage (NOT YET CREATED)
Create bucket `videos` for video uploads
