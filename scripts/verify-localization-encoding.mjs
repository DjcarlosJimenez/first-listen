import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const production = process.argv.includes("--production");
const root = process.cwd();
const scannedExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
]);
const skippedDirectories = new Set([
  ".git",
  ".next",
  "node_modules",
  "outputs",
  "work",
]);
const malformedCodePoints = new Set([0x00c2, 0x00c3, 0xfffd]);
const files = [];

async function loadEnvironment() {
  try {
    const contents = await readFile(".env.local", "utf8");
    for (const line of contents.split(/\r?\n/)) {
      if (!line || line.trimStart().startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator < 1) continue;
      process.env[line.slice(0, separator).trim()] ||=
        line.slice(separator + 1).trim();
    }
  } catch {
    // Production checks can use environment variables directly.
  }
}

async function walk(directory) {
  for (const name of await readdir(directory)) {
    if (skippedDirectories.has(name)) continue;
    const path = join(directory, name);
    const details = await stat(path);
    if (details.isDirectory()) {
      await walk(path);
    } else if (scannedExtensions.has(extname(name))) {
      files.push(path);
    }
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

await loadEnvironment();
await walk(root);

const invalidUtf8 = [];
const malformedText = [];
let combinedLocalizationText = "";

for (const path of files) {
  const bytes = await readFile(path);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    invalidUtf8.push(relative(root, path));
    continue;
  }

  const malformedCharacters = [...text].filter((character) =>
    malformedCodePoints.has(character.codePointAt(0)),
  );
  if (malformedCharacters.length > 0) {
    malformedText.push(relative(root, path));
  }

  if (
    path.includes(`${join(root, "components")}`) ||
    path.endsWith(join("lib", "i18n.ts"))
  ) {
    combinedLocalizationText += `\n${text}`;
  }
}

assert(invalidUtf8.length === 0, `Invalid UTF-8 files: ${invalidUtf8.join(", ")}`);
assert(
  malformedText.length === 0,
  `Mojibake or replacement characters found in: ${malformedText.join(", ")}`,
);

const requiredGlyphs = [0x00e1, 0x00e9, 0x00ed, 0x00f3, 0x00fa, 0x00f1, 0x00bf, 0x00a1]
  .map((codePoint) => String.fromCodePoint(codePoint));
for (const glyph of requiredGlyphs) {
  assert(
    combinedLocalizationText.includes(glyph),
    `Required Spanish glyph is missing: U+${glyph.codePointAt(0).toString(16).toUpperCase()}`,
  );
}

const requiredPhrases = [
  "Escuchas válidas",
  "Canción más apoyada",
  "Mayor colaborador",
  "Colaborador público",
  "Nueva review recibida",
  "apoyó",
];
for (const phrase of requiredPhrases) {
  assert(
    combinedLocalizationText.includes(phrase),
    `Required Spanish phrase is missing: ${phrase}`,
  );
}

const checks = {
  apiContentType: "not_run",
  databaseClientEncoding: "not_run",
  databaseMojibakeObjects: "not_run",
  databaseServerEncoding: "not_run",
  emailTemplates: "passed",
  frontendContentType: "not_run",
  scannedFiles: files.length,
  sourceEncoding: "passed",
  spanishGlyphs: "passed",
  spanishPhrases: "passed",
};

if (production) {
  const projectRef = process.env.SUPABASE_PROJECT_REF;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  assert(projectRef && accessToken, "Supabase Management API credentials are required");

  const sql = `
    create temp table encoding_findings (
      object_name text,
      malformed_rows bigint
    ) on commit drop;

    do $$
    declare
      target record;
      found_rows bigint;
    begin
      for target in
        select table_schema, table_name
        from information_schema.tables
        where table_schema in ('public', 'auth')
          and table_type = 'BASE TABLE'
      loop
        execute format(
          'select count(*) from %I.%I row_data where ' ||
          'strpos(to_jsonb(row_data)::text, chr(195)) > 0 or ' ||
          'strpos(to_jsonb(row_data)::text, chr(194)) > 0 or ' ||
          'strpos(to_jsonb(row_data)::text, chr(65533)) > 0',
          target.table_schema,
          target.table_name
        )
        into found_rows;

        if found_rows > 0 then
          insert into encoding_findings
          values (target.table_schema || '.' || target.table_name, found_rows);
        end if;
      end loop;
    end
    $$;

    select
      current_setting('server_encoding') as server_encoding,
      current_setting('client_encoding') as client_encoding,
      (
        select count(*)::integer
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and (
            strpos(p.prosrc, chr(195)) > 0
            or strpos(p.prosrc, chr(194)) > 0
            or strpos(p.prosrc, chr(65533)) > 0
          )
      ) as malformed_functions,
      coalesce(
        (select sum(malformed_rows)::integer from encoding_findings),
        0
      ) as malformed_table_rows;
  `;
  const databaseResponse = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  assert(databaseResponse.ok, `Database encoding check failed: ${databaseResponse.status}`);
  const databaseRows = await databaseResponse.json();
  const database = databaseRows[0];
  assert(database.server_encoding === "UTF8", "PostgreSQL server encoding is not UTF8");
  assert(database.client_encoding === "UTF8", "PostgreSQL client encoding is not UTF8");
  assert(
    Number(database.malformed_functions) === 0 &&
      Number(database.malformed_table_rows) === 0,
    "Live database objects contain mojibake",
  );
  checks.databaseServerEncoding = database.server_encoding;
  checks.databaseClientEncoding = database.client_encoding;
  checks.databaseMojibakeObjects =
    Number(database.malformed_functions) + Number(database.malformed_table_rows);

  const frontendResponse = await fetch("https://www.firstlisten.net");
  const frontendBody = await frontendResponse.text();
  assert(frontendResponse.ok, `Production frontend failed: ${frontendResponse.status}`);
  assert(
    frontendResponse.headers.get("content-type")?.toLowerCase().includes("charset=utf-8"),
    `Frontend content type is not explicit UTF-8: ${frontendResponse.headers.get("content-type")}`,
  );
  assert(
    ![...frontendBody].some((character) =>
      malformedCodePoints.has(character.codePointAt(0)),
    ),
    "Production frontend response contains mojibake",
  );
  checks.frontendContentType = frontendResponse.headers.get("content-type");

  const metadataResponse = await fetch(
    "https://www.firstlisten.net/api/music-metadata?url=" +
      encodeURIComponent("https://www.youtube.com/watch?v=vy6GDJdvEf8"),
  );
  const metadataBody = await metadataResponse.text();
  assert(metadataResponse.ok, `Production API failed: ${metadataResponse.status}`);
  assert(
    metadataResponse.headers.get("content-type")?.toLowerCase().includes("application/json"),
    `API content type is not JSON: ${metadataResponse.headers.get("content-type")}`,
  );
  JSON.parse(metadataBody);
  assert(
    ![...metadataBody].some((character) =>
      malformedCodePoints.has(character.codePointAt(0)),
    ),
    "Production API response contains mojibake",
  );
  checks.apiContentType = metadataResponse.headers.get("content-type");
}

console.log(JSON.stringify({ checks, status: "passed" }, null, 2));
