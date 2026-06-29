const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

supabase.from('users').select('id').limit(1)
  .then(() => console.log('🐘 Connected to Supabase (REST API)'))
  .catch((err) => console.error('❌ Supabase connection error:', err.message));

module.exports = { supabase };
