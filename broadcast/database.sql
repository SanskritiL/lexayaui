-- PublishToAll Database Schema
-- Run this in your Supabase SQL Editor

-- 1. Connected platform accounts table
-- user_id holds the Firebase Auth uid (imported legacy users keep their old
-- Supabase UUID as their Firebase uid, so both shapes appear in these columns).
CREATE TABLE IF NOT EXISTS connected_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT,
    platform TEXT NOT NULL CHECK (platform IN ('tiktok', 'instagram', 'linkedin', 'twitter', 'threads', 'youtube')),
    platform_user_id TEXT,
    account_name TEXT,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_expires_at TIMESTAMPTZ,
    scopes TEXT[],
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Posts table
CREATE TABLE IF NOT EXISTS posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT,
    video_url TEXT,
    thumbnail_url TEXT,
    caption TEXT,
    platforms TEXT[] DEFAULT '{}',
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'publishing', 'published', 'partial', 'failed')),
    scheduled_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    platform_results JSONB DEFAULT '{}',
    -- Example: {"linkedin": {"status": "success", "post_id": "123", "url": "..."}, ...}
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_connected_accounts_user_id ON connected_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_connected_accounts_platform ON connected_accounts(platform);
CREATE INDEX IF NOT EXISTS idx_connected_accounts_user_platform ON connected_accounts(user_id, platform);
CREATE UNIQUE INDEX IF NOT EXISTS connected_accounts_user_platform_provider_uidx
    ON connected_accounts(user_id, platform, platform_user_id)
    WHERE platform_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_scheduled_at ON posts(scheduled_at) WHERE status = 'scheduled';

-- 4. Row Level Security (RLS)
ALTER TABLE connected_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

-- Users can only see/modify their own rows. Policies compare the JWT sub claim
-- (the Firebase uid; also valid for legacy Supabase tokens) against user_id.
CREATE POLICY "Users can view own connected accounts" ON connected_accounts
    FOR SELECT USING ((select auth.jwt()->>'sub') = user_id);

CREATE POLICY "Users can insert own connected accounts" ON connected_accounts
    FOR INSERT WITH CHECK ((select auth.jwt()->>'sub') = user_id);

CREATE POLICY "Users can update own connected accounts" ON connected_accounts
    FOR UPDATE USING ((select auth.jwt()->>'sub') = user_id);

CREATE POLICY "Users can delete own connected accounts" ON connected_accounts
    FOR DELETE USING ((select auth.jwt()->>'sub') = user_id);

-- Users can only see/modify their own posts
CREATE POLICY "Users can view own posts" ON posts
    FOR SELECT USING ((select auth.jwt()->>'sub') = user_id);

CREATE POLICY "Users can insert own posts" ON posts
    FOR INSERT WITH CHECK ((select auth.jwt()->>'sub') = user_id);

CREATE POLICY "Users can update own posts" ON posts
    FOR UPDATE USING ((select auth.jwt()->>'sub') = user_id);

CREATE POLICY "Users can delete own posts" ON posts
    FOR DELETE USING ((select auth.jwt()->>'sub') = user_id);

-- 5. Create storage bucket for videos (run separately in Storage section)
-- Go to Storage > Create new bucket
-- Name: videos
-- Public: Yes (or use signed URLs)
-- File size limit: 500MB when using R2 direct uploads
-- Allowed MIME types: video/mp4, video/quicktime, video/webm

-- Video uploads go through Cloudflare R2 (publish-service), so the bucket only
-- needs public read (for Instagram to fetch the video).
CREATE POLICY "Public can read videos"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'videos');

-- 6. Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 7. Triggers for updated_at
CREATE TRIGGER update_connected_accounts_updated_at
    BEFORE UPDATE ON connected_accounts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_posts_updated_at
    BEFORE UPDATE ON posts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 8. Service role access for API endpoints (tokens are sensitive)
-- This allows the service key to bypass RLS for token operations
CREATE POLICY "Service role full access to connected_accounts" ON connected_accounts
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- Keep OAuth credentials out of the browser.
--
-- RLS decides which ROWS a user sees, not which COLUMNS, so "view own connected
-- accounts" would otherwise hand the browser a live Instagram access_token —
-- and any XSS on a dashboard page could exfiltrate it. The app never needs the
-- tokens client-side: every platform call is proxied through the API, which
-- reads them with the service key. So revoke the columns outright.
--
-- The UI only needs to know *whether* a refresh token exists (to show the
-- reconnect prompt), which this generated column answers without exposing it.
ALTER TABLE connected_accounts
    ADD COLUMN IF NOT EXISTS has_refresh_token BOOLEAN
    GENERATED ALWAYS AS (refresh_token IS NOT NULL) STORED;

-- Column grants sit in front of RLS. service_role is a separate role and keeps
-- full access, so the API and publish service still read the tokens.
--
-- A column-level REVOKE cannot subtract from a table-level grant, and Supabase
-- ships GRANT ALL ON ALL TABLES TO anon, authenticated. So drop the table-wide
-- SELECT first, then grant back only the columns the browser may see.
REVOKE SELECT ON connected_accounts FROM anon, authenticated;
GRANT SELECT (
    id, user_id, platform, platform_user_id, account_name,
    token_expires_at, scopes, metadata, created_at, updated_at, has_refresh_token
) ON connected_accounts TO anon, authenticated;

-- The browser never writes connected accounts — OAuth runs server-side under
-- the service key. It only needs DELETE, to disconnect an account it owns.
REVOKE INSERT, UPDATE ON connected_accounts FROM anon, authenticated;

CREATE POLICY "Service role full access to posts" ON posts
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- 9. Subscriptions table for Broadcast Pro
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT,
    customer_email TEXT NOT NULL,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    product_key TEXT NOT NULL DEFAULT 'broadcast',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled', 'past_due', 'unpaid')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Each email can only have one subscription per product
    UNIQUE(customer_email, product_key)
);

-- Index for subscription lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_email ON subscriptions(customer_email);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- RLS for subscriptions
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can view their own subscription
CREATE POLICY "Users can view own subscription" ON subscriptions
    FOR SELECT USING (auth.jwt() ->> 'email' = customer_email);

-- Service role full access for webhook updates
CREATE POLICY "Service role full access to subscriptions" ON subscriptions
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- Trigger for updated_at
CREATE TRIGGER update_subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 10. Beta access requests
--
-- While the Meta app is in development mode, Instagram OAuth only works for
-- accounts added as testers in the Meta developer console. So we collect the
-- Instagram username at sign-up and add them by hand. Drop this table once the
-- app clears Meta review and the OAuth flow is open to everyone.
CREATE TABLE IF NOT EXISTS beta_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    email TEXT NOT NULL,
    instagram_username TEXT NOT NULL,
    -- pending: awaiting a tester invite in the Meta console
    -- invited: invite sent, user must accept it in Instagram settings
    -- active:  accepted, OAuth works for them
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'invited', 'active')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- One request per account; re-submitting updates the username.
    UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_beta_requests_status ON beta_requests(status);

ALTER TABLE beta_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own beta request" ON beta_requests
    FOR SELECT USING (auth.jwt() ->> 'sub' = user_id);

CREATE POLICY "Service role full access to beta requests" ON beta_requests
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE TRIGGER update_beta_requests_updated_at
    BEFORE UPDATE ON beta_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
