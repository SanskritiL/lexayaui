const { fetchMediaStream, getMediaInfo } = require('../media');

async function publishToLinkedIn(post, account, onProgress, fileBuffer) {
  const p = onProgress || (async () => {});
  await p('authenticating', 'Authenticating with LinkedIn...');
  console.log('[LINKEDIN] Starting publish...');
  const mediaType = post.metadata?.media_type;
  const { access_token } = account;

  const headers = {
    'Authorization': `Bearer ${access_token}`,
    'Content-Type': 'application/json',
    'X-Restli-Protocol-Version': '2.0.0',
    'LinkedIn-Version': '202507',
  };

  const profileRes = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!profileRes.ok) throw new Error('Failed to get LinkedIn profile: ' + (await profileRes.text()));
  const profile = await profileRes.json();
  const authorUrn = `urn:li:person:${profile.sub}`;

  const linkedinVideoUrn = post.metadata?.linkedin_video_urn;
  if (linkedinVideoUrn) {
    await p('publishing', 'Creating LinkedIn post...');
    return await createLinkedInVideoPost(headers, authorUrn, post, linkedinVideoUrn);
  }

  if (mediaType === 'video' && (fileBuffer || post.video_url)) {
    return await uploadAndCreateLinkedInVideoPost(headers, authorUrn, post, access_token, p, fileBuffer);
  }

  if (mediaType === 'image' && (fileBuffer || post.video_url)) {
    return await createLinkedInImagePost(headers, authorUrn, post, access_token, p, fileBuffer);
  }

  await p('publishing', 'Creating LinkedIn post...');
  return await createLinkedInTextPost(headers, authorUrn, post);
}

async function createLinkedInVideoPost(headers, authorUrn, post, videoUrn) {
  const postBody = {
    author: authorUrn,
    commentary: post.caption || '',
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    content: { media: { id: videoUrn } },
    lifecycleState: 'PUBLISHED',
  };

  const res = await fetch('https://api.linkedin.com/rest/posts', {
    method: 'POST', headers, body: JSON.stringify(postBody),
  });
  if (!res.ok) throw new Error('Failed to create LinkedIn video post: ' + (await res.text()));

  const postId = res.headers.get('x-restli-id');
  return { status: 'success', post_id: postId, url: `https://linkedin.com/feed/update/${postId}` };
}

async function uploadAndCreateLinkedInVideoPost(headers, authorUrn, post, accessToken, onProgress, fileBuffer) {
  const p = onProgress || (async () => {});
  console.log('[LINKEDIN] Server-side video upload flow...');

  const media = fileBuffer
    ? { size: fileBuffer.length, body: fileBuffer, contentType: 'application/octet-stream' }
    : await getMediaInfo(post);
  if (!media.size) throw new Error('No video data available');

  await p('initializing', 'Initializing video upload with LinkedIn...');
  const initRes = await fetch('https://api.linkedin.com/rest/videos?action=initializeUpload', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      initializeUploadRequest: {
        owner: authorUrn,
        fileSizeBytes: media.size,
        uploadCaptions: false,
        uploadThumbnail: false,
      },
    }),
  });

  if (!initRes.ok) throw new Error('LinkedIn video upload init failed: ' + (await readLinkedInError(initRes)));
  const initData = await initRes.json();
  const uploadUrl = initData.value?.uploadInstructions?.[0]?.uploadUrl;
  const videoUrn = initData.value?.video;

  if (!uploadUrl || !videoUrn) throw new Error('Failed to get LinkedIn video upload URL');

  await p('uploading', 'Uploading video to LinkedIn...');
  const uploadMedia = fileBuffer
    ? media
    : await fetchMediaStream(post);
  const uploadedPartIds = await uploadLinkedInVideoParts({
    uploadInstructions: initData.value.uploadInstructions,
    uploadToken: initData.value.uploadToken || '',
    videoUrn,
    uploadMedia,
    headers,
    accessToken,
    onProgress: p,
  });

  await p('finalizing', 'Finalizing LinkedIn video upload...', 100);
  const finalizeRes = await fetch('https://api.linkedin.com/rest/videos?action=finalizeUpload', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      finalizeUploadRequest: {
        video: videoUrn,
        uploadToken: initData.value.uploadToken || '',
        uploadedPartIds,
      },
    }),
  });
  if (!finalizeRes.ok) throw new Error('LinkedIn video upload finalize failed: ' + (await readLinkedInError(finalizeRes)));

  await p('publishing', 'Creating LinkedIn post...');
  return createLinkedInVideoPost(headers, authorUrn, post, videoUrn);
}

async function uploadLinkedInVideoParts({ uploadInstructions, uploadMedia, accessToken, onProgress }) {
  const instructions = Array.isArray(uploadInstructions) ? [...uploadInstructions] : [];
  if (instructions.length === 0) throw new Error('LinkedIn did not return video upload instructions');

  instructions.sort((a, b) => Number(a.firstByte || 0) - Number(b.firstByte || 0));
  const source = createChunkSource(uploadMedia.body);
  const uploadedPartIds = [];

  for (let i = 0; i < instructions.length; i++) {
    const instruction = instructions[i];
    const firstByte = Number(instruction.firstByte);
    const lastByte = Number(instruction.lastByte);
    const uploadUrl = instruction.uploadUrl;
    if (!uploadUrl || !Number.isFinite(firstByte) || !Number.isFinite(lastByte) || lastByte < firstByte) {
      throw new Error('LinkedIn returned invalid video upload instructions');
    }

    const length = lastByte - firstByte + 1;
    const chunk = await source.read(length);
    const pct = Math.round(((i + 1) / instructions.length) * 100);
    await onProgress('uploading', `Uploading LinkedIn video part ${i + 1} of ${instructions.length} (${pct}%)...`, pct);

    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': chunk.length.toString(),
      },
      body: chunk,
    });
    if (!uploadRes.ok) {
      throw new Error('LinkedIn video upload failed: ' + (await readLinkedInError(uploadRes)));
    }

    const partId = uploadRes.headers.get('etag') || uploadRes.headers.get('ETag');
    if (!partId) throw new Error('LinkedIn video upload failed: missing uploaded part id');
    uploadedPartIds.push(partId.replace(/^"|"$/g, ''));
  }

  return uploadedPartIds;
}

function createChunkSource(body) {
  if (Buffer.isBuffer(body)) {
    let offset = 0;
    return {
      async read(length) {
        const chunk = body.slice(offset, offset + length);
        offset += chunk.length;
        if (chunk.length !== length) throw new Error('Media ended before LinkedIn upload finished');
        return chunk;
      },
    };
  }

  if (!body?.getReader) throw new Error('Unsupported media body for LinkedIn upload');

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
      if (chunk.length !== length) throw new Error('Media ended before LinkedIn upload finished');
      return chunk;
    },
  };
}

async function createLinkedInImagePost(headers, authorUrn, post, accessToken, onProgress, fileBuffer) {
  const p = onProgress || (async () => {});
  console.log('[LINKEDIN] Image upload flow...');

  if (!fileBuffer && !post.video_url) throw new Error('No image data available');

  await p('initializing', 'Initializing image upload with LinkedIn...');
  const initRes = await fetch('https://api.linkedin.com/rest/images?action=initializeUpload', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      initializeUploadRequest: {
        owner: authorUrn,
      },
    }),
  });
  if (!initRes.ok) throw new Error('LinkedIn image upload init failed: ' + (await readLinkedInError(initRes)));
  const initData = await initRes.json();
  const uploadUrl = initData.value?.uploadUrl;
  const imageUrn = initData.value?.image;
  if (!uploadUrl || !imageUrn) throw new Error('Failed to get LinkedIn image upload URL');

  await p('uploading', 'Uploading image to LinkedIn...');
  const uploadMedia = fileBuffer
    ? { body: fileBuffer, size: fileBuffer.length }
    : await fetchMediaStream(post);
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream',
      'Content-Length': uploadMedia.size.toString(),
    },
    body: uploadMedia.body,
    duplex: 'half',
  });
  if (!uploadRes.ok) throw new Error('LinkedIn image upload failed: ' + (await readLinkedInError(uploadRes)));

  await p('publishing', 'Creating LinkedIn post...');
  const postBody = {
    author: authorUrn,
    commentary: post.caption || '',
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    content: { media: { id: imageUrn } },
    lifecycleState: 'PUBLISHED',
  };

  const res = await fetch('https://api.linkedin.com/rest/posts', {
    method: 'POST', headers, body: JSON.stringify(postBody),
  });
  if (!res.ok) throw new Error('Failed to create LinkedIn image post: ' + (await res.text()));

  return { status: 'success', url: 'https://linkedin.com/feed/' };
}

async function readLinkedInError(res) {
  const text = await res.text();
  if (res.status === 413) {
    return text || 'HTTP 413. LinkedIn rejected the video upload as too large for this request. Re-encode the video smaller or try again after the multipart upload fix is deployed.';
  }
  if (!text) return `HTTP ${res.status}`;
  try {
    const parsed = JSON.parse(text);
    return parsed.message || parsed.error_description || parsed.error || text;
  } catch (e) {
    return text;
  }
}

async function createLinkedInTextPost(headers, authorUrn, post) {
  const postBody = {
    author: authorUrn,
    commentary: post.caption || '',
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: 'PUBLISHED',
  };

  const res = await fetch('https://api.linkedin.com/rest/posts', {
    method: 'POST', headers, body: JSON.stringify(postBody),
  });
  if (!res.ok) throw new Error('Failed to create LinkedIn text post: ' + (await res.text()));

  return { status: 'success', note: 'Posted!' };
}

module.exports = { publishToLinkedIn };
