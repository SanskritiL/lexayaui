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
│       │   ├── linkedin.js     # LinkedIn OAuth (WORKING)
│       │   ├── tiktok.js       # TikTok OAuth
│       │   └── instagram.js    # Instagram/Meta OAuth (WORKING)
│       ├── publish.js          # Publish to all platforms (WORKING for LinkedIn)
│       └── cron/
│           └── process-scheduled.js  # Scheduled posts cron
├── broadcast/              # Multi-platform publishing app
│   ├── index.html          # Dashboard - shows recent posts
│   ├── upload.html         # Upload & create posts (supports text-only for LinkedIn)
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
- `LINKEDIN_CLIENT_ID` - LinkedIn app client ID (NO trailing newlines!)
- `LINKEDIN_CLIENT_SECRET` - LinkedIn app secret
- `TIKTOK_CLIENT_KEY` - TikTok app client key
- `TIKTOK_CLIENT_SECRET` - TikTok app secret
- `FACEBOOK_APP_ID` - Meta/Facebook app ID: `1391901732240133`
- `FACEBOOK_APP_SECRET` - Meta/Facebook app secret
- `CRON_SECRET` - Secret for cron job authentication

---

## Broadcast Feature - WORKING (Dec 26, 2025)

### Overview
Multi-platform publishing tool at `/broadcast`. Upload once, publish to TikTok, Instagram, and LinkedIn.

### Current Status
- **LinkedIn**: ✅ WORKING - Text posts publish successfully
- **Instagram**: ✅ OAuth WORKING - Connects to `sansmi_boutique` account
- **TikTok**: ⏳ Not tested yet

### Key Technical Details

#### LinkedIn API Version
**CRITICAL**: LinkedIn API versions expire after 1 year. Current working version: `202411`
- If you get `NONEXISTENT_VERSION` error, update the version in `/api/broadcast/publish.js`
- Check active versions at: https://learn.microsoft.com/en-us/linkedin/marketing/versioning
- Version format: `YYYYMM` (e.g., `202411` = November 2024)

#### Text-Only Posts
- LinkedIn supports text-only posts (no video required)
- TikTok and Instagram require video
- Upload form (`/broadcast/upload.html`) handles this automatically

### Database Tables (IN SUPABASE)

**connected_accounts**
```sql
- user_id (uuid, references auth.users)
- platform (text: 'linkedin', 'instagram', 'tiktok')
- platform_user_id (text)
- account_name (text)
- access_token (text)
- refresh_token (text)
- token_expires_at (timestamptz)
- scopes (text[])
- metadata (jsonb)
- Unique constraint on (user_id, platform)
```

**posts**
```sql
- id (uuid)
- user_id (uuid)
- video_url (text, nullable for text-only posts)
- caption (text)
- platforms (text[])
- status (text: 'draft', 'scheduled', 'publishing', 'published', 'partial', 'failed')
- scheduled_at (timestamptz)
- published_at (timestamptz)
- platform_results (jsonb - stores success/error per platform)
- created_at (timestamptz)
```

### Supabase Storage
- Bucket: `videos` (public, 500MB limit, video/* MIME types)

### OAuth Redirect URLs

**LinkedIn Developer Console** → Auth → Authorized redirect URLs:
```
https://lexaya.io/api/broadcast/auth/linkedin
http://localhost:3000/api/broadcast/auth/linkedin  (for local testing)
```

**Meta Developer Console** → Facebook Login → Settings → Valid OAuth Redirect URIs:
```
https://lexaya.io/api/broadcast/auth/instagram
```

### Instagram OAuth Notes
- Uses Facebook Graph API (not direct Instagram API)
- Requires: Instagram Business/Creator account linked to Facebook Page
- During OAuth, user MUST select BOTH the Instagram account AND the Facebook Page
- App must have user added as "Tester" in Roles section (for development mode)
- Connected account: `sansmi_boutique`

### Post Flow
1. User goes to `/broadcast/upload.html`
2. Optionally uploads video (required for TikTok/Instagram, optional for LinkedIn)
3. Writes caption
4. Selects platforms via checkboxes (only connected accounts are enabled)
5. Clicks "Publish Now" or "Post to LinkedIn" (for text-only)
6. Post saved to `posts` table with status `publishing`
7. `/api/broadcast/publish` called with post ID and platforms
8. Each platform publish attempt logged with detailed console output
9. Results stored in `platform_results` JSONB field
10. Alert shows success/failure per platform

### Debugging

**Vercel Logs**: `vercel logs` or check Vercel dashboard
**Local Testing**: `vercel dev` (runs on localhost:3000 or 3001)

**Publish API Logging**: The `/api/broadcast/publish.js` has extensive `console.log` statements:
- `[AUTH]` - Authentication steps
- `[DB]` - Database operations
- `[PUBLISH]` - Platform publishing
- `[LINKEDIN]` - LinkedIn-specific operations

### DNS Setup (Cloudflare)
```
Type: CNAME, Name: @, Target: cname.vercel-dns.com, Proxy: OFF
Type: CNAME, Name: www, Target: cname.vercel-dns.com, Proxy: OFF
```

---

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

videos/
└── {user_id}/
    └── {timestamp}_{filename}.mp4
```

## Social Links
- Instagram: @lexaya.io
- X/Twitter: @LamsalSans
- TikTok: @lexaya_io
- Email: sans@lexaya.io

## Commands
```bash
vercel dev          # Local development (port 3000 or 3001)
git push            # Deploy (auto-deploys on Vercel)
npx vercel --prod   # Deploy directly via CLI
vercel logs         # View production logs
```

---

## Next Steps / TODO

1. **TikTok Publishing** - Test TikTok OAuth and video upload flow
2. **Instagram Publishing** - Test video upload to Instagram Reels
3. **Scheduled Posts** - Test the cron job for scheduled posts
4. **Token Refresh** - LinkedIn tokens expire; may need refresh logic
5. **Video Upload to LinkedIn** - Currently falls back to text; full video upload is complex

## Known Issues

1. **LinkedIn API Version Expiry** - Version `202411` works now, but will expire ~Nov 2025. Update to newer version when needed.
2. **Instagram requires Facebook Page** - User must select both Instagram account AND Facebook Page during OAuth for it to work.
