const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing authorization' });
    }

    const token = authHeader.split(' ')[1];
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY
    );

    // Verify user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
        return res.status(401).json({ error: 'Invalid token' });
    }

    try {
        // Get Instagram connected account
        const { data: account, error: accountError } = await supabase
            .from('connected_accounts')
            .select('*')
            .eq('user_id', user.id)
            .eq('platform', 'instagram')
            .single();

        if (accountError || !account) {
            return res.status(404).json({ error: 'Instagram not connected' });
        }

        const igUserId = account.metadata?.ig_user_id || account.platform_user_id;
        const accessToken = account.access_token;

        if (!igUserId || !accessToken) {
            return res.status(400).json({ error: 'Missing Instagram credentials' });
        }

        // Fetch insights in parallel
        const [audienceData, metricsData, profileData] = await Promise.all([
            // Audience demographics (requires instagram_manage_insights)
            fetchAudienceInsights(igUserId, accessToken),
            // Account metrics (last 30 days)
            fetchAccountMetrics(igUserId, accessToken),
            // Basic profile info
            fetchProfileInfo(igUserId, accessToken)
        ]);

        return res.status(200).json({
            success: true,
            profile: profileData,
            audience: audienceData,
            metrics: metricsData,
            fetched_at: new Date().toISOString()
        });

    } catch (error) {
        console.error('[Instagram Insights] Error:', error);
        return res.status(500).json({
            error: 'Failed to fetch insights',
            details: error.message
        });
    }
};

async function fetchAudienceInsights(igUserId, accessToken) {
    try {
        // Audience demographics - age/gender, cities, countries
        const metrics = [
            'audience_city',
            'audience_country',
            'audience_gender_age',
            'audience_locale'
        ].join(',');

        const url = `https://graph.facebook.com/v18.0/${igUserId}/insights?metric=${metrics}&period=lifetime&access_token=${accessToken}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.error) {
            console.error('[Audience] API Error:', data.error);
            return null;
        }

        // Parse the insights data
        const insights = {};
        for (const item of (data.data || [])) {
            const name = item.name;
            const values = item.values?.[0]?.value || {};

            if (name === 'audience_city') {
                // Top 5 cities
                insights.top_cities = Object.entries(values)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5)
                    .map(([city, count]) => ({ city, count }));
            } else if (name === 'audience_country') {
                // Top 5 countries
                insights.top_countries = Object.entries(values)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5)
                    .map(([country, count]) => ({ country, count }));
            } else if (name === 'audience_gender_age') {
                // Gender/age breakdown
                let male = 0, female = 0, other = 0;
                const ageGroups = {};

                for (const [key, count] of Object.entries(values)) {
                    const [gender, age] = key.split('.');
                    if (gender === 'M') male += count;
                    else if (gender === 'F') female += count;
                    else other += count;

                    if (!ageGroups[age]) ageGroups[age] = 0;
                    ageGroups[age] += count;
                }

                const total = male + female + other;
                insights.gender = {
                    male: total ? Math.round((male / total) * 100) : 0,
                    female: total ? Math.round((female / total) * 100) : 0,
                    other: total ? Math.round((other / total) * 100) : 0
                };

                insights.age_groups = Object.entries(ageGroups)
                    .sort((a, b) => {
                        const ageA = parseInt(a[0].split('-')[0]);
                        const ageB = parseInt(b[0].split('-')[0]);
                        return ageA - ageB;
                    })
                    .map(([range, count]) => ({
                        range,
                        count,
                        percentage: total ? Math.round((count / total) * 100) : 0
                    }));
            }
        }

        return insights;
    } catch (error) {
        console.error('[Audience] Fetch error:', error);
        return null;
    }
}

async function fetchAccountMetrics(igUserId, accessToken) {
    try {
        // Last 30 days metrics
        const metrics = [
            'impressions',
            'reach',
            'profile_views',
            'website_clicks',
            'follower_count'
        ].join(',');

        const url = `https://graph.facebook.com/v18.0/${igUserId}/insights?metric=${metrics}&period=day&since=${getDateDaysAgo(30)}&until=${getDateDaysAgo(0)}&access_token=${accessToken}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.error) {
            console.error('[Metrics] API Error:', data.error);
            return null;
        }

        const metrics_data = {};
        for (const item of (data.data || [])) {
            const name = item.name;
            const values = item.values || [];

            // Sum up the daily values for the period
            const total = values.reduce((sum, v) => sum + (v.value || 0), 0);
            metrics_data[name] = total;

            // For follower_count, get the latest value instead of sum
            if (name === 'follower_count' && values.length > 0) {
                metrics_data[name] = values[values.length - 1]?.value || 0;
            }
        }

        return {
            impressions: metrics_data.impressions || 0,
            reach: metrics_data.reach || 0,
            profile_views: metrics_data.profile_views || 0,
            website_clicks: metrics_data.website_clicks || 0,
            period: 'last_30_days'
        };
    } catch (error) {
        console.error('[Metrics] Fetch error:', error);
        return null;
    }
}

async function fetchProfileInfo(igUserId, accessToken) {
    try {
        const fields = 'username,name,profile_picture_url,followers_count,follows_count,media_count,biography';
        const url = `https://graph.facebook.com/v18.0/${igUserId}?fields=${fields}&access_token=${accessToken}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.error) {
            console.error('[Profile] API Error:', data.error);
            return null;
        }

        return {
            username: data.username,
            name: data.name,
            profile_picture: data.profile_picture_url,
            followers: data.followers_count,
            following: data.follows_count,
            posts: data.media_count,
            bio: data.biography
        };
    } catch (error) {
        console.error('[Profile] Fetch error:', error);
        return null;
    }
}

function getDateDaysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return Math.floor(date.getTime() / 1000);
}
