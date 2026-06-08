import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const accounts = [
  { name: "Carlos", role: "super_admin", email: process.env.ADMIN_CARLOS_EMAIL },
  { name: "Alberta", role: "admin", email: process.env.ADMIN_ALBERTA_EMAIL },
  { name: "CarlosJr", role: "admin", email: process.env.ADMIN_CARLOSJR_EMAIL },
  { name: "David", role: "moderator", email: process.env.ADMIN_DAVID_EMAIL },
];

const missing = accounts.filter((account) => !account.email);
if (missing.length) {
  throw new Error(
    `Missing required admin email environment variables for: ${missing.map((item) => item.name).join(", ")}`,
  );
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

for (const account of accounts) {
  const temporaryPassword = `${randomBytes(18).toString("base64url")}Aa1!`;
  let user;
  const { data: existingUsers, error: listError } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listError) throw listError;
  user = existingUsers.users.find(
    (candidate) => candidate.email?.toLowerCase() === account.email.toLowerCase(),
  );

  if (user) {
    const { data, error } = await supabase.auth.admin.updateUserById(user.id, {
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: {
        ...user.user_metadata,
        full_name: account.name,
        legal_accepted: true,
        explicit_content_acknowledged: true,
        system_bootstrap: true,
      },
    });
    if (error || !data.user) {
      console.error(`${account.name}: ${error?.message ?? "Account update failed"}`);
      continue;
    }
    user = data.user;
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: account.email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: {
        full_name: account.name,
        legal_accepted: true,
        explicit_content_acknowledged: true,
        system_bootstrap: true,
      },
    });
    if (error || !data.user) {
      console.error(`${account.name}: ${error?.message ?? "Account creation failed"}`);
      continue;
    }
    user = data.user;
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      role: account.role,
      force_password_change: true,
      account_status: "active",
    })
    .eq("id", user.id);

  if (profileError) {
    console.error(`${account.name}: ${profileError.message}`);
    continue;
  }

  console.log(`${account.name} <${account.email}> temporary password: ${temporaryPassword}`);
}

console.log("Store these passwords securely. They are not written to the repository.");
