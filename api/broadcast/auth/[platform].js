// Dynamic OAuth handler shared by the Cloud Run web API.

const getClient = require('../../_supabase');
const { verifyToken } = require('../../_firebase');
const { isAdminEmail } = require('../../_admin');
const crypto = require('crypto');

// Instagram is absent: it powers DM automation, so any signed-in user may
// connect it. The rest exist only to publish, which is admin-only.
const PUBLISH_ONLY_PLATFORMS = new Set(['linkedin', 'tiktok', 'twitter', 'threads', 'youtube']);
const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v25.0';
const INSTAGRAM_GRAPH_BASE = `https://graph.instagram.com/${META_GRAPH_VERSION}`;

const INSTAGRAM_REQUESTED_SCOPES = [
    'instagram_business_basic',
    'instagram_business_content_publish',
    'instagram_business_manage_comments',
    'instagram_business_manage_messages',
];

const INSTAGRAM_REQUIRED_SCOPES = [
    'instagram_business_basic',
    'instagram_business_content_publish',
];

function getPublicBaseUrl(req) {
    const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
    const host = forwardedHost || req.headers.host;
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const protocol = forwardedProto || (host?.includes('localhost') ? 'http' : 'https');
    return `${protocol}://${host}`;
}

function instagramAuthLog(requestId, stage, details = {}, level = 'log') {
    const safeLevel = level in console ? level : 'log';
    console[safeLevel]('[Instagram OAuth]', JSON.stringify({ requestId, stage, ...details }));
}

async function getUserState(supabase, state) {
  if (!state) return null;
  try {
    let raw = state;
    if (raw.startsWith('DEBUG:')) raw = raw.slice(6);
    return await verifyToken(raw);
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

async function getExistingRefreshToken(supabase, userId, platform, platformUserId) {
  let query = supabase
    .from('connected_accounts')
    .select('refresh_token')
    .eq('user_id', userId)
    .eq('platform', platform);

  if (platformUserId) {
    query = query.eq('platform_user_id', platformUserId);
  } else {
    query = query.is('platform_user_id', null);
  }

  const { data: existing } = await query.maybeSingle();
  if (existing?.refresh_token) return existing.refresh_token;

  if (!platformUserId) return null;

  const { data: legacyRows } = await supabase
    .from('connected_accounts')
    .select('refresh_token')
    .eq('user_id', userId)
    .eq('platform', platform)
    .is('platform_user_id', null)
    .order('created_at', { ascending: false })
    .limit(1);

  return legacyRows?.[0]?.refresh_token || null;
}

async function resolveDbUserId(_supabase, userState) {
  return userState.id;
}

// The OAuth `state` carries the caller's Firebase ID token on both legs, so it
// is the only identity available here — there is no Authorization header on the
// provider's callback.
async function resolveStateUser(state) {
    if (!state) return null;

    let token = String(state);
    if (token.startsWith('DEBUG:')) token = token.slice(6);

    // Twitter round-trips its state as base64 JSON wrapping the user token.
    try {
        const parsed = JSON.parse(Buffer.from(token, 'base64url').toString());
        if (parsed?.userToken) token = String(parsed.userToken);
    } catch (_) {}

    try {
        return await verifyToken(token);
    } catch (_) {
        return null;
    }
}

module.exports = async function handler(req, res) {
    const { platform } = req.query;

    console.log(`========== ${platform?.toUpperCase()} OAUTH START ==========`);

    // Gate before the redirect leg and again on the callback leg, so a non-admin
    // cannot skip the UI and drive either one directly.
    if (PUBLISH_ONLY_PLATFORMS.has(platform)) {
        const stateUser = await resolveStateUser(req.query.state);
        if (!stateUser || !isAdminEmail(stateUser.email)) {
            console.warn(`[AUTH] Non-admin blocked from connecting ${platform}`);
            return res.redirect('/broadcast/?error=' + encodeURIComponent(
                'Publishing platforms are not enabled for this account.'
            ));
        }
    }

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

    const baseUrl = getPublicBaseUrl(req);
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
    const INSTAGRAM_APP_ID = process.env.INSTAGRAM_APP_ID || process.env.FACEBOOK_APP_ID;
    const INSTAGRAM_APP_SECRET = process.env.INSTAGRAM_APP_SECRET || process.env.FACEBOOK_APP_SECRET;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

    const { code, state, error: oauthError, error_description, error_reason, debug } = req.query;

    const redirectUri = process.env.INSTAGRAM_REDIRECT_URI || `${getPublicBaseUrl(req)}/api/broadcast/auth/instagram`;
    const isDebug = debug === 'true' || debug === '1' || (state && state.startsWith('DEBUG:'));
    const requestId = req.headers['x-cloud-trace-context']?.split('/')?.[0] || crypto.randomUUID();

    instagramAuthLog(requestId, 'request_received', {
        method: req.method,
        hasCode: Boolean(code),
        hasState: Boolean(state),
        hasOauthError: Boolean(oauthError),
        isDebug,
        redirectUri,
        appIdSuffix: INSTAGRAM_APP_ID ? String(INSTAGRAM_APP_ID).slice(-4) : null,
        secretConfigured: Boolean(INSTAGRAM_APP_SECRET),
    });

    if (!code) {
        if (!INSTAGRAM_APP_ID || !INSTAGRAM_APP_SECRET) {
            instagramAuthLog(requestId, 'config_missing', {
                appIdConfigured: Boolean(INSTAGRAM_APP_ID),
                secretConfigured: Boolean(INSTAGRAM_APP_SECRET),
            }, 'warn');
            return res.redirect('/broadcast/?error=' + encodeURIComponent('Instagram app not configured'));
        }

        const authUrl = new URL('https://www.instagram.com/oauth/authorize');
        authUrl.searchParams.set('client_id', INSTAGRAM_APP_ID);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('scope', INSTAGRAM_REQUESTED_SCOPES.join(','));
        authUrl.searchParams.set('state', debug === 'true' ? `DEBUG:${state || ''}` : (state || ''));
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('force_reauth', 'true');
        authUrl.searchParams.set('enable_fb_login', 'false');

        instagramAuthLog(requestId, 'auth_redirect', {
            redirectUri,
            scopeCount: INSTAGRAM_REQUESTED_SCOPES.length,
            stateLength: (state || '').length,
            authUrlHost: authUrl.host,
        });

        return res.redirect(authUrl.toString());
    }

    if (oauthError) {
        instagramAuthLog(requestId, 'oauth_error', {
            oauthError,
            errorDescription: error_description || null,
            errorReason: error_reason || null,
        }, 'warn');
        const errorMsg = `Facebook OAuth Error: ${oauthError}. ${error_description || ''} ${error_reason || ''}`.trim();
        return res.redirect(`/broadcast/?error=${encodeURIComponent(errorMsg)}`);
    }

    try {
        instagramAuthLog(requestId, 'token_exchange_start', {
            redirectUri,
            codeLength: String(code || '').length,
        });

        // Exchange code for token
        const tokenResponse = await fetch('https://api.instagram.com/oauth/access_token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: INSTAGRAM_APP_ID,
                client_secret: INSTAGRAM_APP_SECRET,
                grant_type: 'authorization_code',
                redirect_uri: redirectUri,
                code,
            }),
        });
        const tokenData = await tokenResponse.json();

        instagramAuthLog(requestId, 'token_exchange_result', {
            ok: tokenResponse.ok,
            status: tokenResponse.status,
            hasError: Boolean(tokenData?.error),
            errorType: tokenData?.error_type || tokenData?.error?.type || null,
            errorCode: tokenData?.code || tokenData?.error?.code || null,
            errorMessage: tokenData?.error_message || tokenData?.error?.message || null,
            keys: tokenData && typeof tokenData === 'object' ? Object.keys(tokenData).slice(0, 10) : [],
        }, tokenResponse.ok ? 'log' : 'warn');

        if (!tokenResponse.ok || tokenData.error) {
            const failureMessage = tokenData.error_message || tokenData.error?.message || '';

            // An authorization code is single-use. When the callback is delivered
            // twice for the same code (browser back-navigation, or a link-preview
            // prefetch in Instagram's in-app browser), the first request completes
            // the connection and the second one lands here with "code has been
            // used". That is a benign duplicate, not a failure, so send the user to
            // their accounts rather than an alarming error.
            if (/authorization code has been used/i.test(failureMessage)) {
                instagramAuthLog(requestId, 'token_exchange_duplicate_code', { redirectUri }, 'log');
                return res.redirect('/broadcast/?platform=instagram&info=' + encodeURIComponent(
                    'Instagram connection already processed. Check your connected accounts.'
                ));
            }

            instagramAuthLog(requestId, 'token_exchange_failed', {
                redirectUri,
                responsePreview: typeof tokenData === 'object' ? JSON.stringify(tokenData).slice(0, 500) : String(tokenData).slice(0, 500),
            }, 'warn');
            return res.redirect('/broadcast/?error=' + encodeURIComponent('Token exchange failed: ' + (failureMessage || JSON.stringify(tokenData))));
        }

        const shortLivedToken = tokenData.access_token;

        // Exchange for long-lived token
        const longTokenUrl = new URL('https://graph.instagram.com/access_token');
        longTokenUrl.searchParams.set('grant_type', 'ig_exchange_token');
        longTokenUrl.searchParams.set('client_secret', INSTAGRAM_APP_SECRET);
        longTokenUrl.searchParams.set('access_token', shortLivedToken);

        const longTokenResponse = await fetch(longTokenUrl.toString());
        const longTokenData = await longTokenResponse.json();
        instagramAuthLog(requestId, 'long_token_result', {
            ok: longTokenResponse.ok,
            status: longTokenResponse.status,
            hasError: Boolean(longTokenData?.error),
            keys: longTokenData && typeof longTokenData === 'object' ? Object.keys(longTokenData).slice(0, 10) : [],
        }, longTokenResponse.ok ? 'log' : 'warn');
        if (!longTokenResponse.ok || longTokenData.error || !longTokenData.access_token) {
            instagramAuthLog(requestId, 'long_token_failed', {
                responsePreview: typeof longTokenData === 'object' ? JSON.stringify(longTokenData).slice(0, 500) : String(longTokenData).slice(0, 500),
            }, 'warn');
            return res.redirect('/broadcast/?error=' + encodeURIComponent('Could not create a long-lived Instagram authorization. Please try connecting Instagram again.'));
        }

        const accessToken = longTokenData.access_token;
        const expiresIn = longTokenData.expires_in || (60 * 24 * 60 * 60);
        const grantedScopes = await getInstagramGrantedScopes(accessToken);
        const missingRequiredScopes = INSTAGRAM_REQUIRED_SCOPES.filter(scope => !grantedScopes.includes(scope));
        if (missingRequiredScopes.length > 0) {
            return res.redirect('/broadcast/?error=' + encodeURIComponent(
                `Instagram connection is missing required permissions: ${missingRequiredScopes.join(', ')}. Grant the requested Instagram permissions, then try again.`
            ));
        }

        const meResponse = await fetch(
            `${INSTAGRAM_GRAPH_BASE}/me?fields=id,user_id,username,name,profile_picture_url,followers_count,follows_count,media_count&access_token=${accessToken}`
        );
        const meData = await meResponse.json();
        instagramAuthLog(requestId, 'me_result', {
            ok: meResponse.ok,
            status: meResponse.status,
            hasError: Boolean(meData?.error),
            idPresent: Boolean(meData?.id),
            userIdPresent: Boolean(meData?.user_id),
            usernamePresent: Boolean(meData?.username),
        }, meResponse.ok ? 'log' : 'warn');

        if (!meResponse.ok || meData.error || !meData.id) {
            instagramAuthLog(requestId, 'me_failed', {
                responsePreview: typeof meData === 'object' ? JSON.stringify(meData).slice(0, 500) : String(meData).slice(0, 500),
            }, 'warn');
            return res.redirect('/broadcast/?error=' + encodeURIComponent(
                'No Instagram account found. Make sure you selected the Instagram business login setup and approved the Instagram permissions.'
            ));
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
            platform: 'instagram',
            platform_user_id: meData.id,
            account_name: meData.username || meData.name || 'instagram',
            access_token: accessToken,
            refresh_token: null,
            token_expires_at: tokenExpiresAt,
            scopes: [...new Set(grantedScopes)],
            metadata: {
                profile_picture: meData.profile_picture_url,
                ig_user_id: meData.id,
                instagram_user_id: meData.user_id || null,
                display_name: meData.name || meData.username || 'Instagram account',
                username: meData.username || '',
                followers_count: meData.followers_count,
                following_count: meData.follows_count,
                media_count: meData.media_count,
                account_type: 'Business',
            },
        }, dbUserId, 'instagram');

        if (saveError) {
            console.error('[Instagram] Save error:', saveError);
            return res.redirect('/broadcast/?error=Failed to save account');
        }

        await subscribeInstagramWebhooks(accessToken, requestId);

        return res.redirect('/broadcast/?success=true&platform=instagram&accounts=1');

    } catch (error) {
        console.error('Instagram OAuth Error:', error);
        return res.redirect(`/broadcast/?error=${encodeURIComponent(error.message)}`);
    }
}

// Enrolls the connected account for webhook delivery. Without this, Meta never
// sends comment or message events for the account and every automation is silent.
// Non-fatal: a connection that isn't subscribed is still usable and can be
// re-subscribed later, so failures are logged rather than surfaced to the user.
async function subscribeInstagramWebhooks(accessToken, requestId) {
    try {
        const response = await fetch(`${INSTAGRAM_GRAPH_BASE}/me/subscribed_apps`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                subscribed_fields: 'comments,messages',
                access_token: accessToken,
            }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.error || !data.success) {
            instagramAuthLog(requestId, 'webhook_subscribe_failed', {
                status: response.status,
                error: data.error?.message || null,
            }, 'warn');
            return false;
        }
        instagramAuthLog(requestId, 'webhook_subscribe_succeeded');
        return true;
    } catch (error) {
        instagramAuthLog(requestId, 'webhook_subscribe_failed', { error: error.message }, 'warn');
        return false;
    }
}

async function getInstagramGrantedScopes(accessToken) {
    try {
        const appId = process.env.INSTAGRAM_APP_ID || process.env.FACEBOOK_APP_ID;
        const appSecret = process.env.INSTAGRAM_APP_SECRET || process.env.FACEBOOK_APP_SECRET;
        const debugUrl = new URL('https://graph.facebook.com/debug_token');
        debugUrl.searchParams.set('input_token', accessToken);
        debugUrl.searchParams.set('access_token', `${appId}|${appSecret}`);

        const response = await fetch(debugUrl);
        const payload = await response.json();
        const data = payload.data || {};

        if (response.ok && !payload.error) {
            const granularScopes = (data.granular_scopes || []).map(entry => entry.scope).filter(Boolean);
            const scopes = [...new Set([...(data.scopes || []), ...granularScopes])];
            if (scopes.length > 0) {
                return scopes;
            }
        }
    } catch (error) {
        console.warn('[Instagram OAuth] permission_introspection_failed', error.message);
    }

    console.warn('[Instagram OAuth] permission_introspection_unavailable_falling_back_to_requested_scopes');
    return INSTAGRAM_REQUESTED_SCOPES;
}

async function inspectFacebookToken(accessToken, appId, appSecret) {
    const debugUrl = new URL(`${INSTAGRAM_GRAPH_BASE}/debug_token`);
    debugUrl.searchParams.set('input_token', accessToken);
    debugUrl.searchParams.set('access_token', `${appId}|${appSecret}`);
    const response = await fetch(debugUrl);
    const payload = await response.json();
    const data = payload.data || {};
    const granularScopes = (data.granular_scopes || []).map(entry => entry.scope);
    return {
        isValid: response.ok && !payload.error && data.is_valid === true,
        scopes: [...new Set([...(data.scopes || []), ...granularScopes])],
    };
}

// ============== TIKTOK ==============
async function handleTikTok(req, res) {
    const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
    const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

    const { code, state, error: oauthError, error_description } = req.query;

    const baseUrl = getPublicBaseUrl(req);
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

    const baseUrl = getPublicBaseUrl(req);
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

    const baseUrl = getPublicBaseUrl(req);
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

    const baseUrl = getPublicBaseUrl(req);
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
            const savedRefreshToken = refresh_token || await getExistingRefreshToken(supabase, userId, 'youtube', channelId);

            if (!savedRefreshToken) {
                return res.redirect('/broadcast/?error=' + encodeURIComponent(
                    'YouTube did not return a refresh token. Remove Lexaya from your Google account access, then connect YouTube again.'
                ));
            }

            const { error: saveError } = await upsertAccount(supabase, {
                user_id: userId,
                platform: 'youtube',
                platform_user_id: channelId,
                account_name: channelTitle,
                access_token: access_token,
                refresh_token: savedRefreshToken,
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
            }, userId, 'youtube', { replaceLegacyWithoutProviderId: true });

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
