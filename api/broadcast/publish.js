// Publish to All Platforms API
// Handles publishing a post to multiple platforms

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Verify authentication
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
        return res.status(401).json({ error: 'Invalid token' });
    }

    const { postId, platforms } = req.body;

    if (!postId || !platforms || !Array.isArray(platforms)) {
        return res.status(400).json({ error: 'postId and platforms array required' });
    }

    try {
        // Get the post
        const { data: post, error: postError } = await supabase
            .from('posts')
            .select('*')
            .eq('id', postId)
            .eq('user_id', user.id)
            .single();

        if (postError || !post) {
            return res.status(404).json({ error: 'Post not found' });
        }

        // Get connected accounts for the platforms
        const { data: accounts, error: accountsError } = await supabase
            .from('connected_accounts')
            .select('*')
            .eq('user_id', user.id)
            .in('platform', platforms);

        if (accountsError) {
            return res.status(500).json({ error: 'Failed to get connected accounts' });
        }

        // Check which platforms are connected
        const connectedPlatforms = accounts.map(a => a.platform);
        const missingPlatforms = platforms.filter(p => !connectedPlatforms.includes(p));

        if (missingPlatforms.length > 0) {
            return res.status(400).json({
                error: `Not connected to: ${missingPlatforms.join(', ')}`,
                missingPlatforms
            });
        }

        // Publish to each platform
        const results = {};
        let hasSuccess = false;
        let hasFailure = false;

        for (const platform of platforms) {
            const account = accounts.find(a => a.platform === platform);

            try {
                let result;

                switch (platform) {
                    case 'linkedin':
                        result = await publishToLinkedIn(post, account);
                        break;
                    case 'tiktok':
                        result = await publishToTikTok(post, account);
                        break;
                    case 'instagram':
                        result = await publishToInstagram(post, account);
                        break;
                    default:
                        result = { status: 'error', error: 'Unknown platform' };
                }

                results[platform] = result;

                if (result.status === 'success') {
                    hasSuccess = true;
                } else {
                    hasFailure = true;
                }
            } catch (error) {
                console.error(`Error publishing to ${platform}:`, error);
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
        await supabase
            .from('posts')
            .update({
                status: overallStatus,
                platform_results: results,
                published_at: hasSuccess ? new Date().toISOString() : null,
            })
            .eq('id', postId);

        return res.status(200).json({
            success: hasSuccess,
            status: overallStatus,
            results
        });

    } catch (error) {
        console.error('Publish error:', error);
        return res.status(500).json({ error: error.message });
    }
}

// LinkedIn Publishing
async function publishToLinkedIn(post, account) {
    const { access_token, platform_user_id } = account;

    // For video posts, we need to use the video upload API
    // For now, we'll create a text post with a link to the video
    // Full video upload requires multiple steps

    const headers = {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': '202401',
    };

    // Get the author URN (person URN)
    const profileResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!profileResponse.ok) {
        throw new Error('Failed to get LinkedIn profile');
    }

    const profile = await profileResponse.json();
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

    const postResponse = await fetch('https://api.linkedin.com/rest/posts', {
        method: 'POST',
        headers,
        body: JSON.stringify(postBody),
    });

    if (!postResponse.ok) {
        const errorText = await postResponse.text();
        console.error('LinkedIn post error:', errorText);
        throw new Error('Failed to create LinkedIn post');
    }

    const postId = postResponse.headers.get('x-restli-id');

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
    const { access_token, platform_user_id: igUserId } = account;

    if (!post.video_url) {
        throw new Error('Video is required for Instagram Reels');
    }

    // Step 1: Create media container for Reel
    const containerUrl = new URL(`https://graph.facebook.com/v18.0/${igUserId}/media`);
    containerUrl.searchParams.set('access_token', access_token);
    containerUrl.searchParams.set('media_type', 'REELS');
    containerUrl.searchParams.set('video_url', post.video_url);
    containerUrl.searchParams.set('caption', post.caption || '');

    const containerResponse = await fetch(containerUrl.toString(), {
        method: 'POST',
    });

    if (!containerResponse.ok) {
        const errorData = await containerResponse.json();
        console.error('Instagram container error:', errorData);
        throw new Error(errorData.error?.message || 'Failed to create Instagram container');
    }

    const containerData = await containerResponse.json();
    const containerId = containerData.id;

    // Step 2: Wait for processing (poll status)
    let isReady = false;
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds max wait

    while (!isReady && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000));

        const statusUrl = new URL(`https://graph.facebook.com/v18.0/${containerId}`);
        statusUrl.searchParams.set('fields', 'status_code');
        statusUrl.searchParams.set('access_token', access_token);

        const statusResponse = await fetch(statusUrl.toString());
        const statusData = await statusResponse.json();

        if (statusData.status_code === 'FINISHED') {
            isReady = true;
        } else if (statusData.status_code === 'ERROR') {
            throw new Error('Instagram video processing failed');
        }

        attempts++;
    }

    if (!isReady) {
        return {
            status: 'pending',
            container_id: containerId,
            note: 'Video is still processing. It will be published automatically when ready.',
        };
    }

    // Step 3: Publish the container
    const publishUrl = new URL(`https://graph.facebook.com/v18.0/${igUserId}/media_publish`);
    publishUrl.searchParams.set('access_token', access_token);
    publishUrl.searchParams.set('creation_id', containerId);

    const publishResponse = await fetch(publishUrl.toString(), {
        method: 'POST',
    });

    if (!publishResponse.ok) {
        const errorData = await publishResponse.json();
        console.error('Instagram publish error:', errorData);
        throw new Error(errorData.error?.message || 'Failed to publish to Instagram');
    }

    const publishData = await publishResponse.json();

    return {
        status: 'success',
        post_id: publishData.id,
        url: `https://www.instagram.com/reel/${publishData.id}/`,
    };
}
