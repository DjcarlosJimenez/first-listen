import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

const root = process.cwd();
const migrationDefinitions = [
  { version: "20261031010000", name: "first_publish_trial" },
  { version: "20261031013000", name: "first_publish_trial_retain_fix" },
  { version: "20261031020000", name: "first_publish_growth" },
];

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

const poolerPath = path.join(root, "supabase", ".temp", "pooler-url");
const pooler = (await readFile(poolerPath, "utf8")).trim();
const connection = new URL(pooler);
connection.password = password;

const migrations = await Promise.all(
  migrationDefinitions.map(async (migration) => ({
    ...migration,
    sql: await readFile(
      path.join(
        root,
        "supabase",
        "migrations",
        `${migration.version}_${migration.name}.sql`,
      ),
      "utf8",
    ),
  })),
);
const apply = process.argv.includes("--apply");
const client = new Client({
  connectionString: connection.toString(),
  ssl: { rejectUnauthorized: false },
});

const healthSql = `
  select jsonb_build_object(
    'table_ready', to_regclass('public.first_publish_trials') is not null,
    'claim_ready', to_regprocedure('public.claim_first_publish_trial(text)') is not null,
    'retain_ready', to_regprocedure('public.retain_first_publish_trial(uuid)') is not null,
    'song_expiry_ready', exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'songs'
        and column_name = 'first_publish_trial_expires_at'
    ),
    'reactions_ready', to_regclass('public.first_publish_reactions') is not null,
    'live_song_ready', to_regprocedure('public.get_first_publish_live_song(uuid)') is not null,
    'reaction_rpc_ready', to_regprocedure('public.add_first_publish_reaction(uuid,text,text)') is not null,
    'funnel_ready', to_regprocedure('public.get_first_publish_funnel(integer)') is not null,
    'reminder_ready', exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'first_publish_trials'
        and column_name = 'reminder_email_id'
    )
  ) as health
`;

await client.connect();
try {
  const existing = await client.query(
    "select version, name from supabase_migrations.schema_migrations where version = any($1::text[])",
    [migrations.map((migration) => migration.version)],
  );
  const appliedVersions = new Set(existing.rows.map((migration) => migration.version));
  const pending = migrations.filter((migration) => !appliedVersions.has(migration.version));

  if (pending.length === 0) {
    const health = await client.query(healthSql);
    console.log(JSON.stringify({
      status: "already_applied",
      migrations: existing.rows,
      health: health.rows[0]?.health ?? null,
    }));
  } else if (!apply) {
    await client.query("begin");
    for (const migration of pending) await client.query(migration.sql);
    const health = await client.query(healthSql);
    await client.query("rollback");
    console.log(JSON.stringify({
      status: "dry_run_passed",
      migrations: pending.map(({ version, name }) => ({ version, name })),
      health: health.rows[0]?.health ?? null,
    }));
  } else {
    await client.query("begin");
    for (const migration of pending) {
      await client.query(migration.sql);
      await client.query(
        `insert into supabase_migrations.schema_migrations (version, name, statements)
         values ($1, $2, array['Verified first-publication trial migration.'])`,
        [migration.version, migration.name],
      );
    }
    await client.query("commit");
    const health = await client.query(healthSql);
    console.log(JSON.stringify({
      status: "applied",
      migrations: pending.map(({ version, name }) => ({ version, name })),
      health: health.rows[0]?.health ?? null,
    }));
  }
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
