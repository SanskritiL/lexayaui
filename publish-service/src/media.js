const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const MEDIA_INSPECT_TIMEOUT_MS = Number(process.env.MEDIA_INSPECT_TIMEOUT_MS || 10000);
const MEDIA_FETCH_TIMEOUT_MS = Number(process.env.MEDIA_FETCH_TIMEOUT_MS || 30000);
const MEDIA_DOWNLOAD_MAX_ATTEMPTS = Number(process.env.MEDIA_DOWNLOAD_MAX_ATTEMPTS || 3);
const MEDIA_DOWNLOAD_RETRY_BASE_MS = Number(process.env.MEDIA_DOWNLOAD_RETRY_BASE_MS || 750);

async function getMediaInfo(post) {
  const url = post.video_url;
  if (!url) throw new Error('No media URL available');

  const metadata = post.metadata || {};
  const size = Number(metadata.file_size_bytes || metadata.fileSizeBytes || metadata.file_size || 0);
  const contentType = metadata.content_type || metadata.contentType || inferContentType(url, metadata.media_type);

  if (size > 0) {
    return { url, size, contentType };
  }

  const head = await fetchWithTimeout(url, { method: 'HEAD' }, MEDIA_INSPECT_TIMEOUT_MS, 'inspect media URL');
  if (!head.ok) throw new Error(`Could not inspect media URL: HTTP ${head.status}`);

  const contentLength = Number(head.headers.get('content-length') || 0);
  if (!contentLength) throw new Error('Media URL did not provide a content length');

  return {
    url,
    size: contentLength,
    contentType: head.headers.get('content-type') || contentType,
  };
}

async function fetchMediaStream(post) {
  const info = await getMediaInfo(post);
  const response = await fetchWithTimeout(info.url, {}, MEDIA_FETCH_TIMEOUT_MS, 'fetch media URL');
  if (!response.ok || !response.body) {
    throw new Error(`Could not fetch media URL: HTTP ${response.status}`);
  }

  const responseSize = Number(response.headers.get('content-length') || 0);
  const responseContentType = response.headers.get('content-type');
  if (responseSize > 0 && info.size > 0 && responseSize !== info.size) {
    console.warn('[MEDIA] Media size metadata differs from fetched response', {
      metadataSize: info.size,
      responseSize,
      urlHost: safeUrlHost(info.url),
    });
  }

  return {
    ...info,
    size: responseSize || info.size,
    contentType: responseContentType || info.contentType,
    body: response.body,
  };
}

async function fetchMediaFile(post, options = {}) {
  const attempts = Math.max(1, Number(options.attempts || MEDIA_DOWNLOAD_MAX_ATTEMPTS));
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let tempPath = null;
    try {
      const media = await fetchMediaStream(post);
      tempPath = path.join(os.tmpdir(), `lexaya-media-${crypto.randomUUID()}`);
      const bytes = await writeBodyToFile(media.body, tempPath);

      if (bytes <= 0) {
        throw new Error('Downloaded media was empty');
      }
      if (media.size > 0 && bytes !== media.size) {
        throw new Error(`Downloaded media was incomplete (${bytes} of ${media.size} bytes)`);
      }

      return {
        ...media,
        size: bytes,
        body: null,
        filePath: tempPath,
        cleanup: async () => {
          await fs.unlink(tempPath).catch(() => {});
        },
      };
    } catch (error) {
      lastError = error;
      if (tempPath) await fs.unlink(tempPath).catch(() => {});

      if (attempt < attempts) {
        console.warn('[MEDIA] Retrying media download', {
          attempt,
          attempts,
          error: error?.message || 'Unknown error',
        });
        await delay(MEDIA_DOWNLOAD_RETRY_BASE_MS * (2 ** (attempt - 1)));
      }
    }
  }

  throw new Error(`Could not download complete media for publishing after ${attempts} attempts: ${lastError?.message || 'Unknown error'}`);
}

async function writeBodyToFile(body, tempPath) {
  const file = await fs.open(tempPath, 'w');
  let bytes = 0;

  try {
    if (body?.getReader) {
      const reader = body.getReader();
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        if (!next.value) continue;
        const chunk = Buffer.from(next.value);
        await file.write(chunk);
        bytes += chunk.length;
      }
      return bytes;
    }

    if (body?.[Symbol.asyncIterator]) {
      for await (const value of body) {
        const chunk = Buffer.from(value);
        await file.write(chunk);
        bytes += chunk.length;
      }
      return bytes;
    }
  } finally {
    await file.close();
  }

  throw new Error('Unsupported media body');
}

function inferContentType(url, mediaType) {
  const lower = String(url || '').toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (mediaType === 'image') return 'image/jpeg';
  return 'video/mp4';
}

async function fetchWithTimeout(url, options, timeoutMs, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(`Timed out while trying to ${label}. Check that the media URL is public and reachable.`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
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

module.exports = { getMediaInfo, fetchMediaStream, fetchMediaFile };
