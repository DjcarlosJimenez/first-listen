import { readFile } from "node:fs/promises";

async function loadLocalEnvironment() {
  const contents = await readFile(".env.local", "utf8");
  for (const line of contents.split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

await loadLocalEnvironment();

const projectRef = process.env.SUPABASE_PROJECT_REF;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
if (!projectRef || !accessToken) {
  throw new Error("SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN are required.");
}

const endpoint =
  `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

async function query(statement) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ query: statement }),
  });
  if (!response.ok) {
    throw new Error(
      `Supabase database query failed (${response.status}): ${await response.text()}`,
    );
  }
  return response.json();
}

const result = await query(`
  select jsonb_build_object(
    'migrations', coalesce((
      select jsonb_agg(to_jsonb(history) order by history.version)
      from (
        select version, name
        from supabase_migrations.schema_migrations
        where version in ('20260611000000', '20260611001000', '20260611002000')
      ) history
    ), '[]'::jsonb),
    'claimed_at_columns', (
      select jsonb_object_agg(table_name, exists_for_table)
      from (
        select table_name, exists (
          select 1
          from information_schema.columns c
          where c.table_schema = 'public'
            and c.table_name = t.table_name
            and c.column_name = 'claimed_at'
        ) as exists_for_table
        from (values
          ('songs'),
          ('daily_mission_progress'),
          ('listening_reward_claims'),
          ('founder_claims')
        ) as t(table_name)
      ) columns_by_table
    ),
    'emergency_triggers', (
      select jsonb_agg(
        jsonb_build_object(
          'trigger', trigger_name,
          'table', event_object_table,
          'event', event_manipulation,
          'statement', action_statement
        )
        order by event_object_table, trigger_name
      )
      from information_schema.triggers
      where trigger_schema = 'public'
        and action_statement ilike '%enforce_platform_emergency_controls%'
    ),
    'function_references_claimed_at', position(
      'claimed_at'
      in pg_get_functiondef(
        'public.enforce_platform_emergency_controls()'::regprocedure
      )
    ) > 0,
    'function_branches_safely', position(
      'if tg_table_name = ''songs'' then'
      in pg_get_functiondef(
        'public.enforce_platform_emergency_controls()'::regprocedure
      )
    ) > 0,
    'repair_report_available',
      to_regprocedure('public.priority25_claimed_at_repair_report()') is not null
  ) as diagnosis;
`);

const diagnosis = result[0]?.diagnosis ?? null;
if (diagnosis?.repair_report_available) {
  const repair = await query(`
    select public.priority25_claimed_at_repair_report() as repair;
  `);
  diagnosis.repair_report = repair[0]?.repair ?? null;
}

console.log(JSON.stringify(diagnosis, null, 2));
