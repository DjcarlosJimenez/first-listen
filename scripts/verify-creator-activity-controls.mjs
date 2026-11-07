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

requireText("components/workspace-v2/first-listen-simple-preview.tsx", [
  "Tú eliges",
  "Apoyo real",
]);
requireText("components/creator-activity-controls.tsx", [
  "admin_update_creator_activity_settings",
  "Desactivada temporalmente",
  "Guardar configuración",
]);
requireText("app/control-center/page.tsx", [
  "admin_get_creator_activity_settings",
  "CreatorActivityControls",
  "Actividad de artistas",
]);
requireText(
  "supabase/migrations/20261106010000_creator_activity_controls.sql",
  [
    "creator_activity_settings",
    "admin_update_creator_activity_settings",
    "refresh_creator_activity_status",
    "inactivity_enabled boolean not null default false",
  ],
);

if (!process.argv.includes("--database")) {
  console.log(JSON.stringify({ status: "passed", scope: "source" }));
  process.exit(0);
}

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
      to_regclass('public.creator_activity_settings') is not null as settings_table,
      to_regprocedure('public.admin_get_creator_activity_settings()') is not null as settings_rpc,
      to_regprocedure('public.admin_update_creator_activity_settings(boolean,integer,integer)') is not null as update_rpc,
      to_regprocedure('public.refresh_creator_activity_status(uuid)') is not null as refresh_rpc,
      coalesce((
        select not inactivity_enabled
        from public.creator_activity_settings
        where id = true
      ), false) as temporarily_disabled,
      not exists (
        select 1
        from public.profiles
        where account_status = 'active'
          and banned_at is null
          and creator_activity_status <> 'active'
      ) as eligible_catalogs_active
  `);
  const health = result.rows[0];
  if (Object.values(health).some((value) => value !== true)) {
    throw new Error(`Database verification failed: ${JSON.stringify(health)}`);
  }
  console.log(JSON.stringify({ status: "passed", scope: "database", health }));
} finally {
  await client.end();
}
