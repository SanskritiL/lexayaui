# Lexaya Project Context

## Overview
Personal brand site for a UGC creator at **lexaya.io** (LIVE). Offers free resources (require login) and paid digital products. All resource access is tracked in database.

## Tech Stack
- **Frontend**: Vanilla HTML/CSS/JS (no framework)
- **Hosting**: Vercel (LIVE at lexaya.io)
- **Auth**: Supabase (magic link email auth)
- **Payments**: Stripe Checkout
- **File Storage**: Cloudflare R2 (videos/images) + Supabase Storage (PDFs)
- **Booking**: Cal.com (for 1:1 calls)
- **Analytics**: Plausible

## Design Style
- **Theme**: White background, blue text (#1e40af primary, #3b82f6 secondary)
- **Font**: Inter (clean, readable)
- **Aesthetic**: Hand-drawn/sketchy borders using irregular border-radius
- **Borders**: Dashed lines for section dividers, solid for cards
- **Icons**: Font Awesome with gradient backgrounds (no emojis in UI)

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
│   ├── upload-video.js     # R2 video/image upload
│   └── broadcast/          # Multi-platform publishing APIs
│       ├── auth/
│       │   └── [platform].js   # Unified OAuth handler (linkedin, instagram, tiktok, threads)
│       ├── publish.js          # Publish to all platforms
│       ├── analyze-hook.js     # AI viral hook analyzer (Gemini 1.5 Flash)
│       ├── refresh-accounts.js # Refresh follower counts
│       ├── tiktok/
│       │   └── init-video.js   # TikTok direct video upload (with auto token refresh)
│       ├── linkedin/
│       │   └── init-video.js   # LinkedIn video upload
│       └── cron/
│           └── process-scheduled.js  # Scheduled posts cron
├── broadcast/              # Multi-platform publishing app
│   ├── index.html          # Dashboard - shows recent posts, quick actions
│   ├── upload.html         # Upload & create posts (supports photos + videos)
│   ├── connect.html        # Connect social accounts
│   ├── scheduled.html      # View scheduled posts
│   ├── calendar.html       # Posting calendar view
│   ├── pricing.html        # Subscription pricing ($14.99/mo)
│   ├── style.css           # Broadcast styles
│   └── database.sql        # Supabase schema
└── cs/
    ├── index.html          # CS courses page
    ├── download.html       # Paid download page
    ├── free-download.html  # Free download page (requires login)
    └── ai-projects.html    # AI project ideas page
```

## Environment Variables (Vercel)
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `LINKEDIN_CLIENT_ID` - LinkedIn app client ID (NO trailing newlines!)
- `LINKEDIN_CLIENT_SECRET` - LinkedIn app secret
- `TIKTOK_CLIENT_KEY` - TikTok app client key
- `TIKTOK_CLIENT_SECRET` - TikTok app secret
- `FACEBOOK_APP_ID` - Meta/Facebook app ID (used for Instagram + Threads)
- `FACEBOOK_APP_SECRET` - Meta/Facebook app secret
- `R2_ACCESS_KEY_ID` - Cloudflare R2 access key
- `R2_SECRET_ACCESS_KEY` - Cloudflare R2 secret
- `R2_BUCKET_NAME` - R2 bucket name (`lexaya-videos`)
- `CRON_SECRET` - Secret for cron job authentication
- `GOOGLE_API_KEY` - Gemini API key for viral hook analyzer

---

## Broadcast Feature - Updated Dec 31, 2025

### Overview
Multi-platform publishing tool at `/broadcast`. Upload once, publish to TikTok, Instagram, LinkedIn, and Threads.

### Supported Platforms
| Platform | Video | Photo | Text-Only | Status |
|----------|-------|-------|-----------|--------|
| LinkedIn | ✅ | ✅ | ✅ | WORKING |
| Instagram | ✅ | ✅ | ❌ | WORKING |
| Threads | ✅ | ✅ | ✅ | OAuth needs redirect URL config |
| TikTok | ✅ | ❌ | ❌ | Has auto token refresh |

**Twitter/X removed from UI** - may add back later

### Subscription Required
- Users must have **active paid subscription** to use Broadcast
- No trial users - subscription status must be `'active'` (not `'trialing'`)
- Admin bypass for `sanslamsal16@gmail.com`

### Photo/Image Support (Added Dec 31, 2025)
- Supports: JPEG, PNG, WebP, GIF
- TikTok is disabled for photo uploads (video only)
- Instagram uses `image_url` parameter for photos
- LinkedIn uses Images API (initializeUpload → upload binary → create post)
- Threads uses `IMAGE` media_type

### Viral Hook Analyzer (Added Dec 31, 2025)
AI-powered feature to analyze video hooks for viral potential.

**How it works:**
1. User uploads a video
2. First frame is extracted as thumbnail (already done for all videos)
3. User clicks "Analyze Hook" button below video preview
4. Frame is sent to Gemini 1.5 Flash for analysis
5. Modal shows: viral score (0-100), extracted text, strengths/weaknesses, suggestions, similar hooks

**API Endpoint:** `POST /api/broadcast/analyze-hook`
- Requires: `Authorization: Bearer {token}`, `{ frameBase64: string }`
- Returns: `{ viral_score, extracted_text, analysis, suggestions, similar_hooks }`

**Environment Variable Required:**
- `GOOGLE_API_KEY` - Gemini API key from Google AI Studio

**Cost:** ~$0.001-0.002 per analysis (very cheap)

**Stateless design:** No database tables - viral hook examples are embedded in the Gemini prompt for comparison.

### Key Technical Details

#### LinkedIn API Version
**CRITICAL**: LinkedIn API versions expire after 1 year. Current working version: `202411`
- If you get `NONEXISTENT_VERSION` error, update the version in `/api/broadcast/publish.js`
- Check active versions at: https://learn.microsoft.com/en-us/linkedin/marketing/versioning

#### TikTok Token Auto-Refresh
- Tokens checked before each API call in `/api/broadcast/tiktok/init-video.js`
- Auto-refreshes if expired or expiring within 5 minutes
- If refresh fails, prompts user to reconnect account

#### Cloudflare R2 Storage
- Videos and images uploaded to R2 bucket `lexaya-videos`
- Public URL format: `https://pub-{hash}.r2.dev/{key}`
- Files deleted after successful publish to save storage

### Database Tables (Supabase)

**connected_accounts**
```sql
- user_id (uuid, references auth.users)
- platform (text: 'tiktok', 'instagram', 'linkedin', 'threads')
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
- video_url (text, nullable - used for both videos and images)
- thumbnail_url (text, nullable)
- caption (text)
- platforms (text[])
- status (text: 'draft', 'scheduled', 'publishing', 'published', 'partial', 'failed')
- scheduled_at (timestamptz)
- published_at (timestamptz)
- platform_results (jsonb - stores success/error per platform)
- metadata (jsonb - includes media_type: 'image' or 'video', r2_key, etc.)
- created_at (timestamptz)
```

**subscriptions**
```sql
- customer_email (text)
- product_key (text: 'broadcast')
- status (text: 'active', 'canceled', etc.)
```

### OAuth Redirect URLs

**LinkedIn Developer Console** → Auth → Authorized redirect URLs:
```
https://lexaya.io/api/broadcast/auth/linkedin
```

**Meta Developer Console** → Facebook Login → Valid OAuth Redirect URIs:
```
https://lexaya.io/api/broadcast/auth/instagram
```

**Meta Developer Console** → Threads API → Settings → Redirect Callback URLs:
```
https://lexaya.io/api/broadcast/auth/threads
```
**NOTE**: This must be configured for Threads OAuth to work! Without it, Threads won't redirect back after login.

**TikTok Developer Portal** → Login Kit → Redirect URI:
```
https://lexaya.io/api/broadcast/auth/tiktok
```

### UI Components

#### Quick Actions (Dashboard)
Vibrant gradient icons instead of emojis:
- **New Post**: Blue gradient (`#3b82f6` → `#1e40af`) with plus icon
- **Scheduled**: Orange gradient (`#f59e0b` → `#d97706`) with clock icon
- **Calendar**: Green gradient (`#10b981` → `#059669`) with calendar-check icon

#### Member Badge
- Solid blue background (`#1e40af`) - no gradient
- Shows "PRO MEMBER" and "Active" status
- No email displayed, no sparkle emoji

### Post Flow
1. User goes to `/broadcast/upload.html`
2. Uploads video OR image (images disable TikTok checkbox)
3. Writes caption
4. Selects platforms (only connected accounts enabled)
5. Clicks "Publish Now"
6. Publishing modal shows real-time status per platform
7. Videos/images uploaded to R2, then to each platform
8. Results stored in `platform_results` JSONB
9. Media deleted from R2 after successful publish

---

## Debugging

**Vercel Logs**: `vercel logs` or check Vercel dashboard
**Local Testing**: `vercel dev` (runs on localhost:3000)
**Deploy**: `npx vercel --prod` or `git push` (auto-deploys)

**Publish API Logging** (`/api/broadcast/publish.js`):
- `[AUTH]` - Authentication steps
- `[DB]` - Database operations
- `[PUBLISH]` - Platform publishing
- `[LINKEDIN]` - LinkedIn-specific
- `[INSTAGRAM]` - Instagram-specific
- `[THREADS]` - Threads-specific
- `[TIKTOK]` - TikTok-specific
- `[CLEANUP]` - R2 file deletion

---

## Known Issues / TODO

1. **Threads OAuth Redirect** - Must add `https://lexaya.io/api/broadcast/auth/threads` to Meta Developer Console → Threads API → Settings. User getting errors trying to save this - may need app review or business verification.

2. **TikTok blocked on laptop** - User's laptop blocks TikTok. Can connect via phone browser at same URL.

3. **LinkedIn API Version Expiry** - Version `202411` expires ~Nov 2025. Update when needed.

4. **Instagram requires Facebook Page** - User must select both Instagram account AND Facebook Page during OAuth.

---

## Commands
```bash
vercel dev          # Local development
git push            # Deploy via GitHub (auto)
npx vercel --prod   # Deploy directly via CLI
vercel logs         # View production logs
```

## Social Links
- Instagram: @lexaya.io
- X/Twitter: @LamsalSans
- TikTok: @lexaya_io
- Email: sans@lexaya.io
