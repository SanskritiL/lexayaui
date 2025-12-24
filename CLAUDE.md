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
├── vercel.json             # Vercel config (just version: 2)
├── package.json            # Dependencies
├── js/
│   ├── config.js           # Supabase & Stripe keys
│   └── supabase.js         # Auth functions
├── api/
│   ├── create-checkout.js  # Stripe checkout session
│   ├── webhook.js          # Stripe webhook (saves purchases)
│   ├── download.js         # Paid content signed URLs
│   └── free-download.js    # Free content signed URLs (requires login)
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
```
