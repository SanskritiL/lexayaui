// Lexaya Studio Layout - Shared sidebar, header, mobile nav
(function() {
    'use strict';

    const LAYOUT_CONFIG = {
        siteName: 'Lexaya Studio',
        mode: 'Editorial Mode',
        navItems: [
            { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', href: '/broadcast/' },
            { id: 'automations', label: 'Instagram Automated DM', icon: 'forum', href: '/broadcast/automations.html' },
        ],
        bottomNavItems: [
            { id: 'dashboard', icon: 'dashboard', label: 'Studio', href: '/broadcast/' },
            { id: 'create', icon: 'add', label: '', href: '/broadcast/upload.html', isFab: true },
            { id: 'account', icon: 'person', label: 'Account', href: '/members.html' },
        ]
    };

    let currentUser = null;
    let supabaseClient = null;
    let activePage = '';

    function init() {
        const script = document.getElementById('layout-config');
        if (script) {
            try {
                const config = JSON.parse(script.textContent);
                Object.assign(LAYOUT_CONFIG, config);
            } catch (e) {}
        }

        activePage = document.body.dataset.page || 'dashboard';
        supabaseClient = window.LEXAYA_SUPABASE_CLIENT
            || (typeof initSupabase === 'function' ? initSupabase() : null);

        if (!supabaseClient || !window.LEXAYA_AUTH) {
            renderLayout(null);
            return;
        }

        window.LEXAYA_AUTH.getUser().then((user) => {
            currentUser = user;
            renderLayout(user);
        });
    }

    function renderLayout(user) {
        const shell = document.getElementById('app-shell');
        if (!shell) return;

        shell.innerHTML = `
            ${renderSidebar(user)}
            <main class="md:ml-72 min-h-screen bg-surface" id="main-content">
                ${renderHeader(user)}
                <div id="page-content" class="px-8 md:px-16 py-6 max-w-7xl mx-auto"></div>
                ${renderFooter()}
            </main>
            ${renderMobileNav()}
        `;

        moveContent();
        setupAuthButtons();
        if (user) setupActivityBell(user);
    }

    function moveContent() {
        const target = document.getElementById('page-content');
        const content = document.querySelector('[data-content]');
        if (content && target) {
            while (content.children.length > 0) {
                target.appendChild(content.children[0]);
            }
            content.remove();
        }
    }

    function renderSidebar(user) {
        return `
        <aside class="hidden md:flex h-screen w-72 flex-col fixed left-0 top-0 bg-surface-container-low z-50">
            <div class="flex flex-col h-full py-10 gap-8">
                <div class="px-8 mb-4">
                    <span class="text-headline-sm font-display font-extrabold text-on-surface tracking-tighter">${LAYOUT_CONFIG.siteName}</span>
                    <p class="text-label-sm text-on-surface-variant tracking-wider uppercase mt-1">${LAYOUT_CONFIG.mode}</p>
                </div>
                <nav class="flex-1 space-y-1">
                    ${LAYOUT_CONFIG.navItems.map(item => `
                        <a class="flex items-center gap-4 ${item.id === activePage
                            ? 'bg-surface-container-lowest text-primary rounded-xl px-4 py-3 mx-4 font-medium ambient-shadow'
                            : 'text-on-surface-variant px-4 py-3 mx-4 hover:translate-x-1 transition-transform duration-400 font-medium'
                        }" href="${item.href}">
                            <span class="material-symbols-outlined" ${item.id === activePage ? 'style="font-variation-settings: \'FILL\' 1;"' : ''}>${item.icon}</span>
                            <span>${item.label}</span>
                        </a>
                    `).join('')}
                </nav>
                <div class="mt-auto pt-10 border-t border-outline-variant/10">
                    <button onclick="window.location.href='/broadcast/upload.html'" class="mx-6 mb-8 py-4 px-6 rounded-md bg-gradient-to-br from-primary to-primary-container text-white font-bold flex items-center justify-center gap-3 active:scale-95 transition-transform w-[calc(100%-3rem)]">
                        <span class="material-symbols-outlined text-[20px]">add</span>
                        <span>Create Post</span>
                    </button>
                    <div class="space-y-1">
                        <a class="flex items-center gap-4 text-on-surface-variant px-4 py-3 mx-4 hover:translate-x-1 transition-transform duration-400 font-medium" href="#">
                            <span class="material-symbols-outlined">settings</span>
                            <span>Settings</span>
                        </a>
                        <a class="flex items-center gap-4 text-on-surface-variant px-4 py-3 mx-4 hover:translate-x-1 transition-transform duration-400 font-medium" href="#" id="sidebar-support">
                            <span class="material-symbols-outlined">help_outline</span>
                            <span>Support</span>
                        </a>
                        ${user ? `
                        <div class="border-t border-outline-variant/10 mx-4 my-2"></div>
                        <div class="flex items-center gap-3 text-on-surface-variant px-4 py-3 mx-4">
                            <div class="w-8 h-8 rounded-full overflow-hidden bg-surface-container-high flex-shrink-0 flex items-center justify-center">
                                <span class="material-symbols-outlined text-sm">person</span>
                            </div>
                            <span class="text-sm font-medium truncate">${user.email || 'User'}</span>
                        </div>
                        <button onclick="handleLogout()" class="flex items-center gap-4 text-on-surface-variant px-4 py-3 mx-4 hover:translate-x-1 transition-transform duration-400 font-medium w-full bg-transparent border-none cursor-pointer text-left">
                            <span class="material-symbols-outlined">logout</span>
                            <span>Sign Out</span>
                        </button>
                        ` : `
                        <a href="/login.html" class="flex items-center gap-4 text-primary px-4 py-3 mx-4 hover:translate-x-1 transition-transform duration-400 font-medium">
                            <span class="material-symbols-outlined">login</span>
                            <span>Sign In</span>
                        </a>
                        `}
                    </div>
                </div>
            </div>
        </aside>`;
    }

    function renderHeader(user) {
        const pageTitle = document.body.dataset.title || 'Dashboard';
        const pageSubtitle = document.body.dataset.subtitle || '';
        return `
        <header class="sticky top-0 z-40 bg-surface/80 backdrop-blur-xl px-8 md:px-16 py-6 flex justify-between items-center border-b border-outline-variant/10">
            <div>
                ${pageSubtitle ? `<span class="text-label-md text-primary uppercase tracking-widest">${pageSubtitle}</span>` : ''}
                <h1 class="text-headline-lg mt-1">${pageTitle}</h1>
            </div>
            <div class="flex items-center gap-6">
                ${user ? `
                <div class="activity-bell-wrap" id="activity-bell-wrap">
                    <button type="button" class="activity-bell-button" id="activity-bell-button" aria-label="Recent publishing activity" aria-expanded="false">
                        <span class="material-symbols-outlined">notifications</span>
                        <span class="activity-badge" id="activity-badge" hidden>0</span>
                    </button>
                    <div class="activity-popover" id="activity-popover" hidden>
                        <div class="activity-popover-head">
                            <div>
                                <strong>Recent activity</strong>
                                <span>Last 7 days</span>
                            </div>
                            <button type="button" id="activity-mark-read">Mark all read</button>
                        </div>
                        <div class="activity-list" id="activity-list">
                            <div class="activity-empty">Loading activity...</div>
                        </div>
                        <a class="activity-history-link" href="/broadcast/#publishing-history">View publishing history</a>
                    </div>
                </div>` : ''}
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full overflow-hidden bg-surface-container-high flex items-center justify-center">
                        <span class="material-symbols-outlined text-sm text-on-surface-variant">person</span>
                    </div>
                    <span class="text-label-md font-bold">${user ? user.email?.split('@')[0] || 'User' : 'Guest'}</span>
                </div>
            </div>
        </header>`;
    }

    function renderFooter() {
        return `
        <footer class="bg-surface py-16 border-t border-outline-variant/10">
            <div class="max-w-screen-2xl mx-auto px-12 flex flex-col md:flex-row justify-between items-center gap-8">
                <div class="flex flex-col gap-4">
                    <span class="text-headline-sm font-display font-bold text-on-surface">${LAYOUT_CONFIG.siteName}</span>
                    <p class="text-label-sm tracking-wide text-on-surface-variant max-w-xs">
                        &copy; 2026 ${LAYOUT_CONFIG.siteName}. All rights reserved.
                    </p>
                </div>
                <div class="flex flex-wrap justify-center gap-8">
                    <a class="text-label-sm font-medium text-outline hover:text-primary transition-all duration-400" href="/privacy.html">Privacy Policy</a>
                    <a class="text-label-sm font-medium text-outline hover:text-primary transition-all duration-400" href="/terms.html">Terms of Service</a>
                    <a class="text-label-sm font-medium text-outline hover:text-primary transition-all duration-400" href="#">Cookie Policy</a>
                    <a class="text-label-sm font-medium text-outline hover:text-primary transition-all duration-400" href="#">Accessibility</a>
                </div>
            </div>
        </footer>`;
    }

    function renderMobileNav() {
        return `
        <nav class="md:hidden fixed bottom-0 left-0 right-0 glass z-50 px-6 py-4 flex justify-around items-center rounded-t-3xl ambient-shadow">
            ${LAYOUT_CONFIG.bottomNavItems.map(item => {
                if (item.isFab) {
                    return `
                    <div class="relative -top-8">
                        <button onclick="window.location.href='${item.href}'" class="w-14 h-14 rounded-full bg-gradient-to-br from-primary to-primary-container text-white flex items-center justify-center ambient-shadow active:scale-90 transition-transform">
                            <span class="material-symbols-outlined text-3xl">${item.icon}</span>
                        </button>
                    </div>`;
                }
                return `
                <a href="${item.href}" class="${item.id === activePage ? 'text-primary' : 'text-on-surface-variant'} flex flex-col items-center gap-1">
                    <span class="material-symbols-outlined text-[28px]" ${item.id === activePage ? 'style="font-variation-settings: \'FILL\' 1;"' : ''}>${item.icon}</span>
                    <span class="text-[10px] font-bold uppercase tracking-tighter">${item.label}</span>
                </a>`;
            }).join('')}
        </nav>`;
    }

    function setupAuthButtons() {
        const logoutBtn = document.querySelector('[onclick="handleLogout()"]');
    }

    function setupActivityBell(user) {
        injectActivityStyles();
        const button = document.getElementById('activity-bell-button');
        const popover = document.getElementById('activity-popover');
        const markRead = document.getElementById('activity-mark-read');
        if (!button || !popover || !supabaseClient) return;

        const readKey = `lexaya.activity.read.${user.id}`;
        let activityPosts = [];

        const render = () => {
            const list = document.getElementById('activity-list');
            const badge = document.getElementById('activity-badge');
            if (!list || !badge) return;
            const lastRead = Number(localStorage.getItem(readKey) || 0);
            const unreadCount = activityPosts.filter(post => new Date(post.updated_at || post.created_at).getTime() > lastRead).length;
            badge.textContent = unreadCount > 9 ? '9+' : String(unreadCount);
            badge.hidden = unreadCount === 0;

            if (!activityPosts.length) {
                list.innerHTML = '<div class="activity-empty">No publishing activity in the last 7 days.</div>';
                return;
            }

            list.innerHTML = activityPosts.map(post => {
                const summary = summarizePostActivity(post);
                const isUnread = new Date(post.updated_at || post.created_at).getTime() > lastRead;
                return `
                    <a class="activity-item ${isUnread ? 'unread' : ''}" href="/broadcast/#publishing-history">
                        <span class="activity-state ${summary.tone}"><span class="material-symbols-outlined">${summary.icon}</span></span>
                        <span class="activity-copy">
                            <strong>${escapeLayoutHtml(summary.title)}</strong>
                            <span>${escapeLayoutHtml(summary.detail)}</span>
                            <time>${escapeLayoutHtml(formatActivityTime(post.updated_at || post.created_at))}</time>
                        </span>
                    </a>`;
            }).join('');
        };

        const ACTIVITY_TTL = 5 * 60 * 1000;
        const fetchActivity = async () => {
            const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
            const { data, error } = await supabaseClient
                .from('posts')
                .select('id, caption, status, platforms, platform_results, created_at, updated_at')
                .eq('user_id', user.id)
                .gte('created_at', since)
                .neq('status', 'draft')
                .order('updated_at', { ascending: false })
                .limit(30);
            return error ? [] : (data || []);
        };
        const load = async ({ fresh = false } = {}) => {
            if (fresh) window.LEXAYA_CACHE?.invalidate('activity');
            activityPosts = window.LEXAYA_CACHE
                ? await window.LEXAYA_CACHE.get('activity', ACTIVITY_TTL, fetchActivity)
                : await fetchActivity();
            render();
        };

        button.addEventListener('click', event => {
            event.stopPropagation();
            const willOpen = popover.hidden;
            popover.hidden = !willOpen;
            button.setAttribute('aria-expanded', String(willOpen));
            if (willOpen) load({ fresh: true });
        });
        popover.addEventListener('click', event => event.stopPropagation());
        document.addEventListener('click', () => {
            popover.hidden = true;
            button.setAttribute('aria-expanded', 'false');
        });
        markRead?.addEventListener('click', () => {
            localStorage.setItem(readKey, String(Date.now()));
            render();
        });

        // One fetch for the unread badge, then refetch on open — no standing
        // realtime subscription for a click-triggered popover.
        load();
    }

    function summarizePostActivity(post) {
        const results = Object.values(post.platform_results || {});
        const total = Math.max((post.platforms || []).length, results.length);
        const succeeded = results.filter(result => result?.status === 'success').length;
        const failed = results.filter(result => result?.status === 'error' || result?.status === 'unknown').length;
        const pending = results.filter(result => result?.status === 'pending' || result?.status === 'processing').length;
        const caption = String(post.caption || 'Untitled post').trim();
        const detail = caption.length > 54 ? `${caption.slice(0, 51)}...` : caption;

        if (failed && succeeded) return { title: `${succeeded} of ${total} platforms posted`, detail, icon: 'warning', tone: 'warning' };
        if (failed) return { title: total > 1 ? `Post failed on ${failed} platform${failed === 1 ? '' : 's'}` : 'Post failed', detail, icon: 'error', tone: 'error' };
        if (pending || post.status === 'publishing') return { title: 'Publishing in progress', detail, icon: 'progress_activity', tone: 'processing' };
        if (post.status === 'scheduled') return { title: 'Post scheduled', detail, icon: 'event', tone: 'scheduled' };
        return { title: `Posted to ${succeeded || total} platform${(succeeded || total) === 1 ? '' : 's'}`, detail, icon: 'check_circle', tone: 'success' };
    }

    function formatActivityTime(value) {
        const date = new Date(value);
        const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
        if (seconds < 60) return 'Just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    function escapeLayoutHtml(value) {
        return String(value || '').replace(/[&<>'"]/g, character => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[character]));
    }

    function injectActivityStyles() {
        if (document.getElementById('activity-bell-styles')) return;
        const style = document.createElement('style');
        style.id = 'activity-bell-styles';
        style.textContent = `
            .activity-bell-wrap{position:relative}.activity-bell-button{position:relative;width:42px;height:42px;border:1px solid #e0e3e0;border-radius:12px;background:#fff;color:#5c605e;display:flex;align-items:center;justify-content:center;cursor:pointer}.activity-bell-button:hover{color:#005bc2;border-color:#b8d5ff;background:#f7fbff}.activity-badge{position:absolute;right:-5px;top:-5px;min-width:19px;height:19px;padding:0 5px;border-radius:999px;background:#a83836;color:#fff;border:2px solid #f9f9f7;font:800 10px/15px Manrope,sans-serif}.activity-popover{position:absolute;right:0;top:calc(100% + 12px);width:min(390px,calc(100vw - 32px));background:#fff;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 24px 60px rgba(17,24,39,.16);overflow:hidden;z-index:80}.activity-popover-head{padding:15px 16px 12px;display:flex;align-items:start;justify-content:space-between;border-bottom:1px solid #eef0ee}.activity-popover-head strong{display:block;font-size:14px}.activity-popover-head span{display:block;color:#777c79;font-size:11px;margin-top:2px}.activity-popover-head button{border:0;background:transparent;color:#005bc2;font:800 11px Manrope,sans-serif;cursor:pointer;padding:4px}.activity-list{max-height:390px;overflow:auto}.activity-item{position:relative;display:grid;grid-template-columns:34px minmax(0,1fr);gap:10px;padding:12px 16px;color:#2f3332;text-decoration:none;border-bottom:1px solid #f0f1f0}.activity-item:hover{background:#f7fbff}.activity-item.unread:after{content:'';position:absolute;right:12px;top:17px;width:7px;height:7px;border-radius:50%;background:#005bc2}.activity-state{width:32px;height:32px;border-radius:10px;display:flex;align-items:center;justify-content:center}.activity-state .material-symbols-outlined{font-size:18px}.activity-state.success{background:#ecfdf5;color:#047857}.activity-state.error{background:#fef2f2;color:#b91c1c}.activity-state.warning{background:#fffbeb;color:#b45309}.activity-state.processing{background:#eef5ff;color:#005bc2}.activity-state.scheduled{background:#f5f3ff;color:#6d28d9}.activity-copy{min-width:0;padding-right:9px}.activity-copy strong,.activity-copy span,.activity-copy time{display:block}.activity-copy strong{font-size:12px}.activity-copy span{font-size:11px;color:#5c605e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}.activity-copy time{font-size:10px;color:#929895;margin-top:4px}.activity-empty{padding:28px 18px;text-align:center;color:#777c79;font-size:12px}.activity-history-link{display:block;padding:12px 16px;text-align:center;color:#005bc2;text-decoration:none;font-size:12px;font-weight:800;background:#fbfbfa}.activity-history-link:hover{background:#f3f7fb}@media(max-width:640px){.activity-popover{position:fixed;right:16px;top:86px}.activity-bell-button{width:38px;height:38px}}
        `;
        document.head.appendChild(style);
    }

    // Shown before starting the Instagram OAuth flow: personal accounts pass
    // Meta's login but fail the long-lived token exchange, so warn up front.
    window.LEXAYA_UI = window.LEXAYA_UI || {};
    window.LEXAYA_UI.confirmInstagramBusiness = function() {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'ig-business-overlay';
            overlay.innerHTML = `
                <div class="ig-business-modal" role="dialog" aria-modal="true" aria-labelledby="ig-business-title">
                    <span class="material-symbols-outlined ig-business-icon">storefront</span>
                    <h3 id="ig-business-title">Instagram Professional account required</h3>
                    <p>Your Instagram must be a <strong>Business or Creator</strong> account to connect. Personal accounts can't authorize publishing or DM automation.</p>
                    <p class="ig-business-hint">To switch: Instagram app &rarr; Settings &rarr; Account type and tools &rarr; Switch to professional account.</p>
                    <div class="ig-business-actions">
                        <button type="button" data-action="cancel">Cancel</button>
                        <button type="button" data-action="continue" class="primary">My account is professional &mdash; continue</button>
                    </div>
                </div>`;
            const close = (result) => { overlay.remove(); resolve(result); };
            overlay.addEventListener('click', (event) => {
                if (event.target === overlay) return close(false);
                const action = event.target.closest('[data-action]')?.dataset.action;
                if (action) close(action === 'continue');
            });
            if (!document.getElementById('ig-business-styles')) {
                const style = document.createElement('style');
                style.id = 'ig-business-styles';
                style.textContent = `
                    .ig-business-overlay{position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;background:rgba(17,24,39,.5);padding:16px}
                    .ig-business-modal{width:100%;max-width:420px;background:#fff;border-radius:14px;box-shadow:0 24px 60px rgba(17,24,39,.24);padding:24px;font-family:Manrope,sans-serif;color:#2f3332}
                    .ig-business-icon{width:42px;height:42px;border-radius:12px;background:#eef5ff;color:#005bc2;display:flex;align-items:center;justify-content:center;font-size:24px}
                    .ig-business-modal h3{margin:14px 0 0;font-size:16px;font-weight:800}
                    .ig-business-modal p{margin:10px 0 0;font-size:13px;line-height:1.5;color:#5c605e}
                    .ig-business-hint{background:#fbfbfa;border:1px solid #eef0ee;border-radius:10px;padding:10px 12px}
                    .ig-business-actions{margin-top:20px;display:flex;justify-content:flex-end;gap:10px}
                    .ig-business-actions button{border:1px solid #e0e3e0;background:#fff;color:#5c605e;font:700 12px Manrope,sans-serif;padding:9px 14px;border-radius:10px;cursor:pointer}
                    .ig-business-actions button:hover{background:#f7fbff;border-color:#b8d5ff;color:#005bc2}
                    .ig-business-actions button.primary{background:#005bc2;border-color:#005bc2;color:#fff}
                    .ig-business-actions button.primary:hover{background:#004a9e}
                `;
                document.head.appendChild(style);
            }
            document.body.appendChild(overlay);
        });
    };

    window.handleLogout = function() {
        if (!window.LEXAYA_AUTH) {
            window.location.href = '/';
            return;
        }
        window.LEXAYA_AUTH.signOut();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
