// Publishing is admin-only. Everyone else gets the Instagram DM automation
// product.
//
// Fails closed: an unset ADMIN_EMAILS blocks everyone rather than allowing
// everyone. Deploy must set it (see web-service/deploy.sh).
const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(email => email.trim().toLowerCase())
  .filter(Boolean);

function isAdminEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  return Boolean(normalized) && ADMIN_EMAILS.includes(normalized);
}

module.exports = { isAdminEmail, ADMIN_EMAILS };
