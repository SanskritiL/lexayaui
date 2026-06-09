/**
 * Tests for the Stripe payment flow:
 * 1. Checkout creates a one-time payment session pointing to connect page
 * 2. Webhook saves purchase AND creates subscription record for access
 * 3. Pricing page sends correct parameters
 */

// --- Mock Stripe ---
const mockSessionCreate = jest.fn();
const mockConstructEvent = jest.fn();

jest.mock('stripe', () => {
    return jest.fn(() => ({
        checkout: { sessions: { create: mockSessionCreate } },
        webhooks: { constructEvent: mockConstructEvent },
    }));
});

// --- Mock Supabase ---
const mockInsert = jest.fn().mockResolvedValue({ error: null });
const mockUpsert = jest.fn().mockResolvedValue({ error: null });
const mockFrom = jest.fn((table) => ({
    insert: mockInsert,
    upsert: mockUpsert,
}));

jest.mock('@supabase/supabase-js', () => ({
    createClient: jest.fn(() => ({ from: mockFrom })),
}));

// --- Helpers ---
function mockRes() {
    const res = {
        statusCode: null,
        headers: {},
        body: null,
        setHeader(k, v) { res.headers[k] = v; },
        status(code) { res.statusCode = code; return res; },
        json(data) { res.body = data; return res; },
        end() { return res; },
    };
    return res;
}

// ====================================================
// CREATE-CHECKOUT TESTS
// ====================================================
describe('create-checkout API', () => {
    let handler;

    beforeEach(() => {
        jest.clearAllMocks();
        mockSessionCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/test' });
        handler = require('../api/create-checkout');
    });

    test('creates session with mode "payment" for one-time purchase', async () => {
        const req = {
            method: 'POST',
            headers: { origin: 'https://lexaya.io' },
            body: {
                priceId: 'price_1T1ogBA1WPL5LnBtEQBc2ZXx',
                userEmail: 'user@example.com',
                userId: 'user-123',
                productKey: 'broadcast',
                mode: 'payment',
                successUrl: 'https://lexaya.io/broadcast/connect.html?subscribed=true',
            },
        };
        const res = mockRes();

        await handler(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body.url).toBe('https://checkout.stripe.com/test');

        const config = mockSessionCreate.mock.calls[0][0];
        expect(config.mode).toBe('payment');
        expect(config.line_items[0].price).toBe('price_1T1ogBA1WPL5LnBtEQBc2ZXx');
        expect(config.success_url).toBe('https://lexaya.io/broadcast/connect.html?subscribed=true');
        expect(config.metadata.productKey).toBe('broadcast');
        expect(config.metadata.userId).toBe('user-123');
        expect(config.customer_email).toBe('user@example.com');
    });

    test('success_url points to connect page, not broadcast index', async () => {
        const req = {
            method: 'POST',
            headers: { origin: 'https://lexaya.io' },
            body: {
                priceId: 'price_1T1ogBA1WPL5LnBtEQBc2ZXx',
                mode: 'payment',
                successUrl: 'https://lexaya.io/broadcast/connect.html?subscribed=true',
            },
        };
        const res = mockRes();

        await handler(req, res);

        const config = mockSessionCreate.mock.calls[0][0];
        expect(config.success_url).toContain('/broadcast/connect.html');
        expect(config.success_url).not.toBe('https://lexaya.io/broadcast/?subscribed=true');
    });

    test('does not include subscription_data for payment mode', async () => {
        const req = {
            method: 'POST',
            headers: { origin: 'https://lexaya.io' },
            body: {
                priceId: 'price_test',
                mode: 'payment',
                trialDays: 7,
            },
        };
        const res = mockRes();

        await handler(req, res);

        const config = mockSessionCreate.mock.calls[0][0];
        expect(config.mode).toBe('payment');
        expect(config.subscription_data).toBeUndefined();
    });

    test('rejects requests without priceId', async () => {
        const req = {
            method: 'POST',
            headers: {},
            body: {},
        };
        const res = mockRes();

        await handler(req, res);

        expect(res.statusCode).toBe(400);
        expect(res.body.error).toContain('Price ID');
    });
});

// ====================================================
// WEBHOOK TESTS
// ====================================================
describe('webhook - one-time payment flow', () => {
    let handler;

    beforeEach(() => {
        jest.clearAllMocks();
        mockInsert.mockResolvedValue({ error: null });
        mockUpsert.mockResolvedValue({ error: null });
        handler = require('../api/webhook');
    });

    function makeReq(event) {
        mockConstructEvent.mockReturnValue(event);
        // Create a readable stream from a buffer
        const buf = Buffer.from(JSON.stringify(event));
        const readable = {
            [Symbol.asyncIterator]() {
                let done = false;
                return {
                    next() {
                        if (done) return Promise.resolve({ done: true });
                        done = true;
                        return Promise.resolve({ value: buf, done: false });
                    },
                };
            },
        };
        return {
            method: 'POST',
            headers: { 'stripe-signature': 'sig_test' },
            [Symbol.asyncIterator]: readable[Symbol.asyncIterator].bind(readable),
        };
    }

    test('saves purchase to purchases table for one-time payment', async () => {
        const event = {
            type: 'checkout.session.completed',
            data: {
                object: {
                    id: 'cs_test_123',
                    mode: 'payment',
                    amount_total: 299,
                    customer: 'cus_abc',
                    customer_details: { email: 'buyer@example.com' },
                    metadata: { userId: 'user-456', productKey: 'broadcast' },
                },
            },
        };

        const res = mockRes();
        await handler(makeReq(event), res);

        expect(res.statusCode).toBe(200);

        // Should write to purchases table
        const purchasesCalls = mockFrom.mock.calls.filter(c => c[0] === 'purchases');
        expect(purchasesCalls.length).toBeGreaterThanOrEqual(1);

        expect(mockInsert).toHaveBeenCalledWith([
            expect.objectContaining({
                user_id: 'user-456',
                stripe_session_id: 'cs_test_123',
                amount: 299,
                product_id: 'broadcast',
                customer_email: 'buyer@example.com',
                status: 'completed',
            }),
        ]);
    });

    test('also creates subscription record for one-time payment (access check)', async () => {
        const event = {
            type: 'checkout.session.completed',
            data: {
                object: {
                    id: 'cs_test_123',
                    mode: 'payment',
                    amount_total: 299,
                    customer: 'cus_abc',
                    customer_details: { email: 'buyer@example.com' },
                    metadata: { userId: 'user-456', productKey: 'broadcast' },
                },
            },
        };

        const res = mockRes();
        await handler(makeReq(event), res);

        // Should ALSO write to subscriptions table
        const subCalls = mockFrom.mock.calls.filter(c => c[0] === 'subscriptions');
        expect(subCalls.length).toBeGreaterThanOrEqual(1);

        expect(mockUpsert).toHaveBeenCalledWith(
            [
                expect.objectContaining({
                    user_id: 'user-456',
                    customer_email: 'buyer@example.com',
                    stripe_customer_id: 'cus_abc',
                    product_key: 'broadcast',
                    status: 'active',
                }),
            ],
            { onConflict: 'customer_email,product_key' }
        );
    });

    test('subscription record uses status "active" so access checks pass', async () => {
        const event = {
            type: 'checkout.session.completed',
            data: {
                object: {
                    id: 'cs_test_123',
                    mode: 'payment',
                    amount_total: 299,
                    customer: 'cus_abc',
                    customer_details: { email: 'buyer@example.com' },
                    metadata: { userId: 'user-456', productKey: 'broadcast' },
                },
            },
        };

        const res = mockRes();
        await handler(makeReq(event), res);

        // The subscription record must have status 'active' because
        // broadcast pages query: .eq('status', 'active')
        const upsertArgs = mockUpsert.mock.calls[0][0][0];
        expect(upsertArgs.status).toBe('active');
        expect(upsertArgs.product_key).toBe('broadcast');
    });

    test('uses customer_email for subscription so email-based access checks work', async () => {
        const event = {
            type: 'checkout.session.completed',
            data: {
                object: {
                    id: 'cs_test_123',
                    mode: 'payment',
                    amount_total: 299,
                    customer: 'cus_abc',
                    customer_details: { email: 'buyer@example.com' },
                    metadata: { userId: 'user-456', productKey: 'broadcast' },
                },
            },
        };

        const res = mockRes();
        await handler(makeReq(event), res);

        // Access checks use: .eq('customer_email', currentUser.email).eq('product_key', 'broadcast')
        const upsertArgs = mockUpsert.mock.calls[0][0][0];
        expect(upsertArgs.customer_email).toBe('buyer@example.com');
    });
});

// ====================================================
// PRICING PAGE PARAMETER TESTS (static analysis)
// ====================================================
describe('pricing.html configuration', () => {
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(
        path.join(__dirname, '../broadcast/pricing.html'),
        'utf-8'
    );

    test('uses correct Stripe price ID', () => {
        expect(html).toContain("price_1T1ogBA1WPL5LnBtEQBc2ZXx");
    });

    test('uses payment mode, not subscription', () => {
        expect(html).toContain("mode: 'payment'");
        expect(html).not.toContain("mode: 'subscription'");
    });

    test('success URL points to connect page', () => {
        expect(html).toContain("/broadcast/connect.html?subscribed=true");
        expect(html).not.toMatch(/successUrl:.*\/broadcast\/\?subscribed/);
    });

    test('displays $2.99 one-time price', () => {
        expect(html).toContain('$2.99');
        expect(html).toContain('one-time');
        expect(html).not.toContain('$14.99');
        expect(html).not.toContain('/month');
    });
});
