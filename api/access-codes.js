// Admin management of access codes.
//
// GET   /api/access-codes            -> list every code with its usage
// POST  /api/access-codes            -> create a code { tier, code?, max_uses?, expires_at? }
// PATCH /api/access-codes            -> enable/disable a code { code, active }
//
// Admin-only (server-side ADMIN_EMAILS). Users redeem via /api/redeem.

const getClient = require('./_supabase');
const { verifyToken } = require('./_firebase');
const { isAdminEmail } = require('./_admin');

function getSupabase() {
    return getClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function normalizeCode(input) {
    return String(input || '').trim().toUpperCase().replace(/\s+/g, '');
}

// Readable random code, e.g. "LEXAYA-7QK2P9". No look-alike chars (0/O, 1/I).
function generateCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let suffix = '';
    for (let i = 0; i < 6; i++) suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
    return `LEXAYA-${suffix}`;
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const authHeader = req.headers.authorization || '';
    const user = authHeader.startsWith('Bearer ')
        ? await verifyToken(authHeader.slice('Bearer '.length))
        : null;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (!isAdminEmail(user.email)) return res.status(403).json({ error: 'Forbidden' });

    const supabase = getSupabase();

    if (req.method === 'GET') {
        const { data, error } = await supabase
            .from('access_codes')
            .select('code, tier, max_uses, uses, expires_at, active, created_at')
            .order('created_at', { ascending: false });
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ codes: data || [] });
    }

    if (req.method === 'POST') {
        const tier = String(req.body?.tier || '');
        if (!['dm', 'pro'].includes(tier)) {
            return res.status(400).json({ error: 'tier must be dm or pro' });
        }

        const code = normalizeCode(req.body?.code) || generateCode();

        // max_uses: a positive integer, or null for unlimited.
        let maxUses = null;
        if (req.body?.max_uses != null && req.body.max_uses !== '') {
            maxUses = parseInt(req.body.max_uses, 10);
            if (!Number.isInteger(maxUses) || maxUses < 1) {
                return res.status(400).json({ error: 'max_uses must be a positive whole number' });
            }
        }

        let expiresAt = null;
        if (req.body?.expires_at) {
            const parsed = new Date(req.body.expires_at);
            if (isNaN(parsed.getTime())) return res.status(400).json({ error: 'expires_at is not a valid date' });
            expiresAt = parsed.toISOString();
        }

        const { data, error } = await supabase
            .from('access_codes')
            .insert([{
                code,
                tier,
                max_uses: maxUses,
                expires_at: expiresAt,
                created_by: user.email,
            }])
            .select('code, tier, max_uses, uses, expires_at, active, created_at')
            .single();

        if (error) {
            if (error.code === '23505') return res.status(409).json({ error: 'That code already exists' });
            return res.status(500).json({ error: error.message });
        }

        console.log('[AccessCodes] created', code, tier, 'by', user.email);
        return res.status(200).json({ code: data });
    }

    if (req.method === 'PATCH') {
        const code = normalizeCode(req.body?.code);
        if (!code) return res.status(400).json({ error: 'code is required' });
        if (typeof req.body?.active !== 'boolean') {
            return res.status(400).json({ error: 'active must be true or false' });
        }

        const { data, error } = await supabase
            .from('access_codes')
            .update({ active: req.body.active })
            .eq('code', code)
            .select('code, tier, max_uses, uses, expires_at, active, created_at')
            .maybeSingle();

        if (error) return res.status(500).json({ error: error.message });
        if (!data) return res.status(404).json({ error: 'Code not found' });
        return res.status(200).json({ code: data });
    }

    return res.status(405).json({ error: 'Method not allowed' });
};
