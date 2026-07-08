// Public browser configuration.
//
// These values are safe to expose to browsers, but forks should replace them
// with their own Supabase project, Stripe publishable key, API URLs, and price
// IDs. Deployments can either edit this file directly or define
// window.LEXAYA_CONFIG before loading /js/config.js.
window.CONFIG = {
    SUPABASE_URL: window.LEXAYA_CONFIG?.SUPABASE_URL || 'https://bcyhcsphmqizzvzmdqxc.supabase.co',
    SUPABASE_ANON_KEY: window.LEXAYA_CONFIG?.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjeWhjc3BobXFpenp2em1kcXhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYxNjEwMjQsImV4cCI6MjA4MTczNzAyNH0.8CGKr_2IzxmdcCidKE0pIpsGJnkDKIYmNxDtns2ZRFk',
    STRIPE_PUBLISHABLE_KEY: window.LEXAYA_CONFIG?.STRIPE_PUBLISHABLE_KEY || 'pk_live_51R1BXqA1WPL5LnBtyn66feXbCMeWT1VIwyKSfkJ8Ydy6BVGRT6jN6tZZcALLfL7w2lVdkfZh6SdLsSTWKL9ZwIql005XoAQ4NP',
    APP_BASE_URL: window.LEXAYA_CONFIG?.APP_BASE_URL || 'https://lexaya.io',
    API_BASE_URL: window.LEXAYA_CONFIG?.API_BASE_URL ?? '',
    PUBLISH_BASE_URL: window.LEXAYA_CONFIG?.PUBLISH_BASE_URL || 'https://publish-service-266355090145.us-central1.run.app',
    ADMIN_EMAILS: window.LEXAYA_CONFIG?.ADMIN_EMAILS || ['sanslamsal6@gmail.com'],
    PRODUCTS: {
        freeDigital: window.LEXAYA_CONFIG?.PRODUCTS?.freeDigital || 'price_1SgEPNA1WPL5LnBtS2DTcsDz',
        regularDigital: window.LEXAYA_CONFIG?.PRODUCTS?.regularDigital || 'price_1SgDWdA1WPL5LnBtIYjfgFIx',
        videoBundle5: window.LEXAYA_CONFIG?.PRODUCTS?.videoBundle5 || 'price_1SgDO4A1WPL5LnBtArUCHkY7',
        videoBundle20: window.LEXAYA_CONFIG?.PRODUCTS?.videoBundle20 || 'price_1SgEmVA1WPL5LnBtw8pU7kBE',
        broadcastPro: window.LEXAYA_CONFIG?.PRODUCTS?.broadcastPro || 'price_1T1ogBA1WPL5LnBtEQBc2ZXx',
    },
};

if (!window.CONFIG.SUPABASE_URL || !window.CONFIG.SUPABASE_ANON_KEY) {
    console.warn('[Lexaya] Missing Supabase browser config. Update js/config.js before running the app.');
}

var CONFIG = window.CONFIG;
