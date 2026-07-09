-- Firebase Auth migration: user_id becomes TEXT and RLS keys off the JWT sub claim.
--
-- Run once in the Supabase SQL Editor BEFORE deploying the Firebase frontend.
-- Backward compatible: Supabase access tokens also carry sub = user UUID, so
-- existing sessions keep working until the frontend cutover.
--
-- Why: Firebase UIDs are 28-char strings, not UUIDs, so user_id columns can no
-- longer be UUID or reference auth.users. Existing users are imported into
-- Firebase with uid = their Supabase UUID (scripts/import-users-to-firebase.mjs),
-- so no row data changes here.

BEGIN;

-- ============================================
-- 1. Drop every policy that references user_id on the affected tables.
--    The live project has policies whose names drifted from the checked-in
--    schema, so discover them from pg_policies instead of dropping by name.
--    Service-role policies and the email-based subscriptions policy don't
--    mention user_id and therefore stay.
-- ============================================

DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN (
              'connected_accounts', 'posts', 'subscriptions', 'automation_rules',
              'dm_log', 'webhook_subscriptions', 'media_kits',
              'post_schedule_targets', 'purchases', 'leads'
          )
          AND (COALESCE(qual, '') LIKE '%user_id%' OR COALESCE(with_check, '') LIKE '%user_id%')
    LOOP
        EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, pol.tablename);
        RAISE NOTICE 'Dropped policy % on %', pol.policyname, pol.tablename;
    END LOOP;
END $$;

-- ============================================
-- 2. Drop FKs to auth.users and convert user_id columns to TEXT.
-- ============================================

ALTER TABLE connected_accounts
    DROP CONSTRAINT IF EXISTS connected_accounts_user_id_fkey;
ALTER TABLE connected_accounts
    ALTER COLUMN user_id TYPE TEXT USING user_id::text;

ALTER TABLE posts
    DROP CONSTRAINT IF EXISTS posts_user_id_fkey;
ALTER TABLE posts
    ALTER COLUMN user_id TYPE TEXT USING user_id::text;

ALTER TABLE subscriptions
    DROP CONSTRAINT IF EXISTS subscriptions_user_id_fkey;
ALTER TABLE subscriptions
    ALTER COLUMN user_id TYPE TEXT USING user_id::text;

ALTER TABLE automation_rules
    DROP CONSTRAINT IF EXISTS automation_rules_user_id_fkey;
ALTER TABLE automation_rules
    ALTER COLUMN user_id TYPE TEXT USING user_id::text;

ALTER TABLE dm_log
    DROP CONSTRAINT IF EXISTS dm_log_user_id_fkey;
ALTER TABLE dm_log
    ALTER COLUMN user_id TYPE TEXT USING user_id::text;

ALTER TABLE webhook_subscriptions
    DROP CONSTRAINT IF EXISTS webhook_subscriptions_user_id_fkey;
ALTER TABLE webhook_subscriptions
    ALTER COLUMN user_id TYPE TEXT USING user_id::text;

ALTER TABLE media_kits
    DROP CONSTRAINT IF EXISTS media_kits_user_id_fkey;
ALTER TABLE media_kits
    ALTER COLUMN user_id TYPE TEXT USING user_id::text;

ALTER TABLE post_schedule_targets
    DROP CONSTRAINT IF EXISTS post_schedule_targets_user_id_fkey;
ALTER TABLE post_schedule_targets
    ALTER COLUMN user_id TYPE TEXT USING user_id::text;

-- purchases was created outside the checked-in schema; convert it only if it
-- still has a UUID user_id (it may already be TEXT — webhook.js writes 'guest').
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'purchases'
          AND column_name = 'user_id' AND data_type = 'uuid'
    ) THEN
        ALTER TABLE purchases DROP CONSTRAINT IF EXISTS purchases_user_id_fkey;
        ALTER TABLE purchases ALTER COLUMN user_id TYPE TEXT USING user_id::text;
    END IF;
END $$;

-- ============================================
-- 3. Recreate user policies keyed on the JWT sub claim. Valid for both
--    Supabase tokens (sub = auth.users UUID) and Firebase tokens (sub = uid).
--    The anon key has no sub claim, so unauthenticated access stays blocked.
-- ============================================

CREATE POLICY "Users can view own connected accounts" ON connected_accounts
    FOR SELECT USING ((select auth.jwt()->>'sub') = user_id);
CREATE POLICY "Users can insert own connected accounts" ON connected_accounts
    FOR INSERT WITH CHECK ((select auth.jwt()->>'sub') = user_id);
CREATE POLICY "Users can update own connected accounts" ON connected_accounts
    FOR UPDATE USING ((select auth.jwt()->>'sub') = user_id);
CREATE POLICY "Users can delete own connected accounts" ON connected_accounts
    FOR DELETE USING ((select auth.jwt()->>'sub') = user_id);

CREATE POLICY "Users can view own posts" ON posts
    FOR SELECT USING ((select auth.jwt()->>'sub') = user_id);
CREATE POLICY "Users can insert own posts" ON posts
    FOR INSERT WITH CHECK ((select auth.jwt()->>'sub') = user_id);
CREATE POLICY "Users can update own posts" ON posts
    FOR UPDATE USING ((select auth.jwt()->>'sub') = user_id);
CREATE POLICY "Users can delete own posts" ON posts
    FOR DELETE USING ((select auth.jwt()->>'sub') = user_id);

CREATE POLICY "Users can view own automation rules" ON automation_rules
    FOR SELECT USING ((select auth.jwt()->>'sub') = user_id);
CREATE POLICY "Users can insert own automation rules" ON automation_rules
    FOR INSERT WITH CHECK ((select auth.jwt()->>'sub') = user_id);
CREATE POLICY "Users can update own automation rules" ON automation_rules
    FOR UPDATE USING ((select auth.jwt()->>'sub') = user_id);
CREATE POLICY "Users can delete own automation rules" ON automation_rules
    FOR DELETE USING ((select auth.jwt()->>'sub') = user_id);

CREATE POLICY "Users can view own dm log" ON dm_log
    FOR SELECT USING ((select auth.jwt()->>'sub') = user_id);

CREATE POLICY "Users can view own webhook subscriptions" ON webhook_subscriptions
    FOR SELECT USING ((select auth.jwt()->>'sub') = user_id);
CREATE POLICY "Users can manage own webhook subscriptions" ON webhook_subscriptions
    FOR ALL USING ((select auth.jwt()->>'sub') = user_id);

CREATE POLICY "Users can manage own kit" ON media_kits
    FOR ALL USING ((select auth.jwt()->>'sub') = user_id);

CREATE POLICY "Users can view own post schedule targets" ON post_schedule_targets
    FOR SELECT USING ((select auth.jwt()->>'sub') = user_id);

-- ============================================
-- 4. Functions that took a UUID user id now take TEXT.
-- ============================================

DROP FUNCTION IF EXISTS check_dm_rate_limit(UUID);

CREATE OR REPLACE FUNCTION check_dm_rate_limit(p_user_id TEXT)
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

DROP FUNCTION IF EXISTS reserve_post_schedule(UUID, UUID, DATE, TEXT, TEXT);

CREATE OR REPLACE FUNCTION reserve_post_schedule(
    p_post_id UUID,
    p_user_id TEXT,
    p_local_date DATE,
    p_period TEXT,
    p_timezone TEXT
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_post posts%ROWTYPE;
    v_target TEXT;
    v_platform TEXT;
    v_account_id UUID;
    v_scheduled_at TIMESTAMPTZ;
    v_hour INTEGER;
BEGIN
    IF p_period NOT IN ('am', 'pm') THEN
        RAISE EXCEPTION '[SCHEDULE_INVALID] Period must be am or pm';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_timezone) THEN
        RAISE EXCEPTION '[SCHEDULE_INVALID] Unknown timezone';
    END IF;

    -- Initial defaults: 9:00 AM and 5:00 PM in the user's timezone.
    -- scheduled_at remains an exact instant, so these defaults can become
    -- user-configurable later without changing the worker or table design.
    v_hour := CASE WHEN p_period = 'am' THEN 9 ELSE 17 END;
    v_scheduled_at := make_timestamptz(
        EXTRACT(YEAR FROM p_local_date)::INTEGER,
        EXTRACT(MONTH FROM p_local_date)::INTEGER,
        EXTRACT(DAY FROM p_local_date)::INTEGER,
        v_hour, 0, 0, p_timezone
    );

    IF v_scheduled_at <= NOW() + INTERVAL '5 minutes' THEN
        RAISE EXCEPTION '[SCHEDULE_PAST] That scheduling window has already passed';
    END IF;

    SELECT * INTO v_post
    FROM posts
    WHERE id = p_post_id
    FOR UPDATE;

    IF NOT FOUND OR v_post.user_id IS DISTINCT FROM p_user_id THEN
        RAISE EXCEPTION '[SCHEDULE_NOT_FOUND] Post not found';
    END IF;

    IF v_post.status <> 'draft' THEN
        RAISE EXCEPTION '[SCHEDULE_INVALID] Only a draft can be scheduled';
    END IF;

    IF COALESCE(array_length(v_post.platforms, 1), 0) = 0 THEN
        RAISE EXCEPTION '[SCHEDULE_INVALID] Select at least one account';
    END IF;

    FOREACH v_target IN ARRAY v_post.platforms LOOP
        IF v_target !~ '^[a-z]+:[0-9a-fA-F-]{36}$' THEN
            RAISE EXCEPTION '[SCHEDULE_INVALID] Every scheduled target must identify an account';
        END IF;

        v_platform := split_part(v_target, ':', 1);
        v_account_id := split_part(v_target, ':', 2)::UUID;

        IF NOT EXISTS (
            SELECT 1 FROM connected_accounts
            WHERE id = v_account_id
              AND user_id = p_user_id
              AND platform = v_platform
        ) THEN
            RAISE EXCEPTION '[SCHEDULE_INVALID] A selected account is not connected';
        END IF;

        BEGIN
            INSERT INTO post_schedule_targets (
                post_id, account_id, user_id, local_date, period, timezone, scheduled_at
            ) VALUES (
                p_post_id, v_account_id, p_user_id, p_local_date, p_period, p_timezone, v_scheduled_at
            );
        EXCEPTION WHEN unique_violation THEN
            RAISE EXCEPTION '[SCHEDULE_CONFLICT] One selected account already has a % post on %',
                upper(p_period), p_local_date;
        END;
    END LOOP;

    UPDATE posts
    SET status = 'scheduled',
        scheduled_at = v_scheduled_at,
        metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object(
            'schedule_period', p_period,
            'schedule_local_date', p_local_date::TEXT,
            'schedule_timezone', p_timezone
        ),
        updated_at = NOW()
    WHERE id = p_post_id;

    RETURN v_scheduled_at;
END;
$$;

REVOKE ALL ON FUNCTION reserve_post_schedule(UUID, TEXT, DATE, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reserve_post_schedule(UUID, TEXT, DATE, TEXT, TEXT) TO service_role;

-- ============================================
-- 5. Legacy 'videos' storage policies compare auth.uid()::text and would error
--    under Firebase tokens. Uploads go through Cloudflare R2 now, so drop the
--    per-user policies (discovered by expression, names may have drifted) and
--    keep public read.
-- ============================================

DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND (COALESCE(qual, '') LIKE '%videos%' OR COALESCE(with_check, '') LIKE '%videos%')
          AND (COALESCE(qual, '') LIKE '%auth.uid()%' OR COALESCE(with_check, '') LIKE '%auth.uid()%')
    LOOP
        EXECUTE format('DROP POLICY %I ON storage.objects', pol.policyname);
        RAISE NOTICE 'Dropped storage policy %', pol.policyname;
    END LOOP;
END $$;

COMMIT;
