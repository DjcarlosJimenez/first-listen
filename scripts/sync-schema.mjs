import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = path.join(root, "supabase", "migrations");
const schemaPath = path.join(root, "supabase", "schema.sql");
const checkOnly = process.argv.includes("--check");

const migrationNames = (await readdir(migrationsDirectory))
  .filter((name) => name.endsWith(".sql"))
  .sort();

const sections = await Promise.all(
  migrationNames.map(async (name) => {
    const sql = (await readFile(path.join(migrationsDirectory, name), "utf8")).trim();
    return `-- ============================================================\n-- ${name}\n-- ============================================================\n\n${sql}`;
  }),
);

const generated = [
  "-- GENERATED FILE. Edit supabase/migrations, then run npm run db:schema:sync.",
  "-- This file represents the complete First Listen database from an empty project.",
  "",
  ...sections,
].join("\n\n").trimEnd() + "\n";

if (checkOnly) {
  const current = await readFile(schemaPath, "utf8");
  if (current !== generated) {
    console.error("supabase/schema.sql is out of sync with supabase/migrations.");
    process.exit(1);
  }
  console.log(`Schema is synchronized across ${migrationNames.length} migrations.`);
} else {
  await writeFile(schemaPath, generated, "utf8");
  console.log(`Generated supabase/schema.sql from ${migrationNames.length} migrations.`);
}
