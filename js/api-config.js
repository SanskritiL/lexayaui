// API endpoints
// Short API requests use same-origin Firebase Hosting → Cloud Run rewrites.
// Publishing calls go directly to the existing Cloud Run service because they
// can outlive a hosting rewrite timeout.
const BASE_URL = (() => {
  if (window.LEXAYA_API_BASE_URL !== undefined) return window.LEXAYA_API_BASE_URL;
  if (window.CONFIG?.API_BASE_URL !== undefined) return window.CONFIG.API_BASE_URL;
  const isLocalStaticPreview = ['localhost', '127.0.0.1', ''].includes(window.location.hostname);
  return isLocalStaticPreview || window.location.protocol === 'file:' ? 'http://localhost:8080' : '';
})();

// Published so the pages that resolve their own API base agree with this one.
window.LEXAYA_RESOLVED_API_BASE = BASE_URL;

const PUBLISH_BASE_URL = window.LEXAYA_PUBLISH_BASE_URL ||
  window.CONFIG?.PUBLISH_BASE_URL ||
  (['localhost', '127.0.0.1', ''].includes(window.location.hostname) || window.location.protocol === 'file:' ? 'http://localhost:8081' : '');

const API = {
  r2Upload:           () => `${PUBLISH_BASE_URL}/broadcast/publish?action=upload`,
  r2Verify:           () => `${PUBLISH_BASE_URL}/broadcast/publish?action=verify-upload`,
  reusableMedia:      () => `${PUBLISH_BASE_URL}/broadcast/publish?action=media`,
  publish:            () => `${PUBLISH_BASE_URL}/broadcast/publish`,
  schedule:           () => `${PUBLISH_BASE_URL}/broadcast/publish?action=schedule`,
  instagramComplete:  () => `${PUBLISH_BASE_URL}/broadcast/publish?action=instagram-complete`,
  instagramMedia:     () => `${BASE_URL}/api/instagram/media`,
  instagramRules:     () => `${BASE_URL}/api/instagram/rules`,
  instagramLogs:      () => `${BASE_URL}/api/instagram/logs`,
  analyzeHook:        () => `${BASE_URL}/api/broadcast/analyze-hook`,
  beta:               () => `${BASE_URL}/api/beta`,
  createCheckout:     () => `${BASE_URL}/api/create-checkout`,
  refreshAccounts:    () => `${BASE_URL}/api/broadcast/refresh-accounts`,
  health:             () => `${PUBLISH_BASE_URL}/health`,
};
