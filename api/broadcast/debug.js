// Debug endpoint to check OAuth configuration
// Visit: https://lexaya.io/api/broadcast/debug

module.exports = async function handler(req, res) {
    const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID || '';
    const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID || '';

    // Check for common issues
    const issues = [];

    // LinkedIn checks
    if (!LINKEDIN_CLIENT_ID) {
        issues.push('LINKEDIN_CLIENT_ID is not set');
    } else {
        if (LINKEDIN_CLIENT_ID.includes('\n') || LINKEDIN_CLIENT_ID.includes('%0A')) {
            issues.push('LINKEDIN_CLIENT_ID has newline characters');
        }
        if (LINKEDIN_CLIENT_ID.startsWith(' ') || LINKEDIN_CLIENT_ID.endsWith(' ')) {
            issues.push('LINKEDIN_CLIENT_ID has leading/trailing spaces');
        }
    }

    // Facebook checks
    if (!FACEBOOK_APP_ID) {
        issues.push('FACEBOOK_APP_ID is not set');
    } else {
        if (!/^\d+$/.test(FACEBOOK_APP_ID.trim())) {
            issues.push('FACEBOOK_APP_ID should be numeric only, got: ' + FACEBOOK_APP_ID.substring(0, 20));
        }
        if (FACEBOOK_APP_ID.includes('\n') || FACEBOOK_APP_ID.includes('%0A')) {
            issues.push('FACEBOOK_APP_ID has newline characters');
        }
        if (FACEBOOK_APP_ID.startsWith(' ') || FACEBOOK_APP_ID.endsWith(' ')) {
            issues.push('FACEBOOK_APP_ID has leading/trailing spaces');
        }
    }

    // Check secrets exist (don't show values)
    if (!process.env.LINKEDIN_CLIENT_SECRET) {
        issues.push('LINKEDIN_CLIENT_SECRET is not set');
    }
    if (!process.env.FACEBOOK_APP_SECRET) {
        issues.push('FACEBOOK_APP_SECRET is not set');
    }

    const result = {
        linkedin: {
            client_id_set: !!LINKEDIN_CLIENT_ID,
            client_id_preview: LINKEDIN_CLIENT_ID ? LINKEDIN_CLIENT_ID.substring(0, 8) + '...' : 'NOT SET',
            client_id_length: LINKEDIN_CLIENT_ID.length,
            client_secret_set: !!process.env.LINKEDIN_CLIENT_SECRET,
        },
        facebook: {
            app_id_set: !!FACEBOOK_APP_ID,
            app_id_value: FACEBOOK_APP_ID || 'NOT SET', // App IDs are public, safe to show
            app_id_length: FACEBOOK_APP_ID.length,
            app_secret_set: !!process.env.FACEBOOK_APP_SECRET,
            expected_app_id: '1391901732240133',
            matches_expected: FACEBOOK_APP_ID.trim() === '1391901732240133',
        },
        host: req.headers.host,
        redirect_urls: {
            linkedin: `https://${req.headers.host}/api/broadcast/auth/linkedin`,
            instagram: `https://${req.headers.host}/api/broadcast/auth/instagram`,
        },
        issues: issues,
    };

    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(result);
}
