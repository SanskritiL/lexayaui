// TikTok OAuth Handler
// Uses TikTok Login Kit for authentication

import { createClient } from '@supabase/supabase-js';

const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
    const { code, state, error: oauthError, error_description } = req.query;

    const baseUrl = `https://${req.headers.host}`;
    const redirectUri = `${baseUrl}/api/publishtoall/auth/tiktok`;

    // If no code, redirect to TikTok OAuth
    if (!code) {
        if (!TIKTOK_CLIENT_KEY) {
            return res.redirect('/publishtoall/connect.html?error=TikTok not configured');
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

        return res.redirect(authUrl.toString());
    }

    // Handle OAuth error
    if (oauthError) {
        const errorMsg = error_description || oauthError;
        return res.redirect(`/publishtoall/connect.html?error=${encodeURIComponent(errorMsg)}`);
    }

    try {
        // Exchange code for access token
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

        if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text();
            console.error('TikTok token error:', errorText);
            return res.redirect('/publishtoall/connect.html?error=Failed to get TikTok access token');
        }

        const tokenData = await tokenResponse.json();

        if (tokenData.error) {
            console.error('TikTok token error:', tokenData);
            return res.redirect(`/publishtoall/connect.html?error=${encodeURIComponent(tokenData.error_description || tokenData.error)}`);
        }

        const {
            access_token,
            expires_in,
            refresh_token,
            refresh_expires_in,
            open_id,
            scope
        } = tokenData;

        // Get user info
        const userInfoResponse = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username', {
            headers: {
                'Authorization': `Bearer ${access_token}`,
            },
        });

        let userInfo = { display_name: 'TikTok User' };
        if (userInfoResponse.ok) {
            const userInfoData = await userInfoResponse.json();
            if (userInfoData.data && userInfoData.data.user) {
                userInfo = userInfoData.data.user;
            }
        }

        // Verify user from state
        if (!state) {
            return res.redirect('/publishtoall/connect.html?error=Invalid state');
        }

        const { data: { user }, error: userError } = await supabase.auth.getUser(state);

        if (userError || !user) {
            console.error('User verification error:', userError);
            return res.redirect('/publishtoall/connect.html?error=Session expired, please login again');
        }

        // Calculate expiry times
        const tokenExpiresAt = new Date(Date.now() + (expires_in * 1000)).toISOString();

        // Save connected account
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
                    avatar_url: userInfo.avatar_url,
                    username: userInfo.username,
                    refresh_expires_in: refresh_expires_in,
                },
            }, {
                onConflict: 'user_id,platform',
            });

        if (saveError) {
            console.error('Save error:', saveError);
            return res.redirect('/publishtoall/connect.html?error=Failed to save account');
        }

        return res.redirect('/publishtoall/connect.html?success=true&platform=tiktok');

    } catch (error) {
        console.error('TikTok OAuth error:', error);
        return res.redirect(`/publishtoall/connect.html?error=${encodeURIComponent(error.message)}`);
    }
}
