import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

const root = process.cwd();
const migration = {
  version: "20261106010000",
  name: "creator_activity_controls",
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
    'settings_table',
      to_regclass('public.creator_activity_settings') is not null,
    'settings_rpc',
      to_regprocedure('public.admin_get_creator_activity_settings()') is not null,
    'update_rpc',
      to_regprocedure('public.admin_update_creator_activity_settings(boolean,integer,integer)') is not null,
    'refresh_rpc',
      to_regprocedure('public.refresh_creator_activity_status(uuid)') is not null,
    'inactivity_enabled', (
      select inactivity_enabled
      from public.creator_activity_settings
      where id = true
    ),
    'paused_after_days', (
      select paused_after_days
      from public.creator_activity_settings
      where id = true
    ),
    'archived_after_days', (
      select archived_after_days
      from public.creator_activity_settings
      where id = true
    ),
    'eligible_inactive_profiles', (
      select count(*)
      from public.profiles
      where account_status = 'active'
        and banned_at is null
        and creator_activity_status <> 'active'
    )
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
    console.log(
      JSON.stringify({
        status: "already_applied",
        migration: existing.rows[0],
        health: health.rows[0]?.health ?? null,
      }),
    );
  } else if (!apply) {
    await client.query("begin");
    await client.query(sql);
    const health = await client.query(healthSql);
    await client.query("rollback");
    console.log(
      JSON.stringify({
        status: "dry_run_passed",
        migration,
        health: health.rows[0]?.health ?? null,
      }),
    );
  } else {
    await client.query("begin");
    await client.query(sql);
    await client.query(
      `insert into supabase_migrations.schema_migrations (version, name, statements)
       values ($1, $2, array['Owner/admin controls for creator inactivity and catalog visibility.'])`,
      [migration.version, migration.name],
    );
    await client.query("commit");
    const health = await client.query(healthSql);
    console.log(
      JSON.stringify({
        status: "applied",
        migration,
        health: health.rows[0]?.health ?? null,
      }),
    );
  }
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
