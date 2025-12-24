// Secure Download API - generates signed URLs for paid content
// Environment variables needed: SUPABASE_URL, SUPABASE_SERVICE_KEY

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// Map product keys to their file paths in Supabase Storage
const PRODUCT_FILES = {
    'regularDigital': 'paid/ai_engineer_resources_guide.pdf'
};

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { session_id, test } = req.query;

        // TEST MODE - remove this block before going live!
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
        // END TEST MODE

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
            .createSignedUrl(filePath, 7200); // 2 hours expiry

        if (urlError) {
            console.error('Signed URL error:', urlError);
            return res.status(500).json({
                error: 'Could not generate download link. Email sans@lexaya.io for assistance.'
            });
        }

        res.status(200).json({
            downloadUrl: signedUrl.signedUrl,
            expiresIn: '2 hours'
        });

    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({
            error: 'Something went wrong. Email sans@lexaya.io for assistance.'
        });
    }
};
