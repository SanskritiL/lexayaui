// Cron Job: Process Scheduled Posts
// Runs every minute to check for posts that need to be published

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Verify this is a cron request (Vercel adds this header)
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        // For local testing, allow without auth
        if (process.env.NODE_ENV === 'production') {
            return res.status(401).json({ error: 'Unauthorized' });
        }
    }

    try {
        // Find scheduled posts that are due
        const now = new Date().toISOString();

        const { data: posts, error: fetchError } = await supabase
            .from('posts')
            .select('*')
            .eq('status', 'scheduled')
            .lte('scheduled_at', now)
            .limit(10); // Process up to 10 at a time

        if (fetchError) {
            console.error('Error fetching scheduled posts:', fetchError);
            return res.status(500).json({ error: 'Failed to fetch scheduled posts' });
        }

        if (!posts || posts.length === 0) {
            return res.status(200).json({ message: 'No posts to process', processed: 0 });
        }

        console.log(`Processing ${posts.length} scheduled posts`);

        const results = [];

        for (const post of posts) {
            try {
                // Mark as publishing
                await supabase
                    .from('posts')
                    .update({ status: 'publishing' })
                    .eq('id', post.id);

                // Get connected accounts for this user
                const { data: accounts } = await supabase
                    .from('connected_accounts')
                    .select('*')
                    .eq('user_id', post.user_id)
                    .in('platform', post.platforms || []);

                const platformResults = {};
                let hasSuccess = false;
                let hasFailure = false;

                for (const platform of (post.platforms || [])) {
                    const account = accounts?.find(a => a.platform === platform);

                    if (!account) {
                        platformResults[platform] = {
                            status: 'error',
                            error: 'Account not connected',
                        };
                        hasFailure = true;
                        continue;
                    }

                    try {
                        // Publish to platform (simplified - in production, import from publish.js)
                        const result = await publishToPlatform(platform, post, account);
                        platformResults[platform] = result;

                        if (result.status === 'success') {
                            hasSuccess = true;
                        } else {
                            hasFailure = true;
                        }
                    } catch (error) {
                        platformResults[platform] = {
                            status: 'error',
                            error: error.message,
                        };
                        hasFailure = true;
                    }
                }

                // Determine final status
                let finalStatus = 'failed';
                if (hasSuccess && !hasFailure) {
                    finalStatus = 'published';
                } else if (hasSuccess && hasFailure) {
                    finalStatus = 'partial';
                }

                // Update post
                await supabase
                    .from('posts')
                    .update({
                        status: finalStatus,
                        platform_results: platformResults,
                        published_at: hasSuccess ? new Date().toISOString() : null,
                    })
                    .eq('id', post.id);

                results.push({
                    post_id: post.id,
                    status: finalStatus,
                    platforms: platformResults,
                });

            } catch (error) {
                console.error(`Error processing post ${post.id}:`, error);

                await supabase
                    .from('posts')
                    .update({
                        status: 'failed',
                        platform_results: { error: error.message },
                    })
                    .eq('id', post.id);

                results.push({
                    post_id: post.id,
                    status: 'failed',
                    error: error.message,
                });
            }
        }

        return res.status(200).json({
            message: `Processed ${posts.length} posts`,
            processed: posts.length,
            results,
        });

    } catch (error) {
        console.error('Cron error:', error);
        return res.status(500).json({ error: error.message });
    }
}

// Simplified platform publishing (duplicated from publish.js for cron independence)
async function publishToPlatform(platform, post, account) {
    switch (platform) {
        case 'linkedin':
            return await publishToLinkedIn(post, account);
        case 'tiktok':
            return await publishToTikTok(post, account);
        // case 'instagram':
        //     return await publishToInstagram(post, account);
        default:
            throw new Error('Unknown platform');
    }
}

async function publishToLinkedIn(post, account) {
    const { access_token } = account;

    const profileResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!profileResponse.ok) {
        throw new Error('Failed to get LinkedIn profile - token may be expired');
    }

    const profile = await profileResponse.json();
    const authorUrn = `urn:li:person:${profile.sub}`;

    const headers = {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': '202507',
    };

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
        throw new Error('Failed to create LinkedIn post');
    }

    const postId = postResponse.headers.get('x-restli-id');
    return {
        status: 'success',
        post_id: postId,
        url: `https://www.linkedin.com/feed/update/${postId}`,
    };
}

async function publishToTikTok(post, account) {
    const { access_token } = account;

    if (!post.video_url) {
        throw new Error('Video is required for TikTok');
    }

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
        throw new Error(errorData.error?.message || 'Failed to upload to TikTok');
    }

    const initData = await initResponse.json();
    return {
        status: 'success',
        publish_id: initData.data?.publish_id,
        note: 'Video sent to TikTok drafts',
    };
}

async function publishToInstagram(post, account) {
    const { access_token, platform_user_id: igUserId } = account;

    if (!post.video_url) {
        throw new Error('Video is required for Instagram');
    }

    const containerUrl = new URL(`https://graph.facebook.com/v18.0/${igUserId}/media`);
    containerUrl.searchParams.set('access_token', access_token);
    containerUrl.searchParams.set('media_type', 'REELS');
    containerUrl.searchParams.set('video_url', post.video_url);
    containerUrl.searchParams.set('caption', post.caption || '');

    const containerResponse = await fetch(containerUrl.toString(), { method: 'POST' });

    if (!containerResponse.ok) {
        const errorData = await containerResponse.json();
        throw new Error(errorData.error?.message || 'Failed to create Instagram container');
    }

    const containerData = await containerResponse.json();
    const containerId = containerData.id;

    // Wait for processing (up to 30 seconds)
    let isReady = false;
    for (let i = 0; i < 30; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));

        const statusUrl = new URL(`https://graph.facebook.com/v18.0/${containerId}`);
        statusUrl.searchParams.set('fields', 'status_code');
        statusUrl.searchParams.set('access_token', access_token);

        const statusResponse = await fetch(statusUrl.toString());
        const statusData = await statusResponse.json();

        if (statusData.status_code === 'FINISHED') {
            isReady = true;
            break;
        } else if (statusData.status_code === 'ERROR') {
            throw new Error('Instagram video processing failed');
        }
    }

    if (!isReady) {
        return { status: 'pending', container_id: containerId, note: 'Still processing' };
    }

    const publishUrl = new URL(`https://graph.facebook.com/v18.0/${igUserId}/media_publish`);
    publishUrl.searchParams.set('access_token', access_token);
    publishUrl.searchParams.set('creation_id', containerId);

    const publishResponse = await fetch(publishUrl.toString(), { method: 'POST' });

    if (!publishResponse.ok) {
        throw new Error('Failed to publish to Instagram');
    }

    const publishData = await publishResponse.json();
    return { status: 'success', post_id: publishData.id };
}
