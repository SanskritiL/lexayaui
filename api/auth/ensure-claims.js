// Supabase third-party auth requires Firebase ID tokens to carry
// role: "authenticated" (otherwise requests run as anon and RLS blocks them).
// Imported users receive the claim at import time; new sign-ups call this
// endpoint once after signing in, then force-refresh their ID token.

const { getAdmin } = require('../_firebase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let decoded;
  try {
    decoded = await getAdmin().auth().verifyIdToken(authHeader.replace('Bearer ', ''));
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  if (decoded.role === 'authenticated') {
    return res.status(200).json({ updated: false });
  }

  await getAdmin().auth().setCustomUserClaims(decoded.uid, { role: 'authenticated' });
  return res.status(200).json({ updated: true });
};
