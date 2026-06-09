const { createClient } = require('@supabase/supabase-js');

module.exports = function getClient(supabaseUrl, supabaseServiceKey) {
  return createClient(supabaseUrl, supabaseServiceKey);
};
