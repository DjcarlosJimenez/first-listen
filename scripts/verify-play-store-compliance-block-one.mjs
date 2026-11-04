import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

const root = process.cwd();

function loadEnv(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(line)) continue;
    const [key, ...parts] = line.split("=");
    if (!process.env[key]) {
      process.env[key] = parts.join("=").trim().replace(/^['"]|['"]$/g, "");
    }
  }
}

function requireText(file, expected) {
  const body = readFileSync(path.join(root, file), "utf8");
  for (const item of expected) {
    if (!body.includes(item)) throw new Error(`${file} is missing: ${item}`);
  }
}

requireText("app/api/account/route.ts", ["deleteUser", "self_delete_account"]);
requireText("app/delete-account/page.tsx", ["AccountDeletionPanel"]);
requireText("components/public-artist-profile.tsx", [
  "set_user_block",
  "report_user_profile",
]);
requireText("components/workspace-v2/workspace-v2-auth-entry.tsx", [
  "get_workspace_v2_safe_queue",
  "get_my_blocked_users",
]);
requireText("components/workspace-v2/first-listen-simple-preview.tsx", [
  "Listening does not award tokens, payments, or priority.",
  'href="/delete-account"',
]);
requireText("app/privacy/page.tsx", ["November 4, 2026", "/delete-account"]);
requireText("app/terms/page.tsx", ["do not sell, guarantee, or exchange plays"]);
requireText("app/guidelines/page.tsx", ["Report and block"]);

loadEnv(path.join(root, ".env.local"));
const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) throw new Error("SUPABASE_DB_PASSWORD is required.");
const pooler = readFileSync(
  path.join(root, "supabase", ".temp", "pooler-url"),
  "utf8",
).trim();
const connection = new URL(pooler);
connection.password = password;
const client = new Client({
  connectionString: connection.toString(),
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  const result = await client.query(`
    select
      to_regclass('public.user_blocks') is not null as blocks_table,
      to_regclass('public.profile_reports') is not null as reports_table,
      to_regprocedure('public.set_user_block(uuid,boolean)') is not null as block_rpc,
      to_regprocedure('public.report_user_profile(uuid,text,text)') is not null as report_rpc,
      to_regprocedure('public.get_workspace_v2_safe_queue(integer)') is not null as safe_queue_rpc,
      not has_function_privilege('authenticated', 'public.claim_listening_reward()', 'execute') as rewards_disabled,
      not has_function_privilege('authenticated', 'public.gift_artist_tokens(uuid,integer)', 'execute') as gifting_disabled
  `);
  const health = result.rows[0];
  if (Object.values(health).some((value) => value !== true)) {
    throw new Error(`Database verification failed: ${JSON.stringify(health)}`);
  }
  console.log(JSON.stringify({ status: "passed", health }));
} finally {
  await client.end();
}
