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

if (!projectRef || !accessToken) {
  throw new Error("SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN are required.");
}

const emailShell = (title, body, action, actionLabel, footer) => `
<!doctype html>
<html lang="en">
  <body style="margin:0;background:#111411;color:#f5f7f2;font-family:Arial,sans-serif">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#111411;padding:32px 16px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#1a1d1b;border:1px solid #343a34;border-radius:18px;padding:32px">
          <tr><td style="color:#c8ff4f;font-size:13px;font-weight:800;letter-spacing:.12em;text-transform:uppercase">FIRST LISTEN</td></tr>
          <tr><td><h1 style="font-size:28px;line-height:1.15;margin:18px 0 12px">${title}</h1></td></tr>
          <tr><td><div style="color:#c8cdc8;font-size:15px;line-height:1.65;margin:0 0 24px">${body}</div></td></tr>
          <tr><td><a href="${action}" style="display:inline-block;background:#c8ff4f;color:#111411;text-decoration:none;font-weight:800;padding:13px 20px;border-radius:10px">${actionLabel}</a></td></tr>
          <tr><td><div style="color:#858c85;font-size:12px;line-height:1.55;margin:26px 0 0">${footer}</div></td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`.trim();

const paragraph = (content) => `<p style="margin:0 0 12px">${content}</p>`;

const payload = {
  mailer_subjects_confirmation: "Welcome To First Listen",
  mailer_templates_confirmation_content: emailShell(
    "Confirm Your Email Address",
    [
      paragraph("Welcome to First Listen."),
      paragraph("Confirm your email address to activate your account."),
      paragraph("Discover music.<br>Support artists.<br>Share your own content."),
    ].join(""),
    "{{ .ConfirmationURL }}",
    "Confirm My Account",
    [
      paragraph("Sent by:<br>FirstListen.net"),
      paragraph("If you did not create an account you may safely ignore this message."),
    ].join(""),
  ),
  mailer_subjects_recovery: "Reset your First Listen password",
  mailer_templates_recovery_content: emailShell(
    "Reset your password",
    paragraph("We received a request to reset your First Listen password."),
    "{{ .ConfirmationURL }}",
    "Reset password",
    paragraph("Sent by:<br>FirstListen.net") +
      paragraph("If you did not request this change, ignore this email and your password will remain unchanged."),
  ),
  mailer_subjects_email_change: "Confirm your new First Listen email",
  mailer_templates_email_change_content: emailShell(
    "Confirm your new email",
    paragraph("Confirm {{ .NewEmail }} as the new email address for your First Listen account."),
    "{{ .ConfirmationURL }}",
    "Confirm new email",
    paragraph("Sent by:<br>FirstListen.net") +
      paragraph("If you did not request this change, secure your account immediately."),
  ),
  mailer_subjects_invite: "You are invited to First Listen",
  mailer_templates_invite_content: emailShell(
    "You are invited",
    paragraph("Accept this invitation to create your First Listen account."),
    "{{ .ConfirmationURL }}",
    "Accept invitation",
    paragraph("Sent by:<br>FirstListen.net") +
      paragraph("This invitation link expires and can only be used once."),
  ),
  mailer_subjects_magic_link: "Your First Listen sign-in link",
  mailer_templates_magic_link_content: emailShell(
    "Sign in to First Listen",
    paragraph("Use this secure, one-time link to sign in."),
    "{{ .ConfirmationURL }}",
    "Sign in",
    paragraph("Sent by:<br>FirstListen.net") +
      paragraph("If you did not request this link, you can ignore this email."),
  ),
  mailer_notifications_password_changed_enabled: true,
  mailer_subjects_password_changed_notification:
    "Your First Listen password was changed",
  mailer_templates_password_changed_notification_content: emailShell(
    "Password changed",
    paragraph("The password for your First Listen account was changed."),
    "{{ .SiteURL }}/forgot-password",
    "Secure my account",
    paragraph("Sent by:<br>FirstListen.net") +
      paragraph("If you made this change, no action is required."),
  ),
  mailer_notifications_email_changed_enabled: true,
  mailer_subjects_email_changed_notification:
    "Your First Listen email was changed",
  mailer_templates_email_changed_notification_content: emailShell(
    "Email address changed",
    paragraph("The email address for your First Listen account was changed from {{ .OldEmail }} to {{ .Email }}."),
    "{{ .SiteURL }}/help",
    "Contact support",
    paragraph("Sent by:<br>FirstListen.net") +
      paragraph("If you made this change, no action is required."),
  ),
};

const response = await fetch(
  `https://api.supabase.com/v1/projects/${projectRef}/config/auth`,
  {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  },
);

if (!response.ok) {
  const details = await response.text();
  if (
    response.status === 400 &&
    details.includes("custom SMTP provider")
  ) {
    throw new Error(
      "Auth branding is prepared but Supabase requires custom SMTP first. " +
        "Verify firstlisten.net in Resend, add RESEND_API_KEY to .env.local, " +
        "run npm run auth:configure, then run npm run auth:brand.",
    );
  }
  throw new Error(`Auth branding update failed: ${response.status} ${details}`);
}

const config = await response.json();
console.log(
  JSON.stringify(
    {
      confirmation_subject: config.mailer_subjects_confirmation,
      recovery_subject: config.mailer_subjects_recovery,
      email_change_subject: config.mailer_subjects_email_change,
      password_changed_notification:
        config.mailer_notifications_password_changed_enabled,
      email_changed_notification:
        config.mailer_notifications_email_changed_enabled,
    },
    null,
    2,
  ),
);
