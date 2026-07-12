// Stripe Checkout Session Creator
// Environment variables needed: STRIPE_SECRET_KEY

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { verifyToken } = require('./_firebase');
const { getCatalogItem } = require('./_plans');

module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Only a catalog key crosses the wire. The price and the entitlement it
        // grants are paired server-side, so a caller cannot pay for 'dm' and
        // claim 'pro', or pay the $0 price and claim a paid download.
        const { productKey, successUrl, trialDays } = req.body;
        const item = getCatalogItem(productKey);
        if (!item) {
            return res.status(400).json({ error: 'Unknown product' });
        }

        const authHeader = req.headers.authorization || '';
        const user = authHeader.startsWith('Bearer ')
            ? await verifyToken(authHeader.slice('Bearer '.length))
            : null;

        // Subscriptions are tied to an account, so the buyer must be signed in
        // and is taken from the token — never from the request body.
        if (item.requiresAuth && !user) {
            return res.status(401).json({ error: 'Sign in before subscribing' });
        }

        const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
        const host = forwardedHost || req.headers.host;
        const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
        const protocol = forwardedProto || (host?.includes('localhost') ? 'http' : 'https');
        const origin = req.headers.origin || process.env.APP_BASE_URL || (host ? `${protocol}://${host}` : 'http://localhost:3000');

        // Accept only a same-origin path. An attacker-supplied absolute URL
        // would turn checkout into an open redirect.
        const defaultSuccessPath = item.mode === 'subscription'
            ? '/broadcast/connect.html?subscribed=true'
            : '/members.html?success=true';
        const successPath = typeof successUrl === 'string' && successUrl.startsWith('/')
            ? successUrl
            : defaultSuccessPath;

        const sessionConfig = {
            mode: item.mode,
            line_items: [
                {
                    price: item.priceId,
                    quantity: 1,
                },
            ],
            metadata: {
                userId: user?.id || 'guest',
                productKey: item.productKey,
            },
            success_url: `${origin}${successPath}`,
            cancel_url: item.mode === 'subscription'
                ? `${origin}/broadcast/pricing.html?canceled=true`
                : `${origin}/cs/?canceled=true`,
        };

        if (user?.email) {
            sessionConfig.customer_email = user.email;
        }

        if (item.mode === 'subscription') {
            sessionConfig.subscription_data = {
                // Echoed onto the subscription and its invoices, so the
                // lifecycle handlers know which tier a row belongs to.
                metadata: { userId: user.id, productKey: item.productKey },
            };
            if (trialDays) {
                sessionConfig.subscription_data.trial_period_days = parseInt(trialDays, 10);
            }
        }

        const session = await stripe.checkout.sessions.create(sessionConfig);

        res.status(200).json({ url: session.url });
    } catch (error) {
        console.error('Stripe error:', error);
        res.status(500).json({ error: error.message });
    }
};
