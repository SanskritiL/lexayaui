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
        const accessToken = account.access_token;

        // Initialize video upload with TikTok using FILE_UPLOAD source
        // This is for direct upload, not pull from URL
        console.log('[TIKTOK] Initializing video upload...');

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
                    chunk_size: chunkSize || fileSizeBytes, // Single chunk for simplicity
                    total_chunk_count: totalChunkCount || 1,
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
