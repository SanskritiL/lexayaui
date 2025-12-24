// Free Download API - requires login, generates signed URLs
// Environment variables needed: SUPABASE_URL, SUPABASE_SERVICE_KEY

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// Map resource keys to their file paths in Supabase Storage
const FREE_FILES = {
    'resume': 'free/sans_lamsal_resume.pdf',
    'colleges': 'free/college_with_sch.pdf'
};

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { resource } = req.query;
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Please log in to download this resource.' });
        }

        const token = authHeader.split(' ')[1];

        // Verify the user's session
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);

        if (authError || !user) {
            return res.status(401).json({ error: 'Please log in to download this resource.' });
        }

        if (!resource) {
            return res.status(400).json({ error: 'Resource key required' });
        }

        const filePath = FREE_FILES[resource];

        if (!filePath) {
            return res.status(404).json({ error: 'Resource not found' });
        }

        // Generate signed URL (expires in 1 hour)
        const { data: signedUrl, error: urlError } = await supabase
            .storage
            .from('resources')
            .createSignedUrl(filePath, 3600); // 1 hour expiry

        if (urlError) {
            console.error('Signed URL error:', urlError);
            return res.status(500).json({
                error: 'Could not generate download link. Email sans@lexaya.io for assistance.'
            });
        }

        res.status(200).json({
            downloadUrl: signedUrl.signedUrl,
            expiresIn: '1 hour'
        });

    } catch (error) {
        console.error('Free download error:', error);
        res.status(500).json({
            error: 'Something went wrong. Email sans@lexaya.io for assistance.'
        });
    }
};
