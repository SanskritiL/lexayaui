// Unified Video Upload Initialization
// Handles TikTok and LinkedIn video upload initialization
// Query param: ?platform=tiktok or ?platform=linkedin

const getClient = require('../_supabase');

module.exports = async function handler(req, res) {
    console.log('========== INIT VIDEO API ==========');

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const platform = req.query.platform;
    if (!platform || !['tiktok', 'linkedin'].includes(platform)) {
        return res.status(400).json({ error: 'platform query param required (tiktok or linkedin)' });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const supabase = getClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Verify authentication
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.log('[AUTH] No authorization header');
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
        console.log('[AUTH] Verification failed');
        return res.status(401).json({ error: 'Unauthorized' });
    }
    console.log('[AUTH] User verified:', user.id);

    const { fileSizeBytes } = req.body;

    if (!fileSizeBytes) {
        return res.status(400).json({ error: 'fileSizeBytes required' });
    }

    try {
        // Get platform account
        const { data: account, error: accountError } = await supabase
            .from('connected_accounts')
            .select('*')
            .eq('user_id', user.id)
            .eq('platform', platform)
            .single();

        if (accountError || !account) {
            console.log(`[${platform.toUpperCase()}] Account not found:`, accountError);
            return res.status(400).json({ error: `${platform} account not connected` });
        }

        console.log(`[${platform.toUpperCase()}] Account found:`, account.account_name);

        if (platform === 'tiktok') {
            return await handleTikTokInit(req, res, supabase, user, account, fileSizeBytes);
        } else {
            return await handleLinkedInInit(req, res, account, fileSizeBytes);
        }

    } catch (error) {
        console.error(`[${platform.toUpperCase()}] Error:`, error.message);
        return res.status(500).json({ error: error.message });
    }
};

// TikTok Video Init
async function handleTikTokInit(req, res, supabase, user, account, fileSizeBytes) {
    console.log('[TIKTOK] Initializing video upload...');
    console.log('[TIKTOK] File size:', fileSizeBytes, 'bytes =', (fileSizeBytes / 1024 / 1024).toFixed(2), 'MB');

    if (!hasTikTokScope(account, 'video.upload')) {
        return res.status(401).json({
            error: 'TikTok needs the video upload permission. Please reconnect your TikTok account.',
            reconnect: true
        });
    }

    let accessToken;
    try {
        accessToken = await getValidTikTokAccessToken(account, supabase);
    } catch (refreshError) {
        console.error('[TIKTOK] Token refresh error:', refreshError.message);
        return res.status(401).json({
            error: refreshError.message,
            reconnect: true
        });
    }

    // TikTok chunk size requirements
    // Min chunk size: 5MB, Max chunk size: 64MB
    const MIN_CHUNK_SIZE = 5 * 1024 * 1024;
    const MAX_CHUNK_SIZE = 64 * 1024 * 1024;
    const DEFAULT_CHUNK_SIZE = 10 * 1024 * 1024;

    let calculatedChunkSize;
    let calculatedChunkCount;

    if (fileSizeBytes <= MAX_CHUNK_SIZE) {
        // Single chunk upload - chunk_size = file size (even if < 5MB, TikTok allows this for single chunks)
        calculatedChunkSize = fileSizeBytes;
        calculatedChunkCount = 1;
        console.log('[TIKTOK] Small file, single chunk upload');
    } else {
        // Multi-chunk upload - use 10MB chunks
        // TikTok requires total_chunk_count = floor(video_size / chunk_size)
        // The final chunk absorbs trailing bytes and can exceed chunk_size (up to 128MB)
        calculatedChunkSize = DEFAULT_CHUNK_SIZE;
        calculatedChunkCount = Math.floor(fileSizeBytes / calculatedChunkSize);
        console.log(`[TIKTOK] Large file, using ${calculatedChunkCount} chunks of ${calculatedChunkSize / 1024 / 1024}MB`);
    }

    const initResponse = await fetch('https://open.tiktokapis.com/v2/post/publish/inbox/video/init/', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({
            source_info: {
                source: 'FILE_UPLOAD',
                video_size: fileSizeBytes,
                chunk_size: calculatedChunkSize,
                total_chunk_count: calculatedChunkCount,
            },
        }),
    });

    console.log('[TIKTOK] Init response status:', initResponse.status);
    const initData = await initResponse.json();
    console.log('[TIKTOK] Init response:', JSON.stringify(initData, null, 2));

    if (initData.error && initData.error.code !== 'ok') {
        console.error('[TIKTOK] Init error:', initData.error);
        return res.status(400).json({
            error: initData.error.message || 'Failed to initialize TikTok upload',
            details: initData.error
        });
    }

    const uploadUrl = initData.data?.upload_url;
    const publishId = initData.data?.publish_id;

    if (!uploadUrl) {
        console.error('[TIKTOK] No upload URL in response');
        return res.status(500).json({ error: 'No upload URL returned from TikTok' });
    }

    console.log('[TIKTOK] Upload URL:', uploadUrl);
    console.log('[TIKTOK] Publish ID:', publishId);

    return res.status(200).json({
        uploadUrl,
        publishId,
        chunkSize: calculatedChunkSize,
        totalChunks: calculatedChunkCount
    });
}

function hasTikTokScope(account, requiredScope) {
    const scopes = Array.isArray(account.scopes)
        ? account.scopes
        : String(account.scopes || '').split(/[,\s]+/);

    return scopes.includes(requiredScope);
}

async function getValidTikTokAccessToken(account, supabase) {
    const tokenExpiresAt = new Date(account.token_expires_at).getTime();
    const shouldRefresh = !Number.isFinite(tokenExpiresAt) || tokenExpiresAt <= Date.now() + 5 * 60 * 1000;

    if (!shouldRefresh) return account.access_token;
    if (!account.refresh_token) throw new Error('TikTok token expired. Please reconnect your TikTok account.');

    console.log('[TIKTOK] Token expired or expiring soon, refreshing...');
    const refreshData = await refreshTikTokAccessToken(account.refresh_token);
    const newExpiresAt = new Date(Date.now() + (Number(refreshData.expires_in) * 1000)).toISOString();

    await supabase
        .from('connected_accounts')
        .update({
            access_token: refreshData.access_token,
            refresh_token: refreshData.refresh_token || account.refresh_token,
            token_expires_at: newExpiresAt,
        })
        .eq('id', account.id);

    console.log('[TIKTOK] Token refreshed successfully!');
    return refreshData.access_token;
}

async function refreshTikTokAccessToken(refreshToken) {
    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

    if (!clientKey || !clientSecret) {
        console.error('[TIKTOK] Cannot refresh token: missing TIKTOK_CLIENT_KEY or TIKTOK_CLIENT_SECRET');
        throw new Error('TikTok token refresh is not configured. Please reconnect your TikTok account.');
    }

    const refreshResponse = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_key: clientKey,
            client_secret: clientSecret,
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
        }),
    });

    const responseText = await refreshResponse.text();
    let refreshData;
    try {
        refreshData = responseText ? JSON.parse(responseText) : {};
    } catch (error) {
        console.error('[TIKTOK] Token refresh returned invalid JSON:', responseText.slice(0, 300));
        throw new Error('TikTok token refresh failed. Please reconnect your TikTok account.');
    }

    if (!refreshResponse.ok || !refreshData.access_token) {
        const errorCode = refreshData.error?.code || refreshData.error || refreshData.code || `HTTP_${refreshResponse.status}`;
        const errorMessage = refreshData.error?.message || refreshData.error_description || refreshData.message || 'Unknown TikTok refresh error';
        console.error('[TIKTOK] Token refresh failed:', { status: refreshResponse.status, errorCode, errorMessage });
        throw new Error('TikTok token expired. Please reconnect your TikTok account.');
    }

    if (!Number.isFinite(Number(refreshData.expires_in))) {
        console.error('[TIKTOK] Token refresh response missing expires_in');
        throw new Error('TikTok token refresh failed. Please reconnect your TikTok account.');
    }

    return refreshData;
}

// LinkedIn Video Init
async function handleLinkedInInit(req, res, account, fileSizeBytes) {
    console.log('[LINKEDIN] Initializing video upload...');
    console.log('[LINKEDIN] File size:', fileSizeBytes, 'bytes =', (fileSizeBytes / 1024 / 1024).toFixed(2), 'MB');

    const { access_token } = account;

    // Get user profile for author URN
    const profileResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!profileResponse.ok) {
        const errorText = await profileResponse.text();
        console.error('[LINKEDIN] Profile error:', errorText);
        return res.status(500).json({ error: 'Failed to get LinkedIn profile' });
    }

    const profile = await profileResponse.json();
    const authorUrn = `urn:li:person:${profile.sub}`;
    console.log('[LINKEDIN] Author URN:', authorUrn);

    // Initialize video upload
    const headers = {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': '202507',
    };

    const registerResponse = await fetch('https://api.linkedin.com/rest/videos?action=initializeUpload', {
        method: 'POST',
        headers,
        body: JSON.stringify({
            initializeUploadRequest: {
                owner: authorUrn,
                fileSizeBytes: fileSizeBytes,
                uploadCaptions: false,
                uploadThumbnail: false,
            },
        }),
    });

    console.log('[LINKEDIN] Register response status:', registerResponse.status);

    if (!registerResponse.ok) {
        const errorText = await registerResponse.text();
        console.error('[LINKEDIN] Register error:', errorText);
        return res.status(500).json({ error: 'Failed to initialize LinkedIn upload: ' + errorText });
    }

    const registerData = await registerResponse.json();
    console.log('[LINKEDIN] Register data:', JSON.stringify(registerData, null, 2));

    const { uploadInstructions, video: videoUrn } = registerData.value;
    const uploadUrl = uploadInstructions[0]?.uploadUrl;

    if (!uploadUrl) {
        console.error('[LINKEDIN] No upload URL in response');
        return res.status(500).json({ error: 'No upload URL received from LinkedIn' });
    }

    console.log('[LINKEDIN] Success! Video URN:', videoUrn);

    return res.status(200).json({
        uploadUrl,
        videoUrn,
        authorUrn,
        uploadInstructions,
    });
}
