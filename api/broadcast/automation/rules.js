// Automation Rules CRUD API (Consolidated)
// GET - List all rules, get stats (?stats=true), or get single rule (?id=xxx)
// POST - Create new automation rule
// PUT - Update rule (?id=xxx required)
// DELETE - Delete rule (?id=xxx required)

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
    console.log('========== AUTOMATION RULES API ==========');
    console.log('[RULES] Method:', req.method, 'Query:', req.query);

    // Verify authentication
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from token
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
        console.log('[RULES] User verification failed:', userError);
        return res.status(401).json({ error: 'Invalid token' });
    }

    console.log('[RULES] User:', user.id);

    const ruleId = req.query.id;

    // PUT - Update rule (requires ?id=xxx)
    if (req.method === 'PUT') {
        if (!ruleId) {
            return res.status(400).json({ error: 'Rule ID required (?id=xxx)' });
        }
        return handleUpdateRule(req, res, supabase, user, ruleId);
    }

    // DELETE - Delete rule (requires ?id=xxx)
    if (req.method === 'DELETE') {
        if (!ruleId) {
            return res.status(400).json({ error: 'Rule ID required (?id=xxx)' });
        }
        return handleDeleteRule(res, supabase, user, ruleId);
    }

    // GET - List all rules, get stats, or get single rule
    if (req.method === 'GET') {
        // If ?stats=true, return overall statistics
        if (req.query.stats === 'true') {
            return getOverallStats(res, supabase, user);
        }
        // If ?id=xxx, return single rule with stats
        if (ruleId) {
            return handleGetSingleRule(res, supabase, user, ruleId);
        }
        try {
            const { data: rules, error } = await supabase
                .from('automation_rules')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false });

            if (error) {
                console.error('[RULES] Fetch error:', error);
                return res.status(500).json({ error: 'Failed to fetch rules' });
            }

            // Get DM counts for each rule
            const rulesWithStats = await Promise.all(rules.map(async (rule) => {
                // Today's count
                const today = new Date().toISOString().split('T')[0];
                const { count: todayCount } = await supabase
                    .from('dm_log')
                    .select('*', { count: 'exact', head: true })
                    .eq('automation_rule_id', rule.id)
                    .eq('dm_status', 'sent')
                    .gte('created_at', today);

                // Total count
                const { count: totalCount } = await supabase
                    .from('dm_log')
                    .select('*', { count: 'exact', head: true })
                    .eq('automation_rule_id', rule.id)
                    .eq('dm_status', 'sent');

                return {
                    ...rule,
                    stats: {
                        dms_today: todayCount || 0,
                        dms_total: totalCount || 0,
                    },
                };
            }));

            console.log(`[RULES] Returning ${rulesWithStats.length} rules`);
            return res.status(200).json({ rules: rulesWithStats });

        } catch (error) {
            console.error('[RULES] Error:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    // POST - Create new rule
    if (req.method === 'POST') {
        try {
            const {
                name,
                trigger_keywords,
                trigger_post_ids,
                trigger_scope = 'all',
                exclude_keywords = [],
                dm_template,
                dm_delay_seconds = 0,
                variables = {},
                max_dms_per_hour = 50,
            } = req.body;

            // Validation
            if (!name || !name.trim()) {
                return res.status(400).json({ error: 'Name is required' });
            }

            if (!trigger_keywords || !trigger_keywords.length) {
                return res.status(400).json({ error: 'At least one trigger keyword is required' });
            }

            if (!dm_template || !dm_template.trim()) {
                return res.status(400).json({ error: 'DM template is required' });
            }

            // Normalize keywords (uppercase, trim)
            const normalizedKeywords = trigger_keywords
                .map(kw => kw.trim().toUpperCase())
                .filter(kw => kw.length > 0);

            if (normalizedKeywords.length === 0) {
                return res.status(400).json({ error: 'Invalid keywords' });
            }

            // Create the rule
            const { data: rule, error } = await supabase
                .from('automation_rules')
                .insert({
                    user_id: user.id,
                    name: name.trim(),
                    trigger_type: 'comment_keyword',
                    trigger_keywords: normalizedKeywords,
                    trigger_post_ids: trigger_post_ids || null,
                    trigger_scope,
                    exclude_keywords: exclude_keywords.map(kw => kw.trim().toUpperCase()).filter(Boolean),
                    action_type: 'send_dm',
                    dm_template: dm_template.trim(),
                    dm_delay_seconds: Math.max(0, Math.min(300, dm_delay_seconds)), // 0-300 seconds
                    variables,
                    max_dms_per_hour: Math.max(1, Math.min(200, max_dms_per_hour)), // 1-200
                    is_active: true,
                })
                .select()
                .single();

            if (error) {
                console.error('[RULES] Create error:', error);
                return res.status(500).json({ error: 'Failed to create rule' });
            }

            console.log('[RULES] Created rule:', rule.id);
            return res.status(201).json({ rule });

        } catch (error) {
            console.error('[RULES] Error:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}

// Overall automation statistics
async function getOverallStats(res, supabase, user) {
    try {
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

        const { count: activeRules } = await supabase
            .from('automation_rules')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('is_active', true);

        const { count: totalRules } = await supabase
            .from('automation_rules')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id);

        const { count: dmsToday } = await supabase
            .from('dm_log')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('dm_status', 'sent')
            .gte('created_at', today);

        const { count: dmsWeek } = await supabase
            .from('dm_log')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('dm_status', 'sent')
            .gte('created_at', oneWeekAgo);

        const { count: dmsMonth } = await supabase
            .from('dm_log')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('dm_status', 'sent')
            .gte('created_at', oneMonthAgo);

        const { count: dmsTotal } = await supabase
            .from('dm_log')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('dm_status', 'sent');

        const { count: failedWeek } = await supabase
            .from('dm_log')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('dm_status', 'failed')
            .gte('created_at', oneWeekAgo);

        const { count: rateLimitedWeek } = await supabase
            .from('dm_log')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('dm_status', 'rate_limited')
            .gte('created_at', oneWeekAgo);

        const { count: dmsLastHour } = await supabase
            .from('dm_log')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('dm_status', 'sent')
            .gte('created_at', oneHourAgo);

        const { data: uniqueUsers } = await supabase
            .from('dm_log')
            .select('ig_user_id')
            .eq('user_id', user.id)
            .eq('dm_status', 'sent')
            .gte('created_at', oneWeekAgo);

        const uniqueUsersCount = new Set(uniqueUsers?.map(u => u.ig_user_id) || []).size;

        const { data: rules } = await supabase
            .from('automation_rules')
            .select('id, name')
            .eq('user_id', user.id);

        const topRules = await Promise.all((rules || []).map(async (rule) => {
            const { count } = await supabase
                .from('dm_log')
                .select('*', { count: 'exact', head: true })
                .eq('automation_rule_id', rule.id)
                .eq('dm_status', 'sent')
                .gte('created_at', oneWeekAgo);
            return { id: rule.id, name: rule.name, dms_this_week: count || 0 };
        }));

        topRules.sort((a, b) => b.dms_this_week - a.dms_this_week);

        const totalAttempts = (dmsWeek || 0) + (failedWeek || 0);
        const successRate = totalAttempts > 0 ? Math.round(((dmsWeek || 0) / totalAttempts) * 100) : 100;

        return res.status(200).json({
            stats: {
                rules: { active: activeRules || 0, total: totalRules || 0 },
                dms: { today: dmsToday || 0, week: dmsWeek || 0, month: dmsMonth || 0, total: dmsTotal || 0 },
                rate_limit: { used_last_hour: dmsLastHour || 0, limit: 200, remaining: Math.max(0, 200 - (dmsLastHour || 0)) },
                performance: { success_rate: successRate, failed_week: failedWeek || 0, rate_limited_week: rateLimitedWeek || 0, unique_users_week: uniqueUsersCount },
                top_rules: topRules.slice(0, 5),
            },
        });
    } catch (error) {
        console.error('[STATS] Error:', error);
        return res.status(500).json({ error: error.message });
    }
}

// Get single rule with stats
async function handleGetSingleRule(res, supabase, user, ruleId) {
    try {
        // Verify rule ownership
        const { data: rule, error: fetchError } = await supabase
            .from('automation_rules')
            .select('*')
            .eq('id', ruleId)
            .eq('user_id', user.id)
            .single();

        if (fetchError || !rule) {
            return res.status(404).json({ error: 'Rule not found' });
        }

        // Today's count
        const today = new Date().toISOString().split('T')[0];
        const { count: todayCount } = await supabase
            .from('dm_log')
            .select('*', { count: 'exact', head: true })
            .eq('automation_rule_id', ruleId)
            .eq('dm_status', 'sent')
            .gte('created_at', today);

        // Total count
        const { count: totalCount } = await supabase
            .from('dm_log')
            .select('*', { count: 'exact', head: true })
            .eq('automation_rule_id', ruleId)
            .eq('dm_status', 'sent');

        // Failed count
        const { count: failedCount } = await supabase
            .from('dm_log')
            .select('*', { count: 'exact', head: true })
            .eq('automation_rule_id', ruleId)
            .eq('dm_status', 'failed');

        // Recent DMs
        const { data: recentDms } = await supabase
            .from('dm_log')
            .select('*')
            .eq('automation_rule_id', ruleId)
            .order('created_at', { ascending: false })
            .limit(10);

        return res.status(200).json({
            rule: {
                ...rule,
                stats: {
                    dms_today: todayCount || 0,
                    dms_total: totalCount || 0,
                    dms_failed: failedCount || 0,
                },
                recent_dms: recentDms || [],
            },
        });

    } catch (error) {
        console.error('[RULE] Get error:', error);
        return res.status(500).json({ error: error.message });
    }
}

// Update rule
async function handleUpdateRule(req, res, supabase, user, ruleId) {
    try {
        // Verify rule ownership
        const { data: existingRule, error: fetchError } = await supabase
            .from('automation_rules')
            .select('*')
            .eq('id', ruleId)
            .eq('user_id', user.id)
            .single();

        if (fetchError || !existingRule) {
            return res.status(404).json({ error: 'Rule not found' });
        }

        const {
            name,
            trigger_keywords,
            trigger_post_ids,
            trigger_scope,
            exclude_keywords,
            dm_template,
            dm_delay_seconds,
            variables,
            max_dms_per_hour,
            is_active,
        } = req.body;

        const updates = {};

        if (name !== undefined) {
            if (!name.trim()) {
                return res.status(400).json({ error: 'Name cannot be empty' });
            }
            updates.name = name.trim();
        }

        if (trigger_keywords !== undefined) {
            const normalized = trigger_keywords
                .map(kw => kw.trim().toUpperCase())
                .filter(kw => kw.length > 0);
            if (normalized.length === 0) {
                return res.status(400).json({ error: 'At least one keyword required' });
            }
            updates.trigger_keywords = normalized;
        }

        if (trigger_post_ids !== undefined) {
            updates.trigger_post_ids = trigger_post_ids || null;
        }

        if (trigger_scope !== undefined) {
            if (!['specific', 'all'].includes(trigger_scope)) {
                return res.status(400).json({ error: 'Invalid trigger scope' });
            }
            updates.trigger_scope = trigger_scope;
        }

        if (exclude_keywords !== undefined) {
            updates.exclude_keywords = exclude_keywords
                .map(kw => kw.trim().toUpperCase())
                .filter(Boolean);
        }

        if (dm_template !== undefined) {
            if (!dm_template.trim()) {
                return res.status(400).json({ error: 'DM template cannot be empty' });
            }
            updates.dm_template = dm_template.trim();
        }

        if (dm_delay_seconds !== undefined) {
            updates.dm_delay_seconds = Math.max(0, Math.min(300, dm_delay_seconds));
        }

        if (variables !== undefined) {
            updates.variables = variables;
        }

        if (max_dms_per_hour !== undefined) {
            updates.max_dms_per_hour = Math.max(1, Math.min(200, max_dms_per_hour));
        }

        if (is_active !== undefined) {
            updates.is_active = Boolean(is_active);
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'No valid updates provided' });
        }

        const { data: rule, error } = await supabase
            .from('automation_rules')
            .update(updates)
            .eq('id', ruleId)
            .eq('user_id', user.id)
            .select()
            .single();

        if (error) {
            console.error('[RULE] Update error:', error);
            return res.status(500).json({ error: 'Failed to update rule' });
        }

        console.log('[RULE] Updated:', ruleId);
        return res.status(200).json({ rule });

    } catch (error) {
        console.error('[RULE] Error:', error);
        return res.status(500).json({ error: error.message });
    }
}

// Delete rule
async function handleDeleteRule(res, supabase, user, ruleId) {
    try {
        // Verify rule ownership
        const { data: existingRule, error: fetchError } = await supabase
            .from('automation_rules')
            .select('id')
            .eq('id', ruleId)
            .eq('user_id', user.id)
            .single();

        if (fetchError || !existingRule) {
            return res.status(404).json({ error: 'Rule not found' });
        }

        const { error } = await supabase
            .from('automation_rules')
            .delete()
            .eq('id', ruleId)
            .eq('user_id', user.id);

        if (error) {
            console.error('[RULE] Delete error:', error);
            return res.status(500).json({ error: 'Failed to delete rule' });
        }

        console.log('[RULE] Deleted:', ruleId);
        return res.status(200).json({ success: true });

    } catch (error) {
        console.error('[RULE] Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
