// Public browser configuration.
//
// These values are safe to expose to browsers, but each deployment must use
// its own Supabase project, Stripe publishable key, API URLs, and price IDs.
// Forks can either edit this file directly or define window.LEXAYA_CONFIG
// before loading /js/config.js.
window.CONFIG = {
    SUPABASE_URL: window.LEXAYA_CONFIG?.SUPABASE_URL || '',
    SUPABASE_ANON_KEY: window.LEXAYA_CONFIG?.SUPABASE_ANON_KEY || '',
    STRIPE_PUBLISHABLE_KEY: window.LEXAYA_CONFIG?.STRIPE_PUBLISHABLE_KEY || '',
    APP_BASE_URL: window.LEXAYA_CONFIG?.APP_BASE_URL || window.location.origin,
    API_BASE_URL: window.LEXAYA_CONFIG?.API_BASE_URL ?? '',
    PUBLISH_BASE_URL: window.LEXAYA_CONFIG?.PUBLISH_BASE_URL || '',
    ADMIN_EMAILS: window.LEXAYA_CONFIG?.ADMIN_EMAILS || [],
    PRODUCTS: {
        freeDigital: window.LEXAYA_CONFIG?.PRODUCTS?.freeDigital || '',
        regularDigital: window.LEXAYA_CONFIG?.PRODUCTS?.regularDigital || '',
        videoBundle5: window.LEXAYA_CONFIG?.PRODUCTS?.videoBundle5 || '',
        videoBundle20: window.LEXAYA_CONFIG?.PRODUCTS?.videoBundle20 || '',
        broadcastPro: window.LEXAYA_CONFIG?.PRODUCTS?.broadcastPro || '',
    },
};

if (!window.CONFIG.SUPABASE_URL || !window.CONFIG.SUPABASE_ANON_KEY) {
    console.warn('[Lexaya] Missing Supabase browser config. Update js/config.js before running the app.');
}

var CONFIG = window.CONFIG;
