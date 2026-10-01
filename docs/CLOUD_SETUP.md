# Turning on accounts & cloud sync

QB Brain's accounts run on **Supabase**, a hosted Postgres database with built-in sign-in. The free tier is plenty to start. Setup takes about 10 minutes, and you only do it once.

Until it's set up, QB Brain works exactly as before: everything is saved on the device, and the account options are hidden.

## 1. Create the project
1. Sign up at **supabase.com** and click **New project**. Pick a name (e.g. `qb-brain`), a strong database password (save it somewhere) and a region near your players.
2. Wait about a minute for it to finish setting up.

## 2. Create the tables
1. In the project, open **SQL Editor → New query**.
2. Paste in everything from [`supabase/schema.sql`](../supabase/schema.sql) and click **Run**. It should say "Success. No rows returned."

This creates two tables (players, and their training data) and switches on **row-level security**, so a signed-in parent can only ever read or change their own players.

## 3. Sign-in settings
In **Authentication → Sign In / Providers → Email**:
- Keep **Email** turned on.
- **Confirm email:** leave it on (recommended). Parents tap a link in their email before their first sign-in.
- **Minimum password length:** 8.

In **Authentication → URL Configuration**, set **Site URL** to your app's address: `https://daveblunts56.github.io/qb-brain/`. Confirmation and password-reset emails link back there.

Optional: under **Authentication → Emails**, edit the templates so they say "QB Brain". The built-in email sender is rate-limited, so before a real launch connect your own email provider under **SMTP settings**.

## 4. Connect the app
1. In **Project Settings → API**, copy the **Project URL** and the **anon public** key.
2. Put them in `cloud.config.json` at the root of the repo:
   ```json
   { "url": "https://YOUR-PROJECT.supabase.co", "anonKey": "eyJ..." }
   ```
3. Run `npm run build`, then commit and push.

The anon key is designed to be public, and it's safe in the app. Row-level security is what protects the data. **Never** put the `service_role` key in the app.

## 5. Check it
Open the app, then go to **Settings → Account & Players** and answer the grown-ups question. Create an account, add a player, play a rep, and sign in on a second device. The rep should show up there too.

## How it works (short version)
- A **parent, guardian or coach** owns the account (email + password). Kids are **players** under it: a nickname and an optional age group. Kids never enter an email.
- Everything saves on the device first and syncs in the background. It works offline and catches up when the connection returns.
- When two devices disagree, nothing is lost:
  - reps from both are kept
  - each play keeps its newest edit, and deleted plays stay deleted
  - a lesson finished anywhere counts as finished
  - settings take whichever change is newer
- **Sign out** removes the account's players from that device, which matters on shared family or team phones. **Delete account** removes the account, every player and all their data from the server.
