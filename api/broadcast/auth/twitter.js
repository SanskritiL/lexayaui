// Twitter/X OAuth Handler
// Uses OAuth 2.0 with PKCE

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
    console.log('========== TWITTER OAUTH START ==========');

    const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID;
    const TWITTER_CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

    console.log('[ENV CHECK] TWITTER_CLIENT_ID:', TWITTER_CLIENT_ID ? `${TWITTER_CLIENT_ID.substring(0, 6)}...` : 'NOT SET');
    console.log('[ENV CHECK] TWITTER_CLIENT_SECRET:', TWITTER_CLIENT_SECRET ? 'SET' : 'NOT SET');

    const { code, state, error: oauthError, error_description } = req.query;

    // Get the base URL for redirects
    const isLocalhost = req.headers.host?.includes('localhost');
    const baseUrl = isLocalhost ? `http://${req.headers.host}` : `https://${req.headers.host}`;
    const redirectUri = `${baseUrl}/api/broadcast/auth/twitter`;

    console.log('[REQUEST INFO]', {
        hasCode: !!code,
        hasState: !!state,
        error: oauthError,
        redirectUri,
    });

    // Create Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // If no code, this is the initial auth request - redirect to Twitter
    if (!code) {
        if (!TWITTER_CLIENT_ID) {
            console.log('[ERROR] TWITTER_CLIENT_ID not set!');
            return res.redirect('/broadcast/connect.html?error=Twitter not configured');
        }

        // Generate PKCE code_verifier and code_challenge
        const codeVerifier = crypto.randomBytes(32).toString('base64url');
        const codeChallenge = crypto
            .createHash('sha256')
            .update(codeVerifier)
            .digest('base64url');

        // Get user token from query
        const userToken = req.query.state || '';

        // Store code_verifier temporarily (will retrieve on callback)
        // We encode both user token and code_verifier in state
        const stateData = Buffer.from(JSON.stringify({
            userToken,
            codeVerifier,
        })).toString('base64url');

        const scopes = ['tweet.read', 'tweet.write', 'users.read', 'offline.access'].join(' ');
        const authUrl = new URL('https://twitter.com/i/oauth2/authorize');
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('client_id', TWITTER_CLIENT_ID);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('scope', scopes);
        authUrl.searchParams.set('state', stateData);
        authUrl.searchParams.set('code_challenge', codeChallenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');

        console.log('[STEP 1] Redirecting to Twitter...');
        return res.redirect(authUrl.toString());
    }

    // Handle OAuth error
    if (oauthError) {
        console.log('[ERROR] OAuth error from Twitter:', oauthError, error_description);
        return res.redirect(`/broadcast/connect.html?error=${encodeURIComponent(oauthError + ': ' + (error_description || ''))}`);
    }

    // Exchange code for access token
    try {
        // Decode state to get code_verifier and user token
        if (!state) {
            return res.redirect('/broadcast/connect.html?error=Invalid state');
        }

        let stateData;
        try {
            stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
        } catch (e) {
            console.error('[ERROR] Failed to parse state:', e.message);
            return res.redirect('/broadcast/connect.html?error=Invalid state format');
        }

        const { userToken, codeVerifier } = stateData;

        console.log('[STEP 2] Exchanging code for token...');

        // Twitter requires Basic auth with client_id:client_secret
        const basicAuth = Buffer.from(`${TWITTER_CLIENT_ID}:${TWITTER_CLIENT_SECRET}`).toString('base64');

        const tokenResponse = await fetch('https://api.twitter.com/2/oauth2/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${basicAuth}`,
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: redirectUri,
                code_verifier: codeVerifier,
            }),
        });

        console.log('[STEP 2] Token response status:', tokenResponse.status);

        if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text();
            console.error('[STEP 2] Twitter token error:', errorText);
            return res.redirect('/broadcast/connect.html?error=' + encodeURIComponent('Token exchange failed: ' + errorText));
        }

        const tokenData = await tokenResponse.json();
        console.log('[STEP 2] Token data keys:', Object.keys(tokenData));
        const { access_token, expires_in, refresh_token } = tokenData;

        // Get user profile from Twitter
        console.log('[STEP 3] Getting user profile...');
        const profileResponse = await fetch('https://api.twitter.com/2/users/me', {
            headers: {
                'Authorization': `Bearer ${access_token}`,
            },
        });

        console.log('[STEP 3] Profile response status:', profileResponse.status);

        if (!profileResponse.ok) {
            const errorText = await profileResponse.text();
            console.error('[STEP 3] Twitter profile error:', errorText);
            return res.redirect('/broadcast/connect.html?error=' + encodeURIComponent('Profile fetch failed: ' + errorText));
        }

        const profileData = await profileResponse.json();
        const profile = profileData.data;
        console.log('[STEP 3] Profile:', JSON.stringify(profile, null, 2));

        // Verify the user from state
        console.log('[STEP 4] Verifying user...');
        if (!userToken) {
            return res.redirect('/broadcast/connect.html?error=Session expired, please login again');
        }

        const { data: { user }, error: userError } = await supabase.auth.getUser(userToken);

        if (userError || !user) {
            console.error('[STEP 4] User verification error:', userError);
            return res.redirect('/broadcast/connect.html?error=Session expired, please login again');
        }
        console.log('[STEP 4] User verified:', user.id);

        // Calculate token expiry
        const tokenExpiresAt = new Date(Date.now() + (expires_in * 1000)).toISOString();

        // Save or update connected account
        const { error: saveError } = await supabase
            .from('connected_accounts')
            .upsert({
                user_id: user.id,
                platform: 'twitter',
                platform_user_id: profile.id,
                account_name: profile.username,
                access_token: access_token,
                refresh_token: refresh_token || null,
                token_expires_at: tokenExpiresAt,
                scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
                metadata: {
                    name: profile.name,
                    username: profile.username,
                },
            }, {
                onConflict: 'user_id,platform',
            });

        if (saveError) {
            console.error('[STEP 5] Save error:', saveError);
            return res.redirect('/broadcast/connect.html?error=Failed to save account');
        }

        console.log('[STEP 5] ✅ SUCCESS! Twitter connected:', profile.username);
        console.log('========== TWITTER OAUTH COMPLETE ==========');
        return res.redirect('/broadcast/connect.html?success=true&platform=twitter');

    } catch (error) {
        console.error('========== TWITTER OAUTH ERROR ==========');
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
        return res.redirect(`/broadcast/connect.html?error=${encodeURIComponent(error.message)}`);
    }
}
