const { getClient } = require('./supabase');
const { deleteFile } = require('./storage');
const { publishToLinkedIn } = require('./platforms/linkedin');
const { publishToTikTok } = require('./platforms/tiktok');
const { publishToInstagram } = require('./platforms/instagram');
const { publishToYouTube } = require('./platforms/youtube');
const { publishToTwitter } = require('./platforms/twitter');

async function publishPost(postId, platforms, userId, onProgress) {
  const supabase = getClient();

  const { data: post, error: postError } = await supabase
    .from('posts')
    .select('*')
    .eq('id', postId)
    .eq('user_id', userId)
    .single();

  if (postError || !post) throw new Error('Post not found');

  const existingResults = post.platform_results || {};

  const platformsToPublish = platforms.filter(p => {
    const existing = existingResults[p];
    return !(existing && (existing.status === 'success' || existing.status === 'pending'));
  });

  if (platformsToPublish.length === 0) {
    return { success: true, status: 'published', results: existingResults };
  }

  const { data: accounts, error: accountsError } = await supabase
    .from('connected_accounts')
    .select('*')
    .eq('user_id', userId)
    .in('platform', platformsToPublish);

  if (accountsError) throw new Error('Failed to get connected accounts');

  const connectedPlatforms = accounts.map(a => a.platform);
  const missingPlatforms = platformsToPublish.filter(p => !connectedPlatforms.includes(p));
  if (missingPlatforms.length > 0) {
    throw new Error(`Not connected to: ${missingPlatforms.join(', ')}`);
  }

  const results = {};
  let hasSuccess = false;
  let hasFailure = false;

  const progressFn = onProgress || (async () => {});

  async function updateProgress(newResults) {
    const merged = { ...existingResults, ...newResults };
    const vals = Object.values(merged);
    const successCount = vals.filter(r => r.status === 'success' || r.status === 'pending').length;
    const errorCount = vals.filter(r => r.status === 'error').length;
    const pendingCount = platforms.length - Object.keys(merged).length;

    let status = 'publishing';
    if (pendingCount <= 0) {
      status = errorCount === 0 ? 'published' : (successCount > 0 ? 'partial' : 'failed');
    }

    await supabase
      .from('posts')
      .update({ status, platform_results: merged, updated_at: new Date().toISOString() })
      .eq('id', post.id);
  }

  const makePlatformProgress = (platform) => {
    return async (stage, message, pct) => {
      const progressResult = { status: 'processing', stage, message, pct: pct || 0 };
      await updateProgress({ [platform]: progressResult });
      await progressFn(platform, stage, message, pct);
    };
  };

  const publishPromises = platformsToPublish.map(async (platform) => {
    const account = accounts.find(a => a.platform === platform);
    if (!account) {
      const r = { status: 'error', error: 'Account not connected' };
      results[platform] = r;
      await updateProgress(results);
      return { platform, result: r };
    }

    const p = makePlatformProgress(platform);

    try {
      let result;
      switch (platform) {
        case 'linkedin':   result = await publishToLinkedIn(post, account, p); break;
        case 'tiktok':     result = await publishToTikTok(post, account, supabase, p); break;
        case 'instagram':  result = await publishToInstagram(post, account, p); break;
        case 'twitter':    result = await publishToTwitter(post, account, p); break;
        case 'youtube':    result = await publishToYouTube(post, account, supabase, p); break;
        default:           result = { status: 'error', error: 'Unknown platform' };
      }
      results[platform] = result;
      await updateProgress(results);
      return { platform, result };
    } catch (error) {
      const r = { status: 'error', error: error.message };
      results[platform] = r;
      await updateProgress(results);
      return { platform, result: r };
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

  // Cleanup: delete media from storage after successful publish
  if (hasSuccess && post.video_url) {
    try {
      if (post.metadata?.r2_key) {
        await deleteFile(post.metadata.r2_key);
      }
      await supabase.from('posts').update({ video_url: null }).eq('id', postId);
    } catch (err) {
      console.error('[CLEANUP] Error:', err.message);
    }
  }

  return { success: hasSuccess, status: overallStatus, results: finalResults };
}

module.exports = { publishPost };
