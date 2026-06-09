# Production Email Branding

First Listen uses Supabase Auth with Resend SMTP. Supabase free-tier projects
cannot customize Auth templates while they use the default email provider.

## One-time Resend setup

1. Add `firstlisten.net` in the Resend Domains dashboard.
2. Add every DNS record Resend displays to the DNS provider for
   `firstlisten.net`. Resend generates the exact SPF and DKIM host names and
   values for the account, so do not invent or reuse values from another
   domain.
3. Wait until Resend reports the domain as verified.
4. Create a Resend API key with sending access.
5. Add these values to `.env.local`:

```dotenv
RESEND_API_KEY=re_xxxxxxxxx
AUTH_SENDER_EMAIL=noreply@firstlisten.net
AUTH_SENDER_NAME=First Listen
```

## Activate production email

Run these commands in order:

```powershell
npm run auth:configure
npm run auth:brand
```

The first command configures `smtp.resend.com` and the First Listen sender.
The second installs branded verification, password recovery, email change,
invitation, magic-link, and security notification templates.

## Verify

Create a disposable signup at `https://www.firstlisten.net/signup`, then
confirm:

- Sender is `First Listen <noreply@firstlisten.net>`.
- Subject is `Confirm your First Listen account`.
- The email body contains First Listen branding and no Supabase branding.
- Confirmation returns to `https://www.firstlisten.net/auth/callback`.
- Forgot-password email returns to
  `https://www.firstlisten.net/reset-password`.
