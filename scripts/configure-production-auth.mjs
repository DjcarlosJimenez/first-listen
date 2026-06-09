import { readFile } from "node:fs/promises";

async function loadLocalEnvironment() {
  try {
    const contents = await readFile(".env.local", "utf8");
    for (const line of contents.split(/\r?\n/)) {
      if (!line || line.trimStart().startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator < 1) continue;
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // CI and production environments provide variables directly.
  }
}

await loadLocalEnvironment();

const projectRef = process.env.SUPABASE_PROJECT_REF;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
const resendApiKey = process.env.RESEND_API_KEY;
const senderEmail =
  process.env.AUTH_SENDER_EMAIL ?? "noreply@firstlisten.net";
const senderName = process.env.AUTH_SENDER_NAME ?? "First Listen";

if (!projectRef || !accessToken || !resendApiKey) {
  throw new Error(
    "SUPABASE_PROJECT_REF, SUPABASE_ACCESS_TOKEN, and RESEND_API_KEY are required.",
  );
}
if (!senderEmail.toLowerCase().endsWith("@firstlisten.net")) {
  throw new Error("AUTH_SENDER_EMAIL must use the verified firstlisten.net domain.");
}

const response = await fetch(
  `https://api.supabase.com/v1/projects/${projectRef}/config/auth`,
  {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      smtp_admin_email: senderEmail,
      smtp_host: "smtp.resend.com",
      smtp_port: "465",
      smtp_user: "resend",
      smtp_pass: resendApiKey,
      smtp_sender_name: senderName,
      smtp_max_frequency: 60,
      rate_limit_email_sent: 30,
      mailer_autoconfirm: false,
      mailer_allow_unverified_email_sign_ins: false,
      password_min_length: 8,
      password_required_characters:
        "abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789",
      mailer_subjects_confirmation: "Confirm your First Listen account",
      mailer_subjects_recovery: "Reset your First Listen password",
      mailer_subjects_email_change: "Confirm your new First Listen email",
    }),
  },
);

if (!response.ok) {
  const details = await response.text();
  throw new Error(`Supabase Auth configuration failed: ${response.status} ${details}`);
}

const config = await response.json();
console.log(
  JSON.stringify(
    {
      smtp_configured: Boolean(config.smtp_host),
      smtp_host: config.smtp_host,
      smtp_port: config.smtp_port,
      smtp_sender_name: config.smtp_sender_name,
      smtp_admin_email: config.smtp_admin_email,
      smtp_max_frequency: config.smtp_max_frequency,
      rate_limit_email_sent: config.rate_limit_email_sent,
      mailer_autoconfirm: config.mailer_autoconfirm,
      password_min_length: config.password_min_length,
      password_required_characters: config.password_required_characters,
    },
    null,
    2,
  ),
);
