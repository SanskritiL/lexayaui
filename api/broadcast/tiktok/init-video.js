// TikTok Video Upload Initialization
// Returns upload URL for direct video upload to TikTok

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
    console.log('========== TIKTOK INIT VIDEO ==========');

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

    // Verify authentication
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
        console.log('[AUTH] User verification failed:', userError);
        return res.status(401).json({ error: 'Invalid token' });
    }
    console.log('[AUTH] User verified:', user.id);

    try {
        const { fileSizeBytes, chunkSize, totalChunkCount } = req.body;
        console.log('[INPUT] File size:', fileSizeBytes, 'bytes');

        if (!fileSizeBytes) {
            return res.status(400).json({ error: 'fileSizeBytes required' });
        }

        // Get TikTok access token from connected accounts
        const { data: account, error: accountError } = await supabase
            .from('connected_accounts')
            .select('*')
            .eq('user_id', user.id)
            .eq('platform', 'tiktok')
            .single();

        if (accountError || !account) {
            console.log('[ERROR] TikTok account not found:', accountError);
            return res.status(400).json({ error: 'TikTok account not connected' });
        }

        console.log('[TIKTOK] Account found:', account.account_name);
        let accessToken = account.access_token;

        // Check if token is expired and refresh if needed
        const tokenExpiresAt = new Date(account.token_expires_at);
        const now = new Date();
        const isExpired = tokenExpiresAt <= now;
        const isExpiringSoon = tokenExpiresAt <= new Date(now.getTime() + 5 * 60 * 1000); // 5 min buffer

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

                    // Update token in database
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

        // Initialize video upload with TikTok using FILE_UPLOAD source
        // This is for direct upload, not pull from URL
        console.log('[TIKTOK] Initializing video upload...');

        // TikTok chunk size requirements: min 5MB, max 64MB
        const MIN_CHUNK_SIZE = 5 * 1024 * 1024;  // 5MB
        const MAX_CHUNK_SIZE = 64 * 1024 * 1024; // 64MB

        // Calculate optimal chunk size
        let calculatedChunkSize = chunkSize || fileSizeBytes;
        let calculatedChunkCount = totalChunkCount || 1;

        if (fileSizeBytes > MAX_CHUNK_SIZE) {
            // Need to split into chunks
            calculatedChunkSize = MAX_CHUNK_SIZE;
            calculatedChunkCount = Math.ceil(fileSizeBytes / calculatedChunkSize);
            console.log(`[TIKTOK] Large file, using ${calculatedChunkCount} chunks of ${(calculatedChunkSize / 1024 / 1024).toFixed(1)}MB`);
        } else if (fileSizeBytes < MIN_CHUNK_SIZE) {
            // Small files still need valid chunk size (use file size)
            calculatedChunkSize = fileSizeBytes;
            calculatedChunkCount = 1;
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
        });

    } catch (error) {
        console.error('========== TIKTOK INIT ERROR ==========');
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
        return res.status(500).json({ error: error.message });
    }
};
