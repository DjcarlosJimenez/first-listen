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

const summary = {};

const status = await query(`
  select jsonb_build_object(
    'migrations', coalesce((
      select jsonb_agg(to_jsonb(history) order by history.version)
      from (
        select version, name
        from supabase_migrations.schema_migrations
        where version in ('20260611000000', '20260611001000', '20260611002000')
      ) history
    ), '[]'::jsonb),
    'control_health', public.super_admin_control_center_health_report(),
    'claimed_at_repair', public.priority25_claimed_at_repair_report(),
    'runtime', public.get_platform_runtime(),
    'submission_token_cost', public.current_submission_token_cost('youtube'::public.music_platform),
    'discovery_accepts_100', position(
      'least(coalesce(feed_limit, 8), 100)'
      in pg_get_functiondef(
        'public.get_public_discovery_feed(integer)'::regprocedure
      )
    ) > 0
  ) as status;
`);
summary.status = status[0]?.status ?? null;

const submission = await query(`
  begin;
  do $$
  declare
    founder_id uuid;
    submitted_song_id uuid;
  begin
    select id into founder_id
    from public.profiles
    where role::text = 'super_admin'
      and founder_number = 1
      and account_status = 'active'
      and banned_at is null
    limit 1;

    if founder_id is null then
      raise exception 'Founder #1 super_admin profile was not found.';
    end if;

    perform set_config('request.jwt.claim.sub', founder_id::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);

    submitted_song_id := public.submit_song(
      'Priority 25 Smoke Test',
      'First Listen QA',
      '',
      'https://www.youtube.com/watch?v=abcdefghijk',
      'youtube'::public.music_platform,
      'Other',
      'Instrumental',
      array['General Feedback']::text[],
      'United States',
      false,
      'song',
      180
    );

    if submitted_song_id is null then
      raise exception 'submit_song returned null.';
    end if;
  end;
  $$;
  select jsonb_build_object('founder_submission_rpc', true) as result;
  rollback;
`);
summary.submission = submission.at(-1)?.result ?? null;

const discovery = await query(`
  select jsonb_build_object(
    'rows_returned', count(*),
    'max_position', coalesce(max(feed_position), 0),
    'feed_kinds', coalesce(jsonb_agg(distinct feed_kind), '[]'::jsonb)
  ) as discovery
  from public.get_public_discovery_feed(100);
`);
summary.discovery = discovery[0]?.discovery ?? null;

console.log(JSON.stringify(summary, null, 2));
