-- Run once if automation-schema.sql was applied before webhook idempotency was added.
-- The unique index lets the webhook claim a comment before sending a DM, making
-- concurrent and retried Meta deliveries safe.

CREATE UNIQUE INDEX IF NOT EXISTS idx_dm_log_rule_comment_unique
    ON dm_log(automation_rule_id, ig_comment_id);

ALTER TABLE dm_log
    ALTER COLUMN dm_status SET DEFAULT 'pending',
    ALTER COLUMN dm_sent_at DROP DEFAULT;
