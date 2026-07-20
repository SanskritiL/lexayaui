const {
  getSupabase,
  setCors,
  handleAccounts,
  handleMedia,
  handleRules,
  handleLogs,
  handleWebhook,
} = require('../_instagram');

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabase = getSupabase();
  const resource = req.query.resource;

  try {
    if (resource !== 'webhook' && ['POST', 'PUT', 'PATCH'].includes(req.method)) {
      req.body = await readJsonBody(req);
    }

    switch (resource) {
      case 'accounts':
        return handleAccounts(req, res, supabase);
      case 'media':
        return handleMedia(req, res, supabase);
      case 'rules':
        return handleRules(req, res, supabase);
      case 'logs':
        return handleLogs(req, res, supabase);
      case 'webhook':
        return handleWebhook(req, res, supabase);
      default:
        return res.status(404).json({ error: `Unknown Instagram resource: ${resource}` });
    }
  } catch (error) {
    console.error('[Instagram API]', error);
    return res.status(error.status || 500).json({ error: error.message || 'Instagram API failed' });
  }
}

module.exports = handler;

module.exports.config = {
  api: {
    bodyParser: false,
  },
};
