async function publishToTwitter(post, account, onProgress, fileBuffer) {
  const p = onProgress || (async () => {});
  await p('authenticating', 'Authenticating with Twitter/X...');
  console.log('[TWITTER] Starting publish...');
  const { access_token } = account;

  const mediaId = post.metadata?.twitter_media_id;

  if (mediaId) {
    await p('publishing', 'Creating tweet...');
    return await createTweet(access_token, post.caption, mediaId);
  }

  if (fileBuffer) {
    try {
      const uploadedMediaId = await uploadVideoToTwitter(access_token, fileBuffer, p);
      await p('publishing', 'Creating tweet...');
      return await createTweet(access_token, post.caption, uploadedMediaId);
    } catch (err) {
      console.error('[TWITTER] Video upload failed, falling back to text:', err.message);
      await p('publishing', 'Creating text-only tweet (video upload failed)...');
      return await createTweet(access_token, post.caption, null);
    }
  }

  await p('publishing', 'Creating tweet...');
  return await createTweet(access_token, post.caption, null);
}

async function createTweet(accessToken, text, mediaId) {
  const body = { text: text || '' };
  if (mediaId) body.media = { media_ids: [mediaId] };

  const res = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error('Twitter post failed: ' + (await res.text()));
  const data = await res.json();
  return { status: 'success', post_id: data.data?.id, url: `https://twitter.com/i/web/status/${data.data?.id}` };
}

async function uploadVideoToTwitter(accessToken, videoBuffer, onProgress) {
  const p = onProgress || (async () => {});

  await p('initializing', 'Initializing Twitter/X media upload...');
  const totalBytes = videoBuffer.length;
  const initRes = await fetch('https://upload.twitter.com/1.1/media/upload.json?command=INIT&media_type=video/mp4&total_bytes=' + totalBytes, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  if (!initRes.ok) throw new Error('Twitter INIT failed: ' + (await initRes.text()));
  const { media_id_string } = await initRes.json();

  const CHUNK = 5 * 1024 * 1024;
  const totalChunks = Math.ceil(videoBuffer.length / CHUNK);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK;
    const chunk = videoBuffer.slice(start, start + CHUNK);
    const pct = Math.round(((i + 1) / totalChunks) * 100);

    await p('uploading', `Uploading chunk ${i + 1} of ${totalChunks} (${pct}%)...`, pct);

    const form = new FormData();
    form.append('command', 'APPEND');
    form.append('media_id', media_id_string);
    form.append('segment_index', i.toString());
    form.append('media', new Blob([chunk]), `chunk_${i}.mp4`);

    const appendRes = await fetch('https://upload.twitter.com/1.1/media/upload.json', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}` },
      body: form,
    });
    if (!appendRes.ok) throw new Error(`Twitter APPEND chunk ${i} failed`);
  }

  await p('finalizing', 'Finalizing Twitter/X media upload...');
  const finalizeRes = await fetch('https://upload.twitter.com/1.1/media/upload.json?command=FINALIZE&media_id=' + media_id_string, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  if (!finalizeRes.ok) throw new Error('Twitter FINALIZE failed');

  return media_id_string;
}

module.exports = { publishToTwitter };
