const crypto = require('crypto');
const getClient = require('./_supabase');

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v25.0';
const GRAPH_BASE = `https://graph.instagram.com/${GRAPH_VERSION}`;

function webhookLog(requestId, stage, details = {}, level = 'log') {
  const safeLevel = ['log', 'warn', 'error'].includes(level) ? level : 'log';
  console[safeLevel]('[Instagram Webhook]', JSON.stringify({ requestId, stage, ...details }));
}

function diagnosticRef(value) {
  if (!value) return null;
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

function getSupabase() {
  return getClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function setCors(res, methods = 'GET,POST,PUT,DELETE,OPTIONS') {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Hub-Signature-256');
}

async function requireUser(req, res, supabase) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    res.status(401).json({ error: 'Invalid token' });
    return null;
  }
  return user;
}

async function getInstagramAccount(supabase, userId, accountId) {
  let query = supabase
    .from('connected_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('platform', 'instagram')
    .order('created_at', { ascending: false });

  if (accountId) query = query.eq('id', accountId);

  const { data, error } = await query.limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

async function graphFetch(path, params = {}, options = {}) {
  const url = new URL(`${GRAPH_BASE}/${path.replace(/^\//, '')}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  });

  const response = await fetch(url.toString(), options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const message = data.error?.message || `Graph API request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.graph = data.error;
    throw error;
  }
  return data;
}

function normalizeRuleInput(body, userId) {
  const variables = body.variables && typeof body.variables === 'object' && !Array.isArray(body.variables)
    ? body.variables
    : {};
  const triggerKeywords = Array.isArray(body.trigger_keywords)
    ? body.trigger_keywords
    : String(body.trigger_keywords || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);

  const triggerPostIds = Array.isArray(body.trigger_post_ids)
    ? body.trigger_post_ids.filter(Boolean)
    : String(body.trigger_post_ids || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);

  if (!body.name?.trim()) throw new Error('Rule name is required');
  if (!triggerKeywords.length) throw new Error('At least one trigger keyword is required');
  if (triggerPostIds.length !== 1) throw new Error('Select exactly one Instagram post or reel');
  if (!body.public_reply_template?.trim()) throw new Error('Public reply message is required');
  if (!body.dm_template?.trim()) throw new Error('DM template is required');

  return {
    user_id: userId,
    name: body.name.trim(),
    trigger_type: 'comment_keyword',
    trigger_keywords: triggerKeywords.map(keyword => keyword.toLowerCase()),
    trigger_post_ids: triggerPostIds,
    trigger_scope: 'specific',
    exclude_keywords: Array.isArray(body.exclude_keywords) ? body.exclude_keywords : null,
    action_type: 'both',
    dm_template: body.dm_template.trim(),
    dm_delay_seconds: Number(body.dm_delay_seconds || 0),
    variables: {
      ...variables,
      public_reply_template: body.public_reply_template.trim(),
    },
    is_active: body.is_active !== false,
    max_dms_per_hour: Number(body.max_dms_per_hour || 50),
  };
}

function renderTemplate(template, context) {
  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    if (context.variables && Object.prototype.hasOwnProperty.call(context.variables, key)) {
      return context.variables[key];
    }
    return context[key] ?? '';
  });
}

function commentTextMatches(rule, text) {
  const lowered = String(text || '').toLowerCase();
  const excluded = rule.exclude_keywords || [];
  if (excluded.some(keyword => lowered.includes(String(keyword).toLowerCase()))) return false;
  return (rule.trigger_keywords || []).some(keyword => lowered.includes(String(keyword).toLowerCase()));
}

function ruleMatchesPost(rule, mediaId) {
  if (rule.trigger_scope !== 'specific') return false;
  return (rule.trigger_post_ids || []).includes(mediaId);
}

async function sendPublicReply(commentId, message, accessToken) {
  const response = await fetch(`${GRAPH_BASE}/${commentId}/replies`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ message }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const error = new Error(data.error?.message || `Instagram comment reply failed (${response.status})`);
    error.status = response.status;
    error.graph = data.error;
    throw error;
  }
  return data;
}

async function sendPrivateReply(igAccountId, commentId, message, accessToken) {
  const response = await fetch(`${GRAPH_BASE}/${igAccountId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      recipient: { comment_id: commentId },
      message: { text: message },
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const error = new Error(data.error?.message || `Instagram private reply failed (${response.status})`);
    error.status = response.status;
    error.graph = data.error;
    throw error;
  }
  return data;
}

function verifyWebhookSignature(req, rawBody) {
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  const signature = req.headers['x-hub-signature-256'];
  const isProduction = process.env.NODE_ENV === 'production' || process.env.K_SERVICE;
  if (!appSecret || !signature) return !isProduction;

  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch (_) {
    return false;
  }
}

async function readRawBody(req) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function extractCommentEvents(payload) {
  const events = [];
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const commentId = value.comment_id || value.id;
      const mediaId = value.media_id || value.media?.id || value.post_id;
      const text = value.text || value.message || '';
      const from = value.from || value.sender || {};
      const igUserId = from.id || value.user_id || value.from_id;
      if (!commentId || !mediaId || !text || !igUserId) continue;
      events.push({
        igAccountId: entry.id || value.ig_id || value.instagram_business_account_id,
        commentId,
        mediaId,
        text,
        igUserId,
        username: from.username || value.username || null,
      });
    }
  }
  return events;
}

async function handleMedia(req, res, supabase) {
  const user = await requireUser(req, res, supabase);
  if (!user) return;

  const account = await getInstagramAccount(supabase, user.id, req.query.account_id);
  if (!account) return res.status(404).json({ error: 'Connect an Instagram Business account first' });

  const fields = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,comments_count,like_count';
  const data = await graphFetch(`${account.platform_user_id}/media`, {
    fields,
    limit: req.query.limit || 25,
    access_token: account.access_token,
  });

  return res.status(200).json({ media: data.data || [], paging: data.paging || null, account });
}

async function handleRules(req, res, supabase) {
  const user = await requireUser(req, res, supabase);
  if (!user) return;

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('automation_rules')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ rules: data || [] });
  }

  if (req.method === 'POST') {
    try {
      const input = normalizeRuleInput(req.body || {}, user.id);
      const { data, error } = await supabase.from('automation_rules').insert(input).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json({ rule: data });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  }

  if (req.method === 'PUT') {
    if (!req.query.id) return res.status(400).json({ error: 'Rule id is required' });
    try {
      const input = normalizeRuleInput(req.body || {}, user.id);
      delete input.user_id;
      const { data, error } = await supabase
        .from('automation_rules')
        .update(input)
        .eq('id', req.query.id)
        .eq('user_id', user.id)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ rule: data });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  }

  if (req.method === 'DELETE') {
    if (!req.query.id) return res.status(400).json({ error: 'Rule id is required' });
    const { error } = await supabase
      .from('automation_rules')
      .delete()
      .eq('id', req.query.id)
      .eq('user_id', user.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleLogs(req, res, supabase) {
  const user = await requireUser(req, res, supabase);
  if (!user) return;

  const { data, error } = await supabase
    .from('dm_log')
    .select('*, automation_rules(name)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(Number(req.query.limit || 50));

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ logs: data || [] });
}

async function handleWebhook(req, res, supabase) {
  const requestId = req.headers['x-cloud-trace-context']?.split('/')[0] || crypto.randomUUID();

  if (req.method === 'GET') {
    const verifyToken = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
    const modeMatches = req.query['hub.mode'] === 'subscribe';
    const tokenMatches = Boolean(verifyToken) && req.query['hub.verify_token'] === verifyToken;
    webhookLog(requestId, 'verification_received', {
      modeMatches,
      tokenConfigured: Boolean(verifyToken),
      tokenMatches,
      challengePresent: Boolean(req.query['hub.challenge']),
    });
    if (modeMatches && tokenMatches) {
      webhookLog(requestId, 'verification_succeeded');
      return res.status(200).send(req.query['hub.challenge']);
    }
    webhookLog(requestId, 'verification_failed', { modeMatches, tokenMatches }, 'warn');
    return res.status(403).send('Verification failed');
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rawBody = await readRawBody(req);
  webhookLog(requestId, 'delivery_received', {
    contentLength: rawBody.length,
    signaturePresent: Boolean(req.headers['x-hub-signature-256']),
  });
  if (!verifyWebhookSignature(req, rawBody)) {
    webhookLog(requestId, 'signature_rejected', {}, 'warn');
    return res.status(401).json({ error: 'Invalid signature', requestId });
  }

  const payload = JSON.parse(rawBody.toString('utf8') || '{}');
  const events = extractCommentEvents(payload);
  const results = [];
  webhookLog(requestId, 'payload_parsed', {
    object: payload.object || null,
    entryCount: Array.isArray(payload.entry) ? payload.entry.length : 0,
    commentEventCount: events.length,
  });

  for (const event of events) {
    const eventRef = diagnosticRef(event.commentId);
    const { data: allAccounts, error: accountError } = await supabase
      .from('connected_accounts')
      .select('*')
      .eq('platform', 'instagram');

    const accounts = (allAccounts || []).filter(account => {
      const metadata = account.metadata || {};
      return account.platform_user_id === event.igAccountId ||
        metadata.ig_user_id === event.igAccountId ||
        metadata.facebook_page_id === event.igAccountId;
    });

    if (accountError || !accounts?.length) {
      webhookLog(requestId, 'account_match_failed', {
        eventRef,
        candidateCount: allAccounts?.length || 0,
        error: accountError?.message || null,
      }, 'warn');
      results.push({ commentId: event.commentId, status: 'skipped', reason: 'No connected account matched webhook event' });
      continue;
    }

    for (const account of accounts) {
      const accountMetadata = account.metadata || {};
      const commenterId = String(event.igUserId);
      if (commenterId === String(account.platform_user_id) || commenterId === String(accountMetadata.ig_user_id || '')) {
        webhookLog(requestId, 'self_comment_skipped', { eventRef });
        results.push({ commentId: event.commentId, status: 'skipped', reason: 'Account-authored comment' });
        continue;
      }

      const { data: rules, error: rulesError } = await supabase
        .from('automation_rules')
        .select('*')
        .eq('user_id', account.user_id)
        .eq('is_active', true)
        .eq('trigger_type', 'comment_keyword');

      if (rulesError) {
        webhookLog(requestId, 'rules_load_failed', { eventRef, error: rulesError.message }, 'error');
        results.push({ commentId: event.commentId, status: 'failed', error: rulesError.message });
        continue;
      }

      const matchingRules = (rules || []).filter(rule =>
        ruleMatchesPost(rule, event.mediaId) && commentTextMatches(rule, event.text)
      );
      webhookLog(requestId, 'rules_evaluated', {
        eventRef,
        activeRuleCount: rules?.length || 0,
        matchingRuleCount: matchingRules.length,
      });

      for (const rule of matchingRules) {
        const templateContext = {
          username: event.username || '',
          comment: event.text,
          variables: rule.variables || {},
        };
        const message = renderTemplate(rule.dm_template, templateContext);
        const publicReplyTemplate = rule.variables?.public_reply_template || 'Thanks! Check your DMs.';
        const publicReplyMessage = renderTemplate(publicReplyTemplate, templateContext);

        const logPayload = {
          automation_rule_id: rule.id,
          user_id: account.user_id,
          ig_user_id: event.igUserId,
          ig_username: event.username,
          ig_post_id: event.mediaId,
          ig_comment_id: event.commentId,
          ig_comment_text: event.text,
          dm_message: message,
          dm_status: 'pending',
        };

        const { data: claimedLog, error: claimError } = await supabase
          .from('dm_log')
          .insert(logPayload)
          .select('id')
          .single();

        if (claimError?.code === '23505') {
          webhookLog(requestId, 'duplicate_skipped', { eventRef, ruleRef: diagnosticRef(rule.id) });
          results.push({ commentId: event.commentId, ruleId: rule.id, status: 'duplicate' });
          continue;
        }
        if (claimError) {
          webhookLog(requestId, 'log_claim_failed', { eventRef, error: claimError.message }, 'error');
          results.push({ commentId: event.commentId, ruleId: rule.id, status: 'failed', error: claimError.message });
          continue;
        }

        let dmSent = false;
        let publicReplySent = false;
        let dmError = null;
        let publicReplyError = null;

        try {
          webhookLog(requestId, 'dm_send_started', { eventRef, ruleRef: diagnosticRef(rule.id) });
          await sendPrivateReply(account.platform_user_id, event.commentId, message, account.access_token);
          dmSent = true;
          webhookLog(requestId, 'dm_send_succeeded', { eventRef, ruleRef: diagnosticRef(rule.id) });
          const { error: updateError } = await supabase
            .from('dm_log')
            .update({ dm_status: 'sent', dm_sent_at: new Date().toISOString(), dm_error: null })
            .eq('id', claimedLog.id);
          if (updateError) {
            webhookLog(requestId, 'dm_log_update_failed', { eventRef, error: updateError.message }, 'error');
          }
        } catch (error) {
          dmError = error.message;
          webhookLog(requestId, 'dm_send_failed', {
            eventRef,
            ruleRef: diagnosticRef(rule.id),
            error: error.message,
            graphCode: error.graph?.code || null,
            graphSubcode: error.graph?.error_subcode || null,
          }, 'error');
          await supabase.from('dm_log')
            .update({ dm_status: 'failed', dm_error: error.message })
            .eq('id', claimedLog.id)
            .then(() => null);
        }

        if (dmSent) {
          try {
            webhookLog(requestId, 'comment_reply_started', { eventRef, ruleRef: diagnosticRef(rule.id) });
            await sendPublicReply(event.commentId, publicReplyMessage, account.access_token);
            publicReplySent = true;
            webhookLog(requestId, 'comment_reply_succeeded', { eventRef, ruleRef: diagnosticRef(rule.id) });
          } catch (error) {
            publicReplyError = error.message;
            webhookLog(requestId, 'comment_reply_failed', {
              eventRef,
              ruleRef: diagnosticRef(rule.id),
              error: error.message,
              graphCode: error.graph?.code || null,
              graphSubcode: error.graph?.error_subcode || null,
            }, 'error');
          }
        } else {
          publicReplyError = 'Skipped because the DM was not sent';
        }

        const status = dmSent && publicReplySent ? 'sent' : (dmSent || publicReplySent ? 'partial' : 'failed');
        results.push({
          commentId: event.commentId,
          ruleId: rule.id,
          status,
          dmStatus: dmSent ? 'sent' : 'failed',
          publicReplyStatus: publicReplySent ? 'sent' : (dmSent ? 'failed' : 'skipped'),
          error: dmError || publicReplyError || undefined,
        });
      }
    }
  }

  const statusCounts = results.reduce((counts, result) => {
    counts[result.status] = (counts[result.status] || 0) + 1;
    return counts;
  }, {});
  webhookLog(requestId, 'delivery_completed', { processedCount: results.length, statusCounts });
  return res.status(200).json({ received: true, requestId, processed: results });
}

module.exports = {
  getSupabase,
  setCors,
  handleMedia,
  handleRules,
  handleLogs,
  handleWebhook,
};
