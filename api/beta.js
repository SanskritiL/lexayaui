// Beta access requests.
//
// The Meta app is still in development mode, so Instagram OAuth only works for
// accounts added as testers in the Meta console. We collect the Instagram
// username at sign-up so they can be invited by hand.
//
// GET  /api/beta -> the signed-in user's request, or null
// POST /api/beta -> save/update their Instagram username

const getClient = require('./_supabase');
const { verifyToken } = require('./_firebase');
const { isAdminEmail } = require('./_admin');

function getSupabase() {
    return getClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// Instagram allows letters, numbers, periods and underscores, up to 30 chars.
// Accept a pasted @handle or profile URL and reduce it to the bare username.
function normalizeInstagramUsername(input) {
    let value = String(input || '').trim();
    const urlMatch = value.match(/instagram\.com\/([^/?#]+)/i);
    if (urlMatch) value = urlMatch[1];
    value = value.replace(/^@/, '').trim();
    if (!/^[A-Za-z0-9._]{1,30}$/.test(value)) return null;
    return value.toLowerCase();
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const authHeader = req.headers.authorization || '';
    const user = authHeader.startsWith('Bearer ')
        ? await verifyToken(authHeader.slice('Bearer '.length))
        : null;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const supabase = getSupabase();

    if (req.method === 'GET') {
        // Admins are already testers on their own app, so they never wait.
        if (isAdminEmail(user.email)) {
            return res.status(200).json({ request: { status: 'active', instagram_username: null } });
        }

        const { data, error } = await supabase
            .from('beta_requests')
            .select('instagram_username, status, created_at')
            .eq('user_id', user.id)
            .maybeSingle();

        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ request: data || null });
    }

    if (req.method === 'POST') {
        const instagramUsername = normalizeInstagramUsername(req.body?.instagram_username);
        if (!instagramUsername) {
            return res.status(400).json({
                error: 'Enter a valid Instagram username (letters, numbers, periods and underscores).',
            });
        }

        // Re-submitting replaces the username but never resets an approved
        // status back to pending.
        const { data, error } = await supabase
            .from('beta_requests')
            .upsert([{
                user_id: user.id,
                email: user.email,
                instagram_username: instagramUsername,
                updated_at: new Date().toISOString(),
            }], { onConflict: 'user_id' })
            .select('instagram_username, status')
            .single();

        if (error) return res.status(500).json({ error: error.message });

        console.log('[Beta] access requested:', user.email, '->', instagramUsername);
        return res.status(200).json({ request: data });
    }

    return res.status(405).json({ error: 'Method not allowed' });
};
