// Unified Video Upload Initialization
// Handles TikTok and LinkedIn video upload initialization
// Query param: ?platform=tiktok or ?platform=linkedin

const { createClient } = require('@supabase/supabase-js');

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
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Verify authentication
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
        console.log('[AUTH] User verification failed:', userError);
        return res.status(401).json({ error: 'Invalid token' });
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

    let accessToken = account.access_token;

    // Check if token is expired and refresh if needed
    const tokenExpiresAt = new Date(account.token_expires_at);
    const now = new Date();
    const isExpired = tokenExpiresAt <= now;
    const isExpiringSoon = tokenExpiresAt <= new Date(now.getTime() + 5 * 60 * 1000);

    if ((isExpired || isExpiringSoon) && account.refresh_token) {
        console.log('[TIKTOK] Token expired or expiring soon, refreshing...');
        try {
            const refreshResponse = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_key: process.env.TIKTOK_CLIENT_KEY,
                    client_secret: process.env.TIKTOK_CLIENT_SECRET,
                    grant_type: 'refresh_token',
                    refresh_token: account.refresh_token,
                }),
            });

            const refreshData = await refreshResponse.json();
            console.log('[TIKTOK] Refresh response:', JSON.stringify(refreshData, null, 2));

            if (refreshData.access_token) {
                accessToken = refreshData.access_token;
                const newExpiresAt = new Date(Date.now() + (refreshData.expires_in * 1000)).toISOString();

                await supabase
                    .from('connected_accounts')
                    .update({
                        access_token: refreshData.access_token,
                        refresh_token: refreshData.refresh_token || account.refresh_token,
                        token_expires_at: newExpiresAt,
                    })
                    .eq('user_id', user.id)
                    .eq('platform', 'tiktok');

                console.log('[TIKTOK] Token refreshed successfully!');
            } else {
                console.error('[TIKTOK] Token refresh failed:', refreshData.error);
                return res.status(401).json({
                    error: 'TikTok token expired. Please reconnect your TikTok account.',
                    reconnect: true
                });
            }
        } catch (refreshError) {
            console.error('[TIKTOK] Token refresh error:', refreshError.message);
            return res.status(401).json({
                error: 'Failed to refresh TikTok token. Please reconnect your account.',
                reconnect: true
            });
        }
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
        calculatedChunkSize = DEFAULT_CHUNK_SIZE;
        calculatedChunkCount = Math.ceil(fileSizeBytes / calculatedChunkSize);
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
