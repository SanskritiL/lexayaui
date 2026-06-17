const { fetchMediaStream } = require('../media');

async function publishToTikTok(post, account, supabase, onProgress, fileBuffer) {
  const p = onProgress || (async () => {});
  await p('authenticating', 'Authenticating with TikTok...');
  console.log('[TIKTOK] Starting publish...');

  if (!hasTikTokScope(account, 'video.upload')) {
    throw new Error('TikTok needs the video upload permission. Please reconnect your TikTok account.');
  }

  let accessToken = account.access_token;

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

  if (!fileBuffer && post.video_url) {
    await p('initializing', 'Sending video URL to TikTok...');
    const initRes = await fetch('https://open.tiktokapis.com/v2/post/publish/inbox/video/init/', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({
        source_info: {
          source: 'PULL_FROM_URL',
          video_url: post.video_url,
        },
      }),
    });
    const initData = await initRes.json();
    if (initData.error?.code !== 'ok') {
      if (isUrlOwnershipError(initData)) {
        await p('uploading', 'TikTok needs verified media URLs. Uploading video directly...');
        const media = await fetchMediaStream(post);
        return await uploadFileToTikTok(accessToken, media, p);
      }
      throw new Error(initData.error?.message || 'Failed to init TikTok URL publish');
    }

    return {
      status: 'success',
      publish_id: initData.data?.publish_id,
      note: 'Video sent to TikTok inbox. Open TikTok app to post.',
    };
  }

  const videoBuffer = fileBuffer;
  if (!videoBuffer) throw new Error('No video data available for TikTok');
  return await uploadFileToTikTok(accessToken, { size: videoBuffer.length, body: videoBuffer }, p);
}

async function uploadFileToTikTok(accessToken, media, onProgress) {
  const p = onProgress || (async () => {});
  const videoSize = media.size;
  console.log('[TIKTOK] Video size:', (videoSize / 1024 / 1024).toFixed(2), 'MB');

  const TARGET_CHUNK = 10 * 1024 * 1024;
  let chunkSize, totalChunks;
  if (videoSize <= TARGET_CHUNK) {
    chunkSize = videoSize;
    totalChunks = 1;
  } else {
    chunkSize = TARGET_CHUNK;
    totalChunks = Math.ceil(videoSize / chunkSize);
    if (totalChunks < 2) {
      chunkSize = videoSize;
      totalChunks = 1;
    }
  }

  await p('initializing', 'Initializing TikTok upload...');
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

  const source = createChunkSource(media.body);
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = i === totalChunks - 1 ? videoSize : start + chunkSize;
    const chunk = await source.read(end - start);
    const lastByte = end - 1;
    const pct = Math.round(((i + 1) / totalChunks) * 100);

    await p('uploading', `Uploading chunk ${i + 1} of ${totalChunks} (${pct}%)...`, pct);

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

  await p('finalizing', 'Finalizing with TikTok...');
  return {
    status: 'success',
    publish_id: publishId,
    note: 'Video sent to TikTok inbox. Open TikTok app to post.',
  };
}

function createChunkSource(body) {
  if (Buffer.isBuffer(body)) {
    let offset = 0;
    return {
      async read(length) {
        const chunk = body.slice(offset, offset + length);
        offset += chunk.length;
        if (chunk.length !== length) throw new Error('Media ended before TikTok upload finished');
        return chunk;
      },
    };
  }

  if (!body?.getReader) throw new Error('Unsupported media body for TikTok upload');

  const reader = body.getReader();
  let buffered = Buffer.alloc(0);
  let done = false;

  return {
    async read(length) {
      while (buffered.length < length && !done) {
        const next = await reader.read();
        done = next.done;
        if (next.value) buffered = Buffer.concat([buffered, Buffer.from(next.value)]);
      }

      const chunk = buffered.slice(0, length);
      buffered = buffered.slice(length);
      if (chunk.length !== length) throw new Error('Media ended before TikTok upload finished');
      return chunk;
    },
  };
}

function isUrlOwnershipError(data) {
  const code = data?.error?.code || '';
  const message = data?.error?.message || '';
  return code === 'url_ownership_unverified' || /url ownership|ownership verification|PULL_FROM_URL/i.test(message);
}

function hasTikTokScope(account, requiredScope) {
  const scopes = Array.isArray(account.scopes)
    ? account.scopes
    : String(account.scopes || '').split(/[,\s]+/);

  return scopes.includes(requiredScope);
}

module.exports = { publishToTikTok };
