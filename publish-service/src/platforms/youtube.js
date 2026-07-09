const { fetchMediaStream, getMediaInfo } = require('../media');

async function publishToYouTube(post, account, supabase, onProgress, fileBuffer) {
  const p = onProgress || (async () => {});
  await p('authenticating', 'Authenticating with YouTube...');
  console.log('[YOUTUBE] Starting publish...');
  if (post.metadata?.media_type !== 'video') {
    return { status: 'error', error: 'YouTube Shorts requires a video' };
  }

  const media = fileBuffer
    ? { size: fileBuffer.length, body: fileBuffer, contentType: 'video/*' }
    : await getMediaInfo(post);
  if (!media.size) throw new Error('No video data available for YouTube');
  console.log('[YOUTUBE] Video size:', (media.size / 1024 / 1024).toFixed(2), 'MB');

  const access_token = await getValidYouTubeAccessToken(account, supabase);

  let description = post.metadata?.youtube_description || post.caption || '';
  description = description.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\u200B-\u200F\u2028-\u202F\uFEFF]/g, '').trim();
  if (!description.toLowerCase().includes('#shorts')) description += '\n\n#Shorts';

  const firstLine = post.metadata?.youtube_title || post.caption?.split('\n').find(l => l.trim())?.trim() || '';
  let title = firstLine.substring(0, 100).replace(/[<>]/g, '') || 'Short video';

  await p('uploading', 'Uploading video to YouTube (0%)...', 0);
  const initRes = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Length': media.size.toString(),
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
  const uploadMedia = fileBuffer
    ? media
    : await fetchMediaStream(post);
  const uploadRes = await uploadWithProgress(uploadUrl, uploadMedia, async (pct) => {
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
async function uploadWithProgress(url, media, onProgress) {
  const total = media.size;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/*', 'Content-Length': total.toString() },
    body: media.body,
    duplex: 'half',
  });
  await onProgress(100);
  return res;
}

async function getValidYouTubeAccessToken(account, supabase) {
  if (!account?.access_token) {
    throw new Error('YouTube account is missing an access token. Please reconnect YouTube.');
  }

  const tokenExpiresAt = new Date(account.token_expires_at).getTime();
  const hasValidExpiry = Number.isFinite(tokenExpiresAt);
  const refreshSkewMs = 5 * 60 * 1000;

  if (hasValidExpiry && tokenExpiresAt > Date.now() + refreshSkewMs) {
    return account.access_token;
  }

  if (!account.refresh_token) {
    throw new Error('YouTube token expired. Please reconnect your YouTube account.');
  }

  console.log('[YOUTUBE] Token expired or expiring soon, refreshing...');
  const refreshed = await refreshYouTubeToken(account.refresh_token);
  const tokenExpiresIso = new Date(Date.now() + (Number(refreshed.expires_in) * 1000)).toISOString();

  await supabase
    .from('connected_accounts')
    .update({
      access_token: refreshed.access_token,
      token_expires_at: tokenExpiresIso,
      updated_at: new Date().toISOString(),
    })
    .eq('id', account.id);

  console.log('[YOUTUBE] Token refreshed successfully.');
  return refreshed.access_token;
}

async function refreshYouTubeToken(refreshToken) {
  const clientId = process.env.YOUTUBE_CLIENT_ID?.trim();
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    console.error('[YOUTUBE] Cannot refresh token: missing YOUTUBE_CLIENT_ID or YOUTUBE_CLIENT_SECRET');
    throw new Error('YouTube token refresh is not configured. Please reconnect your YouTube account.');
  }

  if (!refreshToken) {
    throw new Error('YouTube token expired. Please reconnect your YouTube account.');
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const responseText = await res.text();
  let data;
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch (err) {
    console.error('[YOUTUBE] Token refresh returned invalid JSON:', responseText.slice(0, 300));
    throw new Error('YouTube token refresh failed. Please reconnect your YouTube account.');
  }

  if (!res.ok || !data.access_token) {
    const errorCode = data.error || `HTTP_${res.status}`;
    const errorDescription = data.error_description || data.message || 'Unknown YouTube refresh error';
    console.error('[YOUTUBE] Token refresh failed:', { status: res.status, errorCode, errorDescription });

    if (['invalid_grant', 'invalid_request', 'unauthorized_client'].includes(errorCode)) {
      throw new Error('YouTube token expired. Please reconnect your YouTube account.');
    }

    throw new Error('YouTube token refresh failed. Please reconnect your YouTube account.');
  }

  if (!Number.isFinite(Number(data.expires_in))) {
    console.error('[YOUTUBE] Token refresh response missing expires_in');
    throw new Error('YouTube token refresh failed. Please reconnect your YouTube account.');
  }

  return data;
}

module.exports = {
  publishToYouTube,
  _private: { getValidYouTubeAccessToken, refreshYouTubeToken },
};
