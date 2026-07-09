// Firebase Auth token verification shared by the API handlers.
//
// verifyToken accepts a Firebase ID token first and falls back to a legacy
// Supabase access token so sessions issued before the Firebase cutover keep
// working. Remove the fallback once all pre-migration sessions have expired.

const admin = require('firebase-admin');
const getClient = require('./_supabase');

function getAdmin() {
  if (!admin.apps.length) {
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
    admin.initializeApp(projectId ? { projectId } : undefined);
  }
  return admin;
}

async function verifyToken(token) {
  if (!token) return null;

  try {
    const decoded = await getAdmin().auth().verifyIdToken(token);
    return { id: decoded.uid, email: decoded.email || null };
  } catch (err) {
    // Not a valid Firebase token — try the legacy Supabase path.
  }

  try {
    const supabase = getClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (!error && user) return { id: user.id, email: user.email || null };
  } catch (err) {
    // fall through
  }

  return null;
}

module.exports = { getAdmin, verifyToken };
