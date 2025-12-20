// Stripe Webhook Handler
// Environment variables needed: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// Disable body parsing for webhook signature verification
module.exports.config = {
    api: {
        bodyParser: false,
    },
};

async function buffer(readable) {
    const chunks = [];
    for await (const chunk of readable) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks);
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const buf = await buffer(req);
    const sig = req.headers['stripe-signature'];

    let event;

    try {
        event = stripe.webhooks.constructEvent(
            buf,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).json({ error: `Webhook Error: ${err.message}` });
    }

    // Handle the event
    switch (event.type) {
        case 'checkout.session.completed':
            const session = event.data.object;

            // Save purchase to Supabase
            const { error } = await supabase
                .from('purchases')
                .insert([{
                    user_id: session.metadata?.userId || null,
                    stripe_session_id: session.id,
                    amount: session.amount_total,
                    product_id: session.metadata?.productKey || 'unknown',
                    customer_email: session.customer_details?.email || session.customer_email,
                    status: 'completed',
                    created_at: new Date().toISOString()
                }]);

            if (error) {
                console.error('Error saving purchase:', error);
            } else {
                console.log('Purchase saved:', session.customer_details?.email, session.metadata?.productKey);
            }
            break;

        case 'payment_intent.payment_failed':
            const failedIntent = event.data.object;
            console.log('Payment failed:', failedIntent.id);
            break;

        default:
            console.log(`Unhandled event type: ${event.type}`);
    }

    res.status(200).json({ received: true });
};
