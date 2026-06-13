// Lexaya Studio Layout - Shared sidebar, header, mobile nav
(function() {
    'use strict';

    const LAYOUT_CONFIG = {
        supabaseUrl: CONFIG.SUPABASE_URL,
        supabaseKey: CONFIG.SUPABASE_ANON_KEY,
        siteName: 'Lexaya Studio',
        mode: 'Editorial Mode',
        navItems: [
            { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', href: '/broadcast/' },
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
        supabaseClient = window.LEXAYA_SUPABASE_CLIENT || (window.supabase?.createClient
            ? window.supabase.createClient(LAYOUT_CONFIG.supabaseUrl, LAYOUT_CONFIG.supabaseKey, {
                realtime: { transport: window.WebSocket }
            })
            : null);
        if (supabaseClient) window.LEXAYA_SUPABASE_CLIENT = supabaseClient;

        if (!supabaseClient) {
            renderLayout(null);
            return;
        }

        supabaseClient.auth.getUser().then(({ data: { user } }) => {
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

    window.handleLogout = function() {
        if (!supabaseClient) {
            window.location.href = '/';
            return;
        }
        supabaseClient.auth.signOut().then(() => {
            window.location.href = '/';
        });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
