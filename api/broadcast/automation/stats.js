// Automation Stats API
// GET - Overall automation statistics for the user

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
    console.log('========== AUTOMATION STATS API ==========');

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

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
        console.log('[STATS] User verification failed:', userError);
        return res.status(401).json({ error: 'Invalid token' });
    }

    try {
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

        // Count active rules
        const { count: activeRules } = await supabase
            .from('automation_rules')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('is_active', true);

        // Count total rules
        const { count: totalRules } = await supabase
            .from('automation_rules')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id);

        // DMs sent today
        const { count: dmsToday } = await supabase
            .from('dm_log')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('dm_status', 'sent')
            .gte('created_at', today);

        // DMs sent this week
        const { count: dmsWeek } = await supabase
            .from('dm_log')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('dm_status', 'sent')
            .gte('created_at', oneWeekAgo);

        // DMs sent this month
        const { count: dmsMonth } = await supabase
            .from('dm_log')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('dm_status', 'sent')
            .gte('created_at', oneMonthAgo);

        // DMs sent all time
        const { count: dmsTotal } = await supabase
            .from('dm_log')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('dm_status', 'sent');

        // Failed DMs this week
        const { count: failedWeek } = await supabase
            .from('dm_log')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('dm_status', 'failed')
            .gte('created_at', oneWeekAgo);

        // Rate limited this week
        const { count: rateLimitedWeek } = await supabase
            .from('dm_log')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('dm_status', 'rate_limited')
            .gte('created_at', oneWeekAgo);

        // DMs sent in last hour (for rate limit display)
        const { count: dmsLastHour } = await supabase
            .from('dm_log')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('dm_status', 'sent')
            .gte('created_at', oneHourAgo);

        // Unique users messaged this week
        const { data: uniqueUsers } = await supabase
            .from('dm_log')
            .select('ig_user_id')
            .eq('user_id', user.id)
            .eq('dm_status', 'sent')
            .gte('created_at', oneWeekAgo);

        const uniqueUsersCount = new Set(uniqueUsers?.map(u => u.ig_user_id) || []).size;

        // Top performing rules this week
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

            return {
                id: rule.id,
                name: rule.name,
                dms_this_week: count || 0,
            };
        }));

        // Sort by DMs sent
        topRules.sort((a, b) => b.dms_this_week - a.dms_this_week);

        // Calculate success rate
        const totalAttempts = (dmsWeek || 0) + (failedWeek || 0);
        const successRate = totalAttempts > 0
            ? Math.round(((dmsWeek || 0) / totalAttempts) * 100)
            : 100;

        return res.status(200).json({
            stats: {
                rules: {
                    active: activeRules || 0,
                    total: totalRules || 0,
                },
                dms: {
                    today: dmsToday || 0,
                    week: dmsWeek || 0,
                    month: dmsMonth || 0,
                    total: dmsTotal || 0,
                },
                rate_limit: {
                    used_last_hour: dmsLastHour || 0,
                    limit: 200,
                    remaining: Math.max(0, 200 - (dmsLastHour || 0)),
                },
                performance: {
                    success_rate: successRate,
                    failed_week: failedWeek || 0,
                    rate_limited_week: rateLimitedWeek || 0,
                    unique_users_week: uniqueUsersCount,
                },
                top_rules: topRules.slice(0, 5),
            },
        });

    } catch (error) {
        console.error('[STATS] Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
