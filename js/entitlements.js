// What the signed-in user has paid for.
//
// Two plans: 'dm' (Get Lexaya — Instagram comment-to-DM automation) and 'pro'
// (Lexaya Pro — DM automation plus multi-platform publishing). Pro is a
// superset of dm.
//
// This is UX only. It decides what the page renders, not what the backend
// permits — the API enforces the same rules from api/_entitlements.js, because
// anything decided in the browser can be edited in the browser.
//
// Load after /js/config.js and /js/supabase.js.

const LEXAYA_TIERS = {
    // Plans that satisfy each capability, best tier last.
    dm_automation: ['dm', 'pro'],
    multi_platform_publishing: ['pro'],
};

// Rows written before the two-tier split all carry 'broadcast' and paid for
// publishing, so they are honored as pro.
const LEXAYA_LEGACY_KEYS = { broadcast: 'pro' };

const TIER_CACHE_TTL = 5 * 60 * 1000;

window.LEXAYA_ENTITLEMENTS = {
    // 'none' | 'dm' | 'pro'. Admins are always pro.
    async getTier(user, { fresh = false } = {}) {
        if (!user) return 'none';
        if (window.LEXAYA_AUTH.isAdmin?.(user)) return 'pro';

        if (fresh) window.LEXAYA_CACHE.invalidate('tier');
        return await window.LEXAYA_CACHE.get('tier', TIER_CACHE_TTL, async () => {
            // Pages vary in whether they have called initSupabase() yet.
            const client = window.LEXAYA_SUPABASE_CLIENT
                || (typeof initSupabase === 'function' ? initSupabase() : null);
            if (!client) return undefined;

            const { data, error } = await client
                .from('subscriptions')
                .select('product_key')
                .eq('customer_email', user.email)
                .eq('status', 'active');

            // On error, assume no access rather than granting it by default.
            if (error) {
                console.warn('[Lexaya] Could not read subscription', error.message);
                return undefined; // not cached; retried on next call
            }

            const keys = (data || []).map(row => LEXAYA_LEGACY_KEYS[row.product_key] || row.product_key);
            if (keys.includes('pro')) return 'pro';
            if (keys.includes('dm')) return 'dm';
            return 'none';
        }) || 'none';
    },

    async can(user, capability) {
        const tier = await this.getTier(user);
        return (LEXAYA_TIERS[capability] || []).includes(tier);
    },

    // Send a user who lacks `capability` to the pricing page. Returns true when
    // the caller should stop rendering.
    async gate(user, capability) {
        if (await this.can(user, capability)) return false;
        const next = encodeURIComponent(window.location.pathname);
        window.location.href = `/broadcast/pricing.html?upgrade=${capability}&next=${next}`;
        return true;
    },
};
