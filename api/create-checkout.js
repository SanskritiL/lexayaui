// Stripe Checkout Session Creator
// Environment variables needed: STRIPE_SECRET_KEY

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { priceId, userEmail, userId, productKey, successUrl, mode } = req.body;

        if (!priceId) {
            return res.status(400).json({ error: 'Price ID is required' });
        }

        const origin = req.headers.origin || 'https://lexaya.io';
        const redirectUrl = successUrl || `${origin}/members.html?success=true`;
        const checkoutMode = mode || 'payment'; // 'payment' or 'subscription'

        const sessionConfig = {
            mode: checkoutMode,
            payment_method_types: ['card'],
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                },
            ],
            metadata: {
                userId: userId || 'guest',
                productKey: productKey || 'unknown',
            },
            success_url: redirectUrl,
            cancel_url: `${origin}/cs/?canceled=true`,
        };

        // Only set customer_email if provided
        if (userEmail) {
            sessionConfig.customer_email = userEmail;
        }

        const session = await stripe.checkout.sessions.create(sessionConfig);

        res.status(200).json({ url: session.url });
    } catch (error) {
        console.error('Stripe error:', error);
        res.status(500).json({ error: error.message });
    }
};
