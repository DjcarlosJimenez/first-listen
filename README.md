# First Listen Production Beta

A focused music-feedback product built with Next.js and designed for Supabase, PostgreSQL, and Vercel.

## Product rules

- The public landing page explains the product before authentication.
- No audio is uploaded or stored.
- Artists submit YouTube, Spotify, YouTube Music, SoundCloud, or Apple Music links.
- The first 50 registered artists receive a globally unique Founder claim and
  10 bonus credits.
- Registration grants one credit. Song submission costs one credit.
- Review milestones award 1, 3, 8, and 20 credits at 5, 10, 25, and 50
  completed quality reviews.
- Reviews collect four yes/no signals, a 1-10 rating, and a useful comment.
- Comments must contain at least 30 characters and pass repeat/paste checks.
- Hook Score averages Listen Full, Playlist Add, Attention, and Share percentages.
- The complete interface supports English and Spanish and remembers the choice.
- Onboarding stores listener languages and genre preferences.
- Song submissions store song language, genre, and requested feedback focus.
- Review queues prioritize language, genre fit, reviewer activity, and queue age.
- Public artist profiles show songs, genres, languages, followers, and listening links.
- Listeners can follow artists and save reviewed songs for later.
- Review completion keeps First Listen open while offering Spotify, YouTube, and Apple Music links.
- Version 1 contains feedback and analytics only.

## Run locally

```bash
npm install
npm run dev
```

Supabase environment variables are required for authentication and private
routes. The production application does not provide a demo-auth bypass.

## Supabase setup

1. Link this repository to the existing Supabase project:

   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   ```

2. Inspect migration history and preview the recovery:

   ```bash
   npx supabase migration list
   npx supabase db push --dry-run
   ```

3. Apply every pending migration:

   ```bash
   npx supabase db push
   ```

   The `202606080000_base_schema.sql` migration repairs the previously missing
   baseline. `202606080004_recovery_hardening.sql` backfills profiles for
   existing Auth users, reconciles Founder claims and review rewards, hardens
   privileges, and installs a service-role-only database health report.

4. Put the project URL and keys in `.env.local`, then verify the live database:

   ```bash
   npm run db:verify
   ```

5. Enable Email/Password authentication.
6. Set the Auth Site URL to `https://www.firstlisten.net`. Add
   `https://www.firstlisten.net/auth/callback` and
   `http://localhost:3000/auth/callback` to Authentication > URL Configuration.
7. Copy `.env.example` to `.env.local` and fill every required value.

`supabase/schema.sql` is generated from the ordered migrations. After changing
a migration, run `npm run db:schema:sync`; CI or release checks can use
`npm run db:schema:check`.

Song creation uses `submit_song`, so URL validation, duplicate detection, and
one-credit consumption happen atomically in PostgreSQL. Review creation uses
`submit_review`, so low-quality feedback cannot earn milestone rewards.
`save_onboarding_preferences` stores language and genre matching preferences,
and `get_smart_review_queue` returns an authenticated, fairness-aware queue.

The schema also includes the public Founder counter, waitlist storage, share
signal, Hook Score analytics view, multilingual profile fields, song language,
feedback focus, and row-level security policies.

## Initial staff accounts

Set the four `ADMIN_*_EMAIL` variables, then run:

```bash
npm run bootstrap:admins
```

The script creates Carlos (Super Admin), Alberta and CarlosJr (Admin), and David
(Moderator). Passwords are generated with cryptographic randomness, printed
once, and stored only by Supabase Auth as hashes. Every account must replace
its temporary password at first login.

Never expose `SUPABASE_SERVICE_ROLE_KEY` with a `NEXT_PUBLIC_` prefix.

## Production authentication email

First Listen uses Supabase Auth with Resend SMTP. Verify `firstlisten.net` in
Resend, add the generated SPF, DKIM, and MX records, then set `RESEND_API_KEY`
in a secure local environment and run:

```bash
npm run auth:configure
```

The complete DNS and SMTP procedure is documented in
`outputs/phase-a-resend-setup.md`. Never commit the Resend API key.

## Deploy to Vercel

Import the repository into Vercel and add:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only)

Use `https://www.firstlisten.net` as the canonical production URL. Keep the
Vercel domain as a deployment alias, not the public Site URL. Deploy only after
the schema and every migration have completed in filename order.
No audio storage or paid media infrastructure is required.
