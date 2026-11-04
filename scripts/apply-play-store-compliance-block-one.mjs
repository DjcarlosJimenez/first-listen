import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

const root = process.cwd();
const migration = {
  version: "20261104010000",
  name: "play_store_compliance_block_one",
};

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

loadEnv(path.join(root, ".env.local"));
const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) throw new Error("SUPABASE_DB_PASSWORD is required.");

const pooler = (
  await readFile(path.join(root, "supabase", ".temp", "pooler-url"), "utf8")
).trim();
const connection = new URL(pooler);
connection.password = password;

const sql = await readFile(
  path.join(
    root,
    "supabase",
    "migrations",
    `${migration.version}_${migration.name}.sql`,
  ),
  "utf8",
);
const apply = process.argv.includes("--apply");
const client = new Client({
  connectionString: connection.toString(),
  ssl: { rejectUnauthorized: false },
});

const healthSql = `
  select jsonb_build_object(
    'blocks_table', to_regclass('public.user_blocks') is not null,
    'profile_reports_table', to_regclass('public.profile_reports') is not null,
    'block_rpc', to_regprocedure('public.set_user_block(uuid,boolean)') is not null,
    'profile_report_rpc', to_regprocedure('public.report_user_profile(uuid,text,text)') is not null,
    'safe_queue_rpc', to_regprocedure('public.get_workspace_v2_safe_queue(integer)') is not null,
    'reward_claim_publicly_disabled', not has_function_privilege('authenticated', 'public.claim_listening_reward()', 'execute'),
    'token_gifting_publicly_disabled', not has_function_privilege('authenticated', 'public.gift_artist_tokens(uuid,integer)', 'execute'),
    'rewards_setting_disabled', coalesce((select not enabled from public.listening_reward_settings where id = true), true)
  ) as health
`;

await client.connect();
try {
  const existing = await client.query(
    "select version, name from supabase_migrations.schema_migrations where version = $1",
    [migration.version],
  );

  if (existing.rowCount) {
    const health = await client.query(healthSql);
    console.log(JSON.stringify({
      status: "already_applied",
      migration: existing.rows[0],
      health: health.rows[0]?.health ?? null,
    }));
  } else if (!apply) {
    await client.query("begin");
    await client.query(sql);
    const health = await client.query(healthSql);
    await client.query("rollback");
    console.log(JSON.stringify({
      status: "dry_run_passed",
      migration,
      health: health.rows[0]?.health ?? null,
    }));
  } else {
    await client.query("begin");
    await client.query(sql);
    await client.query(
      `insert into supabase_migrations.schema_migrations (version, name, statements)
       values ($1, $2, array['Play Store compliance block one: deletion, reporting, blocking, and organic listening.'])`,
      [migration.version, migration.name],
    );
    await client.query("commit");
    const health = await client.query(healthSql);
    console.log(JSON.stringify({
      status: "applied",
      migration,
      health: health.rows[0]?.health ?? null,
    }));
  }
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
