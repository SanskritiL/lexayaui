async function publishToYouTube(post, account, supabase, onProgress, fileBuffer) {
  const p = onProgress || (async () => {});
  await p('authenticating', 'Authenticating with YouTube...');
  console.log('[YOUTUBE] Starting publish...');
  if (post.metadata?.media_type !== 'video') {
    return { status: 'error', error: 'YouTube Shorts requires a video' };
  }

  const videoBytes = fileBuffer;
  if (!videoBytes) throw new Error('No video data available for YouTube');
  console.log('[YOUTUBE] Video size:', (videoBytes.length / 1024 / 1024).toFixed(2), 'MB');

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

  let description = post.caption || '';
  description = description.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\u200B-\u200F\u2028-\u202F\uFEFF]/g, '').trim();
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

  if (!uploadRes.ok) {
    const errorText = await uploadRes.text();
    console.error('[YOUTUBE] Upload failed:', uploadRes.status, errorText);
    throw new Error('Failed to upload video to YouTube: ' + errorText);
  }

  await p('processing', 'YouTube is processing your video...');
  const videoData = await uploadRes.json();
  console.log('[YOUTUBE] Upload complete:', videoData.id);
  return { status: 'success', post_id: videoData.id, url: `https://youtube.com/shorts/${videoData.id}` };
}

// Helper: upload a Buffer. Avoid reading a stream before fetch consumes it; Node
// rejects disturbed/locked request bodies.
async function uploadWithProgress(url, buffer, onProgress) {
  const total = buffer.length;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/*', 'Content-Length': total.toString() },
    body: buffer,
  });
  await onProgress(100);
  return res;
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
