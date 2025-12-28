// TikTok OAuth Handler
// Uses TikTok Login Kit for authentication

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
    console.log('========== TIKTOK OAUTH START ==========');

    const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
    const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

    console.log('[ENV CHECK] TIKTOK_CLIENT_KEY:', TIKTOK_CLIENT_KEY ? `${TIKTOK_CLIENT_KEY.substring(0, 6)}...` : 'NOT SET');
    console.log('[ENV CHECK] TIKTOK_CLIENT_SECRET:', TIKTOK_CLIENT_SECRET ? 'SET' : 'NOT SET');

    const { code, state, error: oauthError, error_description } = req.query;

    const isLocalhost = req.headers.host?.includes('localhost');
    const baseUrl = isLocalhost ? `http://${req.headers.host}` : `https://${req.headers.host}`;
    const redirectUri = `${baseUrl}/api/broadcast/auth/tiktok`;

    console.log('[REQUEST INFO]', {
        hasCode: !!code,
        hasState: !!state,
        error: oauthError,
        host: req.headers.host,
        redirectUri,
    });

    // If no code, redirect to TikTok OAuth
    if (!code) {
        if (!TIKTOK_CLIENT_KEY) {
            console.log('[ERROR] TIKTOK_CLIENT_KEY not set!');
            return res.redirect('/broadcast/?error=' + encodeURIComponent('TikTok not configured. Set TIKTOK_CLIENT_KEY in Vercel env vars.'));
        }
        if (!TIKTOK_CLIENT_SECRET) {
            console.log('[ERROR] TIKTOK_CLIENT_SECRET not set!');
            return res.redirect('/broadcast/?error=' + encodeURIComponent('TikTok not configured. Set TIKTOK_CLIENT_SECRET in Vercel env vars.'));
        }

        // TikTok OAuth URL
        // Scopes: video.upload allows posting to drafts, video.publish for direct posting
        const scopes = 'user.info.basic,video.upload';
        const csrfState = state || '';

        const authUrl = new URL('https://www.tiktok.com/v2/auth/authorize/');
        authUrl.searchParams.set('client_key', TIKTOK_CLIENT_KEY);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', scopes);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('state', csrfState);

        console.log('[STEP 1] Redirecting to TikTok OAuth:', authUrl.toString());
        return res.redirect(authUrl.toString());
    }

    // Handle OAuth error
    if (oauthError) {
        const errorMsg = error_description || oauthError;
        console.log('[ERROR] OAuth error from TikTok:', errorMsg);
        return res.redirect(`/broadcast/?error=${encodeURIComponent(errorMsg)}`);
    }

    try {
        // Exchange code for access token
        console.log('[STEP 2] Exchanging code for token...');
        const tokenResponse = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                client_key: TIKTOK_CLIENT_KEY,
                client_secret: TIKTOK_CLIENT_SECRET,
                code,
                grant_type: 'authorization_code',
                redirect_uri: redirectUri,
            }),
        });

        console.log('[STEP 2] Token response status:', tokenResponse.status);

        if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text();
            console.error('[STEP 2] TikTok token error:', errorText);
            return res.redirect('/broadcast/?error=' + encodeURIComponent('Failed to get TikTok access token: ' + errorText));
        }

        const tokenData = await tokenResponse.json();
        console.log('[STEP 2] Token data keys:', Object.keys(tokenData));

        if (tokenData.error) {
            console.error('[STEP 2] TikTok token error:', tokenData);
            return res.redirect(`/broadcast/?error=${encodeURIComponent(tokenData.error_description || tokenData.error)}`);
        }

        const {
            access_token,
            expires_in,
            refresh_token,
            refresh_expires_in,
            open_id,
            scope
        } = tokenData;

        console.log('[STEP 2] Got token, open_id:', open_id, 'expires_in:', expires_in);

        // Get user info with follower counts
        console.log('[STEP 3] Getting user info...');
        const userInfoResponse = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username,follower_count,following_count,likes_count,video_count,bio_description', {
            headers: {
                'Authorization': `Bearer ${access_token}`,
            },
        });

        console.log('[STEP 3] User info response status:', userInfoResponse.status);

        let userInfo = { display_name: 'TikTok User' };
        if (userInfoResponse.ok) {
            const userInfoData = await userInfoResponse.json();
            console.log('[STEP 3] User info data:', JSON.stringify(userInfoData, null, 2));
            if (userInfoData.data && userInfoData.data.user) {
                userInfo = userInfoData.data.user;
            }
        } else {
            const errorText = await userInfoResponse.text();
            console.log('[STEP 3] User info error:', errorText);
        }

        console.log('[STEP 3] User info:', userInfo);

        // Verify user from state
        console.log('[STEP 4] Verifying user from state...');
        if (!state) {
            console.log('[STEP 4] No state provided!');
            return res.redirect('/broadcast/?error=Invalid state');
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        const { data: { user }, error: userError } = await supabase.auth.getUser(state);

        if (userError || !user) {
            console.error('[STEP 4] User verification error:', userError);
            return res.redirect('/broadcast/?error=Session expired, please login again');
        }
        console.log('[STEP 4] User verified:', user.id);

        // Calculate expiry times
        const tokenExpiresAt = new Date(Date.now() + (expires_in * 1000)).toISOString();

        // Save connected account
        console.log('[STEP 5] Saving connected account...');
        const { error: saveError } = await supabase
            .from('connected_accounts')
            .upsert({
                user_id: user.id,
                platform: 'tiktok',
                platform_user_id: open_id,
                account_name: userInfo.display_name || userInfo.username,
                access_token: access_token,
                refresh_token: refresh_token,
                token_expires_at: tokenExpiresAt,
                scopes: scope ? scope.split(',') : ['user.info.basic', 'video.upload'],
                metadata: {
                    profile_picture: userInfo.avatar_url,
                    display_name: userInfo.display_name,
                    username: userInfo.username,
                    followers_count: userInfo.follower_count,
                    following_count: userInfo.following_count,
                    likes_count: userInfo.likes_count,
                    video_count: userInfo.video_count,
                    bio: userInfo.bio_description,
                    account_type: 'Creator',
                    refresh_expires_in: refresh_expires_in,
                },
            }, {
                onConflict: 'user_id,platform',
            });

        if (saveError) {
            console.error('[STEP 5] Save error:', saveError);
            return res.redirect('/broadcast/?error=Failed to save account');
        }

        console.log('[STEP 5] ✅ SUCCESS! TikTok account saved:', userInfo.display_name || userInfo.username);
        console.log('========== TIKTOK OAUTH COMPLETE ==========');
        return res.redirect('/broadcast/?success=true&platform=tiktok');

    } catch (error) {
        console.error('========== TIKTOK OAUTH ERROR ==========');
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
        return res.redirect(`/broadcast/?error=${encodeURIComponent(error.message)}`);
    }
}
