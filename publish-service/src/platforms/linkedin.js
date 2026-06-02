async function publishToLinkedIn(post, account) {
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
    return await createLinkedInVideoPost(headers, authorUrn, post, linkedinVideoUrn);
  }

  if (mediaType === 'video' && post.video_url) {
    return await uploadAndCreateLinkedInVideoPost(headers, authorUrn, post, access_token);
  }

  if (mediaType === 'image' && post.video_url) {
    return await createLinkedInImagePost(headers, authorUrn, post, access_token);
  }

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

async function uploadAndCreateLinkedInVideoPost(headers, authorUrn, post, accessToken) {
  console.log('[LINKEDIN] Server-side video upload flow...');

  // 1. Register upload
  const registerRes = await fetch('https://api.linkedin.com/rest/assets?action=registerUpload', {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      registerUploadRequest: {
        recipes: ['urn:li:digitalmediaRecipe:feedshare-video'],
        owner: authorUrn,
        serviceRelationships: [{
          relationshipType: 'OWNER',
          identifier: 'urn:li:userGeneratedContent',
        }],
        supportedUploadMechanism: ['SYNCHRONOUS_UPLOAD'],
      },
    }),
  });

  if (!registerRes.ok) throw new Error('LinkedIn register upload failed: ' + (await registerRes.text()));
  const registerData = await registerRes.json();
  const uploadUrl = registerData.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl;
  const assetUrn = registerData.value?.asset;

  if (!uploadUrl || !assetUrn) throw new Error('Failed to get LinkedIn upload URL');

  // 2. Download video from storage
  const videoRes = await fetch(post.video_url);
  if (!videoRes.ok) throw new Error('Failed to download video');
  const videoBuffer = Buffer.from(await videoRes.arrayBuffer());

  // 3. Upload to LinkedIn
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream',
    },
    body: videoBuffer,
  });
  if (!uploadRes.ok) throw new Error('LinkedIn video upload failed: ' + (await uploadRes.text()));

  return createLinkedInVideoPost(headers, authorUrn, post, assetUrn);
}

async function createLinkedInImagePost(headers, authorUrn, post, accessToken) {
  console.log('[LINKEDIN] Image upload flow...');

  const registerRes = await fetch('https://api.linkedin.com/rest/assets?action=registerUpload', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      registerUploadRequest: {
        recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
        owner: authorUrn,
        serviceRelationships: [{
          relationshipType: 'OWNER',
          identifier: 'urn:li:userGeneratedContent',
        }],
        supportedUploadMechanism: ['SYNCHRONOUS_UPLOAD'],
      },
    }),
  });
  if (!registerRes.ok) throw new Error('LinkedIn register image upload failed: ' + (await registerRes.text()));
  const registerData = await registerRes.json();
  const uploadUrl = registerData.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl;
  const assetUrn = registerData.value?.asset;
  if (!uploadUrl || !assetUrn) throw new Error('Failed to get LinkedIn image upload URL');

  const imgRes = await fetch(post.video_url);
  if (!imgRes.ok) throw new Error('Failed to download image');
  const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/octet-stream' },
    body: imgBuffer,
  });
  if (!uploadRes.ok) throw new Error('LinkedIn image upload failed: ' + (await uploadRes.text()));

  const postBody = {
    author: authorUrn,
    commentary: post.caption || '',
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    content: { media: { id: assetUrn } },
    lifecycleState: 'PUBLISHED',
  };

  const res = await fetch('https://api.linkedin.com/rest/posts', {
    method: 'POST', headers, body: JSON.stringify(postBody),
  });
  if (!res.ok) throw new Error('Failed to create LinkedIn image post: ' + (await res.text()));

  return { status: 'success', url: 'https://linkedin.com/feed/' };
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
