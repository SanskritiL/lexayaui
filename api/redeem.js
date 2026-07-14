// Redeem an access code for free plan access.
//
// POST /api/redeem  { code }  (Firebase Bearer token required)
//
// A valid code writes an 'active' subscriptions row for the user's tier, with
// no Stripe ids. From then on every entitlement check treats them like a payer.

const getClient = require('./_supabase');
const { verifyToken } = require('./_firebase');

function getSupabase() {
    return getClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// Codes are case- and space-insensitive so "friends 2026" and "FRIENDS2026"
// are the same code. Stored and compared uppercase.
function normalizeCode(input) {
    return String(input || '').trim().toUpperCase().replace(/\s+/g, '');
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const authHeader = req.headers.authorization || '';
    const user = authHeader.startsWith('Bearer ')
        ? await verifyToken(authHeader.slice('Bearer '.length))
        : null;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const code = normalizeCode(req.body?.code);
    if (!code) return res.status(400).json({ error: 'Enter a code' });

    const supabase = getSupabase();

    const { data: codeRow, error: lookupError } = await supabase
        .from('access_codes')
        .select('code, tier, max_uses, uses, expires_at, active')
        .eq('code', code)
        .maybeSingle();

    if (lookupError) return res.status(500).json({ error: lookupError.message });

    // One generic "not valid" message for missing / disabled / expired / used
    // up, so a code can't be probed for which state it's in.
    const invalid = () => res.status(400).json({ error: "That code isn't valid." });
    if (!codeRow || !codeRow.active) return invalid();
    if (codeRow.expires_at && new Date(codeRow.expires_at) < new Date()) return invalid();
    if (codeRow.max_uses != null && codeRow.uses >= codeRow.max_uses) return invalid();

    // Already redeemed by this user? Treat as success — they already have the
    // access, no need to burn another use.
    const { data: existing } = await supabase
        .from('access_code_redemptions')
        .select('id')
        .eq('code', code)
        .eq('user_id', user.id)
        .maybeSingle();

    if (!existing) {
        const { error: redemptionError } = await supabase
            .from('access_code_redemptions')
            .insert([{ code, user_id: user.id, email: user.email }]);
        // A unique-violation means a concurrent request already recorded it;
        // fall through and make sure the subscription exists either way.
        if (redemptionError && redemptionError.code !== '23505') {
            return res.status(500).json({ error: redemptionError.message });
        }
        if (!redemptionError) {
            // Best-effort use counter. A comped plan is not worth a transaction;
            // the redemptions table is the real record of who got access.
            await supabase
                .from('access_codes')
                .update({ uses: (codeRow.uses || 0) + 1 })
                .eq('code', code);
        }
    }

    // Grant the plan. UNIQUE(customer_email, product_key) makes this idempotent
    // and re-activates a previously canceled row for the same plan.
    const { error: grantError } = await supabase
        .from('subscriptions')
        .upsert([{
            user_id: user.id,
            customer_email: user.email,
            product_key: codeRow.tier,
            status: 'active',
            updated_at: new Date().toISOString(),
        }], { onConflict: 'customer_email,product_key' });

    if (grantError) return res.status(500).json({ error: grantError.message });

    console.log('[Redeem]', user.email, 'redeemed', code, '->', codeRow.tier);
    return res.status(200).json({ tier: codeRow.tier });
};
