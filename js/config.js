// Configuration - Replace these with your actual keys
const CONFIG = {
    // Supabase (get from: https://supabase.com/dashboard/project/YOUR_PROJECT/settings/api)
    SUPABASE_URL: 'https://bcyhcsphmqizzvzmdqxc.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjeWhjc3BobXFpenp2em1kcXhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYxNjEwMjQsImV4cCI6MjA4MTczNzAyNH0.8CGKr_2IzxmdcCidKE0pIpsGJnkDKIYmNxDtns2ZRFk',

    // Stripe (get from: https://dashboard.stripe.com/apikeys)
    STRIPE_PUBLISHABLE_KEY: 'pk_live_51R1BXqA1WPL5LnBtyn66feXbCMeWT1VIwyKSfkJ8Ydy6BVGRT6jN6tZZcALLfL7w2lVdkfZh6SdLsSTWKL9ZwIql005XoAQ4NP',

    // Your products (create in Stripe Dashboard > Products)
    PRODUCTS: {
        freeDigital: 'price_1SgEPNA1WPL5LnBtS2DTcsDz',
        regularDigital: 'price_1SgDWdA1WPL5LnBtIYjfgFIx',
        videoBundle5: 'price_1SgDO4A1WPL5LnBtArUCHkY7',
        videoBundle20: 'price_1SgEmVA1WPL5LnBtw8pU7kBE'
    }
};
