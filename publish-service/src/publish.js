const { getClient } = require('./supabase');
const { publishToLinkedIn } = require('./platforms/linkedin');
const { publishToTikTok } = require('./platforms/tiktok');
const { publishToYouTube } = require('./platforms/youtube');
const { publishToTwitter } = require('./platforms/twitter');
const { publishToInstagram } = require('./platforms/instagram');

const PROGRESS_UPDATE_MIN_INTERVAL_MS = Number(process.env.PROGRESS_UPDATE_MIN_INTERVAL_MS || 1500);
const PROGRESS_UPDATE_MIN_PCT_DELTA = Number(process.env.PROGRESS_UPDATE_MIN_PCT_DELTA || 10);
const INSTAGRAM_PUBLISHING_ENABLED = process.env.INSTAGRAM_PUBLISHING_ENABLED === 'true';

async function publishPost(postId, platforms, userId, onProgress, fileBuffer) {
  const supabase = getClient();

  const { data: post, error: postError } = await supabase
    .from('posts')
    .select('*')
    .eq('id', postId)
    .eq('user_id', userId)
    .single();

  if (postError || !post) throw new Error('Post not found');

  const existingResults = post.platform_results || {};
  const targets = normalizeTargets(platforms, post.metadata?.account_selections || {});

  const targetsToPublish = targets.filter(target => {
    const existing = existingResults[target.key];
    return !(existing && (existing.status === 'success' || existing.status === 'pending'));
  });

  if (targetsToPublish.length === 0) {
    return { success: true, status: 'published', results: existingResults };
  }

  const accountIds = targetsToPublish.map(t => t.accountId).filter(Boolean);
  let accountQuery = supabase
    .from('connected_accounts')
    .select('*')
    .eq('user_id', userId);

  if (accountIds.length > 0) {
    accountQuery = accountQuery.in('id', accountIds);
  } else {
    accountQuery = accountQuery.in('platform', [...new Set(targetsToPublish.map(t => t.platform))]);
  }

  const { data: accounts, error: accountsError } = await accountQuery;

  if (accountsError) throw new Error('Failed to get connected accounts');

  const results = {};
  let liveResults = { ...existingResults };
  let hasSuccess = false;
  let hasFailure = false;

  const progressFn = onProgress || (async () => {});

  async function updateProgress(newResults) {
    liveResults = { ...liveResults, ...newResults };
    const vals = Object.values(liveResults);
    const successCount = vals.filter(r => r.status === 'success' || r.status === 'pending').length;
    const errorCount = vals.filter(r => r.status === 'error').length;
    const pendingCount = targets.length - Object.keys(liveResults).length;

    let status = 'publishing';
    if (pendingCount <= 0) {
      status = errorCount === 0 ? 'published' : (successCount > 0 ? 'partial' : 'failed');
    }

    await supabase
      .from('posts')
      .update({ status, platform_results: liveResults, updated_at: new Date().toISOString() })
      .eq('id', post.id);
  }

  const lastProgressByKey = new Map();

  const makePlatformProgress = (resultKey) => {
    return async (stage, message, pct) => {
      const normalizedPct = Number(pct || 0);
      const now = Date.now();
      const last = lastProgressByKey.get(resultKey);
      const stageChanged = last?.stage !== stage;
      const pctDelta = Math.abs(normalizedPct - Number(last?.pct || 0));
      const shouldPersist =
        !last ||
        stageChanged ||
        normalizedPct >= 100 ||
        pctDelta >= PROGRESS_UPDATE_MIN_PCT_DELTA ||
        now - last.at >= PROGRESS_UPDATE_MIN_INTERVAL_MS;

      if (!shouldPersist) return;

      lastProgressByKey.set(resultKey, { stage, pct: normalizedPct, at: now });
      const progressResult = { status: 'processing', stage, message, pct: pct || 0 };
      await updateProgress({ [resultKey]: progressResult });
      await progressFn(resultKey, stage, message, pct);
    };
  };

  const publishableTargets = [];

  for (const target of targetsToPublish) {
    const account = findAccountForTarget(accounts, target);
    if (!account) {
      results[target.key] = {
        status: 'error',
        error: `${formatTargetLabel(target)} is not connected. Reconnect the account, then retry this platform.`,
        platform: target.platform,
        account_id: target.accountId || null,
        account_name: target.label,
        recoverable: true,
      };
      continue;
    }

    if (isAccountAuthBlocked(account)) {
      results[target.key] = {
        status: 'error',
        error: `${formatAccountLabel(account, target)} needs to be reconnected. The saved authorization has expired.`,
        platform: target.platform,
        account_id: account.id,
        account_name: account.account_name,
        recoverable: true,
        error_code: 'AUTH_EXPIRED',
      };
      continue;
    }

    if (target.platform === 'instagram' && !INSTAGRAM_PUBLISHING_ENABLED) {
      results[target.key] = {
        status: 'error',
        error: 'Instagram publishing is disabled. This Instagram connection is limited to comment automations for Meta least-privilege review.',
        platform: target.platform,
        account_id: account.id,
        account_name: account.account_name,
        recoverable: false,
        error_code: 'INSTAGRAM_PUBLISHING_DISABLED',
      };
      continue;
    }

    publishableTargets.push(target);
  }

  if (Object.keys(results).length > 0) {
    await updateProgress(results);
  }

  const publishPromises = publishableTargets.map(async (target) => {
    const { platform, key } = target;
    const account = findAccountForTarget(accounts, target);
    if (!account) {
      const r = { status: 'error', error: 'Account not connected' };
      results[key] = r;
      await updateProgress(results);
      return { platform: key, result: r };
    }

    const p = makePlatformProgress(key);

    try {
      let result;
      switch (platform) {
        case 'linkedin':   result = await publishToLinkedIn(post, account, p, fileBuffer); break;
        case 'tiktok':     result = await publishToTikTok(post, account, supabase, p, fileBuffer); break;
        case 'twitter':    result = await publishToTwitter(post, account, p, fileBuffer); break;
        case 'youtube':    result = await publishToYouTube(post, account, supabase, p, fileBuffer); break;
        case 'instagram':  result = await publishToInstagram(post, account, p, fileBuffer); break;
        default:           result = { status: 'error', error: 'Unknown platform' };
      }
      results[key] = { ...result, platform, account_id: account.id, account_name: account.account_name };
      await updateProgress(results);
      return { platform: key, result };
    } catch (error) {
      const r = normalizePublishError(error, platform);
      results[key] = { ...r, platform, account_id: account.id, account_name: account.account_name };
      await updateProgress(results);
      return { platform: key, result: r };
    }
  });

  await Promise.allSettled(publishPromises);

  const finalResults = { ...existingResults, ...results };

  for (const r of Object.values(finalResults)) {
    if (r.status === 'success' || r.status === 'pending') hasSuccess = true;
    else if (r.status === 'error') hasFailure = true;
  }

  let overallStatus = 'failed';
  if (hasSuccess && !hasFailure) overallStatus = 'published';
  else if (hasSuccess && hasFailure) overallStatus = 'partial';

  await supabase
    .from('posts')
    .update({
      status: overallStatus,
      platform_results: finalResults,
      published_at: hasSuccess ? new Date().toISOString() : null,
    })
    .eq('id', postId);

  return { success: hasSuccess, status: overallStatus, results: finalResults };
}

function formatTargetLabel(target) {
  return `${formatPlatformName(target.platform)}${target.accountId ? ` account ${target.accountId}` : ''}`;
}

function formatAccountLabel(account, target) {
  const platform = formatPlatformName(account?.platform || target.platform);
  const name = account?.account_name || target.label || account?.platform_user_id || account?.id || 'account';
  return `${platform} ${name}`;
}

function formatPlatformName(platform) {
  const names = {
    instagram: 'Instagram',
    linkedin: 'LinkedIn',
    tiktok: 'TikTok',
    youtube: 'YouTube',
    twitter: 'X',
  };
  return names[platform] || platform || 'Platform';
}

function normalizeTargets(platforms, accountSelections) {
  const rawTargets = [];

  for (const item of platforms || []) {
    if (typeof item !== 'string') continue;
    if (item.includes(':')) {
      const [platform, accountId] = item.split(':');
      rawTargets.push({ platform, accountId, key: item });
    } else {
      const selectedIds = accountSelections?.[item];
      if (Array.isArray(selectedIds) && selectedIds.length > 0) {
        selectedIds.forEach(accountId => rawTargets.push({ platform: item, accountId }));
      } else {
        rawTargets.push({ platform: item, accountId: null });
      }
    }
  }

  const counts = rawTargets.reduce((acc, target) => {
    acc[target.platform] = (acc[target.platform] || 0) + 1;
    return acc;
  }, {});

  return rawTargets.map(target => ({
    ...target,
    key: target.key || (counts[target.platform] > 1 && target.accountId ? `${target.platform}:${target.accountId}` : target.platform),
    label: target.accountId ? `${target.platform} account ${target.accountId}` : target.platform,
  }));
}

function findAccountForTarget(accounts, target) {
  if (!accounts) return null;
  if (target.accountId) return accounts.find(a => a.id === target.accountId && a.platform === target.platform);
  return accounts.find(a => a.platform === target.platform);
}

function isAccountAuthBlocked(account) {
  if (!account?.token_expires_at) return needsExpiringOAuth(account) && !canRefreshAccountForPublish(account);
  const expiresAt = new Date(account.token_expires_at).getTime();
  if (!Number.isFinite(expiresAt)) return needsExpiringOAuth(account) && !canRefreshAccountForPublish(account);
  if (expiresAt > Date.now() + 2 * 60 * 1000) return false;
  return !canRefreshAccountForPublish(account);
}

function needsExpiringOAuth(account) {
  return ['tiktok', 'youtube'].includes(account?.platform);
}

function canRefreshAccountForPublish(account) {
  return Boolean(account?.refresh_token && ['tiktok', 'youtube'].includes(account.platform));
}

function normalizePublishError(error, platform) {
  const rawMessage = String(error?.message || error || 'Publishing failed');
  const message = rawMessage.length > 500 ? `${rawMessage.slice(0, 500)}...` : rawMessage;
  const lower = message.toLowerCase();
  const result = {
    status: 'error',
    error: message,
    recoverable: true,
  };

  if (error?.code) result.error_code = error.code;

  if (
    lower.includes('expired') ||
    lower.includes('reconnect') ||
    lower.includes('unauthorized') ||
    lower.includes('invalid token') ||
    lower.includes('auth')
  ) {
    result.error_code = result.error_code || 'AUTH_REQUIRED';
    result.recoverable = true;
    result.error = ensureReconnectHint(message, platform);
  } else if (
    lower.includes('timed out') ||
    lower.includes('timeout') ||
    lower.includes('econnreset') ||
    lower.includes('socket') ||
    lower.includes('failed to fetch') ||
    lower.includes('network')
  ) {
    result.error_code = result.error_code || 'NETWORK_TIMEOUT';
    result.error = `${formatPlatformName(platform)} did not respond in time. Retry this platform; if it was already posted, check the platform before retrying.`;
  } else if (lower.includes('too large') || lower.includes('413')) {
    result.error_code = result.error_code || 'MEDIA_TOO_LARGE';
    result.recoverable = false;
  } else if (lower.includes('unsupported') || lower.includes('requires a video') || lower.includes('requires an image')) {
    result.error_code = result.error_code || 'INVALID_MEDIA';
    result.recoverable = false;
  }

  return result;
}

function ensureReconnectHint(message, platform) {
  if (/reconnect/i.test(message)) return message;
  return `${message}. Reconnect ${formatPlatformName(platform)}, then retry this platform.`;
}

module.exports = { publishPost };
