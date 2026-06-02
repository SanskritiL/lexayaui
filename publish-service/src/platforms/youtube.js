async function publishToYouTube(post, account, supabase, onProgress) {
  const p = onProgress || (async () => {});
  await p('authenticating', 'Authenticating with YouTube...');
  console.log('[YOUTUBE] Starting publish...');
  if (post.metadata?.media_type !== 'video' || !post.video_url) {
    return { status: 'error', error: 'YouTube Shorts requires a video' };
  }

  let { access_token, refresh_token } = account;

  const tokenExpiry = new Date(account.token_expires_at);
  if (tokenExpiry <= new Date()) {
    const refreshed = await refreshYouTubeToken(refresh_token);
    if (refreshed.error) return { status: 'error', error: 'Token expired. Please reconnect YouTube.' };
    access_token = refreshed.access_token;
    await supabase.from('connected_accounts').update({
      access_token: refreshed.access_token,
      token_expires_at: new Date(Date.now() + (refreshed.expires_in * 1000)).toISOString(),
    }).eq('id', account.id);
  }

  await p('downloading', 'Downloading video from storage...');
  console.log('[YOUTUBE] Downloading video...');
  const videoRes = await fetch(post.video_url);
  if (!videoRes.ok) throw new Error('Failed to download video from storage');
  const videoBytes = Buffer.from(await videoRes.arrayBuffer());
  console.log('[YOUTUBE] Video size:', (videoBytes.length / 1024 / 1024).toFixed(2), 'MB');

  let description = post.caption || '';
  if (!description.toLowerCase().includes('#shorts')) description += '\n\n#Shorts';

  const firstLine = post.caption?.split('\n').find(l => l.trim())?.trim() || '';
  let title = firstLine.substring(0, 100).replace(/[<>]/g, '') || 'Short video';

  await p('uploading', 'Uploading video to YouTube (0%)...', 0);
  const initRes = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Length': videoBytes.length.toString(),
        'X-Upload-Content-Type': 'video/*',
      },
      body: JSON.stringify({
        snippet: { title, description, categoryId: '22' },
        status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
      }),
    }
  );

  if (!initRes.ok) throw new Error('Failed to init YouTube upload: ' + (await initRes.text()));

  const uploadUrl = initRes.headers.get('location');
  if (!uploadUrl) throw new Error('No upload URL from YouTube');

  // Upload video bytes with progress
  const uploadRes = await uploadWithProgress(uploadUrl, videoBytes, async (pct) => {
    await p('uploading', `Uploading video to YouTube (${pct}%)...`, pct);
  });

  if (!uploadRes.ok) throw new Error('Failed to upload video to YouTube: ' + (await uploadRes.text()));

  await p('processing', 'YouTube is processing your video...');
  const videoData = await uploadRes.json();
  return { status: 'success', post_id: videoData.id, url: `https://youtube.com/shorts/${videoData.id}` };
}

// Helper: upload a Buffer with progress reporting via a passthrough stream
async function uploadWithProgress(url, buffer, onProgress) {
  return new Promise((resolve, reject) => {
    const { PassThrough } = require('stream');
    const stream = new PassThrough();
    let uploaded = 0;
    const total = buffer.length;

    stream.on('data', (chunk) => {
      uploaded += chunk.length;
      const pct = Math.round((uploaded / total) * 100);
      onProgress(pct);
    });

    // Write buffer to stream
    stream.end(buffer);

    fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/*', 'Content-Length': total.toString() },
      body: stream,
      duplex: 'half',
    }).then(resolve).catch(reject);
  });
}

async function refreshYouTubeToken(refreshToken) {
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.YOUTUBE_CLIENT_ID || '',
        client_secret: process.env.YOUTUBE_CLIENT_SECRET || '',
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const data = await res.json();
    if (data.error) return { error: data.error };
    return { access_token: data.access_token, expires_in: data.expires_in };
  } catch (err) {
    return { error: err.message };
  }
}

module.exports = { publishToYouTube };
