// Dynamic OAuth Handler - handles all platforms via [platform] route parameter
// Reduces 4 serverless functions to 1 to stay under Vercel Hobby limit

const getClient = require('../../_supabase');
const crypto = require('crypto');

async function getUserState(supabase, state) {
  if (!state) return null;
  try {
    let raw = state;
    if (raw.startsWith('DEBUG:')) raw = raw.slice(6);
    const { data: { user }, error } = await supabase.auth.getUser(raw);
    if (error || !user) return null;
    return { id: user.id, email: user.email };
  } catch (e) {}
  return null;
}

async function upsertAccount(supabase, data, userId, platform, options = {}) {
  let query = supabase
    .from('connected_accounts')
    .select('id, refresh_token')
    .eq('user_id', userId)
    .eq('platform', platform);

  if (data.platform_user_id) {
    query = query.eq('platform_user_id', data.platform_user_id);
  } else {
    query = query.is('platform_user_id', null);
  }

  const { data: existing } = await query.maybeSingle();
  let accountToUpdate = existing;

  if (!accountToUpdate && data.platform_user_id && options.replaceLegacyWithoutProviderId) {
    const { data: legacyRows } = await supabase
      .from('connected_accounts')
      .select('id, refresh_token')
      .eq('user_id', userId)
      .eq('platform', platform)
      .is('platform_user_id', null)
      .order('created_at', { ascending: false })
      .limit(1);
    accountToUpdate = legacyRows?.[0] || null;
  }

  if (accountToUpdate) {
    if (!data.refresh_token && accountToUpdate.refresh_token) {
      data.refresh_token = accountToUpdate.refresh_token;
    }
    return supabase.from('connected_accounts').update(data).eq('id', accountToUpdate.id);
  }
  return supabase.from('connected_accounts').insert(data);
}

async function resolveDbUserId(_supabase, userState) {
  return userState.id;
}

module.exports = async function handler(req, res) {
    const { platform } = req.query;

    console.log(`========== ${platform?.toUpperCase()} OAUTH START ==========`);

    switch (platform) {
        case 'linkedin':
            return handleLinkedIn(req, res);
        case 'instagram':
            return handleInstagram(req, res);
        case 'tiktok':
            return handleTikTok(req, res);
        case 'twitter':
            return handleTwitter(req, res);
        // case 'threads':
        //     return handleThreads(req, res);
        case 'youtube':
            return handleYouTube(req, res);
        default:
            return res.status(400).json({ error: 'Unknown platform: ' + platform });
    }
};

// ============== LINKEDIN ==============
async function handleLinkedIn(req, res) {
    const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
    const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

    const { code, state, error: oauthError, error_description } = req.query;

    const isLocalhost = req.headers.host?.includes('localhost');
    const baseUrl = isLocalhost ? `http://${req.headers.host}` : `https://${req.headers.host}`;
    const redirectUri = `${baseUrl}/api/broadcast/auth/linkedin`;

    if (!code) {
        if (!LINKEDIN_CLIENT_ID) {
            return res.redirect('/broadcast/?error=LinkedIn not configured');
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

    if (oauthError) {
        return res.redirect(`/broadcast/?error=${encodeURIComponent(oauthError + ': ' + (error_description || ''))}`);
    }

    try {
        const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
            return res.redirect('/broadcast/?error=' + encodeURIComponent('Token exchange failed: ' + errorText));
        }

        const tokenData = await tokenResponse.json();
        const { access_token, expires_in, refresh_token } = tokenData;

        const profileResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
            headers: { 'Authorization': `Bearer ${access_token}` },
        });

        if (!profileResponse.ok) {
            const errorText = await profileResponse.text();
            return res.redirect('/broadcast/?error=' + encodeURIComponent('Profile fetch failed: ' + errorText));
        }

        const profile = await profileResponse.json();

        const supabase = getClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        const userState = await getUserState(supabase, state);
        if (!userState || !userState.email) {
            return res.redirect('/broadcast/?error=Invalid session, please login again');
        }

        // Try to fetch followers count from LinkedIn REST API
        let followersCount = null;
        try {
            const meResponse = await fetch('https://api.linkedin.com/v2/me', {
                headers: { 'Authorization': `Bearer ${access_token}` },
            });
            if (meResponse.ok) {
                const meData = await meResponse.json();
                const personId = meData.id || profile.sub?.replace('urn:li:person:', '');
                if (personId) {
                    const networkResponse = await fetch(
                        `https://api.linkedin.com/v2/networkSizes/urn:li:member:${personId}?edgeType=CompanyFollowedByMember`,
                        { headers: { 'Authorization': `Bearer ${access_token}` } }
                    );
                    if (networkResponse.ok) {
                        const networkData = await networkResponse.json();
                        followersCount = networkData?.firstDegreeSize || null;
                    }
                }
            }
        } catch (_) {}

        const userId = await resolveDbUserId(supabase, userState);
        const tokenExpiresAt = new Date(Date.now() + (expires_in * 1000)).toISOString();

        const { error: saveError } = await upsertAccount(supabase, {
            user_id: userId,
            platform: 'linkedin',
            platform_user_id: profile.sub,
            account_name: profile.name || userState.email,
            access_token: access_token,
            refresh_token: refresh_token || null,
            token_expires_at: tokenExpiresAt,
            scopes: ['openid', 'profile', 'w_member_social'],
            metadata: {
                profile_picture: profile.picture,
                display_name: profile.name,
                username: profile.name?.replace(/\s+/g, '').toLowerCase() || userState.email?.split('@')[0],
                email: userState.email,
                account_type: 'Personal',
                followers_count: followersCount,
            },
        }, userId, 'linkedin');

        if (saveError) {
            console.error('[LinkedIn] Save error:', saveError);
            return res.redirect('/broadcast/?error=Failed to save account');
        }

        return res.redirect('/broadcast/?success=true&platform=linkedin');

    } catch (error) {
        console.error('LinkedIn OAuth Error:', error);
        return res.redirect(`/broadcast/?error=${encodeURIComponent(error.message)}`);
    }
}

// ============== INSTAGRAM ==============
async function handleInstagram(req, res) {
    const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
    const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

    const { code, state, error: oauthError, error_description, error_reason, debug } = req.query;

    const isLocalhost = req.headers.host?.includes('localhost');
    const baseUrl = isLocalhost ? `http://${req.headers.host}` : `https://${req.headers.host}`;
    const redirectUri = `${baseUrl}/api/broadcast/auth/instagram`;
    const isDebug = debug === 'true' || (state && state.startsWith('DEBUG:'));

    if (!code) {
        if (!FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET) {
            return res.redirect('/broadcast/?error=' + encodeURIComponent('Facebook App not configured'));
        }

        // Scopes for publishing + DM automation + insights
        const scopes = [
            'instagram_basic',
            'instagram_content_publish',
            'instagram_manage_comments',    // For reading comments (DM automation)
            'instagram_manage_messages',    // For sending DMs (DM automation)
            'pages_show_list',
            'pages_read_engagement',
            'pages_manage_metadata',
            'pages_messaging',              // For webhook subscriptions
            'business_management'
        ].join(',');
        const authUrl = new URL('https://www.facebook.com/v18.0/dialog/oauth');
        authUrl.searchParams.set('client_id', FACEBOOK_APP_ID);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('scope', scopes);
        authUrl.searchParams.set('state', debug === 'true' ? `DEBUG:${state || ''}` : (state || ''));
        authUrl.searchParams.set('response_type', 'code');

        return res.redirect(authUrl.toString());
    }

    if (oauthError) {
        const errorMsg = `Facebook OAuth Error: ${oauthError}. ${error_description || ''} ${error_reason || ''}`.trim();
        return res.redirect(`/broadcast/?error=${encodeURIComponent(errorMsg)}`);
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

        if (!tokenResponse.ok || tokenData.error) {
            return res.redirect('/broadcast/?error=' + encodeURIComponent('Token exchange failed: ' + (tokenData.error?.message || JSON.stringify(tokenData))));
        }

        const shortLivedToken = tokenData.access_token;

        // Exchange for long-lived token
        const longTokenUrl = new URL('https://graph.facebook.com/v18.0/oauth/access_token');
        longTokenUrl.searchParams.set('grant_type', 'fb_exchange_token');
        longTokenUrl.searchParams.set('client_id', FACEBOOK_APP_ID);
        longTokenUrl.searchParams.set('client_secret', FACEBOOK_APP_SECRET);
        longTokenUrl.searchParams.set('fb_exchange_token', shortLivedToken);

        const longTokenResponse = await fetch(longTokenUrl.toString());
        const longTokenData = await longTokenResponse.json();
        if (!longTokenResponse.ok || longTokenData.error || !longTokenData.access_token) {
            return res.redirect('/broadcast/?error=' + encodeURIComponent('Could not create a long-lived Instagram authorization. Please try connecting Instagram again.'));
        }

        const accessToken = longTokenData.access_token;
        const expiresIn = longTokenData.expires_in || (60 * 24 * 60 * 60);

        // Fetch pages only after the long-lived exchange so saved page tokens are not short-lived.
        let pagesResponse = await fetch(`https://graph.facebook.com/v18.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${accessToken}`);
        let pagesData = await pagesResponse.json();

        if (!pagesData.data || pagesData.data.length === 0) {
            const meResponse = await fetch(`https://graph.facebook.com/v18.0/me?fields=id,name,accounts{id,name,access_token,instagram_business_account}&access_token=${accessToken}`);
            const meData = await meResponse.json();
            if (meData.accounts?.data?.length > 0) {
                pagesData = meData.accounts;
            } else {
                return res.redirect('/broadcast/?error=' + encodeURIComponent('No Facebook Pages found. Make sure you granted Page permissions.'));
            }
        }

        // Find Instagram accounts connected to the authorized Facebook Pages.
        const instagramAccounts = [];

        for (const page of pagesData.data) {
            if (page.instagram_business_account) {
                const igResponse = await fetch(
                    `https://graph.facebook.com/v18.0/${page.instagram_business_account.id}?fields=id,username,name,profile_picture_url,followers_count,follows_count,media_count&access_token=${page.access_token}`
                );
                const igData = await igResponse.json();

                if (igData.id) {
                    instagramAccounts.push({
                        account: igData,
                        pageAccessToken: page.access_token,
                        pageId: page.id,
                        pageName: page.name,
                    });
                }
            }
        }

        if (instagramAccounts.length === 0) {
            return res.redirect('/broadcast/?error=' + encodeURIComponent('No Instagram Business account found.'));
        }

        const supabase = getClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        const userState = await getUserState(supabase, state);
        if (!userState || !userState.email) {
            return res.redirect('/broadcast/?error=Invalid session, please login again');
        }

        const dbUserId = await resolveDbUserId(supabase, userState);
        const tokenExpiresAt = new Date(Date.now() + (expiresIn * 1000)).toISOString();

        for (const item of instagramAccounts) {
            const instagramAccount = item.account;
            const { error: saveError } = await upsertAccount(supabase, {
                user_id: dbUserId,
                platform: 'instagram',
                platform_user_id: instagramAccount.id,
                account_name: instagramAccount.username,
                access_token: item.pageAccessToken,
                refresh_token: null,
                token_expires_at: tokenExpiresAt,
                scopes: ['instagram_basic', 'instagram_content_publish', 'instagram_manage_comments', 'instagram_manage_messages', 'pages_messaging'],
                metadata: {
                    profile_picture: instagramAccount.profile_picture_url,
                    ig_user_id: instagramAccount.id,
                    facebook_page_id: item.pageId,
                    facebook_page_name: item.pageName,
                    display_name: instagramAccount.name || instagramAccount.username,
                    username: instagramAccount.username,
                    followers_count: instagramAccount.followers_count,
                    following_count: instagramAccount.follows_count,
                    media_count: instagramAccount.media_count,
                    account_type: 'Business',
                },
            }, dbUserId, 'instagram');

            if (saveError) {
                console.error('[Instagram] Save error:', saveError);
                return res.redirect('/broadcast/?error=Failed to save account');
            }
        }

        return res.redirect(`/broadcast/?success=true&platform=instagram&accounts=${instagramAccounts.length}`);

    } catch (error) {
        console.error('Instagram OAuth Error:', error);
        return res.redirect(`/broadcast/?error=${encodeURIComponent(error.message)}`);
    }
}

// ============== TIKTOK ==============
async function handleTikTok(req, res) {
    const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
    const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

    const { code, state, error: oauthError, error_description } = req.query;

    const isLocalhost = req.headers.host?.includes('localhost');
    const baseUrl = isLocalhost ? `http://${req.headers.host}` : `https://${req.headers.host}`;
    const redirectUri = `${baseUrl}/api/broadcast/auth/tiktok`;
    const callbackPath = '/broadcast/connect.html';
    const requestedScopes = buildTikTokScopes();

    if (!code) {
        if (!TIKTOK_CLIENT_KEY || !TIKTOK_CLIENT_SECRET) {
            return res.redirect(`${callbackPath}?error=` + encodeURIComponent('TikTok not configured'));
        }

        const authUrl = new URL('https://www.tiktok.com/v2/auth/authorize/');
        authUrl.searchParams.set('client_key', TIKTOK_CLIENT_KEY);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', requestedScopes.join(','));
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('state', state || '');

        return res.redirect(authUrl.toString());
    }

    if (oauthError) {
        return res.redirect(`${callbackPath}?error=${encodeURIComponent(error_description || oauthError)}`);
    }

    try {
        const tokenResponse = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
            return res.redirect(`${callbackPath}?error=` + encodeURIComponent('Token exchange failed: ' + errorText));
        }

        const tokenData = await tokenResponse.json();

        if (tokenData.error) {
            return res.redirect(`${callbackPath}?error=${encodeURIComponent(tokenData.error_description || tokenData.error)}`);
        }

        const { access_token, expires_in, refresh_token, refresh_expires_in, open_id, scope } = tokenData;
        const grantedScopes = parseTikTokScopes(scope || req.query.scopes || requestedScopes.join(','));
        const userInfoFields = getTikTokUserInfoFields(grantedScopes);

        const userInfoResponse = await fetch(`https://open.tiktokapis.com/v2/user/info/?fields=${userInfoFields.join(',')}`, {
            headers: { 'Authorization': `Bearer ${access_token}` },
        });

        let userInfo = { display_name: 'TikTok User' };
        if (userInfoResponse.ok) {
            const userInfoData = await userInfoResponse.json();
            if (userInfoData.data?.user) {
                userInfo = userInfoData.data.user;
            }
        }

        const supabase = getClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        const userState = await getUserState(supabase, state);
        if (!userState || !userState.email) {
            return res.redirect(`${callbackPath}?error=Invalid session, please login again`);
        }

        const userId = await resolveDbUserId(supabase, userState);
        const tokenExpiresAt = new Date(Date.now() + (expires_in * 1000)).toISOString();

        const { error: saveError } = await upsertAccount(supabase, {
            user_id: userId,
            platform: 'tiktok',
            platform_user_id: open_id,
            account_name: userInfo.display_name || userInfo.username,
            access_token: access_token,
            refresh_token: refresh_token,
            token_expires_at: tokenExpiresAt,
            scopes: grantedScopes,
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
        }, userId, 'tiktok', { replaceLegacyWithoutProviderId: true });

        if (saveError) {
            console.error('[TikTok] Save error:', saveError);
            return res.redirect(`${callbackPath}?error=Failed to save account`);
        }

        return res.redirect(`${callbackPath}?success=true&platform=tiktok`);

    } catch (error) {
        console.error('TikTok OAuth Error:', error);
        return res.redirect(`${callbackPath}?error=${encodeURIComponent(error.message)}`);
    }
}

function buildTikTokScopes() {
    const scopes = new Set(['user.info.basic', 'video.upload']);
    const extraScopes = parseTikTokScopes(process.env.TIKTOK_EXTRA_SCOPES || '');
    extraScopes.forEach(scope => scopes.add(scope));
    return [...scopes];
}

function parseTikTokScopes(value) {
    return String(value || '')
        .split(/[,\s]+/)
        .map(scope => scope.trim())
        .filter(Boolean);
}

function getTikTokUserInfoFields(scopes) {
    const scopeSet = new Set(scopes);
    const fields = ['open_id', 'union_id', 'avatar_url', 'display_name'];

    if (scopeSet.has('user.info.profile')) {
        fields.push('username', 'bio_description');
    }

    if (scopeSet.has('user.info.stats')) {
        fields.push('follower_count', 'following_count', 'likes_count', 'video_count');
    }

    return fields;
}

// ============== TWITTER ==============
async function handleTwitter(req, res) {
    const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID;
    const TWITTER_CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

    const { code, state, error: oauthError, error_description } = req.query;

    const isLocalhost = req.headers.host?.includes('localhost');
    const baseUrl = isLocalhost ? `http://${req.headers.host}` : `https://${req.headers.host}`;
    const redirectUri = `${baseUrl}/api/broadcast/auth/twitter`;

    if (oauthError) {
        return res.redirect(`/broadcast/?error=${encodeURIComponent(oauthError + ': ' + (error_description || 'Authorization denied'))}`);
    }

    if (!code) {
        if (!TWITTER_CLIENT_ID) {
            return res.redirect('/broadcast/?error=Twitter not configured');
        }

        const codeVerifier = crypto.randomBytes(32).toString('base64url');
        const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

        const userToken = req.query.state || '';
        const stateData = Buffer.from(JSON.stringify({ userToken, codeVerifier })).toString('base64url');

        const scopes = ['tweet.read', 'tweet.write', 'users.read', 'offline.access'].join(' ');
        const authUrl = new URL('https://twitter.com/i/oauth2/authorize');
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('client_id', TWITTER_CLIENT_ID);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('scope', scopes);
        authUrl.searchParams.set('state', stateData);
        authUrl.searchParams.set('code_challenge', codeChallenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');

        return res.redirect(authUrl.toString());
    }

    try {
        if (!state) {
            return res.redirect('/broadcast/?error=Invalid state');
        }

        let stateData;
        try {
            stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
        } catch (e) {
            return res.redirect('/broadcast/?error=Invalid state format');
        }

        const { userToken, codeVerifier } = stateData;

        if (!TWITTER_CLIENT_ID || !TWITTER_CLIENT_SECRET) {
            return res.redirect('/broadcast/?error=Twitter credentials not configured');
        }

        const basicAuth = Buffer.from(`${TWITTER_CLIENT_ID}:${TWITTER_CLIENT_SECRET}`).toString('base64');

        const tokenBody = new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            code_verifier: codeVerifier,
            client_id: TWITTER_CLIENT_ID,
            client_secret: TWITTER_CLIENT_SECRET,
        });

        let tokenResponse = await fetch('https://api.twitter.com/2/oauth2/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${basicAuth}`,
            },
            body: tokenBody,
        });

        if (tokenResponse.status === 401) {
            tokenResponse = await fetch('https://api.twitter.com/2/oauth2/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: tokenBody,
            });
        }

        if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text();
            return res.redirect('/broadcast/?error=' + encodeURIComponent('Token exchange failed: ' + errorText));
        }

        const tokenData = await tokenResponse.json();
        const { access_token, expires_in, refresh_token } = tokenData;

        const profileResponse = await fetch('https://api.twitter.com/2/users/me?user.fields=profile_image_url,public_metrics,description,verified', {
            headers: { 'Authorization': `Bearer ${access_token}` },
        });

        if (!profileResponse.ok) {
            const errorText = await profileResponse.text();
            return res.redirect('/broadcast/?error=' + encodeURIComponent('Profile fetch failed: ' + errorText));
        }

        const profileData = await profileResponse.json();
        const profile = profileData.data;

        const supabase = getClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        const userState = await getUserState(supabase, userToken);
        if (!userState || !userState.email) {
            return res.redirect('/broadcast/?error=Invalid session, please login again');
        }

        const userId = await resolveDbUserId(supabase, userState);
        const tokenExpiresAt = new Date(Date.now() + (expires_in * 1000)).toISOString();

        const { error: saveError } = await upsertAccount(supabase, {
            user_id: userId,
            platform: 'twitter',
            platform_user_id: profile.id,
            account_name: profile.username,
            access_token: access_token,
            refresh_token: refresh_token || null,
            token_expires_at: tokenExpiresAt,
            scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
            metadata: {
                display_name: profile.name,
                username: profile.username,
                profile_picture: profile.profile_image_url?.replace('_normal', ''),
                followers_count: profile.public_metrics?.followers_count,
                following_count: profile.public_metrics?.following_count,
                tweet_count: profile.public_metrics?.tweet_count,
                bio: profile.description,
                verified: profile.verified,
                account_type: profile.verified ? 'Verified' : 'Personal',
            },
        }, userId, 'twitter');

        if (saveError) {
            console.error('[Twitter] Save error:', saveError);
            return res.redirect('/broadcast/?error=Failed to save account');
        }

        return res.redirect('/broadcast/?success=true&platform=twitter');

    } catch (error) {
        console.error('Twitter OAuth Error:', error);
        return res.redirect(`/broadcast/?error=${encodeURIComponent(error.message)}`);
    }
}

// ============== THREADS ==============
async function handleThreads(req, res) {
    // Threads uses the same Facebook App as Instagram
    const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
    const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

    const { code, state, error: oauthError, error_description } = req.query;

    const isLocalhost = req.headers.host?.includes('localhost');
    const baseUrl = isLocalhost ? `http://${req.headers.host}` : `https://${req.headers.host}`;
    const redirectUri = `${baseUrl}/api/broadcast/auth/threads`;

    if (!code) {
        if (!FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET) {
            return res.redirect('/broadcast/?error=' + encodeURIComponent('Threads not configured (requires Facebook App)'));
        }

        // Threads OAuth uses threads.net domain
        const scopes = ['threads_basic', 'threads_content_publish'].join(',');
        const authUrl = new URL('https://threads.net/oauth/authorize');
        authUrl.searchParams.set('client_id', FACEBOOK_APP_ID);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('scope', scopes);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('state', state || '');

        console.log('[Threads] Redirecting to:', authUrl.toString());
        return res.redirect(authUrl.toString());
    }

    if (oauthError) {
        const errorMsg = `Threads OAuth Error: ${oauthError}. ${error_description || ''}`.trim();
        return res.redirect(`/broadcast/?error=${encodeURIComponent(errorMsg)}`);
    }

    try {
        console.log('[Threads] Exchanging code for token...');

        // Exchange code for access token using Threads API
        const tokenUrl = new URL('https://graph.threads.net/oauth/access_token');
        const tokenResponse = await fetch(tokenUrl.toString(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: FACEBOOK_APP_ID,
                client_secret: FACEBOOK_APP_SECRET,
                grant_type: 'authorization_code',
                redirect_uri: redirectUri,
                code: code,
            }),
        });

        const tokenData = await tokenResponse.json();
        console.log('[Threads] Token response:', JSON.stringify(tokenData));

        if (!tokenResponse.ok || tokenData.error) {
            return res.redirect('/broadcast/?error=' + encodeURIComponent('Token exchange failed: ' + (tokenData.error?.message || tokenData.error_message || JSON.stringify(tokenData))));
        }

        const shortLivedToken = tokenData.access_token;
        const userId = tokenData.user_id;

        // Exchange for long-lived token
        console.log('[Threads] Exchanging for long-lived token...');
        const longTokenUrl = new URL('https://graph.threads.net/access_token');
        longTokenUrl.searchParams.set('grant_type', 'th_exchange_token');
        longTokenUrl.searchParams.set('client_secret', FACEBOOK_APP_SECRET);
        longTokenUrl.searchParams.set('access_token', shortLivedToken);

        const longTokenResponse = await fetch(longTokenUrl.toString());
        const longTokenData = await longTokenResponse.json();
        console.log('[Threads] Long-lived token response:', JSON.stringify(longTokenData));

        const accessToken = longTokenData.access_token || shortLivedToken;
        const expiresIn = longTokenData.expires_in || 3600;

        // Get user profile
        console.log('[Threads] Fetching user profile...');
        const profileUrl = new URL(`https://graph.threads.net/v1.0/${userId}`);
        profileUrl.searchParams.set('fields', 'id,username,threads_profile_picture_url,threads_biography');
        profileUrl.searchParams.set('access_token', accessToken);

        const profileResponse = await fetch(profileUrl.toString());
        const profileData = await profileResponse.json();
        console.log('[Threads] Profile data:', JSON.stringify(profileData));

        if (profileData.error) {
            return res.redirect('/broadcast/?error=' + encodeURIComponent('Failed to get profile: ' + profileData.error.message));
        }

        const supabase = getClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        const userState = await getUserState(supabase, state);
        if (!userState || !userState.email) {
            return res.redirect('/broadcast/?error=Invalid session, please login again');
        }

        const dbUserId = await resolveDbUserId(supabase, userState);
        const tokenExpiresAt = new Date(Date.now() + (expiresIn * 1000)).toISOString();

        const { error: saveError } = await upsertAccount(supabase, {
            user_id: dbUserId,
            platform: 'threads',
                platform_user_id: userId,
                account_name: profileData.username || 'Threads User',
                access_token: accessToken,
                refresh_token: null,
                token_expires_at: tokenExpiresAt,
                scopes: ['threads_basic', 'threads_content_publish'],
                metadata: {
                    threads_user_id: userId,
                    username: profileData.username,
                    display_name: profileData.username,
                    profile_picture: profileData.threads_profile_picture_url,
                    bio: profileData.threads_biography,
                    account_type: 'Personal',
                },
        }, dbUserId, 'threads');

        if (saveError) {
            console.error('[Threads] Save error:', saveError);
            return res.redirect('/broadcast/?error=Failed to save account');
        }

        console.log('[Threads] Successfully connected!');
        return res.redirect('/broadcast/?success=true&platform=threads');

    } catch (error) {
        console.error('Threads OAuth Error:', error);
        return res.redirect(`/broadcast/?error=${encodeURIComponent(error.message)}`);
    }
}

// ============== YOUTUBE ==============
async function handleYouTube(req, res) {
    const YOUTUBE_CLIENT_ID = process.env.YOUTUBE_CLIENT_ID?.trim();
    const YOUTUBE_CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET?.trim();
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

    const { code, state, error: oauthError, error_description } = req.query;

    const isLocalhost = req.headers.host?.includes('localhost');
    const baseUrl = isLocalhost ? `http://${req.headers.host}` : `https://${req.headers.host}`;
    const redirectUri = `${baseUrl}/api/broadcast/auth/youtube`;

    // Step 1: Redirect to Google OAuth
    if (!code) {
        if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET) {
            return res.redirect('/broadcast/?error=' + encodeURIComponent('YouTube not configured'));
        }

        const scopes = [
            'https://www.googleapis.com/auth/youtube.upload',
            'https://www.googleapis.com/auth/youtube.readonly',
            'https://www.googleapis.com/auth/userinfo.profile'
        ].join(' ');

        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        authUrl.searchParams.set('client_id', YOUTUBE_CLIENT_ID);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', scopes);
        authUrl.searchParams.set('access_type', 'offline');
        authUrl.searchParams.set('prompt', 'consent select_account');
        authUrl.searchParams.set('include_granted_scopes', 'false');
        authUrl.searchParams.set('state', state || '');

        return res.redirect(authUrl.toString());
    }

    // Handle OAuth error
    if (oauthError) {
        console.error('[YouTube] OAuth error:', oauthError, error_description);
        return res.redirect(`/broadcast/?error=${encodeURIComponent(error_description || oauthError)}`);
    }

    // Step 2: Exchange code for tokens
    try {
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: YOUTUBE_CLIENT_ID,
                client_secret: YOUTUBE_CLIENT_SECRET,
                code: code,
                grant_type: 'authorization_code',
                redirect_uri: redirectUri,
            }),
        });

        const tokenData = await tokenResponse.json();

        if (tokenData.error) {
            console.error('[YouTube] Token error:', tokenData);
            return res.redirect(`/broadcast/?error=${encodeURIComponent(tokenData.error_description || tokenData.error)}`);
        }

        const { access_token, refresh_token, expires_in } = tokenData;

        // Step 3: Get YouTube channel info
        const channelResponse = await fetch(
            'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true',
            { headers: { 'Authorization': `Bearer ${access_token}` } }
        );

        const channelData = await channelResponse.json();

        if (!channelData.items || channelData.items.length === 0) {
            return res.redirect('/broadcast/?error=' + encodeURIComponent('No YouTube channel found for this account'));
        }

        // Step 4: Verify user and save to database
        const supabase = getClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        const userState = await getUserState(supabase, state);
        if (!userState || !userState.email) {
            return res.redirect('/broadcast/?error=Invalid session, please login again');
        }

        const userId = await resolveDbUserId(supabase, userState);
        const tokenExpiresAt = new Date(Date.now() + (expires_in * 1000)).toISOString();

        for (const channel of channelData.items) {
            const channelId = channel.id;
            const channelTitle = channel.snippet.title;
            const channelThumbnail = channel.snippet.thumbnails?.default?.url;
            const subscriberCount = channel.statistics?.subscriberCount;
            const videoCount = channel.statistics?.videoCount;

            const { error: saveError } = await upsertAccount(supabase, {
                user_id: userId,
                platform: 'youtube',
                platform_user_id: channelId,
                account_name: channelTitle,
                access_token: access_token,
                refresh_token: refresh_token,
                token_expires_at: tokenExpiresAt,
                scopes: ['youtube.upload', 'youtube.readonly'],
                metadata: {
                    channel_id: channelId,
                    channel_title: channelTitle,
                    profile_picture: channelThumbnail,
                    display_name: channelTitle,
                    subscribers_count: parseInt(subscriberCount) || 0,
                    video_count: parseInt(videoCount) || 0,
                },
            }, userId, 'youtube');

            if (saveError) {
                console.error('[YouTube] Save error:', saveError);
                const message = saveError.code === '23505'
                    ? 'Database still has the old one-account-per-platform constraint. Run broadcast/multi-account-migration.sql.'
                    : 'Failed to save YouTube channel';
                return res.redirect('/broadcast/?error=' + encodeURIComponent(message));
            }
        }

        const connectedChannels = channelData.items
            .map(channel => `${channel.snippet?.title || channel.id}:${channel.id}`)
            .join(',');

        return res.redirect(`/broadcast/?success=true&platform=youtube&accounts=${channelData.items.length}&channels=${encodeURIComponent(connectedChannels)}`);

    } catch (error) {
        console.error('YouTube OAuth Error:', error);
        return res.redirect(`/broadcast/?error=${encodeURIComponent(error.message)}`);
    }
}
