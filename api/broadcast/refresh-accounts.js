import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Get user from auth header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
        return res.status(401).json({ error: 'Invalid token' });
    }

    console.log('[RefreshAccounts] Refreshing for user:', user.id);

    // Get connected accounts
    const { data: accounts, error: fetchError } = await supabase
        .from('connected_accounts')
        .select('*')
        .eq('user_id', user.id);

    if (fetchError || !accounts) {
        return res.status(500).json({ error: 'Failed to fetch accounts' });
    }

    const updatedAccounts = [];

    for (const account of accounts) {
        try {
            let updatedMetadata = { ...account.metadata };

            switch (account.platform) {
                case 'linkedin':
                    updatedMetadata = await refreshLinkedIn(account, updatedMetadata);
                    break;
                case 'instagram':
                    updatedMetadata = await refreshInstagram(account, updatedMetadata);
                    break;
                case 'tiktok':
                    updatedMetadata = await refreshTikTok(account, updatedMetadata);
                    break;
                case 'twitter':
                    updatedMetadata = await refreshTwitter(account, updatedMetadata);
                    break;
            }

            // Update in database
            const { data: updated, error: updateError } = await supabase
                .from('connected_accounts')
                .update({
                    metadata: updatedMetadata,
                    updated_at: new Date().toISOString()
                })
                .eq('id', account.id)
                .select()
                .single();

            if (!updateError && updated) {
                updatedAccounts.push(updated);
            } else {
                updatedAccounts.push({ ...account, metadata: updatedMetadata });
            }

        } catch (err) {
            console.log(`[RefreshAccounts] Error refreshing ${account.platform}:`, err.message);
            updatedAccounts.push(account);
        }
    }

    return res.status(200).json({ accounts: updatedAccounts });
}

async function refreshLinkedIn(account, metadata) {
    const accessToken = account.access_token;
    if (!accessToken) return metadata;

    try {
        // Fetch profile info
        const profileRes = await fetch('https://api.linkedin.com/v2/userinfo', {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (profileRes.ok) {
            const profile = await profileRes.json();
            metadata.display_name = profile.name || metadata.display_name;
            metadata.profile_picture = profile.picture || metadata.profile_picture;
            metadata.email = profile.email || metadata.email;
        }

        // LinkedIn doesn't provide follower count via basic API
        // Would need Marketing API for company page followers

        console.log('[RefreshAccounts] LinkedIn refreshed');
    } catch (err) {
        console.log('[RefreshAccounts] LinkedIn error:', err.message);
    }

    return metadata;
}

async function refreshInstagram(account, metadata) {
    const accessToken = account.access_token;
    const igUserId = account.platform_user_id;
    if (!accessToken || !igUserId) return metadata;

    try {
        // Fetch Instagram account info with follower count
        const igRes = await fetch(
            `https://graph.facebook.com/v18.0/${igUserId}?fields=id,username,name,profile_picture_url,followers_count,follows_count,media_count&access_token=${accessToken}`
        );

        if (igRes.ok) {
            const igData = await igRes.json();
            metadata.username = igData.username || metadata.username;
            metadata.display_name = igData.name || metadata.display_name;
            metadata.profile_picture = igData.profile_picture_url || metadata.profile_picture;
            metadata.followers_count = igData.followers_count;
            metadata.following_count = igData.follows_count;
            metadata.media_count = igData.media_count;

            console.log('[RefreshAccounts] Instagram refreshed:', igData.followers_count, 'followers');
        }
    } catch (err) {
        console.log('[RefreshAccounts] Instagram error:', err.message);
    }

    return metadata;
}

async function refreshTikTok(account, metadata) {
    const accessToken = account.access_token;
    if (!accessToken) return metadata;

    try {
        // Fetch TikTok user info
        const userRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,follower_count,following_count,likes_count,video_count', {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (userRes.ok) {
            const userData = await userRes.json();
            const user = userData.data?.user;
            if (user) {
                metadata.display_name = user.display_name || metadata.display_name;
                metadata.profile_picture = user.avatar_url || metadata.profile_picture;
                metadata.followers_count = user.follower_count;
                metadata.following_count = user.following_count;
                metadata.likes_count = user.likes_count;
                metadata.video_count = user.video_count;

                console.log('[RefreshAccounts] TikTok refreshed:', user.follower_count, 'followers');
            }
        }
    } catch (err) {
        console.log('[RefreshAccounts] TikTok error:', err.message);
    }

    return metadata;
}

async function refreshTwitter(account, metadata) {
    const accessToken = account.access_token;
    if (!accessToken) return metadata;

    try {
        // Fetch Twitter user info
        const userRes = await fetch('https://api.twitter.com/2/users/me?user.fields=profile_image_url,public_metrics,description,verified', {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (userRes.ok) {
            const userData = await userRes.json();
            const user = userData.data;
            if (user) {
                metadata.display_name = user.name || metadata.display_name;
                metadata.profile_picture = user.profile_image_url?.replace('_normal', '') || metadata.profile_picture;
                metadata.followers_count = user.public_metrics?.followers_count;
                metadata.following_count = user.public_metrics?.following_count;
                metadata.tweet_count = user.public_metrics?.tweet_count;
                metadata.verified = user.verified;
                metadata.bio = user.description;

                console.log('[RefreshAccounts] Twitter refreshed:', user.public_metrics?.followers_count, 'followers');
            }
        }
    } catch (err) {
        console.log('[RefreshAccounts] Twitter error:', err.message);
    }

    return metadata;
}
