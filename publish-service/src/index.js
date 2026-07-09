const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { getClient } = require('./supabase');
const { getAdmin } = require('./firebase');
const { publishPost } = require('./publish');
const { completeInstagram } = require('./platforms/instagram');
const { createR2Upload, verifyR2Upload } = require('./storage');
const { processScheduledPosts, verifySchedulerAuth } = require('./scheduler');

const app = express();
const PORT = process.env.PORT || 8080;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
});

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }));
app.use(express.json({ limit: '10mb' }));

// ── Health ──
app.post('/health', async (req, res) => {
  const user = await verifyPublishAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ status: 'ok', service: 'lexaya-publish-service', userId: user.id, timestamp: new Date().toISOString() });
});

app.head('/health', (req, res) => res.status(200).end());

// ── Publish: post to platforms ──
app.post('/publish', async (req, res) => {
  try {
    const user = await verifyPublishAuth(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { postId, platforms } = req.body;
    if (!postId || !platforms || !Array.isArray(platforms)) {
      return res.status(400).json({ error: 'postId and platforms array required' });
    }

    console.log(`[PUBLISH] postId=${postId} platforms=${platforms.join(',')} userId=${user.id}`);

    const result = await publishPost(postId, platforms, user.id, (platform, stage, message, pct) => {
      console.log(`[PROGRESS] ${platform}: ${stage} - ${message}`);
    });
    res.json(result);
  } catch (err) {
    console.error('[PUBLISH] Error:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ── Publish with file (multipart upload) ──
async function handlePublishWithFile(req, res) {
  try {
    const user = await verifyPublishAuth(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { postId, platforms: platformsStr } = req.body;
    const fileBuffer = req.file?.buffer;

    if (!postId) return res.status(400).json({ error: 'postId required' });
    if (!platformsStr) return res.status(400).json({ error: 'platforms required' });

    const platforms = JSON.parse(platformsStr);
    if (!Array.isArray(platforms)) return res.status(400).json({ error: 'platforms must be a JSON array' });

    console.log(`[PUBLISH-WITH-FILE] postId=${postId} platforms=${platforms.join(',')} userId=${user.id} fileSize=${fileBuffer ? (fileBuffer.length / 1024 / 1024).toFixed(1) : 0}MB`);

    const result = await publishPost(postId, platforms, user.id, (platform, stage, message, pct) => {
      console.log(`[PROGRESS] ${platform}: ${stage} - ${message}`);
    }, fileBuffer);

    res.json(result);
  } catch (err) {
    console.error('[PUBLISH-WITH-FILE] Error:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
}

app.post('/publish/with-file', upload.single('file'), handlePublishWithFile);
app.post('/with-file', upload.single('file'), handlePublishWithFile);

// ── Direct media upload: return a presigned R2 PUT URL ──
app.post('/uploads/r2-url', async (req, res) => {
  try {
    const user = await verifyPublishAuth(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const upload = await createR2Upload({
      userId: user.id,
      fileName: req.body?.fileName,
      contentType: req.body?.contentType,
      fileSizeBytes: req.body?.fileSizeBytes,
      fileSha256: req.body?.fileSha256,
    });

    res.json(upload);
  } catch (err) {
    console.error('[R2-UPLOAD] Error:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/uploads/r2-verify', async (req, res) => {
  try {
    const user = await verifyPublishAuth(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const verification = await verifyR2Upload({
      userId: user.id,
      key: req.body?.key,
      fileSizeBytes: req.body?.fileSizeBytes,
      contentType: req.body?.contentType,
    });

    res.json(verification);
  } catch (err) {
    console.error('[R2-VERIFY] Error:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ── Instagram completion (called from UI polling) ──
app.post('/instagram-complete', async (req, res) => {
  try {
    const user = await verifyPublishAuth(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { postId, resultKey } = req.body || {};
    if (!postId) return res.status(400).json({ error: 'postId required' });

    const result = await completeInstagram(postId, user.id, resultKey);
    res.json(result);
  } catch (err) {
    console.error('[INSTAGRAM-COMPLETE] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Broadcast publish (action-based routing from Vercel rewrite) ──
// POST /broadcast/publish              → publish to platforms
// POST /broadcast/publish?action=instagram-complete → complete Instagram
app.all('/broadcast/publish', async (req, res) => {
  try {
    const user = await verifyPublishAuth(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const action = req.query.action;
    const method = req.method;

    // POST /broadcast/publish?action=upload
    if (method === 'POST' && action === 'upload') {
      const upload = await createR2Upload({
        userId: user.id,
        fileName: req.body?.fileName,
        contentType: req.body?.contentType,
        fileSizeBytes: req.body?.fileSizeBytes,
        fileSha256: req.body?.fileSha256,
      });
      return res.json(upload);
    }

    // POST /broadcast/publish?action=verify-upload
    if (method === 'POST' && action === 'verify-upload') {
      const verification = await verifyR2Upload({
        userId: user.id,
        key: req.body?.key,
        fileSizeBytes: req.body?.fileSizeBytes,
        contentType: req.body?.contentType,
      });
      return res.json(verification);
    }

    // GET /broadcast/publish?action=media
    if (method === 'GET' && action === 'media') {
      const supabase = getClient();
      const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 50);
      const { data, error } = await supabase
        .from('posts')
        .select('id, video_url, caption, status, created_at, metadata')
        .eq('user_id', user.id)
        .not('video_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw new Error(`Failed to load uploaded media: ${error.message}`);

      const media = (data || [])
        .filter(post => post.video_url && post.metadata?.r2_key)
        .map(post => ({
          postId: post.id,
          url: post.video_url,
          status: post.status,
          caption: post.caption || '',
          createdAt: post.created_at,
          metadata: {
            r2_key: post.metadata.r2_key,
            file_size_bytes: post.metadata.file_size_bytes || null,
            content_type: post.metadata.content_type || null,
            media_type: post.metadata.media_type || null,
          },
        }));

      return res.json({ media });
    }

    // POST /broadcast/publish (no action) → main publish
    if (method === 'POST' && !action) {
      const { postId, platforms } = req.body;
      if (!postId || !platforms || !Array.isArray(platforms)) {
        return res.status(400).json({ error: 'postId and platforms array required' });
      }
      console.log(`[PUBLISH] postId=${postId} platforms=${platforms.join(',')} userId=${user.id}`);
      const result = await publishPost(postId, platforms, user.id, (platform, stage, message, pct) => {
        console.log(`[PROGRESS] ${platform}: ${stage} - ${message}`);
      });
      return res.json(result);
    }

    // POST /broadcast/publish?action=schedule
    if (method === 'POST' && action === 'schedule') {
      const { postId, localDate, period, timezone } = req.body || {};
      if (!postId || !/^\d{4}-\d{2}-\d{2}$/.test(localDate || '')) {
        return res.status(400).json({ error: 'postId and localDate (YYYY-MM-DD) are required' });
      }
      if (!['am', 'pm'].includes(period)) {
        return res.status(400).json({ error: 'period must be am or pm' });
      }
      if (!timezone || typeof timezone !== 'string' || timezone.length > 100) {
        return res.status(400).json({ error: 'A valid IANA timezone is required' });
      }

      const supabase = getClient();
      const { data, error } = await supabase.rpc('reserve_post_schedule', {
        p_post_id: postId,
        p_user_id: user.id,
        p_local_date: localDate,
        p_period: period,
        p_timezone: timezone,
      });

      if (error) {
        const message = String(error.message || 'Could not schedule post')
          .replace(/^.*\[(SCHEDULE_[A-Z]+)\]\s*/, '');
        const status = error.message?.includes('[SCHEDULE_CONFLICT]') ? 409
          : error.message?.includes('[SCHEDULE_PAST]') ? 422
            : error.message?.includes('[SCHEDULE_NOT_FOUND]') ? 404 : 400;
        return res.status(status).json({ error: message });
      }

      return res.status(201).json({ postId, scheduledAt: data, period, timezone });
    }

    // POST /broadcast/publish?action=instagram-complete
    if (method === 'POST' && action === 'instagram-complete') {
      const { postId, resultKey } = req.body || {};
      if (!postId) return res.status(400).json({ error: 'postId required' });
      const result = await completeInstagram(postId, user.id, resultKey);
      return res.json(result);
    }

    return res.status(400).json({ error: 'Invalid request' });
  } catch (err) {
    console.error('[BROADCAST-PUBLISH] Error:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ── Scheduler: called by Google Cloud Scheduler ──
app.post('/scheduler/process', async (req, res) => {
  if (!verifySchedulerAuth(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const limit = Math.min(Number(req.body?.limit || 5), 25);
    const result = await processScheduledPosts({ limit });
    res.json(result);
  } catch (err) {
    console.error('[SCHEDULER] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/broadcast/scheduler/process', async (req, res) => {
  if (!verifySchedulerAuth(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const limit = Math.min(Number(req.body?.limit || 5), 25);
    const result = await processScheduledPosts({ limit });
    res.json(result);
  } catch (err) {
    console.error('[BROADCAST-SCHEDULER] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.use((err, req, res, next) => {
  if (!err) return next();

  if (err.code === 'LIMIT_FILE_SIZE' || err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'File is too large. Max upload size is 500 MB.' });
  }

  console.error('[SERVER] Unhandled request error:', err.message);
  return res.status(err.statusCode || err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── Auth helper ──
async function verifyPublishAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    console.warn('[AUTH] Missing Authorization header');
    return null;
  }
  if (!authHeader.startsWith('Bearer ')) {
    console.warn('[AUTH] Invalid Authorization header format');
    return null;
  }

  const token = authHeader.replace('Bearer ', '');
  if (!token) {
    console.warn('[AUTH] Empty bearer token');
    return null;
  }

  try {
    const decoded = await getAdmin().auth().verifyIdToken(token);
    return { id: decoded.uid, email: decoded.email || null };
  } catch (err) {
    // Not a Firebase token — fall back to a legacy Supabase access token
    // below until pre-migration sessions have expired.
  }

  const supabase = getClient();
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    console.warn('[AUTH] Firebase and Supabase both rejected token', {
      error: error?.message || null,
      status: error?.status || null,
      hasUser: Boolean(user),
    });
    return null;
  }
  return user;
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[SERVER] Lexaya publish service running on port ${PORT}`);
    console.log(`[SERVER] Health: http://localhost:${PORT}/health`);
  });
}

module.exports = app;
