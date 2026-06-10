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

  if (mediaType === 'video' && fileBuffer) {
    return await uploadAndCreateLinkedInVideoPost(headers, authorUrn, post, access_token, p, fileBuffer);
  }

  if (mediaType === 'image' && fileBuffer) {
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

  const videoBuffer = fileBuffer;
  if (!videoBuffer) throw new Error('No video data available');

  await p('initializing', 'Initializing video upload with LinkedIn...');
  const initRes = await fetch('https://api.linkedin.com/rest/videos?action=initializeUpload', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      initializeUploadRequest: {
        owner: authorUrn,
        fileSizeBytes: videoBuffer.length,
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
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream',
    },
    body: videoBuffer,
  });
  if (!uploadRes.ok) throw new Error('LinkedIn video upload failed: ' + (await readLinkedInError(uploadRes)));

  await p('publishing', 'Creating LinkedIn post...');
  return createLinkedInVideoPost(headers, authorUrn, post, videoUrn);
}

async function createLinkedInImagePost(headers, authorUrn, post, accessToken, onProgress, fileBuffer) {
  const p = onProgress || (async () => {});
  console.log('[LINKEDIN] Image upload flow...');

  const imgBuffer = fileBuffer;
  if (!imgBuffer) throw new Error('No image data available');

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
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/octet-stream' },
    body: imgBuffer,
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
