// Publish to All Platforms API
// Handles publishing a post to multiple platforms

const { createClient } = require('@supabase/supabase-js');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');

// R2 client for cleanup
const R2_ACCOUNT_ID = '20ed24d883ada4e35ecd4e48ae90ab27';
const r2Client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    },
});

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

        // Publish to each platform IN PARALLEL with real-time progress updates
        console.log('[PUBLISH] Starting PARALLEL publish to platforms:', platforms);
        const results = {};
        let hasSuccess = false;
        let hasFailure = false;

        // Helper to update post with current progress
        async function updateProgress(platformResults) {
            const successCount = Object.values(platformResults).filter(r => r.status === 'success').length;
            const errorCount = Object.values(platformResults).filter(r => r.status === 'error').length;
            const pendingCount = platforms.length - Object.keys(platformResults).length;

            let status = 'publishing';
            if (pendingCount === 0) {
                status = errorCount === 0 ? 'published' : (successCount > 0 ? 'partial' : 'failed');
            }

            await supabase
                .from('posts')
                .update({
                    status: status,
                    platform_results: platformResults,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', post.id);
        }

        // Create publish promises - each updates DB when done
        const publishPromises = platforms.map(async (platform) => {
            console.log(`[PUBLISH] Starting ${platform}...`);
            const account = accounts.find(a => a.platform === platform);

            if (!account) {
                const result = { status: 'error', error: 'Account not connected' };
                results[platform] = result;
                await updateProgress(results);
                return { platform, result };
            }

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
                    case 'twitter':
                        result = await publishToTwitter(post, account);
                        break;
                    case 'threads':
                        result = await publishToThreads(post, account);
                        break;
                    case 'youtube':
                        result = await publishToYouTube(post, account, supabase);
                        break;
                    default:
                        result = { status: 'error', error: 'Unknown platform' };
                }

                // Update results and save to DB immediately
                results[platform] = result;
                await updateProgress(results);
                console.log(`[PUBLISH] ${platform} completed:`, result.status);
                return { platform, result };
            } catch (error) {
                console.error(`[PUBLISH] ❌ ${platform} error:`, error.message);
                const result = { status: 'error', error: error.message };
                results[platform] = result;
                await updateProgress(results);
                return { platform, result };
            }
        });

        // Wait for all platforms to complete
        await Promise.allSettled(publishPromises);

        // Calculate final status
        for (const [platform, result] of Object.entries(results)) {
            if (result.status === 'success') {
                hasSuccess = true;
            } else {
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

        // CLEANUP: Delete video from R2 or Supabase storage after successful publish
        if (hasSuccess && post.video_url) {
            console.log('[CLEANUP] Starting video cleanup...');
            try {
                // Check if this is an R2 video (has r2_key in metadata)
                if (post.metadata?.r2_key) {
                    console.log('[CLEANUP] Deleting from R2:', post.metadata.r2_key);

                    try {
                        await r2Client.send(new DeleteObjectCommand({
                            Bucket: process.env.R2_BUCKET_NAME || 'lexaya-videos',
                            Key: post.metadata.r2_key,
                        }));
                        console.log('[CLEANUP] R2 video deleted successfully');
                    } catch (r2Error) {
                        console.error('[CLEANUP] R2 delete failed:', r2Error.message);
                    }
                } else {
                    // Legacy Supabase storage cleanup
                    const videoUrl = post.video_url;
                    const match = videoUrl.match(/\/videos\/(.+)$/);

                    if (match) {
                        const filePath = match[1];
                        console.log('[CLEANUP] Deleting from Supabase:', filePath);

                        const { error: deleteError } = await supabase.storage
                            .from('videos')
                            .remove([filePath]);

                        if (deleteError) {
                            console.error('[CLEANUP] Supabase delete failed:', deleteError.message);
                        } else {
                            console.log('[CLEANUP] Supabase video deleted successfully');
                        }
                    }
                }

                // Clear video_url from post (keep thumbnail_url)
                await supabase
                    .from('posts')
                    .update({ video_url: null })
                    .eq('id', postId);
                console.log('[CLEANUP] Cleared video_url from post');

            } catch (cleanupError) {
                console.error('[CLEANUP] Error during cleanup:', cleanupError.message);
                // Don't fail the whole request if cleanup fails
            }
        }

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
    const mediaType = post.metadata?.media_type;
    console.log('[LINKEDIN] Post:', { id: post.id, caption: post.caption?.substring(0, 30), media_url: !!post.video_url, media_type: mediaType });
    console.log('[LINKEDIN] Metadata:', post.metadata);
    console.log('[LINKEDIN] Account:', { platform_user_id: account.platform_user_id, has_token: !!account.access_token });

    const { access_token } = account;

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

    // Check if video was uploaded directly from browser (videoUrn in metadata)
    const linkedinVideoUrn = post.metadata?.linkedin_video_urn;

    if (linkedinVideoUrn) {
        console.log('[LINKEDIN] Video already uploaded, creating post with videoUrn:', linkedinVideoUrn);
        return await createLinkedInVideoPost(headers, authorUrn, post, linkedinVideoUrn);
    }

    // Check if we have a video to upload (server-side upload from R2)
    if (mediaType === 'video' && post.video_url) {
        console.log('[LINKEDIN] Video detected, uploading to LinkedIn server-side...');
        return await uploadAndCreateLinkedInVideoPost(headers, authorUrn, post, access_token);
    }

    // Check if we have an image to upload
    if (mediaType === 'image' && post.video_url) {
        console.log('[LINKEDIN] Image detected, uploading to LinkedIn...');
        return await createLinkedInImagePost(headers, authorUrn, post, access_token);
    }

    // Text-only post
    console.log('[LINKEDIN] No media, creating text post...');
    return await createLinkedInTextPost(headers, authorUrn, post);
}

// Create LinkedIn post with video
async function createLinkedInVideoPost(headers, authorUrn, post, videoUrn) {
    console.log('[LINKEDIN] Creating video post...');
    console.log('[LINKEDIN] Video URN:', videoUrn);

    const postBody = {
        author: authorUrn,
        commentary: post.caption || '',
        visibility: 'PUBLIC',
        distribution: {
            feedDistribution: 'MAIN_FEED',
            targetEntities: [],
            thirdPartyDistributionChannels: [],
        },
        content: {
            media: {
                id: videoUrn,
            },
        },
        lifecycleState: 'PUBLISHED',
    };

    console.log('[LINKEDIN] Video post body:', JSON.stringify(postBody, null, 2));

    const postResponse = await fetch('https://api.linkedin.com/rest/posts', {
        method: 'POST',
        headers,
        body: JSON.stringify(postBody),
    });

    console.log('[LINKEDIN] Response status:', postResponse.status);

    if (!postResponse.ok) {
        const errorText = await postResponse.text();
        console.error('[LINKEDIN] Video post error:', errorText);
        throw new Error('Failed to create LinkedIn video post: ' + errorText);
    }

    const postId = postResponse.headers.get('x-restli-id');
    console.log('[LINKEDIN] Created video post ID:', postId);

    return {
        status: 'success',
        post_id: postId,
        url: `https://www.linkedin.com/feed/update/${postId}`,
    };
}

// Upload video to LinkedIn server-side and create post
async function uploadAndCreateLinkedInVideoPost(headers, authorUrn, post, accessToken) {
    console.log('[LINKEDIN] Server-side video upload starting...');
    console.log('[LINKEDIN] Video URL:', post.video_url);

    try {
        // Step 1: Download video from R2
        console.log('[LINKEDIN] Step 1: Downloading video from R2...');
        const videoResponse = await fetch(post.video_url);
        if (!videoResponse.ok) {
            throw new Error('Failed to download video from storage');
        }
        const videoBuffer = await videoResponse.arrayBuffer();
        const fileSizeBytes = videoBuffer.byteLength;
        console.log('[LINKEDIN] Video size:', (fileSizeBytes / 1024 / 1024).toFixed(2), 'MB');

        // Step 2: Initialize video upload with LinkedIn
        console.log('[LINKEDIN] Step 2: Initializing video upload...');
        const initBody = {
            initializeUploadRequest: {
                owner: authorUrn,
                fileSizeBytes: fileSizeBytes,
                uploadCaptions: false,
                uploadThumbnail: false,
            },
        };

        const initResponse = await fetch('https://api.linkedin.com/rest/videos?action=initializeUpload', {
            method: 'POST',
            headers,
            body: JSON.stringify(initBody),
        });

        if (!initResponse.ok) {
            const errorText = await initResponse.text();
            console.error('[LINKEDIN] Video init error:', errorText);
            throw new Error('Failed to initialize LinkedIn video upload: ' + errorText);
        }

        const initData = await initResponse.json();
        const uploadInstructions = initData.value?.uploadInstructions;
        const videoUrn = initData.value?.video;
        console.log('[LINKEDIN] Got video URN:', videoUrn);
        console.log('[LINKEDIN] Upload instructions count:', uploadInstructions?.length);

        if (!uploadInstructions || uploadInstructions.length === 0) {
            throw new Error('No upload instructions received from LinkedIn');
        }

        // Step 3: Upload video (handle single or chunked upload)
        console.log('[LINKEDIN] Step 3: Uploading video to LinkedIn...');

        if (uploadInstructions.length === 1) {
            // Single upload
            const uploadUrl = uploadInstructions[0].uploadUrl;
            const uploadResponse = await fetch(uploadUrl, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'Authorization': `Bearer ${accessToken}`,
                },
                body: Buffer.from(videoBuffer),
            });

            if (!uploadResponse.ok) {
                const errorText = await uploadResponse.text();
                console.error('[LINKEDIN] Video upload error:', errorText);
                throw new Error('Failed to upload video to LinkedIn: ' + errorText);
            }
            console.log('[LINKEDIN] Single-part upload complete!');
        } else {
            // Chunked upload - must collect ETags for finalize
            console.log('[LINKEDIN] Using chunked upload...');
            const videoBytes = Buffer.from(videoBuffer);
            const uploadedPartIds = [];

            for (const instruction of uploadInstructions) {
                const { uploadUrl, firstByte, lastByte } = instruction;
                const chunk = videoBytes.slice(firstByte, lastByte + 1);
                console.log(`[LINKEDIN] Uploading chunk: bytes ${firstByte}-${lastByte} (${chunk.length} bytes)`);

                const uploadResponse = await fetch(uploadUrl, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/octet-stream',
                        'Authorization': `Bearer ${accessToken}`,
                    },
                    body: chunk,
                });

                if (!uploadResponse.ok) {
                    const errorText = await uploadResponse.text();
                    console.error('[LINKEDIN] Chunk upload error:', errorText);
                    throw new Error(`Failed to upload chunk to LinkedIn: ${errorText}`);
                }

                // Collect ETag for finalize request
                const etag = uploadResponse.headers.get('etag');
                if (etag) {
                    uploadedPartIds.push(etag.replace(/"/g, '')); // Remove quotes from ETag
                    console.log(`[LINKEDIN] Chunk uploaded, ETag: ${etag}`);
                }
            }
            console.log('[LINKEDIN] Chunked upload complete! Parts:', uploadedPartIds.length);

            // Step 4: Finalize the upload with ETags
            console.log('[LINKEDIN] Step 4: Finalizing upload...');
            const finalizeResponse = await fetch('https://api.linkedin.com/rest/videos?action=finalizeUpload', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    finalizeUploadRequest: {
                        video: videoUrn,
                        uploadToken: '',
                        uploadedPartIds: uploadedPartIds,
                    },
                }),
            });

            if (!finalizeResponse.ok) {
                const errorText = await finalizeResponse.text();
                console.error('[LINKEDIN] Finalize error:', errorText);
                throw new Error('Failed to finalize LinkedIn video upload: ' + errorText);
            }
            console.log('[LINKEDIN] Upload finalized!');
        }

        // Step 5: Create post with video
        console.log('[LINKEDIN] Step 5: Creating post with video...');
        return await createLinkedInVideoPost(headers, authorUrn, post, videoUrn);

    } catch (error) {
        console.error('[LINKEDIN] Server-side video upload error:', error.message);
        throw error;
    }
}

// Create LinkedIn post with image
async function createLinkedInImagePost(headers, authorUrn, post, accessToken) {
    console.log('[LINKEDIN] Creating image post...');
    console.log('[LINKEDIN] Image URL:', post.video_url);

    try {
        // Step 1: Initialize image upload
        console.log('[LINKEDIN] Step 1: Initializing image upload...');
        const initBody = {
            initializeUploadRequest: {
                owner: authorUrn,
            },
        };

        const initResponse = await fetch('https://api.linkedin.com/rest/images?action=initializeUpload', {
            method: 'POST',
            headers,
            body: JSON.stringify(initBody),
        });

        if (!initResponse.ok) {
            const errorText = await initResponse.text();
            console.error('[LINKEDIN] Image init error:', errorText);
            throw new Error('Failed to initialize LinkedIn image upload: ' + errorText);
        }

        const initData = await initResponse.json();
        const uploadUrl = initData.value?.uploadUrl;
        const imageUrn = initData.value?.image;
        console.log('[LINKEDIN] Got upload URL and image URN:', imageUrn);

        // Step 2: Download image from R2 and upload to LinkedIn
        console.log('[LINKEDIN] Step 2: Downloading image from R2...');
        const imageResponse = await fetch(post.video_url);
        if (!imageResponse.ok) {
            throw new Error('Failed to download image from storage');
        }
        const imageBuffer = await imageResponse.arrayBuffer();
        console.log('[LINKEDIN] Image size:', (imageBuffer.byteLength / 1024).toFixed(2), 'KB');

        console.log('[LINKEDIN] Uploading to LinkedIn...');
        const uploadResponse = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/octet-stream',
            },
            body: imageBuffer,
        });

        if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text();
            console.error('[LINKEDIN] Image upload error:', errorText);
            throw new Error('Failed to upload image to LinkedIn: ' + errorText);
        }
        console.log('[LINKEDIN] Image uploaded successfully!');

        // Step 3: Create post with image
        console.log('[LINKEDIN] Step 3: Creating post with image...');
        const postBody = {
            author: authorUrn,
            commentary: post.caption || '',
            visibility: 'PUBLIC',
            distribution: {
                feedDistribution: 'MAIN_FEED',
                targetEntities: [],
                thirdPartyDistributionChannels: [],
            },
            content: {
                media: {
                    id: imageUrn,
                },
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
            console.error('[LINKEDIN] Image post error:', errorText);
            throw new Error('Failed to create LinkedIn image post: ' + errorText);
        }

        const postId = postResponse.headers.get('x-restli-id');
        console.log('[LINKEDIN] Created image post ID:', postId);

        return {
            status: 'success',
            post_id: postId,
            url: `https://www.linkedin.com/feed/update/${postId}`,
        };
    } catch (error) {
        console.error('[LINKEDIN] Image post error:', error.message);
        throw error;
    }
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

// TikTok Publishing (Direct Upload to Drafts)
async function publishToTikTok(post, account) {
    console.log('[TIKTOK] Starting publish...');
    console.log('[TIKTOK] Post metadata:', post.metadata);

    // Check if video was already uploaded directly from browser
    const tiktokPublishId = post.metadata?.tiktok_publish_id;
    const tiktokUploadError = post.metadata?.tiktok_upload_error;

    // If there was an upload error, report it
    if (tiktokUploadError) {
        console.error('[TIKTOK] Upload error from browser:', tiktokUploadError);
        throw new Error(tiktokUploadError);
    }

    // If video was uploaded directly, it's already in the user's inbox
    if (tiktokPublishId) {
        console.log('[TIKTOK] Video already uploaded! Publish ID:', tiktokPublishId);
        return {
            status: 'success',
            publish_id: tiktokPublishId,
            note: 'Video sent to TikTok inbox. Open TikTok app to add caption and post.',
        };
    }

    // No direct upload - this shouldn't happen with the new flow
    // but keep as fallback
    console.log('[TIKTOK] No direct upload found, video required');
    throw new Error('Video upload to TikTok failed. Please try again.');
}

// Instagram Publishing
async function publishToInstagram(post, account) {
    console.log('[INSTAGRAM] Starting publish...');
    const mediaType = post.metadata?.media_type || 'video';
    console.log('[INSTAGRAM] Post:', { id: post.id, caption: post.caption?.substring(0, 30), media_url: post.video_url, media_type: mediaType });
    console.log('[INSTAGRAM] Account:', { platform_user_id: account.platform_user_id, account_name: account.account_name, has_token: !!account.access_token });

    const { access_token, platform_user_id: igUserId } = account;

    if (!post.video_url) {
        console.error('[INSTAGRAM] ❌ No media URL provided');
        throw new Error('Media (image or video) is required for Instagram');
    }

    const isImage = mediaType === 'image';
    console.log('[INSTAGRAM] Media URL:', post.video_url);
    console.log('[INSTAGRAM] Is Image:', isImage);
    console.log('[INSTAGRAM] Instagram User ID:', igUserId);

    // Step 1: Create media container
    console.log('[INSTAGRAM] Step 1: Creating media container...');
    const containerUrl = new URL(`https://graph.facebook.com/v18.0/${igUserId}/media`);
    containerUrl.searchParams.set('access_token', access_token);

    if (isImage) {
        // For images, use image_url parameter
        containerUrl.searchParams.set('image_url', post.video_url);
    } else {
        // For videos, use REELS media_type
        containerUrl.searchParams.set('media_type', 'REELS');
        containerUrl.searchParams.set('video_url', post.video_url);
    }
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
            console.log('[INSTAGRAM] ✅ Media processing complete!');
        } else if (statusData.status_code === 'ERROR') {
            console.error('[INSTAGRAM] ❌ Media processing failed!');
            console.error('[INSTAGRAM] Status data:', JSON.stringify(statusData, null, 2));
            throw new Error('Instagram media processing failed: ' + (statusData.status || 'Unknown error'));
        }

        attempts++;
    }

    if (!isReady) {
        console.log('[INSTAGRAM] ⏳ Still processing after 30 seconds...');
        return {
            status: 'pending',
            container_id: containerId,
            note: 'Media is still processing. It will be published automatically when ready.',
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

// Twitter/X Publishing
async function publishToTwitter(post, account) {
    console.log('[TWITTER] Starting publish...');
    console.log('[TWITTER] Post:', { id: post.id, caption: post.caption?.substring(0, 30), video_url: !!post.video_url });
    console.log('[TWITTER] Metadata:', post.metadata);

    const { access_token } = account;

    // Check if video was uploaded from browser (twitter_media_id in metadata)
    const mediaId = post.metadata?.twitter_media_id;

    if (mediaId) {
        console.log('[TWITTER] Media already uploaded, creating tweet with media_id:', mediaId);
        return await createTwitterTweet(access_token, post.caption, mediaId);
    }

    // If there's a video URL but no media_id, we need to upload it
    // This is for Instagram/TikTok flow where video is in Supabase
    if (post.video_url) {
        console.log('[TWITTER] Video URL present, uploading to Twitter...');
        try {
            const uploadedMediaId = await uploadVideoToTwitter(access_token, post.video_url);
            return await createTwitterTweet(access_token, post.caption, uploadedMediaId);
        } catch (uploadError) {
            console.error('[TWITTER] Video upload failed:', uploadError.message);
            // Fall back to text-only
            console.log('[TWITTER] Falling back to text-only tweet');
            return await createTwitterTweet(access_token, post.caption, null);
        }
    }

    // Text-only tweet
    console.log('[TWITTER] Creating text-only tweet...');
    return await createTwitterTweet(access_token, post.caption, null);
}

async function createTwitterTweet(accessToken, text, mediaId) {
    console.log('[TWITTER] Creating tweet...');

    const tweetData = {
        text: text || '',
    };

    if (mediaId) {
        tweetData.media = {
            media_ids: [mediaId],
        };
    }

    console.log('[TWITTER] Tweet data:', JSON.stringify(tweetData, null, 2));

    const response = await fetch('https://api.twitter.com/2/tweets', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(tweetData),
    });

    console.log('[TWITTER] Response status:', response.status);

    if (!response.ok) {
        const errorText = await response.text();
        console.error('[TWITTER] Tweet error:', errorText);
        throw new Error('Failed to create tweet: ' + errorText);
    }

    const result = await response.json();
    console.log('[TWITTER] Tweet created:', result.data?.id);

    return {
        status: 'success',
        post_id: result.data?.id,
        url: `https://twitter.com/i/status/${result.data?.id}`,
    };
}

async function uploadVideoToTwitter(accessToken, videoUrl) {
    console.log('[TWITTER] Uploading video from URL:', videoUrl);

    // Fetch video from URL
    const videoResponse = await fetch(videoUrl);
    if (!videoResponse.ok) {
        throw new Error('Failed to fetch video');
    }

    const videoBuffer = await videoResponse.arrayBuffer();
    const videoBytes = new Uint8Array(videoBuffer);
    const totalBytes = videoBytes.length;

    console.log('[TWITTER] Video size:', (totalBytes / 1024 / 1024).toFixed(2), 'MB');

    // Twitter media upload uses v1.1 API with OAuth 1.0a typically
    // But with OAuth 2.0 user context, we can use the v1.1 endpoints
    // For chunked upload: INIT -> APPEND -> FINALIZE

    // Step 1: INIT
    console.log('[TWITTER] Step 1: INIT...');
    const initParams = new URLSearchParams({
        command: 'INIT',
        total_bytes: totalBytes.toString(),
        media_type: 'video/mp4',
        media_category: 'tweet_video',
    });

    const initResponse = await fetch('https://upload.twitter.com/1.1/media/upload.json', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: initParams,
    });

    if (!initResponse.ok) {
        const errorText = await initResponse.text();
        console.error('[TWITTER] INIT failed:', errorText);
        throw new Error('Failed to init Twitter upload: ' + errorText);
    }

    const initData = await initResponse.json();
    const mediaId = initData.media_id_string;
    console.log('[TWITTER] Media ID:', mediaId);

    // Step 2: APPEND (chunked upload)
    console.log('[TWITTER] Step 2: APPEND...');
    const chunkSize = 5 * 1024 * 1024; // 5MB chunks
    let segmentIndex = 0;

    for (let offset = 0; offset < totalBytes; offset += chunkSize) {
        const chunk = videoBytes.slice(offset, Math.min(offset + chunkSize, totalBytes));
        const chunkBase64 = Buffer.from(chunk).toString('base64');

        console.log(`[TWITTER] Uploading chunk ${segmentIndex} (${chunk.length} bytes)...`);

        const appendParams = new URLSearchParams({
            command: 'APPEND',
            media_id: mediaId,
            segment_index: segmentIndex.toString(),
            media_data: chunkBase64,
        });

        const appendResponse = await fetch('https://upload.twitter.com/1.1/media/upload.json', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: appendParams,
        });

        if (!appendResponse.ok) {
            const errorText = await appendResponse.text();
            console.error('[TWITTER] APPEND failed:', errorText);
            throw new Error('Failed to append chunk: ' + errorText);
        }

        segmentIndex++;
    }

    // Step 3: FINALIZE
    console.log('[TWITTER] Step 3: FINALIZE...');
    const finalizeParams = new URLSearchParams({
        command: 'FINALIZE',
        media_id: mediaId,
    });

    const finalizeResponse = await fetch('https://upload.twitter.com/1.1/media/upload.json', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: finalizeParams,
    });

    if (!finalizeResponse.ok) {
        const errorText = await finalizeResponse.text();
        console.error('[TWITTER] FINALIZE failed:', errorText);
        throw new Error('Failed to finalize upload: ' + errorText);
    }

    const finalizeData = await finalizeResponse.json();
    console.log('[TWITTER] Finalize response:', JSON.stringify(finalizeData, null, 2));

    // Step 4: Check processing status (for videos)
    if (finalizeData.processing_info) {
        console.log('[TWITTER] Video processing...');
        let processingInfo = finalizeData.processing_info;

        while (processingInfo.state === 'pending' || processingInfo.state === 'in_progress') {
            const checkAfterSecs = processingInfo.check_after_secs || 5;
            console.log(`[TWITTER] Waiting ${checkAfterSecs}s for processing...`);
            await new Promise(resolve => setTimeout(resolve, checkAfterSecs * 1000));

            const statusParams = new URLSearchParams({
                command: 'STATUS',
                media_id: mediaId,
            });

            const statusResponse = await fetch(`https://upload.twitter.com/1.1/media/upload.json?${statusParams}`, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                },
            });

            if (!statusResponse.ok) {
                throw new Error('Failed to check processing status');
            }

            const statusData = await statusResponse.json();
            processingInfo = statusData.processing_info;
            console.log('[TWITTER] Processing state:', processingInfo?.state);

            if (processingInfo?.state === 'failed') {
                throw new Error('Video processing failed: ' + (processingInfo.error?.message || 'Unknown error'));
            }
        }

        console.log('[TWITTER] Video processing complete!');
    }

    return mediaId;
}

// ============== THREADS ==============
async function publishToThreads(post, account) {
    console.log('[THREADS] Starting publish...');
    const postMediaType = post.metadata?.media_type; // 'image' or 'video'
    console.log('[THREADS] Post:', { id: post.id, caption: post.caption?.substring(0, 50), media_url: !!post.video_url, media_type: postMediaType });

    const { access_token, platform_user_id: userId } = account;

    try {
        // Threads API follows same pattern as Instagram:
        // Step 1: Create media container
        // Step 2: Publish the container

        let mediaType = 'TEXT';
        let containerParams = {
            text: post.caption || '',
        };

        // Check if it's an image or video post
        if (post.video_url) {
            const isImage = postMediaType === 'image';

            if (isImage) {
                console.log('[THREADS] Creating image container...');
                mediaType = 'IMAGE';
                containerParams = {
                    media_type: 'IMAGE',
                    image_url: post.video_url,
                    text: post.caption || '',
                };
            } else {
                console.log('[THREADS] Creating video container...');
                mediaType = 'VIDEO';
                containerParams = {
                    media_type: 'VIDEO',
                    video_url: post.video_url,
                    text: post.caption || '',
                };
            }
        }

        // Step 1: Create container
        console.log('[THREADS] Step 1: Creating container...', { mediaType, userId });

        const containerUrl = new URL(`https://graph.threads.net/v1.0/${userId}/threads`);
        Object.entries(containerParams).forEach(([key, value]) => {
            containerUrl.searchParams.set(key, value);
        });
        containerUrl.searchParams.set('access_token', access_token);

        console.log('[THREADS] Container URL:', containerUrl.toString().replace(access_token, 'TOKEN'));

        const containerResponse = await fetch(containerUrl.toString(), {
            method: 'POST',
        });

        const containerData = await containerResponse.json();
        console.log('[THREADS] Container response:', JSON.stringify(containerData));

        if (containerData.error) {
            console.error('[THREADS] Container error:', containerData.error);
            return {
                status: 'error',
                error: containerData.error.message || containerData.error.error_user_msg || JSON.stringify(containerData.error),
            };
        }

        const containerId = containerData.id;
        console.log('[THREADS] Container created:', containerId);

        // Wait for media processing (videos take longer, images are quick)
        if (mediaType === 'VIDEO' || mediaType === 'IMAGE') {
            const isVideo = mediaType === 'VIDEO';
            console.log(`[THREADS] Waiting for ${isVideo ? 'video' : 'image'} processing...`);
            let attempts = 0;
            const maxAttempts = isVideo ? 30 : 10; // Longer wait for videos
            const waitTime = isVideo ? 2000 : 1000; // 2s for video, 1s for image

            while (attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, waitTime));

                const statusUrl = new URL(`https://graph.threads.net/v1.0/${containerId}`);
                statusUrl.searchParams.set('fields', 'status');
                statusUrl.searchParams.set('access_token', access_token);

                const statusResponse = await fetch(statusUrl.toString());
                const statusData = await statusResponse.json();

                console.log('[THREADS] Processing status:', statusData.status);

                if (statusData.status === 'FINISHED') {
                    break;
                } else if (statusData.status === 'ERROR') {
                    return {
                        status: 'error',
                        error: `${isVideo ? 'Video' : 'Image'} processing failed`,
                    };
                }

                attempts++;
            }

            if (attempts >= maxAttempts) {
                return {
                    status: 'error',
                    error: `${isVideo ? 'Video' : 'Image'} processing timed out`,
                };
            }
        }

        // Step 2: Publish
        console.log('[THREADS] Step 2: Publishing...');
        const publishUrl = new URL(`https://graph.threads.net/v1.0/${userId}/threads_publish`);
        publishUrl.searchParams.set('creation_id', containerId);
        publishUrl.searchParams.set('access_token', access_token);

        const publishResponse = await fetch(publishUrl.toString(), {
            method: 'POST',
        });

        const publishData = await publishResponse.json();
        console.log('[THREADS] Publish response:', JSON.stringify(publishData));

        if (publishData.error) {
            console.error('[THREADS] Publish error:', publishData.error);
            return {
                status: 'error',
                error: publishData.error.message || publishData.error.error_user_msg || JSON.stringify(publishData.error),
            };
        }

        console.log('[THREADS] ✅ Published successfully!');
        return {
            status: 'success',
            post_id: publishData.id,
            url: `https://threads.net/@${account.account_name}/post/${publishData.id}`,
        };

    } catch (error) {
        console.error('[THREADS] ❌ Error:', error.message);
        return {
            status: 'error',
            error: error.message,
        };
    }
}

// ============== YOUTUBE SHORTS ==============
async function publishToYouTube(post, account, supabase) {
    console.log('[YOUTUBE] Starting publish...');
    const mediaType = post.metadata?.media_type;
    console.log('[YOUTUBE] Post:', { id: post.id, caption: post.caption?.substring(0, 50), media_url: !!post.video_url, media_type: mediaType });

    // YouTube only supports video
    if (mediaType !== 'video' || !post.video_url) {
        return {
            status: 'error',
            error: 'YouTube Shorts requires a video',
        };
    }

    let { access_token, refresh_token } = account;

    try {
        // Check if token is expired and refresh if needed
        const tokenExpiry = new Date(account.token_expires_at);
        if (tokenExpiry <= new Date()) {
            console.log('[YOUTUBE] Token expired, refreshing...');
            const refreshed = await refreshYouTubeToken(refresh_token);
            if (refreshed.error) {
                return { status: 'error', error: 'Token expired. Please reconnect YouTube.' };
            }
            access_token = refreshed.access_token;

            // Update token in database
            await supabase
                .from('connected_accounts')
                .update({
                    access_token: refreshed.access_token,
                    token_expires_at: new Date(Date.now() + (refreshed.expires_in * 1000)).toISOString(),
                })
                .eq('id', account.id);
        }

        // Step 1: Download video from R2
        console.log('[YOUTUBE] Step 1: Downloading video from R2...');
        const videoResponse = await fetch(post.video_url);
        if (!videoResponse.ok) {
            throw new Error('Failed to download video from storage');
        }
        const videoBuffer = await videoResponse.arrayBuffer();
        const videoBytes = Buffer.from(videoBuffer);
        console.log('[YOUTUBE] Video size:', (videoBytes.length / 1024 / 1024).toFixed(2), 'MB');

        // Prepare metadata - add #Shorts to make it a Short
        let description = post.caption || '';
        if (!description.toLowerCase().includes('#shorts')) {
            description = description + '\n\n#Shorts';
        }

        // Extract title from caption (first line or first 100 chars)
        let title = post.caption?.split('\n')[0]?.substring(0, 100) || 'Short video';
        if (title.length > 100) {
            title = title.substring(0, 97) + '...';
        }

        const videoMetadata = {
            snippet: {
                title: title,
                description: description,
                categoryId: '22', // People & Blogs
            },
            status: {
                privacyStatus: 'public',
                selfDeclaredMadeForKids: false,
            },
        };

        // Step 2: Initialize resumable upload
        console.log('[YOUTUBE] Step 2: Initializing resumable upload...');
        const initResponse = await fetch(
            'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${access_token}`,
                    'Content-Type': 'application/json',
                    'X-Upload-Content-Length': videoBytes.length.toString(),
                    'X-Upload-Content-Type': 'video/*',
                },
                body: JSON.stringify(videoMetadata),
            }
        );

        if (!initResponse.ok) {
            const errorText = await initResponse.text();
            console.error('[YOUTUBE] Init error:', errorText);
            throw new Error('Failed to initialize YouTube upload: ' + errorText);
        }

        const uploadUrl = initResponse.headers.get('location');
        if (!uploadUrl) {
            throw new Error('No upload URL received from YouTube');
        }
        console.log('[YOUTUBE] Got resumable upload URL');

        // Step 3: Upload video bytes
        console.log('[YOUTUBE] Step 3: Uploading video...');
        const uploadResponse = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
                'Content-Type': 'video/*',
                'Content-Length': videoBytes.length.toString(),
            },
            body: videoBytes,
        });

        if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text();
            console.error('[YOUTUBE] Upload error:', errorText);
            throw new Error('Failed to upload video to YouTube: ' + errorText);
        }

        const videoData = await uploadResponse.json();
        console.log('[YOUTUBE] Video uploaded! ID:', videoData.id);

        return {
            status: 'success',
            post_id: videoData.id,
            url: `https://youtube.com/shorts/${videoData.id}`,
        };

    } catch (error) {
        console.error('[YOUTUBE] ❌ Error:', error.message);
        return {
            status: 'error',
            error: error.message,
        };
    }
}

async function refreshYouTubeToken(refreshToken) {
    const YOUTUBE_CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
    const YOUTUBE_CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;

    try {
        const response = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: YOUTUBE_CLIENT_ID,
                client_secret: YOUTUBE_CLIENT_SECRET,
                refresh_token: refreshToken,
                grant_type: 'refresh_token',
            }),
        });

        const data = await response.json();
        if (data.error) {
            console.error('[YOUTUBE] Token refresh error:', data);
            return { error: data.error };
        }

        return {
            access_token: data.access_token,
            expires_in: data.expires_in,
        };
    } catch (error) {
        console.error('[YOUTUBE] Token refresh failed:', error.message);
        return { error: error.message };
    }
}
