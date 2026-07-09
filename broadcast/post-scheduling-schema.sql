-- AM/PM post scheduling with an atomic two-posts-per-account/day limit.
-- Run this once in the Supabase SQL Editor after database.sql and
-- multi-account-migration.sql.

CREATE TABLE IF NOT EXISTS post_schedule_targets (
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    local_date DATE NOT NULL,
    period TEXT NOT NULL CHECK (period IN ('am', 'pm')),
    timezone TEXT NOT NULL,
    scheduled_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (post_id, account_id),
    UNIQUE (account_id, local_date, period)
);

CREATE INDEX IF NOT EXISTS idx_post_schedule_targets_user_date
    ON post_schedule_targets(user_id, local_date);

CREATE INDEX IF NOT EXISTS idx_post_schedule_targets_scheduled_at
    ON post_schedule_targets(scheduled_at);

ALTER TABLE post_schedule_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own post schedule targets" ON post_schedule_targets
    FOR SELECT USING ((select auth.jwt()->>'sub') = user_id);

CREATE POLICY "Service role full access to post schedule targets" ON post_schedule_targets
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- The service calls this function after creating a draft post. All account
-- reservations and the post status change happen in one transaction.
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
