# Open-source readiness checklist

Before making a repository public:

- [ ] Rotate any credential that ever appeared in `.env`, screenshots, terminal output, deploy logs, or git history.
- [ ] Confirm `.env`, `.env.local`, `.firebaserc`, and `CNAME` are ignored.
- [ ] Replace `js/config.js` values with your own public project values before deployment.
- [ ] Confirm `npm run check` passes.
- [ ] Confirm Firebase Hosting serves only `.firebase-public`.
- [ ] Confirm Supabase RLS policies protect user data when using the public anon key.
- [ ] Confirm OAuth redirect URLs in each platform developer dashboard match your deployed URLs.
- [ ] Confirm Meta requested permissions match the feature set you are submitting.
- [ ] Review `privacy.html` and `terms.html` for your own legal/business details.
- [ ] Choose/confirm the license. This repo currently uses MIT.
