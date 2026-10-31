import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

const root = process.cwd();
const version = "20261030010000";
const name = "site_analytics";

function loadEnv(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(line)) continue;
    const [key, ...parts] = line.split("=");
    if (!process.env[key]) process.env[key] = parts.join("=").trim().replace(/^['"]|['"]$/g, "");
  }
}

loadEnv(path.join(root, ".env.local"));
const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) throw new Error("SUPABASE_DB_PASSWORD is required.");
const poolerPath = path.join(root, "supabase", ".temp", "pooler-url");
const pooler = (await readFile(poolerPath, "utf8")).trim();
const connection = new URL(pooler);
connection.password = password;
const migration = await readFile(
  path.join(root, "supabase", "migrations", `${version}_${name}.sql`),
  "utf8",
);
const apply = process.argv.includes("--apply");
const client = new Client({
  connectionString: connection.toString(),
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  const existing = await client.query(
    "select version, name from supabase_migrations.schema_migrations where version = $1",
    [version],
  );
  if (existing.rowCount) {
    const health = await client.query(`
      select
        to_regclass('public.site_analytics_events') is not null as table_ready,
        to_regprocedure('public.get_site_analytics_report(text,text,integer)') is not null as report_ready
    `);
    const report = await client.query(
      "select public.get_site_analytics_report('platform', null, 30) as report",
    );
    console.log(JSON.stringify({
      status: "already_applied",
      migration: existing.rows[0],
      health: health.rows[0],
      report_ready: Boolean(report.rows[0]?.report?.metrics),
    }));
    process.exitCode = 0;
  } else if (!apply) {
    await client.query("begin");
    await client.query(migration);
    const health = await client.query(`
      select
        to_regclass('public.site_analytics_events') is not null as table_ready,
        to_regprocedure('public.get_site_analytics_report(text,text,integer)') is not null as report_ready
    `);
    await client.query("rollback");
    console.log(JSON.stringify({ status: "dry_run_passed", health: health.rows[0] }));
  } else {
    await client.query("begin");
    await client.query(migration);
    await client.query(
      `insert into supabase_migrations.schema_migrations (version, name, statements)
       values ($1, $2, array['Private site analytics events and aggregated report.'])`,
      [version, name],
    );
    await client.query("commit");
    const health = await client.query(`
      select
        to_regclass('public.site_analytics_events') is not null as table_ready,
        to_regprocedure('public.get_site_analytics_report(text,text,integer)') is not null as report_ready
    `);
    console.log(JSON.stringify({ status: "applied", health: health.rows[0] }));
  }
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
