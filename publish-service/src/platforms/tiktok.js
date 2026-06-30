const { fetchMediaStream } = require('../media');

const TIKTOK_MIN_CHUNK_SIZE = 5_000_000;
const TIKTOK_MAX_CHUNK_SIZE = 64_000_000;
const TIKTOK_MAX_FINAL_CHUNK_SIZE = 128_000_000;
const TIKTOK_MAX_CHUNKS = 1000;
const TIKTOK_CHUNK_MAX_ATTEMPTS = 4;

async function publishToTikTok(post, account, supabase, onProgress, fileBuffer) {
  const p = onProgress || (async () => {});
  await p('authenticating', 'Authenticating with TikTok...');
  console.log('[TIKTOK] Starting publish...');

  if (!hasTikTokScope(account, 'video.upload')) {
    throw new Error('TikTok needs the video upload permission. Please reconnect your TikTok account.');
  }

  const accessToken = await getValidTikTokAccessToken(account, supabase);

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

  const uploadPlan = buildTikTokUploadPlan(videoSize);

  await p('initializing', 'Initializing TikTok upload...');
  const initRes = await fetch('https://open.tiktokapis.com/v2/post/publish/inbox/video/init/', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: videoSize,
        chunk_size: uploadPlan.chunkSize,
        total_chunk_count: uploadPlan.totalChunks,
      },
    }),
  });
  const initData = await initRes.json();
  if (initData.error?.code !== 'ok') throw new Error(initData.error?.message || 'Failed to init TikTok upload');

  const publishId = initData.data?.publish_id;
  const uploadUrl = initData.data?.upload_url;
  if (!uploadUrl) throw new Error('No upload URL from TikTok');

  const source = createChunkSource(media.body);
  const contentType = getTikTokUploadContentType(media.contentType);
  for (let i = 0; i < uploadPlan.chunks.length; i++) {
    const part = uploadPlan.chunks[i];
    const chunk = await source.read(part.length);
    const pct = Math.round(((i + 1) / uploadPlan.totalChunks) * 100);

    await p('uploading', `Uploading chunk ${i + 1} of ${uploadPlan.totalChunks} (${pct}%)...`, pct);

    const isLastChunk = i === uploadPlan.totalChunks - 1;
    await uploadTikTokChunk({
      uploadUrl,
      chunk,
      contentType,
      contentRange: `bytes ${part.start}-${part.end}/${videoSize}`,
      chunkNumber: i + 1,
      isLastChunk,
    });
  }

  await p('finalizing', 'Finalizing with TikTok...');
  return {
    status: 'success',
    publish_id: publishId,
    note: 'Video sent to TikTok inbox. Open TikTok app to post.',
  };
}

async function uploadTikTokChunk({ uploadUrl, chunk, contentType, contentRange, chunkNumber, isLastChunk }) {
  let lastFailure = null;

  for (let attempt = 1; attempt <= TIKTOK_CHUNK_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': contentType,
          'Content-Length': chunk.length.toString(),
          'Content-Range': contentRange,
        },
        body: chunk,
      });
      const expectedStatus = isLastChunk ? 201 : 206;
      if (response.status === expectedStatus || response.status === 201 || response.status === 206) return;

      const responseBody = await response.text();
      lastFailure = { status: response.status, body: responseBody };
      if (!isRetryableTikTokUploadFailure(response.status, responseBody) || attempt === TIKTOK_CHUNK_MAX_ATTEMPTS) {
        throw buildTikTokChunkError(chunkNumber, lastFailure, attempt);
      }
    } catch (error) {
      if (error?.code === 'TIKTOK_CHUNK_UPLOAD_FAILED') throw error;
      lastFailure = { status: 0, body: error?.message || 'Network error' };
      if (attempt === TIKTOK_CHUNK_MAX_ATTEMPTS) {
        throw buildTikTokChunkError(chunkNumber, lastFailure, attempt);
      }
    }

    const uploadHost = safeUrlHost(uploadUrl);
    console.warn('[TIKTOK] Retrying chunk upload', {
      uploadHost,
      chunkNumber,
      attempt,
      status: lastFailure.status,
      providerCode: readTikTokUploadErrorCode(lastFailure.body),
    });
    await delay(750 * (2 ** (attempt - 1)));
  }
}

function isRetryableTikTokUploadFailure(status, body) {
  const code = readTikTokUploadErrorCode(body);
  return status === 0 || status === 408 || status === 429 || status >= 500 || code === 50001;
}

function readTikTokUploadErrorCode(body) {
  try {
    return Number(JSON.parse(body || '{}').code) || null;
  } catch (_) {
    return null;
  }
}

function buildTikTokChunkError(chunkNumber, failure, attempts) {
  const error = new Error(`TikTok chunk ${chunkNumber} failed after ${attempts} attempts: ${failure.body}`);
  error.code = 'TIKTOK_CHUNK_UPLOAD_FAILED';
  return error;
}

function safeUrlHost(value) {
  try {
    return new URL(value).host;
  } catch (_) {
    return 'unknown';
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildTikTokUploadPlan(videoSize) {
  if (!Number.isSafeInteger(videoSize) || videoSize <= 0) {
    throw new Error('Invalid TikTok video size');
  }

  let chunkSize;
  let totalChunks;

  if (videoSize <= TIKTOK_MAX_CHUNK_SIZE) {
    chunkSize = videoSize;
    totalChunks = 1;
  } else if (videoSize <= TIKTOK_MAX_FINAL_CHUNK_SIZE) {
    totalChunks = 2;
    chunkSize = Math.floor(videoSize / totalChunks);
  } else {
    chunkSize = TIKTOK_MAX_CHUNK_SIZE;
    totalChunks = Math.floor(videoSize / chunkSize);
  }

  if (totalChunks > TIKTOK_MAX_CHUNKS) {
    throw new Error('TikTok video requires too many chunks');
  }

  const chunks = [];
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = i === totalChunks - 1 ? videoSize - 1 : start + chunkSize - 1;
    chunks.push({ start, end, length: end - start + 1 });
  }

  const finalChunk = chunks[chunks.length - 1];
  const nonFinalChunks = chunks.slice(0, -1);
  const invalidNonFinalChunk = nonFinalChunks.find(chunk =>
    chunk.length < TIKTOK_MIN_CHUNK_SIZE || chunk.length > TIKTOK_MAX_CHUNK_SIZE
  );
  if (invalidNonFinalChunk) {
    throw new Error('TikTok chunk size is outside the allowed range');
  }
  if (totalChunks > 1 && finalChunk.length > TIKTOK_MAX_FINAL_CHUNK_SIZE) {
    throw new Error('TikTok final chunk is too large');
  }

  return { chunkSize, totalChunks, chunks };
}

function getTikTokUploadContentType(contentType) {
  const normalized = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (['video/mp4', 'video/quicktime', 'video/webm'].includes(normalized)) {
    return normalized;
  }
  return 'video/mp4';
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
  const queue = [];
  let bufferedLength = 0;
  let done = false;

  return {
    async read(length) {
      while (bufferedLength < length && !done) {
        const next = await reader.read();
        done = next.done;
        if (next.value) {
          const buffer = Buffer.from(next.value);
          queue.push(buffer);
          bufferedLength += buffer.length;
        }
      }

      if (bufferedLength < length) throw new Error('Media ended before TikTok upload finished');

      const chunks = [];
      let remaining = length;
      while (remaining > 0) {
        const head = queue[0];
        if (head.length <= remaining) {
          chunks.push(head);
          queue.shift();
          bufferedLength -= head.length;
          remaining -= head.length;
        } else {
          chunks.push(head.slice(0, remaining));
          queue[0] = head.slice(remaining);
          bufferedLength -= remaining;
          remaining = 0;
        }
      }

      return chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, length);
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

async function getValidTikTokAccessToken(account, supabase) {
  const tokenExpiresAt = new Date(account.token_expires_at).getTime();
  const shouldRefresh = !Number.isFinite(tokenExpiresAt) || tokenExpiresAt <= Date.now() + 5 * 60 * 1000;

  if (!shouldRefresh) return account.access_token;
  if (!account.refresh_token) throw new Error('TikTok token expired. Please reconnect your TikTok account.');

  const refreshData = await refreshTikTokAccessToken(account.refresh_token);

  await supabase.from('connected_accounts').update({
    access_token: refreshData.access_token,
    refresh_token: refreshData.refresh_token || account.refresh_token,
    token_expires_at: new Date(Date.now() + (Number(refreshData.expires_in) * 1000)).toISOString(),
  }).eq('id', account.id);

  return refreshData.access_token;
}

async function refreshTikTokAccessToken(refreshToken) {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

  if (!clientKey || !clientSecret) {
    console.error('[TIKTOK] Cannot refresh token: missing TIKTOK_CLIENT_KEY or TIKTOK_CLIENT_SECRET');
    throw new Error('TikTok token refresh is not configured. Please reconnect your TikTok account.');
  }

  const refreshRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  const responseText = await refreshRes.text();
  let refreshData;
  try {
    refreshData = responseText ? JSON.parse(responseText) : {};
  } catch (error) {
    console.error('[TIKTOK] Token refresh returned invalid JSON:', responseText.slice(0, 300));
    throw new Error('TikTok token refresh failed. Please reconnect your TikTok account.');
  }

  if (!refreshRes.ok || !refreshData.access_token) {
    const errorCode = refreshData.error?.code || refreshData.error || refreshData.code || `HTTP_${refreshRes.status}`;
    const errorMessage = refreshData.error?.message || refreshData.error_description || refreshData.message || 'Unknown TikTok refresh error';
    console.error('[TIKTOK] Token refresh failed:', { status: refreshRes.status, errorCode, errorMessage });
    throw new Error('TikTok token expired. Please reconnect your TikTok account.');
  }

  if (!Number.isFinite(Number(refreshData.expires_in))) {
    console.error('[TIKTOK] Token refresh response missing expires_in');
    throw new Error('TikTok token refresh failed. Please reconnect your TikTok account.');
  }

  return refreshData;
}

module.exports = {
  publishToTikTok,
  _private: {
    buildTikTokUploadPlan,
    createChunkSource,
    getTikTokUploadContentType,
    isRetryableTikTokUploadFailure,
    readTikTokUploadErrorCode,
    refreshTikTokAccessToken,
    TIKTOK_MIN_CHUNK_SIZE,
    TIKTOK_MAX_CHUNK_SIZE,
    TIKTOK_MAX_FINAL_CHUNK_SIZE,
    TIKTOK_MAX_CHUNKS,
    TIKTOK_CHUNK_MAX_ATTEMPTS,
  },
};
