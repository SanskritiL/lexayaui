// Individual Automation Rule API
// GET - Get single rule
// PUT - Update rule
// DELETE - Delete rule

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
    console.log('========== AUTOMATION RULE [ID] API ==========');
    console.log('[RULE] Method:', req.method);

    const { id } = req.query;

    if (!id) {
        return res.status(400).json({ error: 'Rule ID required' });
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
        console.log('[RULE] User verification failed:', userError);
        return res.status(401).json({ error: 'Invalid token' });
    }

    console.log('[RULE] User:', user.id, 'Rule ID:', id);

    // Verify rule ownership
    const { data: existingRule, error: fetchError } = await supabase
        .from('automation_rules')
        .select('*')
        .eq('id', id)
        .eq('user_id', user.id)
        .single();

    if (fetchError || !existingRule) {
        return res.status(404).json({ error: 'Rule not found' });
    }

    // GET - Get single rule with stats
    if (req.method === 'GET') {
        try {
            // Today's count
            const today = new Date().toISOString().split('T')[0];
            const { count: todayCount } = await supabase
                .from('dm_log')
                .select('*', { count: 'exact', head: true })
                .eq('automation_rule_id', id)
                .eq('dm_status', 'sent')
                .gte('created_at', today);

            // Total count
            const { count: totalCount } = await supabase
                .from('dm_log')
                .select('*', { count: 'exact', head: true })
                .eq('automation_rule_id', id)
                .eq('dm_status', 'sent');

            // Failed count
            const { count: failedCount } = await supabase
                .from('dm_log')
                .select('*', { count: 'exact', head: true })
                .eq('automation_rule_id', id)
                .eq('dm_status', 'failed');

            // Recent DMs
            const { data: recentDms } = await supabase
                .from('dm_log')
                .select('*')
                .eq('automation_rule_id', id)
                .order('created_at', { ascending: false })
                .limit(10);

            return res.status(200).json({
                rule: {
                    ...existingRule,
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

    // PUT - Update rule
    if (req.method === 'PUT') {
        try {
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

            // Only update fields that are provided
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
                .eq('id', id)
                .eq('user_id', user.id)
                .select()
                .single();

            if (error) {
                console.error('[RULE] Update error:', error);
                return res.status(500).json({ error: 'Failed to update rule' });
            }

            console.log('[RULE] Updated:', id);
            return res.status(200).json({ rule });

        } catch (error) {
            console.error('[RULE] Error:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    // DELETE - Delete rule
    if (req.method === 'DELETE') {
        try {
            const { error } = await supabase
                .from('automation_rules')
                .delete()
                .eq('id', id)
                .eq('user_id', user.id);

            if (error) {
                console.error('[RULE] Delete error:', error);
                return res.status(500).json({ error: 'Failed to delete rule' });
            }

            console.log('[RULE] Deleted:', id);
            return res.status(200).json({ success: true });

        } catch (error) {
            console.error('[RULE] Error:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
