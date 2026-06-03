
const SUPABASE_URL = 'https://ofbgiziabvrujrdjingv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mYmdpemlhYnZydWpyZGppbmd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0NjkxODMsImV4cCI6MjA5NTA0NTE4M30.mytB0t2giV2rkyMdsttC0D4dfNWx2BWRgfCTR_w-PnI';

// Initialize the Supabase client
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);