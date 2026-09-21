import { readFile } from "node:fs/promises";

try {
  const contents = await readFile(".env.local", "utf8");
  for (const line of contents.split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    if (!process.env[key]) process.env[key] = line.slice(separator + 1).trim();
  }
} catch {
  // Deployment environments provide credentials directly.
}

const projectRef = process.env.SUPABASE_PROJECT_REF;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
if (!projectRef || !accessToken) {
  throw new Error("SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN are required.");
}

const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/config/auth`;
const headers = {
  Authorization: `Bearer ${accessToken}`,
  "Content-Type": "application/json",
};
const readConfig = async () => {
  const response = await fetch(endpoint, { headers });
  if (!response.ok) throw new Error(`Supabase auth config HTTP ${response.status}`);
  return response.json();
};

const current = await readConfig();
const template = current.mailer_templates_recovery_content;
if (
  typeof template !== "string" ||
  (!/{{\s*\.ConfirmationURL\s*}}/.test(template) &&
    !template.includes("?token_hash={{ .TokenHash }}&amp;type=recovery"))
) {
  throw new Error("Recovery template has no recognized link. Inspect it before updating.");
}

const updatedTemplate = template.replaceAll(
  /{{\s*\.ConfirmationURL\s*}}/g,
  "{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=recovery",
);
const payload = {
  mailer_otp_exp: 3600,
  mailer_templates_recovery_content: updatedTemplate,
};

console.log(JSON.stringify({
  currentValiditySeconds: current.mailer_otp_exp,
  targetValiditySeconds: payload.mailer_otp_exp,
  templateNeedsUpdate: updatedTemplate !== template,
  mode: process.argv.includes("--apply") ? "apply" : "dry-run",
}, null, 2));

if (process.argv.includes("--apply")) {
  const response = await fetch(endpoint, {
    method: "PATCH",
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Supabase auth config update HTTP ${response.status}`);
  const verified = await readConfig();
  if (
    verified.mailer_otp_exp !== 3600 ||
    verified.mailer_templates_recovery_content !== updatedTemplate
  ) {
    throw new Error("Supabase did not save the expected recovery settings.");
  }
  console.log("Recovery template and 60-minute validity verified in Supabase.");
}
