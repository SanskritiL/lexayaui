const express = require('express');
const cors = require('cors');
const { getClient } = require('./supabase');
const { generateUploadUrl, deleteFile } = require('./storage');
const { publishPost } = require('./publish');
const { completeInstagram } = require('./platforms/instagram');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }));
app.use(express.json({ limit: '1mb' }));

// ── Health ──
// No public endpoints — every route requires auth
app.post('/health', async (req, res) => {
  const user = await verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ status: 'ok', service: 'lexaya-publish-service', userId: user.id, timestamp: new Date().toISOString() });
});

// Head request for uptime monitoring (no auth needed)
app.head('/health', (req, res) => res.status(200).end());

// ── Upload: generate signed URL ──
app.post('/upload', async (req, res) => {
  try {
    const user = await verifyAuth(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { fileName, contentType } = req.body;
    if (!fileName || !contentType) return res.status(400).json({ error: 'Missing fileName or contentType' });

    const result = await generateUploadUrl(fileName, contentType, user.id);
    res.json(result);
  } catch (err) {
    console.error('[UPLOAD] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Upload: delete file ──
app.delete('/upload', async (req, res) => {
  try {
    const user = await verifyAuth(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'Missing key' });
    if (!key.startsWith(`${user.id}/`)) return res.status(403).json({ error: 'Not authorized' });

    await deleteFile(key);
    res.json({ success: true, deleted: key });
  } catch (err) {
    console.error('[DELETE] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Publish: post to platforms ──
app.post('/publish', async (req, res) => {
  try {
    const user = await verifyAuth(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { postId, platforms } = req.body;
    if (!postId || !platforms || !Array.isArray(platforms)) {
      return res.status(400).json({ error: 'postId and platforms array required' });
    }

    console.log(`[PUBLISH] postId=${postId} platforms=${platforms.join(',')} userId=${user.id}`);

    const result = await publishPost(postId, platforms, user.id);
    res.json(result);
  } catch (err) {
    console.error('[PUBLISH] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Instagram completion (called from UI polling) ──
app.post('/instagram-complete', async (req, res) => {
  try {
    const user = await verifyAuth(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { postId } = req.body || {};
    if (!postId) return res.status(400).json({ error: 'postId required' });

    const result = await completeInstagram(postId, user.id);
    res.json(result);
  } catch (err) {
    console.error('[INSTAGRAM-COMPLETE] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Auth helper ──
async function verifyAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.replace('Bearer ', '');
  const supabase = getClient();
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

app.listen(PORT, () => {
  console.log(`[SERVER] Lexaya publish service running on port ${PORT}`);
  console.log(`[SERVER] Health: http://localhost:${PORT}/health`);
});
