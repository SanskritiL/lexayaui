-- Access codes: hand out free access to a plan without Stripe.
--
-- Redeeming a code writes a normal 'active' row into subscriptions with no
-- Stripe ids, so every entitlement check (browser, api/_entitlements.js,
-- publish-service) honors it exactly like a paid plan, and the Stripe webhook
-- never touches it because it has no stripe_subscription_id.
--
-- Only the API (service role) reads or writes these tables; the browser never
-- sees a code it hasn't just typed in.

CREATE TABLE IF NOT EXISTS access_codes (
    code TEXT PRIMARY KEY,
    -- Which plan the code grants. Matches subscriptions.product_key.
    tier TEXT NOT NULL CHECK (tier IN ('dm', 'pro')),
    -- NULL means unlimited redemptions.
    max_uses INTEGER,
    uses INTEGER NOT NULL DEFAULT 0,
    -- NULL means it never expires.
    expires_at TIMESTAMPTZ,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- One row per (code, user): stops a person redeeming the same code twice and
-- gives an audit trail of who used what.
CREATE TABLE IF NOT EXISTS access_code_redemptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL REFERENCES access_codes(code) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    email TEXT NOT NULL,
    redeemed_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(code, user_id)
);

CREATE INDEX IF NOT EXISTS idx_code_redemptions_user ON access_code_redemptions(user_id);

ALTER TABLE access_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_code_redemptions ENABLE ROW LEVEL SECURITY;

-- Service role only. There is no browser-facing policy on purpose: the redeem
-- and admin endpoints do all reads and writes with the service key.
CREATE POLICY "Service role full access to access codes" ON access_codes
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access to code redemptions" ON access_code_redemptions
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
