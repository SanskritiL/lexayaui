// Single source of truth for what Lexaya sells.
//
// The browser sends an item key and nothing else. Price IDs and the
// entitlements they grant are paired here, server-side, so a caller cannot pay
// for the cheap item while claiming the expensive one.

// Recurring plans. Buying one requires a signed-in user.
const PLANS = {
    dm: {
        priceId: process.env.STRIPE_PRICE_DM || 'price_1TsRAnA1WPL5LnBtoLUi9Siy',
        productKey: 'dm',
        name: 'Get Lexaya',
        amount: 799,
        mode: 'subscription',
        requiresAuth: true,
    },
    pro: {
        priceId: process.env.STRIPE_PRICE_PRO || 'price_1TsQN6A1WPL5LnBtV12xwmX9',
        productKey: 'pro',
        name: 'Lexaya Pro',
        amount: 2500,
        mode: 'subscription',
        requiresAuth: true,
    },
};

// One-time digital downloads sold from /cs. Guest checkout is allowed; the
// buyer is identified by the email Stripe collects.
const DIGITAL = {
    freeDigital: {
        priceId: process.env.STRIPE_PRICE_FREE_DIGITAL || 'price_1SgEPNA1WPL5LnBtS2DTcsDz',
        productKey: 'freeDigital',
        mode: 'payment',
        requiresAuth: false,
    },
    regularDigital: {
        priceId: process.env.STRIPE_PRICE_REGULAR_DIGITAL || 'price_1SgDWdA1WPL5LnBtIYjfgFIx',
        productKey: 'regularDigital',
        mode: 'payment',
        requiresAuth: false,
    },
    videoBundle5: {
        priceId: process.env.STRIPE_PRICE_VIDEO_BUNDLE_5 || 'price_1SgDO4A1WPL5LnBtArUCHkY7',
        productKey: 'videoBundle5',
        mode: 'payment',
        requiresAuth: false,
    },
    videoBundle20: {
        priceId: process.env.STRIPE_PRICE_VIDEO_BUNDLE_20 || 'price_1SgEmVA1WPL5LnBtw8pU7kBE',
        productKey: 'videoBundle20',
        mode: 'payment',
        requiresAuth: false,
    },
};

const CATALOG = { ...PLANS, ...DIGITAL };

// Which plans grant a capability. 'pro' is a superset of 'dm'.
const CAPABILITIES = {
    dm_automation: ['dm', 'pro'],
    multi_platform_publishing: ['pro'],
};

// Subscriptions written before the two-tier split all carry product_key
// 'broadcast' and paid for multi-platform publishing, so they map to pro.
const LEGACY_PRODUCT_KEYS = {
    broadcast: 'pro',
};

function getCatalogItem(key) {
    return CATALOG[String(key || '')] || null;
}

// Reverse lookup: what did this Stripe price actually buy? The webhook uses
// this instead of trusting the productKey the browser sent.
function itemForPriceId(priceId) {
    if (!priceId) return null;
    return Object.values(CATALOG).find(item => item.priceId === priceId) || null;
}

function normalizeProductKey(productKey) {
    const key = String(productKey || '');
    return LEGACY_PRODUCT_KEYS[key] || key;
}

function hasCapability(productKeys, capability) {
    const allowed = CAPABILITIES[capability];
    if (!allowed) return false;
    return (productKeys || [])
        .map(normalizeProductKey)
        .some(key => allowed.includes(key));
}

module.exports = {
    PLANS,
    DIGITAL,
    CATALOG,
    CAPABILITIES,
    getCatalogItem,
    itemForPriceId,
    normalizeProductKey,
    hasCapability,
};
