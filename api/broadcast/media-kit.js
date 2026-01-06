import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Handle public view (GET with token query param)
    if (req.method === 'GET' && req.query.token) {
        return handlePublicView(req, res, supabase);
    }

    // All other operations require auth
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
        return res.status(401).json({ error: 'Invalid token' });
    }

    switch (req.method) {
        case 'GET':
            return handleGetOwn(req, res, supabase, user);
        case 'PUT':
            return handleUpdate(req, res, supabase, user);
        case 'POST':
            if (req.query.action === 'regenerate-token') {
                return handleRegenerateToken(req, res, supabase, user);
            }
            return res.status(400).json({ error: 'Invalid action' });
        default:
            return res.status(405).json({ error: 'Method not allowed' });
    }
}

// Public view - fetch kit by share token
async function handlePublicView(req, res, supabase) {
    const { token } = req.query;

    console.log('[MediaKit] Public view for token:', token);

    // Get the media kit
    const { data: kit, error: kitError } = await supabase
        .from('media_kits')
        .select('*')
        .eq('share_token', token)
        .single();

    if (kitError || !kit) {
        console.log('[MediaKit] Kit not found:', kitError?.message);
        return res.status(404).json({ error: 'Media kit not found' });
    }

    // Get connected accounts for follower data
    const { data: accounts } = await supabase
        .from('connected_accounts')
        .select('platform, account_name, metadata')
        .eq('user_id', kit.user_id);

    // Build platforms array with manual overrides
    const manualFollowers = kit.manual_followers || {};
    const manualUsernames = kit.manual_usernames || {};

    // All supported platforms
    const allPlatformNames = ['instagram', 'tiktok', 'linkedin', 'youtube', 'threads'];

    const platforms = allPlatformNames.map(platformName => {
        const acc = (accounts || []).find(a => a.platform === platformName);
        const apiFollowers = acc?.metadata?.followers_count || acc?.metadata?.subscribers_count || 0;
        const manualCount = manualFollowers[platformName];
        const followers = manualCount !== undefined ? manualCount : apiFollowers;

        // Get username: manual > connected account > null
        const username = manualUsernames[platformName] ||
                        acc?.account_name ||
                        acc?.metadata?.username ||
                        acc?.metadata?.display_name ||
                        null;

        return {
            name: platformName,
            username,
            followers,
            profile_picture: acc?.metadata?.profile_picture || acc?.metadata?.avatar_url || null
        };
    }).filter(p => p.followers > 0);

    return res.status(200).json({
        display_name: kit.display_name || 'Creator',
        tagline: kit.tagline || 'UGC Creator',
        brands: kit.brands || [],
        platforms
    });
}

// Get user's own kit (or create if doesn't exist)
async function handleGetOwn(req, res, supabase, user) {
    console.log('[MediaKit] Fetching kit for user:', user.id);

    // Try to get existing kit
    let { data: kit, error: kitError } = await supabase
        .from('media_kits')
        .select('*')
        .eq('user_id', user.id)
        .single();

    // If no kit exists, create one with defaults
    if (kitError && kitError.code === 'PGRST116') {
        // Get first connected account for default name
        const { data: accounts } = await supabase
            .from('connected_accounts')
            .select('account_name, metadata')
            .eq('user_id', user.id)
            .limit(1);

        const defaultName = accounts?.[0]?.metadata?.display_name ||
                           accounts?.[0]?.account_name ||
                           user.email?.split('@')[0] ||
                           'Creator';

        const { data: newKit, error: createError } = await supabase
            .from('media_kits')
            .insert({
                user_id: user.id,
                display_name: defaultName,
                tagline: 'UGC Creator',
                brands: [
                    { name: 'Claude', domain: 'anthropic.com' },
                    { name: 'Replit', domain: 'replit.com' },
                    { name: 'Lovable', domain: 'lovable.dev' },
                    { name: 'Emergent', domain: 'emergentgames.com' },
                    { name: 'Groupon', domain: 'groupon.com' },
                    { name: 'Vmake', domain: 'vmake.ai' },
                    { name: 'Trae', domain: 'trae.ai' }
                ],
                manual_followers: {}
            })
            .select()
            .single();

        if (createError) {
            console.log('[MediaKit] Error creating kit:', createError.message);
            return res.status(500).json({ error: 'Failed to create media kit' });
        }

        kit = newKit;
        console.log('[MediaKit] Created new kit:', kit.share_token);
    } else if (kitError) {
        console.log('[MediaKit] Error fetching kit:', kitError.message);
        return res.status(500).json({ error: 'Failed to fetch media kit' });
    }

    // Get connected accounts
    const { data: accounts } = await supabase
        .from('connected_accounts')
        .select('platform, account_name, metadata')
        .eq('user_id', user.id);

    // Build platforms with API data + manual overrides
    const manualFollowers = kit.manual_followers || {};
    const platforms = (accounts || []).map(acc => ({
        name: acc.platform,
        username: acc.account_name || acc.metadata?.username || acc.metadata?.display_name,
        followers_api: acc.metadata?.followers_count || acc.metadata?.subscribers_count || 0,
        followers_manual: manualFollowers[acc.platform],
        profile_picture: acc.metadata?.profile_picture || acc.metadata?.avatar_url
    }));

    return res.status(200).json({
        ...kit,
        platforms
    });
}

// Update kit
async function handleUpdate(req, res, supabase, user) {
    const { display_name, tagline, brands, manual_followers, manual_usernames } = req.body;

    console.log('[MediaKit] Updating kit for user:', user.id);

    const updates = {};
    if (display_name !== undefined) updates.display_name = display_name;
    if (tagline !== undefined) updates.tagline = tagline;
    if (brands !== undefined) updates.brands = brands;
    if (manual_followers !== undefined) updates.manual_followers = manual_followers;
    if (manual_usernames !== undefined) updates.manual_usernames = manual_usernames;

    const { data: kit, error } = await supabase
        .from('media_kits')
        .update(updates)
        .eq('user_id', user.id)
        .select()
        .single();

    if (error) {
        console.log('[MediaKit] Error updating:', error.message);
        return res.status(500).json({ error: 'Failed to update' });
    }

    return res.status(200).json(kit);
}

// Regenerate share token
async function handleRegenerateToken(req, res, supabase, user) {
    console.log('[MediaKit] Regenerating token for user:', user.id);

    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let newToken = '';
    for (let i = 0; i < 10; i++) {
        newToken += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    const { data: kit, error } = await supabase
        .from('media_kits')
        .update({ share_token: newToken })
        .eq('user_id', user.id)
        .select()
        .single();

    if (error) {
        console.log('[MediaKit] Error regenerating token:', error.message);
        return res.status(500).json({ error: 'Failed to regenerate token' });
    }

    return res.status(200).json({ share_token: kit.share_token });
}
