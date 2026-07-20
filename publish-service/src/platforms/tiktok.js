const fs = require('node:fs');
const { fetchMediaFile } = require('../media');

const TIKTOK_MIN_CHUNK_SIZE = 5_000_000;
const TIKTOK_MAX_CHUNK_SIZE = 64_000_000;
const TIKTOK_MAX_FINAL_CHUNK_SIZE = 128_000_000;
const TIKTOK_MAX_CHUNKS = 1000;
const TIKTOK_CHUNK_MAX_ATTEMPTS = 4;
const TIKTOK_PREFER_PULL_FROM_URL = process.env.TIKTOK_PREFER_PULL_FROM_URL === 'true';
const TIKTOK_STATUS_POLL_MAX_ATTEMPTS = Number(process.env.TIKTOK_STATUS_POLL_MAX_ATTEMPTS || 10);
const TIKTOK_STATUS_POLL_INTERVAL_MS = Number(process.env.TIKTOK_STATUS_POLL_INTERVAL_MS || 3000);

const TIKTOK_SETTLED_STATUSES = new Set(['SEND_TO_USER_INBOX', 'PUBLISH_COMPLETE']);

// TikTok only reports transcode rejections here — accepting the bytes says nothing
// about whether the video survived processing.
const TIKTOK_FAIL_REASONS = {
  file_format_check_failed: 'TikTok rejected the video format. Try re-exporting as an MP4 (H.264 video, AAC audio).',
  duration_check_failed: 'TikTok rejected the video length. It must be between 3 seconds and 10 minutes.',
  frame_rate_check_failed: 'TikTok rejected the video frame rate. Try re-exporting at a constant 30fps.',
  picture_size_check_failed: 'TikTok rejected the video dimensions. Try a 1080x1920 export.',
  video_pull_failed: 'TikTok could not download the video from the media URL.',
  auth_removed: 'TikTok access was revoked. Please reconnect your TikTok account.',
  spam_risk_too_many_posts: 'TikTok blocked this post: too many posts in the last 24 hours.',
  spam_risk_user_banned_from_posting: 'TikTok has blocked this account from posting.',
  spam_risk: 'TikTok flagged this post as spam and blocked it.',
};

async function publishToTikTok(post, account, supabase, onProgress, fileBuffer) {
  const p = onProgress || (async () => {});
  await p('authenticating', 'Authenticating with TikTok...');
  console.log('[TIKTOK] Starting publish...');

  if (!hasTikTokScope(account, 'video.upload')) {
    throw new Error('TikTok needs the video upload permission. Please reconnect your TikTok account.');
  }

  const accessToken = await getValidTikTokAccessToken(account, supabase);

  if (!fileBuffer && post.video_url && TIKTOK_PREFER_PULL_FROM_URL) {
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
      await p('uploading', 'TikTok URL import failed. Uploading video directly...');
      const media = await fetchMediaFile(post);
      return await uploadFileToTikTok(accessToken, media, p);
    }

    await p('finalizing', 'Waiting for TikTok to import the video...');
    return await confirmTikTokPublish(accessToken, initData.data?.publish_id, p);
  }

  if (fileBuffer) {
    return await uploadFileToTikTok(accessToken, {
      size: fileBuffer.length,
      body: fileBuffer,
      contentType: post.metadata?.content_type,
    }, p);
  }

  if (post.video_url) {
    await p('preparing', 'Preparing verified media for TikTok upload...');
    const media = await fetchMediaFile(post);
    return await uploadFileToTikTok(accessToken, media, p);
  }

  throw new Error('No video data available for TikTok');
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

  let source = null;
  const contentType = getTikTokUploadContentType(media.contentType);
  try {
    source = createChunkSource(media);
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
  } finally {
    if (source?.close) await source.close();
    if (media.cleanup) await media.cleanup();
  }

  await p('finalizing', 'Finalizing with TikTok...');
  return await confirmTikTokPublish(accessToken, publishId, p);
}

// Uploading the bytes only means TikTok received them. Processing happens afterwards
// and can still reject the video, so wait for a settled status before claiming success.
async function confirmTikTokPublish(accessToken, publishId, onProgress) {
  const p = onProgress || (async () => {});
  if (!publishId) throw new Error('TikTok did not return a publish id');

  let lastStatus = null;

  for (let attempt = 1; attempt <= TIKTOK_STATUS_POLL_MAX_ATTEMPTS; attempt += 1) {
    const result = await fetchTikTokPublishStatus(accessToken, publishId);

    if (result?.status) {
      lastStatus = result.status;

      if (TIKTOK_SETTLED_STATUSES.has(result.status)) {
        return {
          status: 'success',
          publish_id: publishId,
          note: 'Video sent to TikTok inbox. Open TikTok app to post.',
        };
      }

      if (result.status === 'FAILED') {
        console.error('[TIKTOK] Publish failed during processing', {
          publishId,
          failReason: result.failReason,
        });
        throw new Error(describeTikTokFailReason(result.failReason));
      }
    }

    if (attempt < TIKTOK_STATUS_POLL_MAX_ATTEMPTS) {
      await p('finalizing', 'Waiting for TikTok to finish processing the video...');
      await delay(TIKTOK_STATUS_POLL_INTERVAL_MS);
    }
  }

  console.warn('[TIKTOK] Gave up waiting for processing to settle', { publishId, lastStatus });
  return {
    status: 'pending',
    publish_id: publishId,
    note: 'TikTok is still processing the video. Check your TikTok inbox shortly.',
  };
}

async function fetchTikTokPublishStatus(accessToken, publishId) {
  try {
    const response = await fetch('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ publish_id: publishId }),
    });

    const body = await response.text();
    const data = body ? JSON.parse(body) : {};
    if (data.error?.code && data.error.code !== 'ok') {
      console.warn('[TIKTOK] Status check returned an error', { code: data.error.code });
      return null;
    }

    return { status: data.data?.status || null, failReason: data.data?.fail_reason || null };
  } catch (error) {
    // A flaky status check should not fail an upload that may well have succeeded.
    console.warn('[TIKTOK] Status check failed', { error: error?.message || 'Unknown error' });
    return null;
  }
}

function describeTikTokFailReason(failReason) {
  const known = TIKTOK_FAIL_REASONS[String(failReason || '').toLowerCase()];
  if (known) return known;
  return failReason
    ? `TikTok could not process the video (${failReason}).`
    : 'TikTok could not process the video.';
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

function createChunkSource(input) {
  const media = input && (input.body !== undefined || input.filePath)
    ? input
    : { body: input };
  const body = media.body;

  if (media.filePath) {
    const fd = fs.openSync(media.filePath, 'r');
    let offset = 0;
    return {
      async read(length) {
        const chunk = Buffer.allocUnsafe(length);
        const bytesRead = fs.readSync(fd, chunk, 0, length, offset);
        offset += bytesRead;
        if (bytesRead !== length) throw new Error('Media ended before TikTok upload finished');
        return chunk;
      },
      async close() {
        fs.closeSync(fd);
      },
    };
  }

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
    confirmTikTokPublish,
    describeTikTokFailReason,
    TIKTOK_SETTLED_STATUSES,
    TIKTOK_MIN_CHUNK_SIZE,
    TIKTOK_MAX_CHUNK_SIZE,
    TIKTOK_MAX_FINAL_CHUNK_SIZE,
    TIKTOK_MAX_CHUNKS,
    TIKTOK_CHUNK_MAX_ATTEMPTS,
  },
};
