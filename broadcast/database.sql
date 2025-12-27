-- PublishToAll Database Schema
-- Run this in your Supabase SQL Editor

-- 1. Connected platform accounts table
CREATE TABLE IF NOT EXISTS connected_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL CHECK (platform IN ('tiktok', 'instagram', 'linkedin', 'twitter')),
    platform_user_id TEXT,
    account_name TEXT,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_expires_at TIMESTAMPTZ,
    scopes TEXT[],
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Each user can only have one account per platform
    UNIQUE(user_id, platform)
);

-- 2. Posts table
CREATE TABLE IF NOT EXISTS posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_scheduled_at ON posts(scheduled_at) WHERE status = 'scheduled';

-- 4. Row Level Security (RLS)
ALTER TABLE connected_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

-- Users can only see/modify their own connected accounts
CREATE POLICY "Users can view own connected accounts" ON connected_accounts
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own connected accounts" ON connected_accounts
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own connected accounts" ON connected_accounts
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own connected accounts" ON connected_accounts
    FOR DELETE USING (auth.uid() = user_id);

-- Users can only see/modify their own posts
CREATE POLICY "Users can view own posts" ON posts
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own posts" ON posts
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own posts" ON posts
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own posts" ON posts
    FOR DELETE USING (auth.uid() = user_id);

-- 5. Create storage bucket for videos (run separately in Storage section)
-- Go to Storage > Create new bucket
-- Name: videos
-- Public: Yes (or use signed URLs)
-- File size limit: 500MB
-- Allowed MIME types: video/mp4, video/quicktime, video/webm

-- IMPORTANT: Storage bucket RLS policies (run in SQL Editor)
-- These allow authenticated users to upload/read their own videos

-- Allow users to upload videos to their own folder
CREATE POLICY "Users can upload videos to own folder"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'videos' AND
    (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow users to read their own videos
CREATE POLICY "Users can read own videos"
ON storage.objects FOR SELECT TO authenticated
USING (
    bucket_id = 'videos' AND
    (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow public read access (for Instagram to fetch the video)
CREATE POLICY "Public can read videos"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'videos');

-- Allow users to delete their own videos
CREATE POLICY "Users can delete own videos"
ON storage.objects FOR DELETE TO authenticated
USING (
    bucket_id = 'videos' AND
    (storage.foldername(name))[1] = auth.uid()::text
);

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

CREATE POLICY "Service role full access to posts" ON posts
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
