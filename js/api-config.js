// API endpoints — proxied through Vercel rewrites to Cloud Run
// Vercel rewrites /api/publish/* → https://publish-service-266355090145.us-central1.run.app/*
// No Cloud Run URL exposed to the browser.
const API = {
  upload:             () => '/api/publish/upload',
  publish:            () => '/api/publish/publish',
  instagramComplete:  () => '/api/publish/instagram-complete',
  analyzeHook:        () => '/api/broadcast/analyze-hook',
  health:             () => '/api/publish/health',
};
