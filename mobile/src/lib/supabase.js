import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SUPABASE_URL = 'https://bcyhcsphmqizzvzmdqxc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjeWhjc3BobXFpenp2em1kcXhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYxNjEwMjQsImV4cCI6MjA4MTczNzAyNH0.8CGKr_2IzxmdcCidKE0pIpsGJnkDKIYmNxDtns2ZRFk';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export const ADMIN_EMAILS = ['sanslamsal16@gmail.com'];
