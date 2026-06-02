async function publishToTikTok(post, account, supabase) {
  console.log('[TIKTOK] Starting publish...');
  if (!post.video_url) throw new Error('No video available for TikTok');

  let accessToken = account.access_token;

  // Refresh token if expired
  const tokenExpiresAt = new Date(account.token_expires_at);
  const isExpired = tokenExpiresAt <= new Date();
  const isExpiringSoon = tokenExpiresAt <= new Date(Date.now() + 5 * 60 * 1000);

  if ((isExpired || isExpiringSoon) && account.refresh_token) {
    const refreshRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY || '',
        client_secret: process.env.TIKTOK_CLIENT_SECRET || '',
        grant_type: 'refresh_token',
        refresh_token: account.refresh_token,
      }),
    });
    const refreshData = await refreshRes.json();
    if (refreshData.access_token) {
      accessToken = refreshData.access_token;
      await supabase.from('connected_accounts').update({
        access_token: refreshData.access_token,
        refresh_token: refreshData.refresh_token || account.refresh_token,
        token_expires_at: new Date(Date.now() + (refreshData.expires_in * 1000)).toISOString(),
      }).eq('id', account.id);
    } else {
      throw new Error('TikTok token expired. Please reconnect your TikTok account.');
    }
  }

  // Download video from storage
  console.log('[TIKTOK] Downloading video:', post.video_url);
  const videoFetch = await fetch(post.video_url);
  if (!videoFetch.ok) throw new Error('Failed to fetch video from storage');
  const videoBuffer = Buffer.from(await videoFetch.arrayBuffer());
  const videoSize = videoBuffer.length;
  console.log('[TIKTOK] Video size:', (videoSize / 1024 / 1024).toFixed(2), 'MB');

  // Determine chunk parameters
  const TARGET_CHUNK = 10 * 1024 * 1024;
  const chunkSize = videoSize <= TARGET_CHUNK ? videoSize : TARGET_CHUNK;
  const totalChunks = Math.ceil(videoSize / chunkSize);

  // Step 1: Initialize upload
  const initRes = await fetch('https://open.tiktokapis.com/v2/post/publish/inbox/video/init/', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      source_info: { source: 'FILE_UPLOAD', video_size: videoSize, chunk_size: chunkSize, total_chunk_count: totalChunks },
    }),
  });
  const initData = await initRes.json();
  if (initData.error?.code !== 'ok') throw new Error(initData.error?.message || 'Failed to init TikTok upload');

  const publishId = initData.data?.publish_id;
  const uploadUrl = initData.data?.upload_url;
  if (!uploadUrl) throw new Error('No upload URL from TikTok');

  // Step 2: Upload chunks
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = i === totalChunks - 1 ? videoSize : start + chunkSize;
    const chunk = videoBuffer.slice(start, end);
    const lastByte = end - 1;

    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': chunk.length.toString(),
        'Content-Range': `bytes ${start}-${lastByte}/${videoSize}`,
      },
      body: chunk,
    });
    const isLastChunk = i === totalChunks - 1;
    const expectedStatus = isLastChunk ? 201 : 206;
    if (uploadRes.status !== expectedStatus && uploadRes.status !== 201 && uploadRes.status !== 206) {
      throw new Error(`TikTok chunk ${i + 1} failed: ${await uploadRes.text()}`);
    }
  }

  return {
    status: 'success',
    publish_id: publishId,
    note: 'Video sent to TikTok inbox. Open TikTok app to post.',
  };
}

module.exports = { publishToTikTok };
