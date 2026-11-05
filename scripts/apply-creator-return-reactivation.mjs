import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

const root = process.cwd();
const migration = {
  version: "20261104030000",
  name: "creator_return_reactivation",
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
  with eligible_catalog as (
    select songs.id, songs.user_id, songs.genre
    from public.songs
    join public.profiles as creators on creators.id = songs.user_id
    where songs.is_active
      and songs.removed_at is null
      and songs.archived_at is null
      and songs.merged_into_song_id is null
      and songs.approval_status in ('auto_approved', 'approved')
      and songs.queue_tier in ('public', 'sponsored')
      and songs.platform in ('youtube', 'youtube_music', 'soundcloud')
      and nullif(btrim(coalesce(songs.music_url, '')), '') is not null
      and (
        songs.first_publish_trial_expires_at is null
        or songs.first_publish_trial_claimed_at is not null
        or songs.first_publish_trial_expires_at > now()
      )
      and creators.account_status = 'active'
      and creators.banned_at is null
      and creators.creator_activity_status = 'active'
  )
  select jsonb_build_object(
    'rpc_ready',
      to_regprocedure('public.record_creator_return()') is not null,
    'recent_signed_in_profiles', (
      select count(*)
      from public.profiles as profiles
      join auth.users as auth_users on auth_users.id = profiles.id
      where auth_users.last_sign_in_at > now() - interval '14 days'
        and profiles.account_status = 'active'
        and profiles.banned_at is null
    ),
    'recent_signed_in_profiles_active', (
      select count(*)
      from public.profiles as profiles
      join auth.users as auth_users on auth_users.id = profiles.id
      where auth_users.last_sign_in_at > now() - interval '14 days'
        and profiles.account_status = 'active'
        and profiles.banned_at is null
        and profiles.creator_activity_status = 'active'
    ),
    'eligible_catalog_songs', (
      select count(*) from eligible_catalog
    ),
    'eligible_catalog_artists', (
      select count(distinct user_id) from eligible_catalog
    ),
    'eligible_catalog_genres', (
      select coalesce(
        jsonb_agg(distinct btrim(genre))
          filter (where nullif(btrim(coalesce(genre, '')), '') is not null),
        '[]'::jsonb
      )
      from eligible_catalog
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
       values ($1, $2, array['Reactivate eligible creator catalogs when their owners return to First Listen.'])`,
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
