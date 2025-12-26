// Test endpoint to debug Facebook API
// Usage: Go through OAuth, then check Vercel logs

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
    const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
    const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

    const { code, state } = req.query;
    const baseUrl = `https://${req.headers.host}`;
    const redirectUri = `${baseUrl}/api/broadcast/test-fb`;

    // Initial redirect to Facebook
    if (!code) {
        const scopes = [
            'instagram_basic',
            'instagram_content_publish',
            'pages_show_list',
            'pages_read_engagement',
            'business_management',
        ].join(',');

        const authUrl = new URL('https://www.facebook.com/v18.0/dialog/oauth');
        authUrl.searchParams.set('client_id', FACEBOOK_APP_ID);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('scope', scopes);
        authUrl.searchParams.set('state', state || 'test');
        authUrl.searchParams.set('response_type', 'code');

        return res.redirect(authUrl.toString());
    }

    try {
        // Exchange code for token
        const tokenUrl = new URL('https://graph.facebook.com/v18.0/oauth/access_token');
        tokenUrl.searchParams.set('client_id', FACEBOOK_APP_ID);
        tokenUrl.searchParams.set('client_secret', FACEBOOK_APP_SECRET);
        tokenUrl.searchParams.set('redirect_uri', redirectUri);
        tokenUrl.searchParams.set('code', code);

        const tokenResponse = await fetch(tokenUrl.toString());
        const tokenData = await tokenResponse.json();

        if (tokenData.error) {
            return res.json({ error: 'Token exchange failed', details: tokenData });
        }

        const accessToken = tokenData.access_token;

        // Get user info
        const meResponse = await fetch(`https://graph.facebook.com/v18.0/me?fields=id,name&access_token=${accessToken}`);
        const meData = await meResponse.json();

        // Get pages
        const pagesResponse = await fetch(`https://graph.facebook.com/v18.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${accessToken}`);
        const pagesData = await pagesResponse.json();

        // Get permissions granted
        const permResponse = await fetch(`https://graph.facebook.com/v18.0/me/permissions?access_token=${accessToken}`);
        const permData = await permResponse.json();

        // If we have pages, check for Instagram
        let instagramData = null;
        if (pagesData.data && pagesData.data.length > 0) {
            for (const page of pagesData.data) {
                if (page.instagram_business_account) {
                    const igResponse = await fetch(
                        `https://graph.facebook.com/v18.0/${page.instagram_business_account.id}?fields=id,username,profile_picture_url,media_count&access_token=${page.access_token}`
                    );
                    instagramData = await igResponse.json();

                    // Get recent media
                    const mediaResponse = await fetch(
                        `https://graph.facebook.com/v18.0/${page.instagram_business_account.id}/media?fields=id,caption,media_type,permalink,thumbnail_url,timestamp&limit=3&access_token=${page.access_token}`
                    );
                    instagramData.recent_media = await mediaResponse.json();
                    break;
                }
            }
        }

        res.setHeader('Content-Type', 'application/json');
        return res.json({
            user: meData,
            permissions: permData,
            pages: pagesData,
            instagram: instagramData,
            debug: {
                pagesCount: pagesData.data?.length || 0,
                hasInstagram: !!instagramData,
            }
        });

    } catch (error) {
        return res.json({ error: error.message, stack: error.stack });
    }
}
