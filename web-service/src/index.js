const express = require('express');
const cors = require('cors');

const instagramHandler = require('../../api/instagram/[resource]');
const authHandler = require('../../api/broadcast/auth/[platform]');
const analyzeHookHandler = require('../../api/broadcast/analyze-hook');
const initVideoHandler = require('../../api/broadcast/init-video');
const refreshAccountsHandler = require('../../api/broadcast/refresh-accounts');
const checkoutHandler = require('../../api/create-checkout');
const stripeWebhookHandler = require('../../api/webhook');
const downloadHandler = require('../../api/download');
const ensureClaimsHandler = require('../../api/auth/ensure-claims');

const app = express();
const PORT = process.env.PORT || 8080;

app.disable('x-powered-by');
app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'Stripe-Signature', 'X-Hub-Signature-256'],
}));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'lexaya-web-api', timestamp: new Date().toISOString() });
});

// Signature verification requires the exact bytes sent by Stripe and Meta.
app.post('/api/webhook', express.raw({ type: 'application/json', limit: '2mb' }), (req, res) => {
  req.rawBody = req.body;
  return stripeWebhookHandler(req, res);
});

app.get('/api/instagram/webhook', (req, res) => {
  req.query.resource = 'webhook';
  return instagramHandler(req, res);
});

app.post('/api/instagram/webhook', express.raw({ type: 'application/json', limit: '2mb' }), (req, res) => {
  req.rawBody = req.body;
  req.query.resource = 'webhook';
  return instagramHandler(req, res);
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.all('/api/instagram/:resource', (req, res) => {
  req.query.resource = req.params.resource;
  return instagramHandler(req, res);
});

app.all('/api/broadcast/auth/:platform', (req, res) => {
  req.query.platform = req.params.platform;
  return authHandler(req, res);
});

app.all('/api/broadcast/analyze-hook', analyzeHookHandler);
app.all('/api/broadcast/init-video', initVideoHandler);
app.all('/api/broadcast/refresh-accounts', refreshAccountsHandler);
app.all('/api/create-checkout', checkoutHandler);
app.all('/api/download', downloadHandler);
app.all('/api/auth/ensure-claims', ensureClaimsHandler);

app.use((error, _req, res, _next) => {
  console.error('[WEB-API] Unhandled request error:', error);
  if (res.headersSent) return;
  res.status(error.status || error.statusCode || 500).json({
    error: error.message || 'Internal server error',
  });
});

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[WEB-API] Listening on port ${PORT}`);
  });
}

module.exports = app;
