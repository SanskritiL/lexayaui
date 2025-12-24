// Supabase Client
// Load Supabase from CDN in HTML: <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>

let supabaseClient;

function initSupabase() {
    if (!supabaseClient) {
        supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    }
    return supabaseClient;
}

// Auth functions
const auth = {
    // Send magic link to email
    async sendMagicLink(email, redirectTo = '/members.html') {
        const { data, error } = await initSupabase().auth.signInWithOtp({
            email: email,
            options: {
                emailRedirectTo: window.location.origin + redirectTo
            }
        });
        return { data, error };
    },

    // Get current user
    async getUser() {
        const { data: { user } } = await initSupabase().auth.getUser();
        return user;
    },

    // Get session
    async getSession() {
        const { data: { session } } = await initSupabase().auth.getSession();
        return session;
    },

    // Sign out
    async signOut() {
        const { error } = await initSupabase().auth.signOut();
        if (!error) {
            window.location.href = '/';
        }
        return { error };
    },

    // Listen to auth changes
    onAuthStateChange(callback) {
        initSupabase().auth.onAuthStateChange((event, session) => {
            callback(event, session);
        });
    }
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
