-- Instagram DM Automation Schema
-- Run this in your Supabase SQL Editor after the main database.sql

-- ============================================
-- 1. AUTOMATION RULES TABLE
-- ============================================
-- Stores keyword triggers and DM templates for each user

CREATE TABLE IF NOT EXISTS automation_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,                          -- "Free Guide DM Automation"

    -- Trigger Configuration
    trigger_type TEXT NOT NULL DEFAULT 'comment_keyword',
    trigger_keywords TEXT[] NOT NULL,            -- ['INFO', 'GUIDE', 'FREE']
    trigger_post_ids TEXT[],                     -- Specific post IDs, or null for all posts
    trigger_scope TEXT DEFAULT 'all',            -- 'specific', 'all'
    exclude_keywords TEXT[],                     -- Keywords to ignore

    -- Action Configuration
    action_type TEXT DEFAULT 'send_dm',
    dm_template TEXT NOT NULL,                   -- "Thanks! Here's your guide: {{link}}"
    dm_delay_seconds INT DEFAULT 0,              -- 0, 30, 60, 300

    -- Variables for template substitution
    variables JSONB DEFAULT '{}',                -- {"link": "https://...", "code": "SAVE20"}

    -- Status & Limits
    is_active BOOLEAN DEFAULT true,
    max_dms_per_hour INT DEFAULT 50,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT valid_trigger_type CHECK (trigger_type IN ('comment_keyword', 'story_mention', 'dm_keyword')),
    CONSTRAINT valid_action_type CHECK (action_type IN ('send_dm', 'reply_comment', 'both')),
    CONSTRAINT valid_trigger_scope CHECK (trigger_scope IN ('specific', 'all'))
);

-- Indexes for automation_rules
CREATE INDEX IF NOT EXISTS idx_automation_rules_user_id ON automation_rules(user_id);
CREATE INDEX IF NOT EXISTS idx_automation_rules_active ON automation_rules(is_active) WHERE is_active = true;


-- ============================================
-- 2. DM LOG TABLE
-- ============================================
-- Tracks all DMs sent, prevents duplicates, enables analytics

CREATE TABLE IF NOT EXISTS dm_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    automation_rule_id UUID REFERENCES automation_rules(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Instagram identifiers
    ig_user_id TEXT NOT NULL,                    -- Instagram Scoped User ID (commenter)
    ig_username TEXT,                            -- @username if available
    ig_post_id TEXT,                             -- Which post was commented on
    ig_comment_id TEXT,                          -- The comment that triggered this
    ig_comment_text TEXT,                        -- What they commented

    -- DM details
    dm_message TEXT NOT NULL,                    -- The actual message sent
    dm_sent_at TIMESTAMPTZ DEFAULT NOW(),
    dm_status TEXT DEFAULT 'sent',               -- 'sent', 'failed', 'rate_limited'
    dm_error TEXT,                               -- Error message if failed

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for dm_log
CREATE INDEX IF NOT EXISTS idx_dm_log_rule_id ON dm_log(automation_rule_id);
CREATE INDEX IF NOT EXISTS idx_dm_log_user_created ON dm_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dm_log_ig_user ON dm_log(ig_user_id);
CREATE INDEX IF NOT EXISTS idx_dm_log_status ON dm_log(dm_status);

-- Note: Duplicate prevention (1 DM per user per rule per day) is handled
-- in the webhook.js application logic by checking dm_log before sending


-- ============================================
-- 3. WEBHOOK SUBSCRIPTIONS TABLE
-- ============================================
-- Tracks webhook setup status for each Instagram account

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    platform TEXT DEFAULT 'instagram',
    ig_account_id TEXT NOT NULL,                 -- Instagram Business Account ID
    page_id TEXT,                                -- Facebook Page ID
    subscription_status TEXT DEFAULT 'pending',  -- 'pending', 'active', 'failed'
    subscribed_fields TEXT[],                    -- ['comments', 'messages']
    verify_token TEXT NOT NULL,                  -- For webhook verification
    subscribed_at TIMESTAMPTZ,
    last_event_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id, platform, ig_account_id)
);

-- Index for webhook_subscriptions
CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_ig_account ON webhook_subscriptions(ig_account_id);


-- ============================================
-- 4. ROW LEVEL SECURITY (RLS)
-- ============================================

ALTER TABLE automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE dm_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_subscriptions ENABLE ROW LEVEL SECURITY;

-- automation_rules policies
CREATE POLICY "Users can view own automation rules" ON automation_rules
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own automation rules" ON automation_rules
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own automation rules" ON automation_rules
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own automation rules" ON automation_rules
    FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Service role full access to automation_rules" ON automation_rules
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- dm_log policies (users can only view, not modify)
CREATE POLICY "Users can view own dm log" ON dm_log
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role full access to dm_log" ON dm_log
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- webhook_subscriptions policies
CREATE POLICY "Users can view own webhook subscriptions" ON webhook_subscriptions
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own webhook subscriptions" ON webhook_subscriptions
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Service role full access to webhook_subscriptions" ON webhook_subscriptions
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');


-- ============================================
-- 5. TRIGGERS FOR updated_at
-- ============================================

CREATE TRIGGER update_automation_rules_updated_at
    BEFORE UPDATE ON automation_rules
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- ============================================
-- 6. HELPER FUNCTION: Check Rate Limit
-- ============================================
-- Returns true if user can send more DMs (under 200/hour limit)

CREATE OR REPLACE FUNCTION check_dm_rate_limit(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    dm_count INT;
BEGIN
    SELECT COUNT(*) INTO dm_count
    FROM dm_log
    WHERE user_id = p_user_id
      AND dm_status = 'sent'
      AND created_at > NOW() - INTERVAL '1 hour';

    RETURN dm_count < 200;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
