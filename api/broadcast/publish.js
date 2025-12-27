// Publish to All Platforms API
// Handles publishing a post to multiple platforms

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
    console.log('========== PUBLISH API START ==========');

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    console.log('[ENV] SUPABASE_URL:', SUPABASE_URL ? 'SET' : 'NOT SET');
    console.log('[ENV] SUPABASE_SERVICE_KEY:', SUPABASE_SERVICE_KEY ? 'SET' : 'NOT SET');
    console.log('[REQUEST] Method:', req.method);
    console.log('[REQUEST] Body:', JSON.stringify(req.body));

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Verify authentication
    console.log('[AUTH] Verifying authorization...');
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.log('[AUTH] No authorization header');
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.replace('Bearer ', '');
    console.log('[AUTH] Token present, verifying with Supabase...');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
        console.log('[AUTH] User verification failed:', userError);
        return res.status(401).json({ error: 'Invalid token' });
    }
    console.log('[AUTH] User verified:', user.id, user.email);

    const { postId, platforms } = req.body;
    console.log('[REQUEST] postId:', postId, 'platforms:', platforms);

    if (!postId || !platforms || !Array.isArray(platforms)) {
        console.log('[ERROR] Invalid request body');
        return res.status(400).json({ error: 'postId and platforms array required' });
    }

    try {
        // Get the post
        console.log('[DB] Fetching post:', postId);
        const { data: post, error: postError } = await supabase
            .from('posts')
            .select('*')
            .eq('id', postId)
            .eq('user_id', user.id)
            .single();

        if (postError || !post) {
            console.log('[DB] Post not found:', postError);
            return res.status(404).json({ error: 'Post not found' });
        }
        console.log('[DB] Post found:', { id: post.id, caption: post.caption?.substring(0, 30), platforms: post.platforms });

        // Get connected accounts for the platforms
        console.log('[DB] Fetching connected accounts for platforms:', platforms);
        const { data: accounts, error: accountsError } = await supabase
            .from('connected_accounts')
            .select('*')
            .eq('user_id', user.id)
            .in('platform', platforms);

        if (accountsError) {
            console.log('[DB] Error fetching accounts:', accountsError);
            return res.status(500).json({ error: 'Failed to get connected accounts' });
        }
        console.log('[DB] Found accounts:', accounts.map(a => ({ platform: a.platform, account_name: a.account_name })));

        // Check which platforms are connected
        const connectedPlatforms = accounts.map(a => a.platform);
        const missingPlatforms = platforms.filter(p => !connectedPlatforms.includes(p));

        if (missingPlatforms.length > 0) {
            console.log('[ERROR] Missing platforms:', missingPlatforms);
            return res.status(400).json({
                error: `Not connected to: ${missingPlatforms.join(', ')}`,
                missingPlatforms
            });
        }

        // Publish to each platform
        console.log('[PUBLISH] Starting publish to platforms:', platforms);
        const results = {};
        let hasSuccess = false;
        let hasFailure = false;

        for (const platform of platforms) {
            console.log(`[PUBLISH] Processing platform: ${platform}`);
            const account = accounts.find(a => a.platform === platform);
            console.log(`[PUBLISH] Found account for ${platform}:`, !!account);

            try {
                let result;

                switch (platform) {
                    case 'linkedin':
                        console.log('[PUBLISH] Calling publishToLinkedIn...');
                        result = await publishToLinkedIn(post, account);
                        console.log('[PUBLISH] LinkedIn result:', result);
                        break;
                    case 'tiktok':
                        console.log('[PUBLISH] Calling publishToTikTok...');
                        result = await publishToTikTok(post, account);
                        console.log('[PUBLISH] TikTok result:', result);
                        break;
                    case 'instagram':
                        console.log('[PUBLISH] Calling publishToInstagram...');
                        result = await publishToInstagram(post, account);
                        console.log('[PUBLISH] Instagram result:', result);
                        break;
                    default:
                        result = { status: 'error', error: 'Unknown platform' };
                }

                results[platform] = result;

                if (result.status === 'success') {
                    hasSuccess = true;
                    console.log(`[PUBLISH] ✅ ${platform} succeeded`);
                } else {
                    hasFailure = true;
                    console.log(`[PUBLISH] ⚠️ ${platform} status:`, result.status);
                }
            } catch (error) {
                console.error(`[PUBLISH] ❌ Error publishing to ${platform}:`, error.message);
                console.error(`[PUBLISH] ❌ Stack:`, error.stack);
                results[platform] = { status: 'error', error: error.message };
                hasFailure = true;
            }
        }

        // Determine overall status
        let overallStatus = 'failed';
        if (hasSuccess && !hasFailure) {
            overallStatus = 'published';
        } else if (hasSuccess && hasFailure) {
            overallStatus = 'partial';
        }

        // Update post with results
        console.log('[DB] Updating post with results:', { overallStatus, results });
        await supabase
            .from('posts')
            .update({
                status: overallStatus,
                platform_results: results,
                published_at: hasSuccess ? new Date().toISOString() : null,
            })
            .eq('id', postId);

        console.log('========== PUBLISH API COMPLETE ==========');
        console.log('Final status:', overallStatus);
        console.log('Results:', JSON.stringify(results, null, 2));

        return res.status(200).json({
            success: hasSuccess,
            status: overallStatus,
            results
        });

    } catch (error) {
        console.error('========== PUBLISH API ERROR ==========');
        console.error('Publish error:', error.message);
        console.error('Stack:', error.stack);
        return res.status(500).json({ error: error.message });
    }
}

// LinkedIn Publishing
async function publishToLinkedIn(post, account) {
    console.log('[LINKEDIN] Starting publish...');
    console.log('[LINKEDIN] Post:', { id: post.id, caption: post.caption?.substring(0, 30), video_url: !!post.video_url });
    console.log('[LINKEDIN] Account:', { platform_user_id: account.platform_user_id, has_token: !!account.access_token });

    const { access_token, platform_user_id } = account;

    // For video posts, we need to use the video upload API
    // For now, we'll create a text post with a link to the video
    // Full video upload requires multiple steps

    const headers = {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': '202411',
    };

    // Get the author URN (person URN)
    console.log('[LINKEDIN] Getting user profile...');
    const profileResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` },
    });

    console.log('[LINKEDIN] Profile response status:', profileResponse.status);

    if (!profileResponse.ok) {
        const errorText = await profileResponse.text();
        console.error('[LINKEDIN] Profile error:', errorText);
        throw new Error('Failed to get LinkedIn profile: ' + errorText);
    }

    const profile = await profileResponse.json();
    console.log('[LINKEDIN] Profile:', { sub: profile.sub, name: profile.name });
    const authorUrn = `urn:li:person:${profile.sub}`;

    // If there's a video, we need to register and upload it
    if (post.video_url) {
        // Step 1: Register the video upload
        const registerResponse = await fetch('https://api.linkedin.com/rest/videos?action=initializeUpload', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                initializeUploadRequest: {
                    owner: authorUrn,
                    fileSizeBytes: 50000000, // Approximate, LinkedIn will handle it
                    uploadCaptions: false,
                    uploadThumbnail: false,
                },
            }),
        });

        if (!registerResponse.ok) {
            const errorText = await registerResponse.text();
            console.error('LinkedIn video register error:', errorText);
            // Fall back to text-only post
            return await createLinkedInTextPost(headers, authorUrn, post);
        }

        const registerData = await registerResponse.json();
        const { uploadUrl, video: videoUrn } = registerData.value;

        // Step 2: Upload the video
        // Note: This requires fetching the video and uploading - complex for serverless
        // For MVP, we'll fall back to a text post with link
        console.log('Video upload URL:', uploadUrl);
        console.log('Video URN:', videoUrn);

        // For now, create text post (video upload is complex for MVP)
        return await createLinkedInTextPost(headers, authorUrn, post);
    }

    // Text-only post
    return await createLinkedInTextPost(headers, authorUrn, post);
}

async function createLinkedInTextPost(headers, authorUrn, post) {
    console.log('[LINKEDIN] Creating text post...');
    console.log('[LINKEDIN] Author URN:', authorUrn);
    console.log('[LINKEDIN] Caption:', post.caption?.substring(0, 50) + '...');

    const postBody = {
        author: authorUrn,
        commentary: post.caption || '',
        visibility: 'PUBLIC',
        distribution: {
            feedDistribution: 'MAIN_FEED',
            targetEntities: [],
            thirdPartyDistributionChannels: [],
        },
        lifecycleState: 'PUBLISHED',
    };

    console.log('[LINKEDIN] Request body:', JSON.stringify(postBody, null, 2));
    console.log('[LINKEDIN] Headers:', JSON.stringify({ ...headers, Authorization: 'Bearer ***' }, null, 2));

    const postResponse = await fetch('https://api.linkedin.com/rest/posts', {
        method: 'POST',
        headers,
        body: JSON.stringify(postBody),
    });

    console.log('[LINKEDIN] Response status:', postResponse.status);
    console.log('[LINKEDIN] Response headers:', JSON.stringify(Object.fromEntries(postResponse.headers.entries()), null, 2));

    if (!postResponse.ok) {
        const errorText = await postResponse.text();
        console.error('[LINKEDIN] Post error response:', errorText);
        throw new Error('Failed to create LinkedIn post: ' + errorText);
    }

    const postId = postResponse.headers.get('x-restli-id');
    console.log('[LINKEDIN] Created post ID:', postId);

    return {
        status: 'success',
        post_id: postId,
        url: `https://www.linkedin.com/feed/update/${postId}`,
        note: 'Posted as text (video requires additional setup)',
    };
}

// TikTok Publishing (Upload to Drafts)
async function publishToTikTok(post, account) {
    const { access_token } = account;

    if (!post.video_url) {
        throw new Error('Video is required for TikTok');
    }

    // For TikTok, we'll use the "Upload" API which sends to drafts
    // Direct posting requires passing an app audit

    // Step 1: Initialize the upload
    const initResponse = await fetch('https://open.tiktokapis.com/v2/post/publish/inbox/video/init/', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${access_token}`,
            'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({
            source_info: {
                source: 'PULL_FROM_URL',
                video_url: post.video_url,
            },
        }),
    });

    if (!initResponse.ok) {
        const errorData = await initResponse.json();
        console.error('TikTok init error:', errorData);
        throw new Error(errorData.error?.message || 'Failed to initialize TikTok upload');
    }

    const initData = await initResponse.json();

    if (initData.error && initData.error.code !== 'ok') {
        throw new Error(initData.error.message || 'TikTok upload failed');
    }

    const publishId = initData.data?.publish_id;

    return {
        status: 'success',
        publish_id: publishId,
        note: 'Video sent to TikTok drafts. Open TikTok app to add caption and post.',
    };
}

// Instagram Publishing
async function publishToInstagram(post, account) {
    console.log('[INSTAGRAM] Starting publish...');
    console.log('[INSTAGRAM] Post:', { id: post.id, caption: post.caption?.substring(0, 30), video_url: post.video_url });
    console.log('[INSTAGRAM] Account:', { platform_user_id: account.platform_user_id, account_name: account.account_name, has_token: !!account.access_token });

    const { access_token, platform_user_id: igUserId } = account;

    if (!post.video_url) {
        console.error('[INSTAGRAM] ❌ No video URL provided');
        throw new Error('Video is required for Instagram Reels');
    }

    console.log('[INSTAGRAM] Video URL:', post.video_url);
    console.log('[INSTAGRAM] Instagram User ID:', igUserId);

    // Step 1: Create media container for Reel
    console.log('[INSTAGRAM] Step 1: Creating media container...');
    const containerUrl = new URL(`https://graph.facebook.com/v18.0/${igUserId}/media`);
    containerUrl.searchParams.set('access_token', access_token);
    containerUrl.searchParams.set('media_type', 'REELS');
    containerUrl.searchParams.set('video_url', post.video_url);
    containerUrl.searchParams.set('caption', post.caption || '');

    console.log('[INSTAGRAM] Container URL (without token):', containerUrl.toString().replace(access_token, '***TOKEN***'));

    const containerResponse = await fetch(containerUrl.toString(), {
        method: 'POST',
    });

    console.log('[INSTAGRAM] Container response status:', containerResponse.status);

    if (!containerResponse.ok) {
        const errorData = await containerResponse.json();
        console.error('[INSTAGRAM] ❌ Container creation failed!');
        console.error('[INSTAGRAM] Error response:', JSON.stringify(errorData, null, 2));
        throw new Error(errorData.error?.message || 'Failed to create Instagram container');
    }

    const containerData = await containerResponse.json();
    const containerId = containerData.id;
    console.log('[INSTAGRAM] ✅ Container created! ID:', containerId);

    // Step 2: Wait for processing (poll status)
    console.log('[INSTAGRAM] Step 2: Polling for processing status...');
    let isReady = false;
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds max wait
    let lastStatus = '';

    while (!isReady && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000));

        const statusUrl = new URL(`https://graph.facebook.com/v18.0/${containerId}`);
        statusUrl.searchParams.set('fields', 'status_code,status');
        statusUrl.searchParams.set('access_token', access_token);

        const statusResponse = await fetch(statusUrl.toString());
        const statusData = await statusResponse.json();

        if (statusData.status_code !== lastStatus) {
            console.log(`[INSTAGRAM] Status check #${attempts + 1}:`, statusData.status_code, statusData.status || '');
            lastStatus = statusData.status_code;
        }

        if (statusData.status_code === 'FINISHED') {
            isReady = true;
            console.log('[INSTAGRAM] ✅ Video processing complete!');
        } else if (statusData.status_code === 'ERROR') {
            console.error('[INSTAGRAM] ❌ Video processing failed!');
            console.error('[INSTAGRAM] Status data:', JSON.stringify(statusData, null, 2));
            throw new Error('Instagram video processing failed: ' + (statusData.status || 'Unknown error'));
        }

        attempts++;
    }

    if (!isReady) {
        console.log('[INSTAGRAM] ⏳ Still processing after 30 seconds...');
        return {
            status: 'pending',
            container_id: containerId,
            note: 'Video is still processing. It will be published automatically when ready.',
        };
    }

    // Step 3: Publish the container
    console.log('[INSTAGRAM] Step 3: Publishing the container...');
    const publishUrl = new URL(`https://graph.facebook.com/v18.0/${igUserId}/media_publish`);
    publishUrl.searchParams.set('access_token', access_token);
    publishUrl.searchParams.set('creation_id', containerId);

    const publishResponse = await fetch(publishUrl.toString(), {
        method: 'POST',
    });

    console.log('[INSTAGRAM] Publish response status:', publishResponse.status);

    if (!publishResponse.ok) {
        const errorData = await publishResponse.json();
        console.error('[INSTAGRAM] ❌ Publish failed!');
        console.error('[INSTAGRAM] Error response:', JSON.stringify(errorData, null, 2));
        throw new Error(errorData.error?.message || 'Failed to publish to Instagram');
    }

    const publishData = await publishResponse.json();
    console.log('[INSTAGRAM] ✅ Published successfully!');
    console.log('[INSTAGRAM] Post ID:', publishData.id);

    return {
        status: 'success',
        post_id: publishData.id,
        url: `https://www.instagram.com/reel/${publishData.id}/`,
    };
}
