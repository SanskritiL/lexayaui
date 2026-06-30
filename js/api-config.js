// API endpoints
// Production uses same-origin Vercel rewrites. Static local previews do not have
// those rewrites, so send API calls to production unless BASE_URL is overridden.
const BASE_URL = (() => {
  if (window.LEXAYA_API_BASE_URL !== undefined) return window.LEXAYA_API_BASE_URL;
  const isLocalStaticPreview = ['localhost', '127.0.0.1', ''].includes(window.location.hostname);
  return isLocalStaticPreview || window.location.protocol === 'file:' ? 'https://lexaya.io' : '';
})();

const API = {
  r2Upload:           () => `${BASE_URL}/api/broadcast/publish?action=upload`,
  reusableMedia:      () => `${BASE_URL}/api/broadcast/publish?action=media`,
  publish:            () => `${BASE_URL}/api/broadcast/publish`,
  schedule:           () => `${BASE_URL}/api/broadcast/publish?action=schedule`,
  instagramComplete:  () => `${BASE_URL}/api/broadcast/publish?action=instagram-complete`,
  analyzeHook:        () => `${BASE_URL}/api/broadcast/analyze-hook`,
  health:             () => `${BASE_URL}/api/publish/health`,
};
