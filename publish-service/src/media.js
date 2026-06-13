async function getMediaInfo(post) {
  const url = post.video_url;
  if (!url) throw new Error('No media URL available');

  const metadata = post.metadata || {};
  const size = Number(metadata.file_size_bytes || metadata.fileSizeBytes || metadata.file_size || 0);
  const contentType = metadata.content_type || metadata.contentType || inferContentType(url, metadata.media_type);

  if (size > 0) {
    return { url, size, contentType };
  }

  const head = await fetch(url, { method: 'HEAD' });
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
  const response = await fetch(info.url);
  if (!response.ok || !response.body) {
    throw new Error(`Could not fetch media URL: HTTP ${response.status}`);
  }
  return { ...info, body: response.body };
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

module.exports = { getMediaInfo, fetchMediaStream };
