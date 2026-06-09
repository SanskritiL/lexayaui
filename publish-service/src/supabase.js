const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

let _client = null;

function getSupabase() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY required');
  _client = createClient(url, key, {
    realtime: {
      transport: WebSocket,
    },
  });
  return _client;
}

function getClient() {
  return getSupabase();
}

module.exports = { getClient };
