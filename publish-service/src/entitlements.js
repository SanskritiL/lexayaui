// Every route on this service publishes, and publishing is the Lexaya Pro tier.
//
// Mirrors api/_entitlements.js. The two services deploy separately, so this is
// a deliberate copy rather than a shared import — keep them in step.

const { getClient } = require('./supabase');
const { isAdminEmail } = require('./admin');

// Rows written before the two-tier split carry 'broadcast' and paid for
// publishing, so they are honored as pro.
const LEGACY_PRODUCT_KEYS = { broadcast: 'pro' };
const PUBLISHING_PLANS = ['pro'];

async function canPublish(user) {
  if (!user?.email) return false;
  if (isAdminEmail(user.email)) return true;

  const { data, error } = await getClient()
    .from('subscriptions')
    .select('product_key')
    .eq('customer_email', user.email)
    .eq('status', 'active');

  // Fail closed: a database error denies publishing rather than allowing it.
  if (error) {
    console.error('[Entitlements] subscription lookup failed:', error.message);
    return false;
  }

  return (data || [])
    .map(row => LEGACY_PRODUCT_KEYS[row.product_key] || row.product_key)
    .some(key => PUBLISHING_PLANS.includes(key));
}

module.exports = { canPublish };
