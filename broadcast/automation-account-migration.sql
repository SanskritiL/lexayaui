-- Apply once to scope automation rules to a specific connected Instagram account.
-- Users with more than one connected account need each rule to name the account
-- whose comments it answers, otherwise a rule fires for every account they own.
ALTER TABLE automation_rules
    ADD COLUMN IF NOT EXISTS connected_account_id UUID REFERENCES connected_accounts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_automation_rules_connected_account
    ON automation_rules(connected_account_id);

-- Backfill single-account users; rules belonging to multi-account users stay
-- NULL and keep the old "any account" behaviour until they are edited.
UPDATE automation_rules AS r
SET connected_account_id = a.id
FROM (
    SELECT user_id, MIN(id::text)::uuid AS id
    FROM connected_accounts
    WHERE platform = 'instagram'
    GROUP BY user_id
    HAVING COUNT(*) = 1
) AS a
WHERE r.connected_account_id IS NULL
  AND r.user_id = a.user_id;
