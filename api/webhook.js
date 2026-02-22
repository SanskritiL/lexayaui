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

            // Check if this is a subscription or one-time payment
            if (session.mode === 'subscription') {
                // Handle subscription checkout
                const { error: subError } = await supabase
                    .from('subscriptions')
                    .upsert([{
                        user_id: session.metadata?.userId || null,
                        customer_email: session.customer_details?.email || session.customer_email,
                        stripe_customer_id: session.customer,
                        stripe_subscription_id: session.subscription,
                        product_key: session.metadata?.productKey || 'broadcast',
                        status: 'active',
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    }], { onConflict: 'customer_email,product_key' });

                if (subError) {
                    console.error('Error saving subscription:', subError);
                } else {
                    console.log('Subscription saved:', session.customer_details?.email, session.metadata?.productKey);
                }
            } else {
                // Save one-time purchase to Supabase
                const customerEmail = session.customer_details?.email || session.customer_email;
                const productKey = session.metadata?.productKey || 'unknown';
                const userId = session.metadata?.userId || null;

                const { error } = await supabase
                    .from('purchases')
                    .insert([{
                        user_id: userId,
                        stripe_session_id: session.id,
                        amount: session.amount_total,
                        product_id: productKey,
                        customer_email: customerEmail,
                        status: 'completed',
                        created_at: new Date().toISOString()
                    }]);

                if (error) {
                    console.error('Error saving purchase:', error);
                } else {
                    console.log('Purchase saved:', customerEmail, productKey);
                }

                // Also create a subscription record so access checks work
                // (broadcast pages check the subscriptions table for access)
                const { error: subError } = await supabase
                    .from('subscriptions')
                    .upsert([{
                        user_id: userId,
                        customer_email: customerEmail,
                        stripe_customer_id: session.customer,
                        stripe_subscription_id: session.id, // Use session ID for one-time payments
                        product_key: productKey,
                        status: 'active',
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    }], { onConflict: 'customer_email,product_key' });

                if (subError) {
                    console.error('Error creating subscription record:', subError);
                } else {
                    console.log('Subscription record created for one-time payment:', customerEmail, productKey);
                }
            }
            break;

        case 'customer.subscription.created':
            // Backup handler - checkout.session.completed usually handles this
            const createdSub = event.data.object;
            console.log('Subscription created:', createdSub.id);

            // Only insert if not already exists (upsert)
            await supabase
                .from('subscriptions')
                .upsert([{
                    customer_email: createdSub.customer_email || createdSub.metadata?.email,
                    stripe_customer_id: createdSub.customer,
                    stripe_subscription_id: createdSub.id,
                    product_key: createdSub.metadata?.productKey || 'broadcast',
                    status: createdSub.status,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }], { onConflict: 'stripe_subscription_id', ignoreDuplicates: true });
            break;

        case 'customer.subscription.updated':
            const updatedSub = event.data.object;
            console.log('Subscription updated:', updatedSub.id, updatedSub.status);

            await supabase
                .from('subscriptions')
                .update({
                    status: updatedSub.status,
                    updated_at: new Date().toISOString()
                })
                .eq('stripe_subscription_id', updatedSub.id);
            break;

        case 'customer.subscription.deleted':
            const deletedSub = event.data.object;
            console.log('Subscription canceled:', deletedSub.id);

            await supabase
                .from('subscriptions')
                .update({
                    status: 'canceled',
                    updated_at: new Date().toISOString()
                })
                .eq('stripe_subscription_id', deletedSub.id);
            break;

        case 'invoice.paid':
            // Recurring payment succeeded - ensure subscription stays active
            const paidInvoice = event.data.object;
            if (paidInvoice.subscription) {
                console.log('Invoice paid for subscription:', paidInvoice.subscription);
                await supabase
                    .from('subscriptions')
                    .update({
                        status: 'active',
                        updated_at: new Date().toISOString()
                    })
                    .eq('stripe_subscription_id', paidInvoice.subscription);
            }
            break;

        case 'invoice.payment_failed':
            // Recurring payment failed - mark as past_due
            const failedInvoice = event.data.object;
            if (failedInvoice.subscription) {
                console.log('Invoice payment failed for subscription:', failedInvoice.subscription);
                await supabase
                    .from('subscriptions')
                    .update({
                        status: 'past_due',
                        updated_at: new Date().toISOString()
                    })
                    .eq('stripe_subscription_id', failedInvoice.subscription);
            }
            break;

        case 'customer.subscription.paused':
            const pausedSub = event.data.object;
            console.log('Subscription paused:', pausedSub.id);
            await supabase
                .from('subscriptions')
                .update({
                    status: 'paused',
                    updated_at: new Date().toISOString()
                })
                .eq('stripe_subscription_id', pausedSub.id);
            break;

        default:
            console.log(`Unhandled event type: ${event.type}`);
    }

    res.status(200).json({ received: true });
};
