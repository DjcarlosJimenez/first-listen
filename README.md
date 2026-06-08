# First Listen Public Beta

A focused music-feedback product built with Next.js and designed for Supabase, PostgreSQL, and Vercel.

## Product rules

- The public landing page explains the product before authentication.
- No audio is uploaded or stored.
- Artists submit YouTube, Spotify, YouTube Music, or SoundCloud links.
- The first 50 artists receive a Founder badge and one free submission.
- Founders also receive early feature access and a stored entitlement for one
  free year of Premium when Premium launches. Billing is not implemented.
- After the Founder submission, five quality reviews unlock one song.
- Reviews collect four yes/no signals, a 1-10 rating, and a useful comment.
- Comments must contain at least 30 characters and pass repeat/paste checks.
- Hook Score averages Listen Full, Playlist Add, Attention, and Share percentages.
- The complete interface supports English and Spanish and remembers the choice.
- Onboarding stores listener languages and genre preferences.
- Song submissions store song language, genre, and requested feedback focus.
- Review queues prioritize language, genre fit, reviewer activity, and queue age.
- Version 1 contains feedback and analytics only.

## Run locally

```bash
npm install
npm run dev
```

The app runs in demo mode when Supabase environment variables are absent. Use
the landing page Log in or Sign up button to enter the demo workspace. Review
progress, Founder status, and submitted demo songs are stored in `localStorage`.

## Supabase setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the SQL editor for a new project.
3. Enable Google under Authentication > Providers.
4. Add `http://localhost:3000/auth/callback` and the production callback URL to the allowed redirects.
5. Copy `.env.example` to `.env.local` and add the project URL and anon key.

Song creation uses the `submit_song` database function so five review credits
or the one-time Founder submission are checked and consumed atomically. Review
creation uses `submit_review` so low-quality feedback cannot earn credits.
`save_onboarding_preferences` stores language and genre matching preferences,
and `get_smart_review_queue` returns an authenticated, fairness-aware queue.

The schema also includes the public Founder counter, waitlist storage, share
signal, Hook Score analytics view, multilingual profile fields, song language,
feedback focus, and row-level security policies.

## Deploy

Import the repository into Vercel and add the same two public Supabase environment variables. No paid services or persistent audio storage are required.
