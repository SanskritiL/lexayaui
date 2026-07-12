// Server-side enforcement of what a user has paid for.
//
// The browser has its own copy of these rules (js/entitlements.js) to decide
// what to render, but that copy is advisory — it runs on the user's machine.
// This one is authoritative and is what actually protects the paid features.

const getClient = require('./_supabase');
const { isAdminEmail } = require('./_admin');
const { hasCapability } = require('./_plans');

function getSupabase() {
  return getClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// The product keys this user currently holds an active subscription for.
async function getActiveProductKeys(user, supabase = getSupabase()) {
  if (!user?.email) return [];
  const { data, error } = await supabase
    .from('subscriptions')
    .select('product_key')
    .eq('customer_email', user.email)
    .eq('status', 'active');

  // Fail closed: a database error denies access rather than granting it.
  if (error) {
    console.error('[Entitlements] subscription lookup failed:', error.message);
    return [];
  }
  return (data || []).map(row => row.product_key);
}

async function userCan(user, capability, supabase) {
  if (!user) return false;
  if (isAdminEmail(user.email)) return true;
  const productKeys = await getActiveProductKeys(user, supabase);
  return hasCapability(productKeys, capability);
}

// Responds 402 and returns false when the user has not paid for `capability`.
async function requireCapability(req, res, user, capability, supabase) {
  if (await userCan(user, capability, supabase)) return true;
  res.status(402).json({
    error: 'This feature requires an upgrade',
    capability,
    upgradeUrl: '/broadcast/pricing.html',
  });
  return false;
}

module.exports = { getActiveProductKeys, userCan, requireCapability };
