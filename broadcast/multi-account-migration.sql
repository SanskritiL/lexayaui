-- Enable multiple connected accounts per provider.
-- Run this once in Supabase SQL Editor before deploying the multi-account UI/API changes.

ALTER TABLE connected_accounts
    DROP CONSTRAINT IF EXISTS connected_accounts_user_id_platform_key;

DO $$
DECLARE
    constraint_record RECORD;
    index_record RECORD;
BEGIN
    -- Older installs may have the one-account-per-platform constraint under a
    -- different generated name. Remove any unique constraint/index whose only
    -- columns are user_id and platform.
    FOR constraint_record IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE rel.relname = 'connected_accounts'
            AND nsp.nspname = 'public'
            AND con.contype = 'u'
            AND (
                SELECT array_agg(att.attname::text ORDER BY cols.ordinality)
                FROM unnest(con.conkey) WITH ORDINALITY AS cols(attnum, ordinality)
                JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = cols.attnum
            ) = ARRAY['user_id', 'platform']
    LOOP
        EXECUTE format('ALTER TABLE public.connected_accounts DROP CONSTRAINT IF EXISTS %I', constraint_record.conname);
    END LOOP;

    FOR index_record IN
        SELECT idx.relname
        FROM pg_index ind
        JOIN pg_class idx ON idx.oid = ind.indexrelid
        JOIN pg_class rel ON rel.oid = ind.indrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE rel.relname = 'connected_accounts'
            AND nsp.nspname = 'public'
            AND ind.indisunique
            AND NOT EXISTS (
                SELECT 1
                FROM pg_constraint con
                WHERE con.conindid = ind.indexrelid
            )
            AND (
                SELECT array_agg(att.attname::text ORDER BY cols.ordinality)
                FROM unnest(ind.indkey::int2[]) WITH ORDINALITY AS cols(attnum, ordinality)
                JOIN pg_attribute att ON att.attrelid = ind.indrelid AND att.attnum = cols.attnum
            ) = ARRAY['user_id', 'platform']
    LOOP
        EXECUTE format('DROP INDEX IF EXISTS public.%I', index_record.relname);
    END LOOP;
END $$;

ALTER TABLE connected_accounts
    DROP CONSTRAINT IF EXISTS connected_accounts_platform_check;

ALTER TABLE connected_accounts
    ADD CONSTRAINT connected_accounts_platform_check
    CHECK (platform IN ('tiktok', 'instagram', 'linkedin', 'twitter', 'threads', 'youtube'));

CREATE UNIQUE INDEX IF NOT EXISTS connected_accounts_user_platform_provider_uidx
    ON connected_accounts(user_id, platform, platform_user_id)
    WHERE platform_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_connected_accounts_user_platform
    ON connected_accounts(user_id, platform);
