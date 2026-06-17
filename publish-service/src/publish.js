const { getClient } = require('./supabase');
const { publishToLinkedIn } = require('./platforms/linkedin');
const { publishToTikTok } = require('./platforms/tiktok');
const { publishToInstagram } = require('./platforms/instagram');
const { publishToYouTube } = require('./platforms/youtube');
const { publishToTwitter } = require('./platforms/twitter');

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

  const makePlatformProgress = (resultKey) => {
    return async (stage, message, pct) => {
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
        case 'instagram':  result = await publishToInstagram(post, account, p, fileBuffer); break;
        case 'twitter':    result = await publishToTwitter(post, account, p, fileBuffer); break;
        case 'youtube':    result = await publishToYouTube(post, account, supabase, p, fileBuffer); break;
        default:           result = { status: 'error', error: 'Unknown platform' };
      }
      results[key] = { ...result, platform, account_id: account.id, account_name: account.account_name };
      await updateProgress(results);
      return { platform: key, result };
    } catch (error) {
      const r = { status: 'error', error: error.message };
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
  if (!account?.token_expires_at) return false;
  const expiresAt = new Date(account.token_expires_at).getTime();
  if (!Number.isFinite(expiresAt)) return false;
  if (expiresAt > Date.now() + 2 * 60 * 1000) return false;
  return !canRefreshAccountForPublish(account);
}

function canRefreshAccountForPublish(account) {
  return Boolean(account?.refresh_token && ['tiktok', 'youtube'].includes(account.platform));
}

module.exports = { publishPost };
