const { createClient } = require('@supabase/supabase-js');
const { verifyToken } = require('../_firebase');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Verify authentication
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const token = authHeader.replace('Bearer ', '');
    const user = await verifyToken(token);
    if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const userId = user.id;

    console.log('[RefreshAccounts] Refreshing for user:', userId);

    // Get connected accounts
    const { data: accounts, error: fetchError } = await supabase
        .from('connected_accounts')
        .select('*')
        .eq('user_id', userId);

    if (fetchError || !accounts) {
        return res.status(500).json({ error: 'Failed to fetch accounts' });
    }

    const updatedAccounts = [];

    for (const account of accounts) {
        try {
            let updatedMetadata = { ...account.metadata };
            let tokenPatch = {};

            switch (account.platform) {
                case 'linkedin':
                    updatedMetadata = await refreshLinkedIn(account, updatedMetadata);
                    break;
                // case 'instagram':
                //     updatedMetadata = await refreshInstagram(account, updatedMetadata);
                //     break;
                case 'tiktok':
                    updatedMetadata = await refreshTikTok(account, updatedMetadata);
                    break;
                case 'twitter':
                    updatedMetadata = await refreshTwitter(account, updatedMetadata);
                    break;
                case 'youtube':
                    ({ metadata: updatedMetadata, tokenPatch } = await refreshYouTube(account, updatedMetadata));
                    break;
                // case 'threads':
                //     updatedMetadata = await refreshThreads(account, updatedMetadata);
                //     break;
            }

            // Update in database
            const { data: updated, error: updateError } = await supabase
                .from('connected_accounts')
                .update({
                    ...tokenPatch,
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

    // Strip credentials before responding: the browser (and its localStorage
    // cache) only needs display data, never access/refresh tokens. Same shape
    // as LEXAYA_DATA.getConnectedAccounts so the frontend cache stays valid.
    const safeAccounts = updatedAccounts.map(({ id, platform, account_name, token_expires_at, metadata, created_at, refresh_token }) =>
        ({ id, platform, account_name, token_expires_at, metadata, created_at, has_refresh_token: Boolean(refresh_token) }));
    return res.status(200).json({ accounts: safeAccounts });
}

module.exports = handler;

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
        const scopes = new Set(account.scopes || []);
        const fields = ['open_id', 'union_id', 'avatar_url', 'display_name'];

        if (scopes.has('user.info.profile')) {
            fields.push('username', 'bio_description');
        }

        if (scopes.has('user.info.stats')) {
            fields.push('follower_count', 'following_count', 'likes_count', 'video_count');
        }

        // Fetch TikTok user info
        const userRes = await fetch(`https://open.tiktokapis.com/v2/user/info/?fields=${fields.join(',')}`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (userRes.ok) {
            const userData = await userRes.json();
            const user = userData.data?.user;
            if (user) {
                metadata.display_name = user.display_name || metadata.display_name;
                metadata.profile_picture = user.avatar_url || metadata.profile_picture;
                metadata.username = user.username || metadata.username;
                metadata.bio = user.bio_description || metadata.bio;
                if (scopes.has('user.info.stats')) {
                    metadata.followers_count = user.follower_count;
                    metadata.following_count = user.following_count;
                    metadata.likes_count = user.likes_count;
                    metadata.video_count = user.video_count;
                }

                console.log('[RefreshAccounts] TikTok refreshed:', scopes.has('user.info.stats') ? `${user.follower_count} followers` : 'basic profile');
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

async function refreshYouTube(account, metadata) {
    let accessToken = account.access_token;
    const channelId = account.platform_user_id;
    const tokenPatch = {};
    if (!accessToken || !channelId) return { metadata, tokenPatch };

    try {
        const tokenExpiresAt = new Date(account.token_expires_at).getTime();
        const shouldRefreshToken = !Number.isFinite(tokenExpiresAt) || tokenExpiresAt <= Date.now() + (5 * 60 * 1000);

        if (shouldRefreshToken && account.refresh_token) {
            const refreshed = await refreshYouTubeAccessToken(account.refresh_token);
            accessToken = refreshed.access_token;
            tokenPatch.access_token = refreshed.access_token;
            tokenPatch.token_expires_at = new Date(Date.now() + (Number(refreshed.expires_in) * 1000)).toISOString();
        }

        // Fetch YouTube channel info
        let channelRes = await fetch(
            `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelId}`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );

        if (channelRes.status === 401 && account.refresh_token && !tokenPatch.access_token) {
            const refreshed = await refreshYouTubeAccessToken(account.refresh_token);
            accessToken = refreshed.access_token;
            tokenPatch.access_token = refreshed.access_token;
            tokenPatch.token_expires_at = new Date(Date.now() + (Number(refreshed.expires_in) * 1000)).toISOString();
            channelRes = await fetch(
                `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelId}`,
                { headers: { 'Authorization': `Bearer ${accessToken}` } }
            );
        }

        if (channelRes.ok) {
            const channelData = await channelRes.json();
            const channel = channelData.items?.[0];
            if (channel) {
                metadata.channel_title = channel.snippet.title || metadata.channel_title;
                metadata.display_name = channel.snippet.title || metadata.display_name;
                metadata.profile_picture = channel.snippet.thumbnails?.default?.url || metadata.profile_picture;
                metadata.subscribers_count = parseInt(channel.statistics?.subscriberCount) || 0;
                metadata.video_count = parseInt(channel.statistics?.videoCount) || 0;
                metadata.view_count = parseInt(channel.statistics?.viewCount) || 0;

                console.log('[RefreshAccounts] YouTube refreshed:', metadata.subscribers_count, 'subscribers');
            }
        } else {
            const errorText = await channelRes.text();
            console.log('[RefreshAccounts] YouTube refresh failed:', channelRes.status, errorText.slice(0, 300));
        }
    } catch (err) {
        console.log('[RefreshAccounts] YouTube error:', err.message);
    }

    return { metadata, tokenPatch };
}

async function refreshYouTubeAccessToken(refreshToken) {
    const clientId = process.env.YOUTUBE_CLIENT_ID?.trim();
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET?.trim();

    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error('YouTube token refresh is not configured');
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
        }),
    });

    const responseText = await response.text();
    let data;
    try {
        data = responseText ? JSON.parse(responseText) : {};
    } catch (err) {
        throw new Error('YouTube token refresh returned invalid JSON');
    }

    if (!response.ok || !data.access_token || !Number.isFinite(Number(data.expires_in))) {
        const errorCode = data.error || `HTTP_${response.status}`;
        if (['invalid_grant', 'invalid_request', 'unauthorized_client'].includes(errorCode)) {
            throw new Error('YouTube token expired. Please reconnect your YouTube account.');
        }
        throw new Error(data.error_description || data.error || 'YouTube token refresh failed');
    }

    return data;
}

async function refreshThreads(account, metadata) {
    const accessToken = account.access_token;
    if (!accessToken) return metadata;

    try {
        // Fetch Threads follower count via insights API
        const insightsRes = await fetch(
            `https://graph.threads.net/v1.0/me/threads_insights?metric=followers_count&access_token=${accessToken}`
        );

        if (insightsRes.ok) {
            const insightsData = await insightsRes.json();
            const followersMetric = insightsData.data?.find(m => m.name === 'followers_count');
            if (followersMetric?.total_value?.value) {
                metadata.followers_count = followersMetric.total_value.value;
                console.log('[RefreshAccounts] Threads refreshed:', metadata.followers_count, 'followers');
            }
        }

        // Also try to get profile info
        const profileRes = await fetch(
            `https://graph.threads.net/v1.0/me?fields=id,username,threads_profile_picture_url,threads_biography&access_token=${accessToken}`
        );

        if (profileRes.ok) {
            const profileData = await profileRes.json();
            metadata.username = profileData.username || metadata.username;
            metadata.display_name = profileData.username || metadata.display_name;
            metadata.profile_picture = profileData.threads_profile_picture_url || metadata.profile_picture;
            metadata.bio = profileData.threads_biography || metadata.bio;
        }
    } catch (err) {
        console.log('[RefreshAccounts] Threads error:', err.message);
    }

    return metadata;
}
