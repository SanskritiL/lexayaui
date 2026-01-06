// Instagram Webhook Handler for Comment-Triggered DM Automation
// Receives comment notifications from Instagram and sends DMs based on keywords

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const WEBHOOK_VERIFY_TOKEN = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || 'lexaya_webhook_token';

module.exports = async function handler(req, res) {
    console.log('========== INSTAGRAM WEBHOOK ==========');
    console.log('[WEBHOOK] Method:', req.method);

    // GET - Webhook Verification (Meta sends this when setting up webhook)
    if (req.method === 'GET') {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];

        console.log('[WEBHOOK] Verification request:', { mode, token, challenge });

        if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
            console.log('[WEBHOOK] Verification successful!');
            return res.status(200).send(challenge);
        } else {
            console.log('[WEBHOOK] Verification failed - token mismatch');
            return res.status(403).json({ error: 'Verification failed' });
        }
    }

    // POST - Receive webhook events
    if (req.method === 'POST') {
        // CRITICAL: Must respond within 30 seconds or Meta will retry
        // Respond immediately, then process asynchronously
        res.status(200).json({ received: true });

        try {
            await processWebhookEvent(req.body);
        } catch (error) {
            // Log but don't fail - we already responded 200
            console.error('[WEBHOOK] Processing error:', error.message);
        }
        return;
    }

    return res.status(405).json({ error: 'Method not allowed' });
};

async function processWebhookEvent(event) {
    console.log('[WEBHOOK] Event received:', JSON.stringify(event, null, 2));

    // Verify it's an Instagram event
    if (event.object !== 'instagram') {
        console.log('[WEBHOOK] Not an Instagram event, ignoring');
        return;
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Process each entry (could be batched)
    for (const entry of event.entry || []) {
        const igAccountId = entry.id; // Instagram account that received the comment
        const time = entry.time;

        console.log('[WEBHOOK] Processing entry for IG account:', igAccountId);

        // Process changes (comments, messages, etc.)
        for (const change of entry.changes || []) {
            if (change.field === 'comments') {
                await processComment(supabase, igAccountId, change.value);
            } else if (change.field === 'messages') {
                // Future: DM keyword triggers
                console.log('[WEBHOOK] Message event - not implemented yet');
            } else {
                console.log('[WEBHOOK] Unknown field:', change.field);
            }
        }

        // Also handle messaging format (different structure)
        for (const messaging of entry.messaging || []) {
            console.log('[WEBHOOK] Messaging event - not implemented yet');
        }
    }
}

async function processComment(supabase, igAccountId, commentData) {
    console.log('[COMMENT] Processing:', JSON.stringify(commentData, null, 2));

    const commentId = commentData.id;
    const commentText = commentData.text?.trim().toUpperCase() || '';
    const fromUserId = commentData.from?.id;
    const fromUsername = commentData.from?.username;
    const postId = commentData.media?.id;

    if (!fromUserId || !commentText) {
        console.log('[COMMENT] Missing user ID or text, skipping');
        return;
    }

    console.log(`[COMMENT] User @${fromUsername} (${fromUserId}) commented "${commentText}" on post ${postId}`);

    // Find the user who owns this Instagram account
    const { data: account, error: accountError } = await supabase
        .from('connected_accounts')
        .select('*')
        .eq('platform', 'instagram')
        .eq('platform_user_id', igAccountId)
        .single();

    if (accountError || !account) {
        console.log('[COMMENT] No connected account found for IG ID:', igAccountId);
        return;
    }

    const userId = account.user_id;
    console.log('[COMMENT] Found owner user:', userId);

    // Find matching automation rules
    const { data: rules, error: rulesError } = await supabase
        .from('automation_rules')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .eq('trigger_type', 'comment_keyword');

    if (rulesError || !rules?.length) {
        console.log('[COMMENT] No active automation rules found');
        return;
    }

    console.log(`[COMMENT] Found ${rules.length} active rule(s)`);

    // Check each rule for keyword match
    for (const rule of rules) {
        const keywords = rule.trigger_keywords || [];
        const excludeKeywords = rule.exclude_keywords || [];
        const triggerScope = rule.trigger_scope;
        const triggerPostIds = rule.trigger_post_ids || [];

        // Check if comment matches any keyword (case-insensitive)
        const matchedKeyword = keywords.find(kw =>
            commentText.includes(kw.toUpperCase())
        );

        if (!matchedKeyword) {
            console.log(`[RULE ${rule.id}] No keyword match`);
            continue;
        }

        // Check exclude keywords
        const excluded = excludeKeywords.some(kw =>
            commentText.includes(kw.toUpperCase())
        );

        if (excluded) {
            console.log(`[RULE ${rule.id}] Excluded by keyword`);
            continue;
        }

        // Check trigger scope (specific posts vs all posts)
        if (triggerScope === 'specific' && triggerPostIds.length > 0) {
            if (!triggerPostIds.includes(postId)) {
                console.log(`[RULE ${rule.id}] Post not in trigger list`);
                continue;
            }
        }

        console.log(`[RULE ${rule.id}] MATCH! Keyword: "${matchedKeyword}"`);

        // Check for duplicate (already sent DM to this user for this rule today)
        const today = new Date().toISOString().split('T')[0];
        const { data: existing, error: dupError } = await supabase
            .from('dm_log')
            .select('id')
            .eq('automation_rule_id', rule.id)
            .eq('ig_user_id', fromUserId)
            .gte('created_at', today)
            .limit(1);

        if (existing?.length > 0) {
            console.log(`[RULE ${rule.id}] Already sent DM to user today, skipping`);
            continue;
        }

        // Check rate limit (200 DMs per hour)
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const { count: hourlyCount } = await supabase
            .from('dm_log')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('dm_status', 'sent')
            .gte('created_at', oneHourAgo);

        if (hourlyCount >= 200) {
            console.log(`[RULE ${rule.id}] Rate limit exceeded (${hourlyCount}/200 per hour)`);

            // Log as rate limited
            await supabase.from('dm_log').insert({
                automation_rule_id: rule.id,
                user_id: userId,
                ig_user_id: fromUserId,
                ig_username: fromUsername,
                ig_post_id: postId,
                ig_comment_id: commentId,
                ig_comment_text: commentText,
                dm_message: rule.dm_template,
                dm_status: 'rate_limited',
                dm_error: 'Exceeded 200 DMs per hour limit',
            });
            continue;
        }

        // Build the DM message (replace variables)
        let dmMessage = rule.dm_template;
        const variables = rule.variables || {};

        for (const [key, value] of Object.entries(variables)) {
            dmMessage = dmMessage.replace(new RegExp(`{{${key}}}`, 'g'), value);
        }

        // Apply delay if configured
        if (rule.dm_delay_seconds > 0) {
            console.log(`[RULE ${rule.id}] Delaying ${rule.dm_delay_seconds}s`);
            await new Promise(resolve => setTimeout(resolve, rule.dm_delay_seconds * 1000));
        }

        // Send the DM!
        const dmResult = await sendInstagramDM(
            account.access_token,
            igAccountId,
            fromUserId,
            dmMessage
        );

        // Log the result
        const logEntry = {
            automation_rule_id: rule.id,
            user_id: userId,
            ig_user_id: fromUserId,
            ig_username: fromUsername,
            ig_post_id: postId,
            ig_comment_id: commentId,
            ig_comment_text: commentText,
            dm_message: dmMessage,
            dm_status: dmResult.success ? 'sent' : 'failed',
            dm_error: dmResult.error || null,
        };

        await supabase.from('dm_log').insert(logEntry);

        if (dmResult.success) {
            console.log(`[RULE ${rule.id}] DM sent successfully!`);
        } else {
            console.log(`[RULE ${rule.id}] DM failed:`, dmResult.error);
        }
    }
}

async function sendInstagramDM(accessToken, igAccountId, recipientId, message) {
    console.log('[DM] Sending to:', recipientId);

    try {
        // Instagram Graph API - Send message
        // Note: This uses the Instagram Messaging API (requires instagram_manage_messages permission)
        const response = await fetch(
            `https://graph.facebook.com/v18.0/${igAccountId}/messages`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    recipient: { id: recipientId },
                    message: { text: message },
                }),
            }
        );

        const data = await response.json();
        console.log('[DM] Response:', JSON.stringify(data, null, 2));

        if (data.error) {
            return {
                success: false,
                error: data.error.message || 'Unknown error',
            };
        }

        return {
            success: true,
            messageId: data.message_id,
        };

    } catch (error) {
        console.error('[DM] Send error:', error.message);
        return {
            success: false,
            error: error.message,
        };
    }
}
