// LinkedIn OAuth Handler
// Handles both initial auth redirect and callback

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
    console.log('========== LINKEDIN OAUTH START ==========');

    const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
    const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

    console.log('[ENV CHECK] LINKEDIN_CLIENT_ID:', LINKEDIN_CLIENT_ID ? `${LINKEDIN_CLIENT_ID.substring(0, 6)}... (len: ${LINKEDIN_CLIENT_ID.length})` : 'NOT SET');
    console.log('[ENV CHECK] LINKEDIN_CLIENT_SECRET:', LINKEDIN_CLIENT_SECRET ? 'SET' : 'NOT SET');

    const { code, state, error: oauthError, error_description } = req.query;

    // Get the base URL for redirects
    const isLocalhost = req.headers.host?.includes('localhost');
    const baseUrl = isLocalhost ? `http://${req.headers.host}` : `https://${req.headers.host}`;
    const redirectUri = `${baseUrl}/api/broadcast/auth/linkedin`;

    console.log('[REQUEST INFO]', {
        hasCode: !!code,
        hasState: !!state,
        error: oauthError,
        error_description,
        host: req.headers.host,
        redirectUri,
    });

    // If no code, this is the initial auth request - redirect to LinkedIn
    if (!code) {
        if (!LINKEDIN_CLIENT_ID) {
            console.log('[ERROR] LINKEDIN_CLIENT_ID not set!');
            return res.redirect('/broadcast/?error=LinkedIn not configured');
        }

        const scopes = ['openid', 'profile', 'w_member_social'].join(' ');
        const authUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('client_id', LINKEDIN_CLIENT_ID);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('scope', scopes);
        authUrl.searchParams.set('state', state || '');

        console.log('[STEP 1] Redirecting to LinkedIn:', authUrl.toString());
        return res.redirect(authUrl.toString());
    }

    // Handle OAuth error
    if (oauthError) {
        console.log('[ERROR] OAuth error from LinkedIn:', oauthError, error_description);
        return res.redirect(`/broadcast/?error=${encodeURIComponent(oauthError + ': ' + (error_description || ''))}`);
    }

    // Exchange code for access token
    try {
        console.log('[STEP 2] Exchanging code for token...');
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

        console.log('[STEP 2] Token response status:', tokenResponse.status);

        if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text();
            console.error('[STEP 2] LinkedIn token error:', errorText);
            return res.redirect('/broadcast/?error=' + encodeURIComponent('Token exchange failed: ' + errorText));
        }

        const tokenData = await tokenResponse.json();
        console.log('[STEP 2] Token data keys:', Object.keys(tokenData));
        const { access_token, expires_in, refresh_token } = tokenData;

        // Get user profile from LinkedIn
        console.log('[STEP 3] Getting user profile...');
        const profileResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
            headers: {
                'Authorization': `Bearer ${access_token}`,
            },
        });

        console.log('[STEP 3] Profile response status:', profileResponse.status);

        if (!profileResponse.ok) {
            const errorText = await profileResponse.text();
            console.error('[STEP 3] LinkedIn profile error:', errorText);
            return res.redirect('/broadcast/?error=' + encodeURIComponent('Profile fetch failed: ' + errorText));
        }

        const profile = await profileResponse.json();
        console.log('[STEP 3] Profile:', JSON.stringify(profile, null, 2));

        // Verify the user from the state (JWT token)
        console.log('[STEP 4] Verifying user from state...');
        if (!state) {
            console.log('[STEP 4] No state provided!');
            return res.redirect('/broadcast/?error=Invalid state');
        }

        // Create Supabase client
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

        // Get user from Supabase using the JWT
        const { data: { user }, error: userError } = await supabase.auth.getUser(state);

        if (userError || !user) {
            console.error('[STEP 4] User verification error:', userError);
            return res.redirect('/broadcast/?error=Session expired, please login again');
        }
        console.log('[STEP 4] User verified:', user.id);

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
                    profile_picture: profile.picture,
                    display_name: profile.name,
                    username: profile.name?.replace(/\s+/g, '').toLowerCase() || profile.email?.split('@')[0],
                    email: profile.email,
                    account_type: 'Personal'
                },
            }, {
                onConflict: 'user_id,platform',
            });

        if (saveError) {
            console.error('[STEP 5] Save error:', saveError);
            return res.redirect('/broadcast/?error=Failed to save account');
        }

        // Success - redirect back to connect page
        console.log('[STEP 5] ✅ SUCCESS! LinkedIn connected:', profile.name);
        console.log('========== LINKEDIN OAUTH COMPLETE ==========');
        return res.redirect('/broadcast/?success=true&platform=linkedin');

    } catch (error) {
        console.error('========== LINKEDIN OAUTH ERROR ==========');
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
        return res.redirect(`/broadcast/?error=${encodeURIComponent(error.message)}`);
    }
}
