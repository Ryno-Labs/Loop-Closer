# Loop Closer v4

Private personal PWA using Netlify + Supabase.

## Update an existing deployment
Replace these repo files with the v4 files and push/commit:
- index.html
- styles.css
- app.js
- manifest.webmanifest
- sw.js

Keep your existing `config.js` if it already contains your Supabase URL and publishable/anon key.
No new SQL is required if you already ran the supplied `supabase.sql`.

Netlify should redeploy automatically from GitHub. The service worker cache name was bumped and now activates immediately so the new UI replaces the prior cached version faster.

## Fresh setup
1. Create a Supabase project.
2. Run `supabase.sql` once in SQL Editor.
3. Create your user under Supabase Authentication.
4. Put the Supabase Project URL and publishable/anon key into `config.js`.
5. Push these files to a private GitHub repo.
6. Connect that repo to Netlify. No build command is required.
