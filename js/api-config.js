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

const PUBLISH_BASE_URL = window.LEXAYA_PUBLISH_BASE_URL ||
  window.CONFIG?.PUBLISH_BASE_URL ||
  (['localhost', '127.0.0.1', ''].includes(window.location.hostname) || window.location.protocol === 'file:' ? 'http://localhost:8081' : '');

const API = {
  r2Upload:           () => `${PUBLISH_BASE_URL}/broadcast/publish?action=upload`,
  reusableMedia:      () => `${PUBLISH_BASE_URL}/broadcast/publish?action=media`,
  publish:            () => `${PUBLISH_BASE_URL}/broadcast/publish`,
  schedule:           () => `${PUBLISH_BASE_URL}/broadcast/publish?action=schedule`,
  instagramComplete:  () => `${PUBLISH_BASE_URL}/broadcast/publish?action=instagram-complete`,
  instagramMedia:     () => `${BASE_URL}/api/instagram/media`,
  instagramRules:     () => `${BASE_URL}/api/instagram/rules`,
  instagramLogs:      () => `${BASE_URL}/api/instagram/logs`,
  analyzeHook:        () => `${BASE_URL}/api/broadcast/analyze-hook`,
  health:             () => `${PUBLISH_BASE_URL}/health`,
};
