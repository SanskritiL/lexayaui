// LinkedIn Video Upload Initialization
// Returns uploadUrl for direct browser upload

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
    console.log('[LINKEDIN-INIT] Starting video init...');

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
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
        return res.status(401).json({ error: 'Invalid token' });
    }

    const { fileSizeBytes } = req.body;

    if (!fileSizeBytes) {
        return res.status(400).json({ error: 'fileSizeBytes required' });
    }

    try {
        // Get LinkedIn account
        const { data: account, error: accountError } = await supabase
            .from('connected_accounts')
            .select('*')
            .eq('user_id', user.id)
            .eq('platform', 'linkedin')
            .single();

        if (accountError || !account) {
            console.log('[LINKEDIN-INIT] No LinkedIn account found');
            return res.status(400).json({ error: 'LinkedIn account not connected' });
        }

        const { access_token } = account;

        // Get user profile for author URN
        const profileResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
            headers: { Authorization: `Bearer ${access_token}` },
        });

        if (!profileResponse.ok) {
            const errorText = await profileResponse.text();
            console.error('[LINKEDIN-INIT] Profile error:', errorText);
            return res.status(500).json({ error: 'Failed to get LinkedIn profile' });
        }

        const profile = await profileResponse.json();
        const authorUrn = `urn:li:person:${profile.sub}`;
        console.log('[LINKEDIN-INIT] Author URN:', authorUrn);

        // Initialize video upload
        const headers = {
            'Authorization': `Bearer ${access_token}`,
            'Content-Type': 'application/json',
            'X-Restli-Protocol-Version': '2.0.0',
            'LinkedIn-Version': '202411',
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

        console.log('[LINKEDIN-INIT] Register response status:', registerResponse.status);

        if (!registerResponse.ok) {
            const errorText = await registerResponse.text();
            console.error('[LINKEDIN-INIT] Register error:', errorText);
            return res.status(500).json({ error: 'Failed to initialize LinkedIn upload: ' + errorText });
        }

        const registerData = await registerResponse.json();
        console.log('[LINKEDIN-INIT] Register data:', JSON.stringify(registerData, null, 2));

        const { uploadInstructions, video: videoUrn } = registerData.value;

        // LinkedIn returns upload instructions with one or more upload URLs
        // For smaller files, it's usually just one URL
        const uploadUrl = uploadInstructions[0]?.uploadUrl;

        if (!uploadUrl) {
            console.error('[LINKEDIN-INIT] No upload URL in response');
            return res.status(500).json({ error: 'No upload URL received from LinkedIn' });
        }

        console.log('[LINKEDIN-INIT] Success! Video URN:', videoUrn);

        return res.status(200).json({
            uploadUrl,
            videoUrn,
            authorUrn,
            uploadInstructions, // In case client needs chunked upload info
        });

    } catch (error) {
        console.error('[LINKEDIN-INIT] Error:', error.message);
        return res.status(500).json({ error: error.message });
    }
}
