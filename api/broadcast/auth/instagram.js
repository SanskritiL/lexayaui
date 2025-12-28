// Instagram OAuth Handler
// Uses Facebook/Meta Graph API for Instagram Business accounts

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
    console.log('========== INSTAGRAM OAUTH START ==========');

    const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
    const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

    console.log('[ENV CHECK] FACEBOOK_APP_ID:', FACEBOOK_APP_ID ? `${FACEBOOK_APP_ID.substring(0, 6)}...` : 'NOT SET');
    console.log('[ENV CHECK] FACEBOOK_APP_SECRET:', FACEBOOK_APP_SECRET ? 'SET' : 'NOT SET');
    console.log('[ENV CHECK] SUPABASE_URL:', SUPABASE_URL ? 'SET' : 'NOT SET');

    const { code, state, error: oauthError, error_description, error_reason, debug } = req.query;

    const isLocalhost = req.headers.host?.includes('localhost');
    const baseUrl = isLocalhost ? `http://${req.headers.host}` : `https://${req.headers.host}`;
    const redirectUri = `${baseUrl}/api/broadcast/auth/instagram`;

    // Check if debug mode (can be in query or encoded in state)
    const isDebug = debug === 'true' || (state && state.startsWith('DEBUG:'));

    // Debug: Show what we're working with
    console.log('[REQUEST INFO]', {
        hasCode: !!code,
        codePreview: code ? code.substring(0, 20) + '...' : 'none',
        hasState: !!state,
        statePreview: state ? state.substring(0, 30) + '...' : 'none',
        isDebug,
        error: oauthError,
        host: req.headers.host,
        redirectUri,
    });

    // If no code, redirect to Facebook OAuth
    if (!code) {
        if (!FACEBOOK_APP_ID) {
            return res.redirect('/broadcast/?error=' + encodeURIComponent('FACEBOOK_APP_ID not configured in Vercel env vars'));
        }
        if (!FACEBOOK_APP_SECRET) {
            return res.redirect('/broadcast/?error=' + encodeURIComponent('FACEBOOK_APP_SECRET not configured in Vercel env vars'));
        }

        // Facebook OAuth with Instagram permissions
        const scopes = [
            'instagram_basic',
            'instagram_content_publish',
            'pages_show_list',
            'pages_read_engagement',
            'pages_manage_metadata',
            'business_management',
        ].join(',');

        const authUrl = new URL('https://www.facebook.com/v18.0/dialog/oauth');
        authUrl.searchParams.set('client_id', FACEBOOK_APP_ID);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('scope', scopes);
        // Pass debug flag through state if requested
        authUrl.searchParams.set('state', debug === 'true' ? `DEBUG:${state || ''}` : (state || ''));
        authUrl.searchParams.set('response_type', 'code');

        console.log('Redirecting to Facebook OAuth:', authUrl.toString());
        return res.redirect(authUrl.toString());
    }

    // Handle OAuth error from Facebook
    if (oauthError) {
        const errorMsg = `Facebook OAuth Error: ${oauthError}. ${error_description || ''} ${error_reason || ''}`.trim();
        console.error('OAuth error from Facebook:', errorMsg);
        return res.redirect(`/broadcast/?error=${encodeURIComponent(errorMsg)}`);
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
            return res.redirect('/broadcast/?error=' + encodeURIComponent('Token exchange failed: ' + errorMsg));
        }

        const shortLivedToken = tokenData.access_token;
        console.log('[STEP 1] Got short-lived token:', shortLivedToken.substring(0, 20) + '...');

        // Try getting pages with SHORT-LIVED token first (before exchange)
        console.log('[STEP 2] Fetching Facebook pages with short-lived token...');
        const pagesUrl = `https://graph.facebook.com/v18.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${shortLivedToken}`;
        console.log('[STEP 2] Pages URL:', pagesUrl.replace(shortLivedToken, 'TOKEN_HIDDEN'));

        let pagesResponse = await fetch(pagesUrl);
        let pagesData = await pagesResponse.json();
        console.log('[STEP 2] Pages response status:', pagesResponse.status);
        console.log('[STEP 2] Pages data:', JSON.stringify(pagesData, null, 2));

        // Exchange for long-lived token
        console.log('[STEP 3] Exchanging for long-lived token...');
        const longTokenUrl = new URL('https://graph.facebook.com/v18.0/oauth/access_token');
        longTokenUrl.searchParams.set('grant_type', 'fb_exchange_token');
        longTokenUrl.searchParams.set('client_id', FACEBOOK_APP_ID);
        longTokenUrl.searchParams.set('client_secret', FACEBOOK_APP_SECRET);
        longTokenUrl.searchParams.set('fb_exchange_token', shortLivedToken);

        const longTokenResponse = await fetch(longTokenUrl.toString());
        const longTokenData = await longTokenResponse.json();

        const accessToken = longTokenData.access_token || shortLivedToken;
        const expiresIn = longTokenData.expires_in || 3600;
        console.log('[STEP 3] Got long-lived token, expires in:', expiresIn);

        // If no pages with short token, try with long token
        console.log('[STEP 4] Pages data check - has data:', !!pagesData.data, 'length:', pagesData.data?.length || 0);

        if (!pagesData.data || pagesData.data.length === 0) {
            console.log('[STEP 4] No pages with short token, trying long token...');
            pagesResponse = await fetch(
                `https://graph.facebook.com/v18.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${accessToken}`
            );
            pagesData = await pagesResponse.json();
            console.log('[STEP 4] Pages with long token:', JSON.stringify(pagesData, null, 2));
        }

        console.log('[STEP 4] Final pages count:', pagesData.data?.length || 0);

        if (pagesData.error) {
            console.error('Pages fetch error:', pagesData.error);
            return res.redirect('/broadcast/?error=' + encodeURIComponent('Failed to get pages: ' + pagesData.error.message));
        }

        if (!pagesData.data || pagesData.data.length === 0) {
            // Try alternative: get Instagram accounts directly via user
            console.log('[STEP 5] ❌ No pages found! Trying alternative approaches...');

            const meResponse = await fetch(`https://graph.facebook.com/v18.0/me?fields=id,name,accounts{id,name,access_token,instagram_business_account}&access_token=${accessToken}`);
            const meData = await meResponse.json();
            console.log('[STEP 5] User info with accounts:', JSON.stringify(meData, null, 2));

            // Check if accounts came through the me endpoint
            if (meData.accounts?.data?.length > 0) {
                pagesData = meData.accounts;
                console.log('[STEP 5] ✅ Found pages via /me endpoint!');
            } else {
                console.log('[STEP 5] ❌ No accounts in /me response either');
                // Try getting businesses
                const bizResponse = await fetch(`https://graph.facebook.com/v18.0/me/businesses?access_token=${accessToken}`);
                const bizData = await bizResponse.json();
                console.log('Businesses:', JSON.stringify(bizData, null, 2));

                // Get permissions to see what was granted
                const permResponse = await fetch(`https://graph.facebook.com/v18.0/me/permissions?access_token=${accessToken}`);
                const permData = await permResponse.json();
                console.log('Permissions:', permData);

                // Debug mode - return JSON
                if (isDebug) {
                    res.setHeader('Content-Type', 'application/json');
                    return res.json({
                        error: 'No Facebook Pages found',
                        user: meData,
                        permissions: permData,
                        pages: pagesData,
                        businesses: bizData,
                        hint: 'Make sure you selected BOTH the Instagram account AND the Facebook Page it is connected to during OAuth'
                    });
                }

                return res.redirect('/broadcast/?error=' + encodeURIComponent(`No Facebook Pages found for user ${meData.name || 'unknown'}. Make sure you granted Page permissions and have admin access to a Page connected to Instagram.`));
            }
        }

        console.log('[STEP 6] ✅ Found', pagesData.data.length, 'Facebook pages');

        // Get the Instagram Business Account for each page
        let instagramAccount = null;
        let pageAccessToken = null;
        const pagesChecked = [];

        for (const page of pagesData.data) {
            console.log('[STEP 7] Checking page:', page.name, '- ID:', page.id, '- has IG:', !!page.instagram_business_account);

            // Check if instagram_business_account is already in the response
            if (page.instagram_business_account) {
                console.log('[STEP 7] Found IG account on page, getting details...');
                // Need to get full details including follower count
                const igResponse = await fetch(
                    `https://graph.facebook.com/v18.0/${page.instagram_business_account.id}?fields=id,username,name,profile_picture_url,followers_count,follows_count,media_count&access_token=${page.access_token}`
                );
                const igData = await igResponse.json();
                console.log('Instagram account data:', igData);

                if (igData.id) {
                    instagramAccount = igData;
                    pageAccessToken = page.access_token;
                    console.log(`Found Instagram account: ${instagramAccount.username} (${instagramAccount.followers_count} followers)`);
                    pagesChecked.push({ name: page.name, hasInstagram: true, igUsername: igData.username });
                    break;
                }
            }

            pagesChecked.push({ name: page.name, hasInstagram: false });
        }

        if (!instagramAccount) {
            const checkedNames = pagesChecked.map(p => `${p.name} (IG: ${p.hasInstagram ? p.igUsername : 'none'})`).join(', ');
            return res.redirect('/broadcast/?error=' + encodeURIComponent(`No Instagram Business account found. Pages checked: ${checkedNames}. Make sure your Instagram is a Business/Creator account and connected to a Facebook Page.`));
        }

        // Verify user from state
        if (!state) {
            return res.redirect('/broadcast/?error=Invalid state');
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        const { data: { user }, error: userError } = await supabase.auth.getUser(state);

        if (userError || !user) {
            console.error('User verification error:', userError);
            return res.redirect('/broadcast/?error=Session expired, please login again');
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
                    display_name: instagramAccount.name || instagramAccount.username,
                    username: instagramAccount.username,
                    followers_count: instagramAccount.followers_count,
                    following_count: instagramAccount.follows_count,
                    media_count: instagramAccount.media_count,
                    account_type: 'Business',
                },
            }, {
                onConflict: 'user_id,platform',
            });

        if (saveError) {
            console.error('Save error:', saveError);
            return res.redirect('/broadcast/?error=Failed to save account');
        }

        console.log('[STEP 8] ✅ SUCCESS! Instagram account saved:', instagramAccount.username);
        console.log('========== INSTAGRAM OAUTH COMPLETE ==========');
        return res.redirect('/broadcast/?success=true&platform=instagram');

    } catch (error) {
        console.error('========== INSTAGRAM OAUTH ERROR ==========');
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
        return res.redirect(`/broadcast/?error=${encodeURIComponent(error.message)}`);
    }
}
