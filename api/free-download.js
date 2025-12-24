// Free Download API - requires login, generates signed URLs, tracks in database
// Environment variables needed: SUPABASE_URL, SUPABASE_SERVICE_KEY

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// Map resource keys to their file paths in Supabase Storage
// 'page' type resources redirect to a URL instead of generating signed URL
const FREE_RESOURCES = {
    'resume': { type: 'file', path: 'free/sans_lamsal_resume.pdf', name: 'FAANG Resume Template' },
    'colleges': { type: 'file', path: 'free/college_with_sch.pdf', name: 'Colleges with Scholarships' },
    'ai-projects': { type: 'page', path: '/cs/ai-projects.html', name: 'AI Project Ideas' }
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
            return res.status(401).json({ error: 'Please log in to access this resource.' });
        }

        const token = authHeader.split(' ')[1];

        // Verify the user's session
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);

        if (authError || !user) {
            return res.status(401).json({ error: 'Please log in to access this resource.' });
        }

        if (!resource) {
            return res.status(400).json({ error: 'Resource key required' });
        }

        const resourceInfo = FREE_RESOURCES[resource];

        if (!resourceInfo) {
            return res.status(404).json({ error: 'Resource not found' });
        }

        // Track the download/access in database
        await supabase
            .from('purchases')
            .insert([{
                user_id: user.id,
                product_id: resource,
                customer_email: user.email,
                amount: 0,
                status: 'free_access',
                created_at: new Date().toISOString()
            }]);

        // Handle page-type resources (redirect to URL)
        if (resourceInfo.type === 'page') {
            return res.status(200).json({
                type: 'redirect',
                downloadUrl: resourceInfo.path,
                resourceName: resourceInfo.name
            });
        }

        // Handle file-type resources (generate signed URL)
        const { data: signedUrl, error: urlError } = await supabase
            .storage
            .from('resources')
            .createSignedUrl(resourceInfo.path, 3600); // 1 hour expiry

        if (urlError) {
            console.error('Signed URL error:', urlError);
            return res.status(500).json({
                error: 'Could not generate download link. Email sans@lexaya.io for assistance.'
            });
        }

        res.status(200).json({
            type: 'download',
            downloadUrl: signedUrl.signedUrl,
            resourceName: resourceInfo.name,
            expiresIn: '1 hour'
        });

    } catch (error) {
        console.error('Free download error:', error);
        res.status(500).json({
            error: 'Something went wrong. Email sans@lexaya.io for assistance.'
        });
    }
};
