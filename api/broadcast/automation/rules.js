// Automation Rules CRUD API
// GET - List all rules for authenticated user
// POST - Create new automation rule

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
    console.log('========== AUTOMATION RULES API ==========');
    console.log('[RULES] Method:', req.method);

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

    // GET - List all rules
    if (req.method === 'GET') {
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
