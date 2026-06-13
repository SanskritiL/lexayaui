const FB_API_VERSION = 'v18.0';
const FB_HOST = 'https://graph.facebook.com';
const RUPLOAD_HOST = 'https://rupload.facebook.com';

async function publishToInstagram(post, account, onProgress, fileBuffer) {
  const p = onProgress || (async () => {});
  await p('authenticating', 'Authenticating with Instagram...');
  console.log('[INSTAGRAM] Starting publish...');
  const mediaType = post.metadata?.media_type || 'video';
  const { access_token, platform_user_id: igUserId } = account;
  const isImage = mediaType === 'image';
  const isVideo = mediaType === 'video';

  if (!fileBuffer) throw new Error('Media data is required for Instagram');

  // Step 1: Create container
  await p('uploading', `Creating Instagram ${isImage ? 'image' : 'reel'} container...`);
  const containerUrl = new URL(`${FB_HOST}/${FB_API_VERSION}/${igUserId}/media`);
  containerUrl.searchParams.set('access_token', access_token);

  if (isImage) {
    // Images still need a public URL for now — upload via resumable isn't available for images
    // Keep image_url param, but we embed the bytes via the container creation
    // Actually, Instagram's image API still requires image_url (public URL)
    // For images, we could upload to a temp location or use a different approach
    throw new Error('Image posts are not supported in direct mode yet');
  } else {
    containerUrl.searchParams.set('media_type', 'REELS');
    containerUrl.searchParams.set('upload_type', 'resumable');
    containerUrl.searchParams.set('caption', post.caption || '');
  }

  const containerRes = await fetch(containerUrl.toString(), { method: 'POST' });
  if (!containerRes.ok) {
    const err = await containerRes.json();
    throw new Error(err.error?.message || 'Failed to create Instagram container');
  }

  const containerData = await containerRes.json();
  const containerId = containerData.id;
  console.log('[INSTAGRAM] Container created:', containerId);

  // Step 2: Upload video binary to rupload.facebook.com
  await p('uploading', `Uploading video to Instagram (${(fileBuffer.length / 1024 / 1024).toFixed(1)} MB)...`);
  const uploadUrl = `${RUPLOAD_HOST}/ig-api-upload/${FB_API_VERSION}/${containerId}`;
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `OAuth ${access_token}`,
      'offset': '0',
      'file_size': fileBuffer.length.toString(),
    },
    body: fileBuffer,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error('Instagram upload failed: ' + errText);
  }

  const uploadResult = await uploadRes.json();
  console.log('[INSTAGRAM] Upload result:', uploadResult);

  if (!uploadResult.success) {
    throw new Error('Instagram upload failed: ' + JSON.stringify(uploadResult));
  }

  await p('processing', 'Instagram is processing your media...');
  return {
    status: 'pending',
    container_id: containerId,
    note: 'Instagram is processing your video...',
  };
}

async function completeInstagram(postId, userId, resultKey) {
  const { getClient } = require('../supabase');
  const supabase = getClient();

  const { data: post } = await supabase
    .from('posts').select('*').eq('id', postId).eq('user_id', userId).single();

  if (!post) return { status: 'error', error: 'Post not found' };

  const instagramEntries = Object.entries(post.platform_results || {})
    .filter(([key, result]) => {
      const isInstagramKey = key === 'instagram' || key.startsWith('instagram:') || result?.platform === 'instagram';
      return isInstagramKey && result?.status === 'pending' && result?.container_id;
    });
  const selectedEntry = resultKey
    ? instagramEntries.find(([key]) => key === resultKey)
    : instagramEntries[0];
  const selectedKey = selectedEntry?.[0] || resultKey || 'instagram';
  const igResult = selectedEntry?.[1] || post.platform_results?.[selectedKey];
  if (!igResult || igResult.status !== 'pending' || !igResult.container_id) {
    return igResult || { status: 'error', error: 'No pending Instagram container' };
  }

  let accountQuery = supabase
    .from('connected_accounts').select('*')
    .eq('user_id', userId).eq('platform', 'instagram');

  if (igResult.account_id) {
    accountQuery = accountQuery.eq('id', igResult.account_id);
  }

  const { data: account } = await accountQuery.limit(1).single();

  if (!account) return { status: 'error', error: 'Instagram account not connected' };

  const { access_token, platform_user_id: igUserId } = account;
  const containerId = igResult.container_id;

  // Poll for up to 25s
  let isReady = false;
  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const statusUrl = new URL(`${FB_HOST}/${FB_API_VERSION}/${containerId}`);
    statusUrl.searchParams.set('fields', 'status_code,status');
    statusUrl.searchParams.set('access_token', access_token);
    const statusData = await fetch(statusUrl.toString()).then(r => r.json());

    if (statusData.status_code === 'FINISHED') { isReady = true; break; }
    if (statusData.status_code === 'ERROR') {
      await saveInstagramResult(supabase, post, postId, selectedKey, { ...igResult, status: 'error', error: statusData.status || 'Processing failed' });
      return { status: 'error', error: statusData.status || 'Processing failed' };
    }
  }

  if (!isReady) return { status: 'pending', note: 'Still processing' };

  // Publish
  const publishUrl = new URL(`${FB_HOST}/${FB_API_VERSION}/${igUserId}/media_publish`);
  publishUrl.searchParams.set('access_token', access_token);
  publishUrl.searchParams.set('creation_id', containerId);
  const publishRes = await fetch(publishUrl.toString(), { method: 'POST' });

  if (!publishRes.ok) {
    const err = (await publishRes.json()).error?.message || 'Failed to publish';
    await saveInstagramResult(supabase, post, postId, selectedKey, { ...igResult, status: 'error', error: err });
    return { status: 'error', error: err };
  }

  const publishData = await publishRes.json();
  const result = { ...igResult, status: 'success', post_id: publishData.id, url: `https://www.instagram.com/reel/${publishData.id}/` };
  await saveInstagramResult(supabase, post, postId, selectedKey, result);
  return result;
}

async function saveInstagramResult(supabase, post, postId, resultKey, result) {
  const merged = { ...post.platform_results, [resultKey]: result };
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
