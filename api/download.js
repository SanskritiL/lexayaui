// Unified Download API - handles both paid and free downloads
// Query params:
//   - session_id: for paid downloads (verifies Stripe purchase)
//   - resource: for free downloads (requires auth)
//   - test=true: test mode for paid downloads

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// Paid product files
const PRODUCT_FILES = {
    'regularDigital': 'paid/ai_engineer_resources_guide.pdf'
};

// Free resource files
const FREE_RESOURCES = {
    'resume': { type: 'file', path: 'free/sans_lamsal_resume.pdf', name: 'FAANG Resume Template' },
    'colleges': { type: 'file', path: 'free/college_with_sch.pdf', name: 'Colleges with Scholarships' },
    'ai-projects': { type: 'page', path: '/cs/ai-projects.html', name: 'AI Project Ideas' },
    'portfolio': { type: 'file', path: 'free/ugc_portfolio_template.pdf', name: 'UGC Portfolio Template' },
    'pitch': { type: 'file', path: 'free/brand_pitch_emails.pdf', name: 'Brand Pitch Email Scripts' },
    'ratecard': { type: 'file', path: 'free/rate_card_template.pdf', name: 'Rate Card Template' },
    'calendar': { type: 'file', path: 'free/content_calendar.pdf', name: 'Content Calendar' }
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

    const { session_id, resource, test } = req.query;

    // Route to appropriate handler
    if (resource) {
        return handleFreeDownload(req, res, resource);
    } else if (session_id || test) {
        return handlePaidDownload(req, res, session_id, test);
    } else {
        return res.status(400).json({ error: 'Either session_id or resource parameter required' });
    }
};

// Handle free downloads (requires login)
async function handleFreeDownload(req, res, resource) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Please log in to access this resource.' });
    }

    const token = authHeader.split(' ')[1];
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
        return res.status(401).json({ error: 'Please log in to access this resource.' });
    }

    const resourceInfo = FREE_RESOURCES[resource];
    if (!resourceInfo) {
        return res.status(404).json({ error: 'Resource not found' });
    }

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
        .createSignedUrl(resourceInfo.path, 3600);

    if (urlError) {
        console.error('Signed URL error:', urlError);
        return res.status(500).json({
            error: 'Could not generate download link. Email sans@lexaya.io for assistance.'
        });
    }

    return res.status(200).json({
        type: 'download',
        downloadUrl: signedUrl.signedUrl,
        resourceName: resourceInfo.name,
        expiresIn: '1 hour'
    });
}

// Handle paid downloads (verifies Stripe purchase)
async function handlePaidDownload(req, res, session_id, test) {
    try {
        // TEST MODE
        if (test === 'true') {
            const testFilePath = PRODUCT_FILES['regularDigital'];
            const { data: signedUrl, error: urlError } = await supabase
                .storage
                .from('resources')
                .createSignedUrl(testFilePath, 7200);

            if (urlError) {
                return res.status(500).json({ error: 'Storage error: ' + urlError.message });
            }

            return res.status(200).json({
                downloadUrl: signedUrl.signedUrl,
                expiresIn: '2 hours',
                testMode: true
            });
        }

        if (!session_id) {
            return res.status(400).json({ error: 'Session ID required' });
        }

        // Verify purchase exists in Supabase
        const { data: purchase, error: purchaseError } = await supabase
            .from('purchases')
            .select('*')
            .eq('stripe_session_id', session_id)
            .single();

        if (purchaseError || !purchase) {
            return res.status(403).json({
                error: 'Purchase not found. If you just paid, please wait a moment and refresh. For help, email sans@lexaya.io'
            });
        }

        const productKey = purchase.product_id;
        const filePath = PRODUCT_FILES[productKey];

        if (!filePath) {
            return res.status(404).json({
                error: 'File not found for this product. Email sans@lexaya.io for assistance.'
            });
        }

        // Generate signed URL (expires in 2 hours)
        const { data: signedUrl, error: urlError } = await supabase
            .storage
            .from('resources')
            .createSignedUrl(filePath, 7200);

        if (urlError) {
            console.error('Signed URL error:', urlError);
            return res.status(500).json({
                error: 'Could not generate download link. Email sans@lexaya.io for assistance.'
            });
        }

        return res.status(200).json({
            downloadUrl: signedUrl.signedUrl,
            expiresIn: '2 hours'
        });

    } catch (error) {
        console.error('Download error:', error);
        return res.status(500).json({
            error: 'Something went wrong. Email sans@lexaya.io for assistance.'
        });
    }
};
