#!/usr/bin/env node
// One-off migration: copy Supabase auth users into Firebase Auth, preserving
// each user's Supabase UUID as the Firebase uid. When a user later signs in
// with Google using the same email, Firebase links the provider to the
// imported record and keeps the uid, so existing user_id rows keep working.
//
// Usage:
//   NODE_PATH=web-service/node_modules node --env-file=.env.local scripts/import-users-to-firebase.js [--dry-run]
//
// Requires SUPABASE_URL, SUPABASE_SERVICE_KEY, FIREBASE_PROJECT_ID, and
// Application Default Credentials that can manage Firebase Auth users
// (`gcloud auth application-default login`).

const { createClient } = require('@supabase/supabase-js');
const admin = require('firebase-admin');

const dryRun = process.argv.includes('--dry-run');

async function fetchAllSupabaseUsers(supabase) {
  const users = [];
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) break;
    page += 1;
  }
  return users;
}

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
  admin.initializeApp(projectId ? { projectId } : undefined);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const supabaseUsers = await fetchAllSupabaseUsers(supabase);
  const importable = supabaseUsers
    .filter((u) => u.email)
    .map((u) => ({
      uid: u.id,
      email: u.email,
      emailVerified: true,
      // Supabase third-party auth requires this claim on every Firebase token.
      customClaims: { role: 'authenticated' },
    }));

  console.log(`Supabase users: ${supabaseUsers.length}, importable (with email): ${importable.length}`);
  if (dryRun) {
    importable.forEach((u) => console.log(`  ${u.uid}  ${u.email}`));
    return;
  }

  let imported = 0;
  for (let i = 0; i < importable.length; i += 1000) {
    const batch = importable.slice(i, i + 1000);
    const result = await admin.auth().importUsers(batch);
    imported += result.successCount;
    result.errors.forEach(({ index, error }) => {
      console.error(`  FAILED ${batch[index].email}: ${error.message}`);
    });
  }
  console.log(`Imported ${imported}/${importable.length} users into Firebase.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
