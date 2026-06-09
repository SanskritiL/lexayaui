// API endpoints
// Local dev with `serve` → API calls go to production Vercel (which rewrites to Cloud Run)
// Local dev with `vercel dev` → change BASE_URL to '' to use local serverless functions
const BASE_URL = '';

const API = {
  publishWithFile:    () => `${BASE_URL}/api/publish/publish/with-file`,
  publish:            () => `${BASE_URL}/api/broadcast/publish`,
  instagramComplete:  () => `${BASE_URL}/api/broadcast/publish?action=instagram-complete`,
  analyzeHook:        () => `${BASE_URL}/api/broadcast/analyze-hook`,
  health:             () => `${BASE_URL}/api/publish/health`,
};
