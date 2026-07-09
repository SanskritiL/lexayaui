// Firebase Admin singleton for verifying Firebase ID tokens.

const admin = require('firebase-admin');

function getAdmin() {
  if (!admin.apps.length) {
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
    admin.initializeApp(projectId ? { projectId } : undefined);
  }
  return admin;
}

module.exports = { getAdmin };
