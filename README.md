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

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the SQL editor.
3. Run the SQL files in `supabase/migrations` in filename order.
4. Enable Email/Password authentication.
5. Add `http://localhost:3000/auth/callback` and the production callback URL
   to Authentication > URL Configuration.
6. Copy `.env.example` to `.env.local` and fill every required value.

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

## Deploy to Vercel

Import the repository into Vercel and add:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only)

Set the Supabase Site URL to the Vercel production domain and add the production
`/auth/callback` redirect URL. Deploy only after the schema and every migration
have completed in filename order.
No audio storage or paid media infrastructure is required.
