// PublishToAll - Main Application JavaScript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Config - same as main site
const SUPABASE_URL = 'https://bwvczgcynfvfpifonzxf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3dmN6Z2N5bmZ2ZnBpZm9uenhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzQ3MDgwMTIsImV4cCI6MjA1MDI4NDAxMn0.lL6ADTr7W51MhT14DpAK6IrE8E35dI4ey1Ih2gcb0Jc';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Platform icons
const PLATFORM_ICONS = {
    tiktok: '🎵',
    instagram: '📸',
    linkedin: '💼'
};

const PLATFORM_NAMES = {
    tiktok: 'TikTok',
    instagram: 'Instagram',
    linkedin: 'LinkedIn'
};

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
    await checkAuth();
});

// Check authentication
async function checkAuth() {
    const { data: { user } } = await supabase.auth.getUser();

    const authRequired = document.getElementById('auth-required');
    const dashboard = document.getElementById('dashboard');

    if (!user) {
        if (authRequired) authRequired.style.display = 'flex';
        if (dashboard) dashboard.style.display = 'none';
        return null;
    }

    if (authRequired) authRequired.style.display = 'none';
    if (dashboard) dashboard.style.display = 'block';

    // Load dashboard data
    await loadConnectedAccounts();
    await loadRecentPosts();

    return user;
}

// Load connected accounts
async function loadConnectedAccounts() {
    const grid = document.getElementById('accounts-grid');
    if (!grid) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: accounts, error } = await supabase
        .from('connected_accounts')
        .select('*')
        .eq('user_id', user.id);

    if (error) {
        console.error('Error loading accounts:', error);
        grid.innerHTML = '<div class="empty-state"><h3>Error loading accounts</h3></div>';
        return;
    }

    // Build account cards for all platforms
    const platforms = ['tiktok', 'instagram', 'linkedin'];
    const html = platforms.map(platform => {
        const account = accounts?.find(a => a.platform === platform);
        const isConnected = !!account;

        return `
            <div class="account-card ${isConnected ? 'connected' : ''}">
                <div class="account-icon">${PLATFORM_ICONS[platform]}</div>
                <div class="account-info">
                    <h3>${PLATFORM_NAMES[platform]}</h3>
                    <p>${isConnected ? account.account_name || 'Connected' : 'Not connected'}</p>
                </div>
                <span class="account-status ${isConnected ? 'connected' : 'disconnected'}">
                    ${isConnected ? 'Connected' : 'Connect'}
                </span>
            </div>
        `;
    }).join('');

    grid.innerHTML = html;
}

// Load recent posts
async function loadRecentPosts() {
    const container = document.getElementById('recent-posts');
    if (!container) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: posts, error } = await supabase
        .from('posts')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(5);

    if (error) {
        console.error('Error loading posts:', error);
        container.innerHTML = '<div class="empty-state"><h3>Error loading posts</h3></div>';
        return;
    }

    if (!posts || posts.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <h3>No posts yet</h3>
                <p>Create your first post to get started!</p>
                <a href="upload.html" class="btn btn-primary" style="margin-top: 1rem;">Create Post</a>
            </div>
        `;
        return;
    }

    const html = posts.map(post => `
        <div class="post-item">
            <div class="post-thumbnail">
                <video src="${post.video_url}" muted></video>
            </div>
            <div class="post-info">
                <h3>${post.caption || 'No caption'}</h3>
                <div class="post-meta">
                    <span>${formatDate(post.created_at)}</span>
                    <div class="post-platforms">
                        ${(post.platforms || []).map(p => `<span class="platform-badge">${PLATFORM_ICONS[p]}</span>`).join('')}
                    </div>
                </div>
            </div>
            <span class="post-status ${post.status}">${capitalizeFirst(post.status)}</span>
        </div>
    `).join('');

    container.innerHTML = html;
}

// Helper functions
function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// Export for use in other modules
export { supabase, checkAuth, PLATFORM_ICONS, PLATFORM_NAMES };
