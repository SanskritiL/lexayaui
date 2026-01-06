-- Media Kit Schema for Lexaya Broadcast (Simplified)
-- Run this in Supabase SQL Editor

-- Create media_kits table (minimal - just what we need for sharing)
CREATE TABLE IF NOT EXISTS media_kits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    share_token TEXT UNIQUE NOT NULL,

    -- Only store what's needed for sharing
    display_name TEXT,
    tagline TEXT,

    -- Brands worked with
    brands JSONB DEFAULT '[]',

    -- Manual follower overrides (for platforms that don't expose counts)
    -- Example: {"linkedin": 5000, "tiktok": 12000}
    manual_followers JSONB DEFAULT '{}',

    -- Manual usernames for profile links
    -- Example: {"instagram": "lexaya.io", "tiktok": "lexaya_io"}
    manual_usernames JSONB DEFAULT '{}',

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- One kit per user
    UNIQUE(user_id)
);

-- Index for fast token lookups
CREATE INDEX IF NOT EXISTS idx_media_kits_share_token ON media_kits(share_token);

-- Enable Row Level Security
ALTER TABLE media_kits ENABLE ROW LEVEL SECURITY;

-- Users can manage their own kit
CREATE POLICY "Users can manage own kit" ON media_kits
    FOR ALL USING (auth.uid() = user_id);

-- Anyone can view public kits (for share links)
CREATE POLICY "Public can view kits by token" ON media_kits
    FOR SELECT USING (true);

-- Function to generate a random share token
CREATE OR REPLACE FUNCTION generate_share_token()
RETURNS TEXT AS $$
DECLARE
    chars TEXT := 'abcdefghijklmnopqrstuvwxyz0123456789';
    result TEXT := '';
    i INTEGER;
BEGIN
    FOR i IN 1..10 LOOP
        result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
    END LOOP;
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Auto-generate share token on insert
CREATE OR REPLACE FUNCTION set_share_token()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.share_token IS NULL OR NEW.share_token = '' THEN
        NEW.share_token := generate_share_token();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_share_token ON media_kits;
CREATE TRIGGER trigger_set_share_token
    BEFORE INSERT ON media_kits
    FOR EACH ROW
    EXECUTE FUNCTION set_share_token();

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_updated_at ON media_kits;
CREATE TRIGGER trigger_update_updated_at
    BEFORE UPDATE ON media_kits
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();
