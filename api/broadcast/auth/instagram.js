// Instagram OAuth Handler
// Uses Facebook/Meta Graph API for Instagram Business accounts

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
    const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
    const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

    const { code, state, error: oauthError, error_description, error_reason, debug } = req.query;

    const baseUrl = `https://${req.headers.host}`;
    const redirectUri = `${baseUrl}/api/broadcast/auth/instagram`;

    // Debug: Show what we're working with
    console.log('Instagram OAuth Request:', {
        hasCode: !!code,
        hasState: !!state,
        error: oauthError,
        error_description,
        error_reason,
        host: req.headers.host,
        redirectUri,
        appId: FACEBOOK_APP_ID ? FACEBOOK_APP_ID.substring(0, 5) + '...' : 'NOT SET'
    });

    // If no code, redirect to Facebook OAuth
    if (!code) {
        if (!FACEBOOK_APP_ID) {
            return res.redirect('/broadcast/connect.html?error=' + encodeURIComponent('FACEBOOK_APP_ID not configured in Vercel env vars'));
        }
        if (!FACEBOOK_APP_SECRET) {
            return res.redirect('/broadcast/connect.html?error=' + encodeURIComponent('FACEBOOK_APP_SECRET not configured in Vercel env vars'));
        }

        // Facebook OAuth with Instagram permissions
        const scopes = [
            'instagram_basic',
            'instagram_content_publish',
            'pages_show_list',
            'pages_read_engagement',
        ].join(',');

        const authUrl = new URL('https://www.facebook.com/v18.0/dialog/oauth');
        authUrl.searchParams.set('client_id', FACEBOOK_APP_ID);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('scope', scopes);
        authUrl.searchParams.set('state', state || '');
        authUrl.searchParams.set('response_type', 'code');

        console.log('Redirecting to Facebook OAuth:', authUrl.toString());
        return res.redirect(authUrl.toString());
    }

    // Handle OAuth error from Facebook
    if (oauthError) {
        const errorMsg = `Facebook OAuth Error: ${oauthError}. ${error_description || ''} ${error_reason || ''}`.trim();
        console.error('OAuth error from Facebook:', errorMsg);
        return res.redirect(`/broadcast/connect.html?error=${encodeURIComponent(errorMsg)}`);
    }

    try {
        // Exchange code for access token
        console.log('Exchanging code for token...');
        const tokenUrl = new URL('https://graph.facebook.com/v18.0/oauth/access_token');
        tokenUrl.searchParams.set('client_id', FACEBOOK_APP_ID);
        tokenUrl.searchParams.set('client_secret', FACEBOOK_APP_SECRET);
        tokenUrl.searchParams.set('redirect_uri', redirectUri);
        tokenUrl.searchParams.set('code', code);

        const tokenResponse = await fetch(tokenUrl.toString());
        const tokenData = await tokenResponse.json();

        if (!tokenResponse.ok || tokenData.error) {
            const errorMsg = tokenData.error?.message || JSON.stringify(tokenData);
            console.error('Facebook token error:', tokenData);
            return res.redirect('/broadcast/connect.html?error=' + encodeURIComponent('Token exchange failed: ' + errorMsg));
        }

        const shortLivedToken = tokenData.access_token;
        console.log('Got short-lived token');

        // Exchange for long-lived token
        console.log('Exchanging for long-lived token...');
        const longTokenUrl = new URL('https://graph.facebook.com/v18.0/oauth/access_token');
        longTokenUrl.searchParams.set('grant_type', 'fb_exchange_token');
        longTokenUrl.searchParams.set('client_id', FACEBOOK_APP_ID);
        longTokenUrl.searchParams.set('client_secret', FACEBOOK_APP_SECRET);
        longTokenUrl.searchParams.set('fb_exchange_token', shortLivedToken);

        const longTokenResponse = await fetch(longTokenUrl.toString());
        const longTokenData = await longTokenResponse.json();

        const accessToken = longTokenData.access_token || shortLivedToken;
        const expiresIn = longTokenData.expires_in || 3600;
        console.log('Got long-lived token');

        // Get Facebook pages connected to this user
        console.log('Fetching Facebook pages...');
        const pagesResponse = await fetch(
            `https://graph.facebook.com/v18.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${accessToken}`
        );
        const pagesData = await pagesResponse.json();

        console.log('Pages API response:', JSON.stringify(pagesData, null, 2));

        if (pagesData.error) {
            console.error('Pages fetch error:', pagesData.error);
            return res.redirect('/broadcast/connect.html?error=' + encodeURIComponent('Failed to get pages: ' + pagesData.error.message));
        }

        if (!pagesData.data || pagesData.data.length === 0) {
            // Try to get more info about what's happening
            const meResponse = await fetch(`https://graph.facebook.com/v18.0/me?fields=id,name&access_token=${accessToken}`);
            const meData = await meResponse.json();
            console.log('User info:', meData);

            // Get permissions to see what was granted
            const permResponse = await fetch(`https://graph.facebook.com/v18.0/me/permissions?access_token=${accessToken}`);
            const permData = await permResponse.json();
            console.log('Permissions:', permData);

            // Debug mode - return JSON
            if (debug === 'true') {
                res.setHeader('Content-Type', 'application/json');
                return res.json({
                    error: 'No Facebook Pages found',
                    user: meData,
                    permissions: permData,
                    pages: pagesData,
                    hint: 'Check if pages_show_list permission was granted and you have admin access to a Page'
                });
            }

            return res.redirect('/broadcast/connect.html?error=' + encodeURIComponent(`No Facebook Pages found for user ${meData.name || 'unknown'}. Make sure you granted Page permissions and have admin access to a Page connected to Instagram.`));
        }

        console.log(`Found ${pagesData.data.length} Facebook pages`);

        // Get the Instagram Business Account for each page
        let instagramAccount = null;
        let pageAccessToken = null;
        const pagesChecked = [];

        for (const page of pagesData.data) {
            console.log(`Checking page: ${page.name} (${page.id})`, page);

            // Check if instagram_business_account is already in the response
            if (page.instagram_business_account) {
                // Need to get full details
                const igResponse = await fetch(
                    `https://graph.facebook.com/v18.0/${page.instagram_business_account.id}?fields=id,username,profile_picture_url&access_token=${page.access_token}`
                );
                const igData = await igResponse.json();
                console.log('Instagram account data:', igData);

                if (igData.id) {
                    instagramAccount = igData;
                    pageAccessToken = page.access_token;
                    console.log(`Found Instagram account: ${instagramAccount.username}`);
                    pagesChecked.push({ name: page.name, hasInstagram: true, igUsername: igData.username });
                    break;
                }
            }

            pagesChecked.push({ name: page.name, hasInstagram: false });
        }

        if (!instagramAccount) {
            const checkedNames = pagesChecked.map(p => `${p.name} (IG: ${p.hasInstagram ? p.igUsername : 'none'})`).join(', ');
            return res.redirect('/broadcast/connect.html?error=' + encodeURIComponent(`No Instagram Business account found. Pages checked: ${checkedNames}. Make sure your Instagram is a Business/Creator account and connected to a Facebook Page.`));
        }

        // Verify user from state
        if (!state) {
            return res.redirect('/broadcast/connect.html?error=Invalid state');
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        const { data: { user }, error: userError } = await supabase.auth.getUser(state);

        if (userError || !user) {
            console.error('User verification error:', userError);
            return res.redirect('/broadcast/connect.html?error=Session expired, please login again');
        }

        // Calculate expiry
        const tokenExpiresAt = new Date(Date.now() + (expiresIn * 1000)).toISOString();

        // Save connected account
        const { error: saveError } = await supabase
            .from('connected_accounts')
            .upsert({
                user_id: user.id,
                platform: 'instagram',
                platform_user_id: instagramAccount.id,
                account_name: instagramAccount.username,
                access_token: pageAccessToken, // Use page token for posting
                refresh_token: null,
                token_expires_at: tokenExpiresAt,
                scopes: ['instagram_basic', 'instagram_content_publish'],
                metadata: {
                    profile_picture: instagramAccount.profile_picture_url,
                    ig_user_id: instagramAccount.id,
                },
            }, {
                onConflict: 'user_id,platform',
            });

        if (saveError) {
            console.error('Save error:', saveError);
            return res.redirect('/broadcast/connect.html?error=Failed to save account');
        }

        return res.redirect('/broadcast/connect.html?success=true&platform=instagram');

    } catch (error) {
        console.error('Instagram OAuth error:', error);
        return res.redirect(`/broadcast/connect.html?error=${encodeURIComponent(error.message)}`);
    }
}
