const { getClient } = require('./supabase');
const { publishPost } = require('./publish');
const { completeInstagram } = require('./platforms/instagram');

async function processScheduledPosts({ limit = 5 } = {}) {
  const supabase = getClient();
  const now = new Date().toISOString();

  const { data: duePosts, error } = await supabase
    .from('posts')
    .select('id,user_id,platforms,scheduled_at')
    .eq('status', 'scheduled')
    .lte('scheduled_at', now)
    .order('scheduled_at', { ascending: true })
    .limit(limit);

  if (error) throw new Error(`Failed to fetch scheduled posts: ${error.message}`);
  if (!duePosts?.length) return { processed: 0, results: [] };

  const results = [];

  for (const duePost of duePosts) {
    const claim = await supabase
      .from('posts')
      .update({ status: 'publishing', updated_at: new Date().toISOString() })
      .eq('id', duePost.id)
      .eq('status', 'scheduled')
      .select('id,user_id,platforms')
      .single();

    if (claim.error || !claim.data) {
      results.push({ post_id: duePost.id, status: 'skipped', reason: 'Already claimed' });
      continue;
    }

    try {
      const post = claim.data;
      const result = await publishPost(post.id, post.platforms || [], post.user_id);
      await completePendingInstagram(post.user_id, post.id, result.results || {});
      results.push({ post_id: post.id, status: result.status, success: result.success });
    } catch (err) {
      await supabase
        .from('posts')
        .update({
          status: 'failed',
          platform_results: { scheduler: { status: 'error', error: err.message } },
          updated_at: new Date().toISOString(),
        })
        .eq('id', duePost.id);

      results.push({ post_id: duePost.id, status: 'failed', error: err.message });
    }
  }

  return { processed: results.length, results };
}

async function completePendingInstagram(userId, postId, platformResults) {
  const pendingKeys = Object.entries(platformResults)
    .filter(([key, result]) => {
      const isInstagram = key === 'instagram' || key.startsWith('instagram:') || result?.platform === 'instagram';
      return isInstagram && result?.status === 'pending' && result?.container_id;
    })
    .map(([key]) => key);

  for (const key of pendingKeys) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const result = await completeInstagram(postId, userId, key);
      if (result.status !== 'pending') break;
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

function verifySchedulerAuth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.authorization === `Bearer ${secret}`;
}

module.exports = { processScheduledPosts, verifySchedulerAuth };
