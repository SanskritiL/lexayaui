async function publishToTwitter(post, account) {
  console.log('[TWITTER] Starting publish...');
  const { access_token } = account;

  const mediaId = post.metadata?.twitter_media_id;

  if (mediaId) {
    return await createTweet(access_token, post.caption, mediaId);
  }

  if (post.video_url) {
    try {
      const uploadedMediaId = await uploadVideoToTwitter(access_token, post.video_url);
      return await createTweet(access_token, post.caption, uploadedMediaId);
    } catch (err) {
      console.error('[TWITTER] Video upload failed, falling back to text:', err.message);
      return await createTweet(access_token, post.caption, null);
    }
  }

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

async function uploadVideoToTwitter(accessToken, videoUrl) {
  // 1. INIT
  const totalBytes = await getContentLength(videoUrl);
  const initRes = await fetch('https://upload.twitter.com/1.1/media/upload.json?command=INIT&media_type=video/mp4&total_bytes=' + totalBytes, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  if (!initRes.ok) throw new Error('Twitter INIT failed: ' + (await initRes.text()));
  const { media_id_string } = await initRes.json();

  // 2. APPEND in chunks
  const CHUNK = 5 * 1024 * 1024;
  const videoRes = await fetch(videoUrl);
  const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
  const totalChunks = Math.ceil(videoBuffer.length / CHUNK);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK;
    const chunk = videoBuffer.slice(start, start + CHUNK);
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

  // 3. FINALIZE
  const finalizeRes = await fetch('https://upload.twitter.com/1.1/media/upload.json?command=FINALIZE&media_id=' + media_id_string, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  if (!finalizeRes.ok) throw new Error('Twitter FINALIZE failed');

  return media_id_string;
}

async function getContentLength(url) {
  const head = await fetch(url, { method: 'HEAD' });
  return parseInt(head.headers.get('content-length') || '0');
}

module.exports = { publishToTwitter };
