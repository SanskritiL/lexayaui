// Firebase Auth + Supabase data client.
//
// Firebase handles sign-in (Google); Supabase stays as the database/realtime
// backend and accepts the Firebase ID token via third-party auth. Required
// script order in HTML:
//   <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js"></script>
//   <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js"></script>
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="/js/config.js"></script>
//   <script src="/js/supabase.js"></script>

let lexayaSupabaseClient;
let firebaseAuthSettledPromise;

function initFirebase() {
    if (!window.firebase.apps.length) {
        window.firebase.initializeApp(CONFIG.FIREBASE);
    }
    return window.firebase;
}

// Resolves once Firebase has restored (or ruled out) a session. The persistent
// listener also keeps the role claim fresh on every sign-in.
function firebaseAuthSettled() {
    if (!firebaseAuthSettledPromise) {
        firebaseAuthSettledPromise = new Promise((resolve) => {
            initFirebase().auth().onAuthStateChanged((user) => {
                if (user) ensureAuthClaims(user);
                resolve();
            });
        });
    }
    return firebaseAuthSettledPromise;
}

// Supabase third-party auth requires role: "authenticated" on the ID token.
// Imported users already carry it; new sign-ups get it from the backend once,
// then force-refresh the token. Reads cached claims, so this is free when the
// claim is already present.
async function ensureAuthClaims(user) {
    try {
        const { claims } = await user.getIdTokenResult();
        if (claims.role === 'authenticated') return;
        const response = await fetch(`${CONFIG.API_BASE_URL || ''}/api/auth/ensure-claims`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${await user.getIdToken()}` },
        });
        if (response.ok) await user.getIdToken(true);
    } catch (error) {
        console.warn('[Lexaya] Could not refresh auth claims', error);
    }
}

function initSupabase() {
    if (!lexayaSupabaseClient) {
        lexayaSupabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
            accessToken: async () => {
                await firebaseAuthSettled();
                const user = initFirebase().auth().currentUser;
                return user ? await user.getIdToken() : null;
            },
            realtime: { transport: window.WebSocket },
        });
        window.LEXAYA_SUPABASE_CLIENT = lexayaSupabaseClient;

        // Keep the realtime connection authenticated as Firebase rotates tokens.
        initFirebase().auth().onIdTokenChanged(async (user) => {
            try {
                lexayaSupabaseClient.realtime.setAuth(user ? await user.getIdToken() : null);
            } catch (error) { /* realtime not in use on this page */ }
        });
    }
    return lexayaSupabaseClient;
}

// Auth functions (Firebase-backed; shapes match what pages already consume)
const auth = {
    async signInWithGoogle() {
        const firebase = initFirebase();
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        try {
            const credential = await firebase.auth().signInWithPopup(provider);
            await ensureAuthClaims(credential.user);
            return { user: credential.user, error: null };
        } catch (error) {
            if (error?.code === 'auth/popup-blocked' ||
                error?.code === 'auth/operation-not-supported-in-this-environment') {
                await firebase.auth().signInWithRedirect(provider);
                return { user: null, error: null };
            }
            return { user: null, error };
        }
    },

    // Get current user
    async getUser() {
        await firebaseAuthSettled();
        const user = initFirebase().auth().currentUser;
        return user ? { id: user.uid, email: user.email } : null;
    },

    // Get session ({ access_token, user }) — access_token is the Firebase ID
    // token, sent to the backends as a Bearer token.
    async getSession() {
        await firebaseAuthSettled();
        const user = initFirebase().auth().currentUser;
        if (!user) return null;
        return {
            access_token: await user.getIdToken(),
            user: { id: user.uid, email: user.email },
        };
    },

    // Sign out
    async signOut() {
        window.LEXAYA_CACHE.clear();
        await initFirebase().auth().signOut();
        window.location.href = '/';
        return { error: null };
    },

    // Listen to auth changes
    onAuthStateChange(callback) {
        initFirebase().auth().onAuthStateChanged((user) => {
            callback(
                user ? 'SIGNED_IN' : 'SIGNED_OUT',
                user ? { user: { id: user.uid, email: user.email } } : null
            );
        });
    }
};

window.LEXAYA_AUTH = auth;

// localStorage cache for read-mostly queries, to avoid re-hitting the
// database on every pageview. Keys are namespaced per user; entries expire
// by TTL and are invalidated explicitly after writes. Never cache tokens or
// other secrets here — localStorage is plaintext and survives the session.
const LEXAYA_CACHE_PREFIX = 'lexaya:cache:';
window.LEXAYA_CACHE = {
    async get(name, ttlMs, fetcher) {
        const user = await auth.getUser();
        const key = user ? `${LEXAYA_CACHE_PREFIX}${user.id}:${name}` : null;
        if (key) {
            try {
                const entry = JSON.parse(localStorage.getItem(key) || 'null');
                if (entry && Date.now() - entry.t < ttlMs) return entry.v;
            } catch (error) { /* corrupted entry — fall through to refetch */ }
        }
        const value = await fetcher();
        if (key && value !== undefined) {
            try {
                localStorage.setItem(key, JSON.stringify({ t: Date.now(), v: value }));
            } catch (error) { /* storage full or blocked — caching is best-effort */ }
        }
        return value;
    },
    invalidate(name) {
        const suffix = `:${name}`;
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (key && key.startsWith(LEXAYA_CACHE_PREFIX) && key.endsWith(suffix)) {
                localStorage.removeItem(key);
            }
        }
    },
    clear() {
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (key && key.startsWith(LEXAYA_CACHE_PREFIX)) localStorage.removeItem(key);
        }
    },
};

// Shared cached reads. All pages must consume the same shape so the cache
// stays interchangeable between them.
window.LEXAYA_DATA = {
    ACCOUNTS_CACHE_TTL: 10 * 60 * 1000,
    async getConnectedAccounts(userId, { fresh = false } = {}) {
        if (fresh) window.LEXAYA_CACHE.invalidate('accounts');
        let errorMessage = null;
        const accounts = await window.LEXAYA_CACHE.get('accounts', this.ACCOUNTS_CACHE_TTL, async () => {
            const { data, error } = await initSupabase()
                .from('connected_accounts')
                .select('id, platform, account_name, token_expires_at, metadata, created_at, refresh_token')
                .eq('user_id', userId)
                .order('created_at', { ascending: false });
            if (error) {
                errorMessage = error.message;
                return undefined; // errors are not cached
            }
            // Reduce refresh_token to a boolean before anything is cached:
            // credentials must never reach localStorage.
            return (data || []).map(({ refresh_token, ...account }) => ({
                ...account,
                has_refresh_token: Boolean(refresh_token),
            }));
        });
        return { accounts: accounts || [], error: errorMessage };
    },
};

// Database functions for leads
const db = {
    // Save a lead
    async saveLead(email, source = 'website') {
        const { data, error } = await initSupabase()
            .from('leads')
            .insert([{ email, source, created_at: new Date().toISOString() }]);
        return { data, error };
    },

    // Save a purchase
    async savePurchase(userId, productId, amount, stripeSessionId) {
        const { data, error } = await initSupabase()
            .from('purchases')
            .insert([{
                user_id: userId,
                product_id: productId,
                amount: amount,
                stripe_session_id: stripeSessionId,
                created_at: new Date().toISOString()
            }]);
        return { data, error };
    },

    // Get user purchases
    async getUserPurchases(userId) {
        const { data, error } = await initSupabase()
            .from('purchases')
            .select('*')
            .eq('user_id', userId);
        return { data, error };
    }
};
