import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

const root = process.cwd();
const migration = {
  version: "20261108010000",
  name: "user_music_library",
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

const poolerPath = path.join(root, "supabase", ".temp", "pooler-url");
const pooler = (await readFile(poolerPath, "utf8")).trim();
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
    'playlists_ready', to_regclass('public.user_music_playlists') is not null,
    'playlist_items_ready', to_regclass('public.user_music_playlist_items') is not null,
    'preferences_ready', to_regclass('public.user_notification_preferences') is not null,
    'create_playlist_ready', to_regprocedure('public.create_music_playlist(text)') is not null,
    'playlist_items_rpc_ready', to_regprocedure('public.get_my_music_playlist_items(uuid)') is not null,
    'liked_songs_rpc_ready', to_regprocedure('public.get_my_liked_songs()') is not null,
    'reminder_preference_rpc_ready', to_regprocedure('public.update_inactive_reminder_preference(boolean,integer)') is not null
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
       values ($1, $2, array['Private user playlists, liked-song retrieval, and opt-in reminder preferences.'])`,
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
