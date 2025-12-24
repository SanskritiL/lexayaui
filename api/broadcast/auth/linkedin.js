// LinkedIn OAuth Handler
// Handles both initial auth redirect and callback

const { createClient } = require('@supabase/supabase-js');

const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
    const { code, state, error: oauthError } = req.query;

    // Get the base URL for redirects
    const baseUrl = `https://${req.headers.host}`;
    const redirectUri = `${baseUrl}/api/broadcast/auth/linkedin`;

    // If no code, this is the initial auth request - redirect to LinkedIn
    if (!code) {
        if (!LINKEDIN_CLIENT_ID) {
            return res.redirect('/broadcast/connect.html?error=LinkedIn not configured');
        }

        const scopes = ['openid', 'profile', 'w_member_social'].join(' ');
        const authUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('client_id', LINKEDIN_CLIENT_ID);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('scope', scopes);
        authUrl.searchParams.set('state', state || '');

        return res.redirect(authUrl.toString());
    }

    // Handle OAuth error
    if (oauthError) {
        return res.redirect(`/broadcast/connect.html?error=${encodeURIComponent(oauthError)}`);
    }

    // Exchange code for access token
    try {
        const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: redirectUri,
                client_id: LINKEDIN_CLIENT_ID,
                client_secret: LINKEDIN_CLIENT_SECRET,
            }),
        });

        if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text();
            console.error('LinkedIn token error:', errorText);
            return res.redirect('/broadcast/connect.html?error=Failed to get access token');
        }

        const tokenData = await tokenResponse.json();
        const { access_token, expires_in, refresh_token } = tokenData;

        // Get user profile from LinkedIn
        const profileResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
            headers: {
                'Authorization': `Bearer ${access_token}`,
            },
        });

        if (!profileResponse.ok) {
            console.error('LinkedIn profile error:', await profileResponse.text());
            return res.redirect('/broadcast/connect.html?error=Failed to get profile');
        }

        const profile = await profileResponse.json();

        // Verify the user from the state (JWT token)
        if (!state) {
            return res.redirect('/broadcast/connect.html?error=Invalid state');
        }

        // Get user from Supabase using the JWT
        const { data: { user }, error: userError } = await supabase.auth.getUser(state);

        if (userError || !user) {
            console.error('User verification error:', userError);
            return res.redirect('/broadcast/connect.html?error=Session expired, please login again');
        }

        // Calculate token expiry
        const tokenExpiresAt = new Date(Date.now() + (expires_in * 1000)).toISOString();

        // Save or update connected account
        const { error: saveError } = await supabase
            .from('connected_accounts')
            .upsert({
                user_id: user.id,
                platform: 'linkedin',
                platform_user_id: profile.sub,
                account_name: profile.name || profile.email,
                access_token: access_token,
                refresh_token: refresh_token || null,
                token_expires_at: tokenExpiresAt,
                scopes: ['openid', 'profile', 'w_member_social'],
                metadata: {
                    picture: profile.picture,
                    email: profile.email,
                },
            }, {
                onConflict: 'user_id,platform',
            });

        if (saveError) {
            console.error('Save error:', saveError);
            return res.redirect('/broadcast/connect.html?error=Failed to save account');
        }

        // Success - redirect back to connect page
        return res.redirect('/broadcast/connect.html?success=true&platform=linkedin');

    } catch (error) {
        console.error('LinkedIn OAuth error:', error);
        return res.redirect(`/broadcast/connect.html?error=${encodeURIComponent(error.message)}`);
    }
}
