# Loop Closer — Live Build

This is the real Supabase-connected version using the approved V3 visual direction.

## Files to upload to GitHub

Upload every file in this folder to the root of one GitHub repository:

- index.html
- styles.css
- app.js
- config.js
- manifest.webmanifest
- sw.js
- supabase.sql

## 1. Supabase

Create a Supabase project.

In **SQL Editor**, paste the full contents of `supabase.sql` and run it once.

Then create your private user in **Authentication → Users**. Use your own email and password. Public sign-up is not required.

## 2. Connect the app

In Supabase, copy:

- Project URL
- Publishable key (or legacy anon key)

Open `config.js` and replace the two placeholder values.

The publishable/anon key is safe to place in browser code. Privacy comes from Supabase authentication + the Row Level Security policies in `supabase.sql`.

## 3. GitHub Pages

Create a repository, upload all files to the repository root, then:

**Settings → Pages → Build and deployment → Deploy from a branch → main → /(root) → Save**

GitHub will provide the Pages URL.

## 4. iPhone install

Open the Pages URL in Safari → Share → Add to Home Screen.

## First test

Create one real loop with A, B, and 3–5 steps. Mark one step current, start/stop the timer, add a deadline, then close the current step. The next open step should automatically become current.
