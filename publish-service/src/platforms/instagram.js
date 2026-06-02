async function publishToInstagram(post, account) {
  console.log('[INSTAGRAM] Starting publish...');
  const mediaType = post.metadata?.media_type || 'video';
  const { access_token, platform_user_id: igUserId } = account;

  if (!post.video_url) throw new Error('Media is required for Instagram');

  const isImage = mediaType === 'image';
  const containerUrl = new URL(`https://graph.facebook.com/v18.0/${igUserId}/media`);
  containerUrl.searchParams.set('access_token', access_token);

  if (isImage) {
    containerUrl.searchParams.set('image_url', post.video_url);
  } else {
    containerUrl.searchParams.set('media_type', 'REELS');
    containerUrl.searchParams.set('video_url', post.video_url);
  }
  containerUrl.searchParams.set('caption', post.caption || '');

  const containerRes = await fetch(containerUrl.toString(), { method: 'POST' });
  if (!containerRes.ok) {
    const err = await containerRes.json();
    throw new Error(err.error?.message || 'Failed to create Instagram container');
  }

  const containerData = await containerRes.json();
  console.log('[INSTAGRAM] Container created:', containerData.id);

  return {
    status: 'pending',
    container_id: containerData.id,
    note: 'Instagram is processing your video...',
  };
}

async function completeInstagram(postId, userId) {
  const { getClient } = require('../supabase');
  const supabase = getClient();

  const { data: post } = await supabase
    .from('posts').select('*').eq('id', postId).eq('user_id', userId).single();

  if (!post) return { status: 'error', error: 'Post not found' };

  const igResult = post.platform_results?.instagram;
  if (!igResult || igResult.status !== 'pending' || !igResult.container_id) {
    return igResult || { status: 'error', error: 'No pending Instagram container' };
  }

  const { data: account } = await supabase
    .from('connected_accounts').select('*')
    .eq('user_id', userId).eq('platform', 'instagram').single();

  if (!account) return { status: 'error', error: 'Instagram account not connected' };

  const { access_token, platform_user_id: igUserId } = account;
  const containerId = igResult.container_id;

  // Poll for up to 25s
  let isReady = false;
  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const statusUrl = new URL(`https://graph.facebook.com/v18.0/${containerId}`);
    statusUrl.searchParams.set('fields', 'status_code,status');
    statusUrl.searchParams.set('access_token', access_token);
    const statusData = await fetch(statusUrl.toString()).then(r => r.json());

    if (statusData.status_code === 'FINISHED') { isReady = true; break; }
    if (statusData.status_code === 'ERROR') {
      await saveInstagramResult(supabase, post, postId, { status: 'error', error: statusData.status || 'Processing failed' });
      return { status: 'error', error: statusData.status || 'Processing failed' };
    }
  }

  if (!isReady) return { status: 'pending', note: 'Still processing' };

  // Publish
  const publishUrl = new URL(`https://graph.facebook.com/v18.0/${igUserId}/media_publish`);
  publishUrl.searchParams.set('access_token', access_token);
  publishUrl.searchParams.set('creation_id', containerId);
  const publishRes = await fetch(publishUrl.toString(), { method: 'POST' });

  if (!publishRes.ok) {
    const err = (await publishRes.json()).error?.message || 'Failed to publish';
    await saveInstagramResult(supabase, post, postId, { status: 'error', error: err });
    return { status: 'error', error: err };
  }

  const publishData = await publishRes.json();
  const result = { status: 'success', post_id: publishData.id, url: `https://www.instagram.com/reel/${publishData.id}/` };
  await saveInstagramResult(supabase, post, postId, result);
  return result;
}

async function saveInstagramResult(supabase, post, postId, result) {
  const merged = { ...post.platform_results, instagram: result };
  const allResults = Object.values(merged);
  const hasError = allResults.some(r => r.status === 'error');
  const overallStatus = hasError ? 'partial' : 'published';
  await supabase.from('posts').update({
    platform_results: merged,
    status: overallStatus,
    published_at: result.status === 'success' ? new Date().toISOString() : undefined,
  }).eq('id', postId);
}

module.exports = { publishToInstagram, completeInstagram };
