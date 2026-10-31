-- Private, privacy-preserving traffic analytics for First Listen and artist pages.

create table if not exists public.site_analytics_events (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('platform', 'artist')),
  artist_slug text,
  event_type text not null check (event_type in ('page_view', 'action')),
  path text not null,
  content_label text,
  content_kind text,
  source_label text not null default 'Directo',
  visitor_hash text not null,
  session_hash text not null,
  user_id uuid references auth.users(id) on delete set null,
  device_type text not null default 'Otro',
  created_at timestamptz not null default now(),
  constraint site_analytics_artist_scope_check check (
    (scope = 'artist' and artist_slug is not null)
    or (scope = 'platform' and artist_slug is null)
  )
);

create index if not exists site_analytics_events_scope_created_idx
  on public.site_analytics_events (scope, artist_slug, created_at desc);
create index if not exists site_analytics_events_visitor_idx
  on public.site_analytics_events (scope, artist_slug, visitor_hash, created_at desc);

alter table public.site_analytics_events enable row level security;
revoke all on table public.site_analytics_events from public, anon, authenticated;
grant all on table public.site_analytics_events to service_role;

create or replace function public.get_site_analytics_report(
  report_scope text,
  report_artist_slug text default null,
  period_days integer default 30
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with all_filtered as (
    select *
    from public.site_analytics_events e
    where e.scope = report_scope
      and (
        (report_scope = 'platform' and e.artist_slug is null)
        or (report_scope = 'artist' and e.artist_slug = report_artist_slug)
      )
  ),
  filtered as (
    select * from all_filtered
    where period_days = 0 or created_at >= now() - make_interval(days => period_days)
  ),
  visitors as (
    select visitor_hash, count(distinct session_hash) as sessions
    from filtered
    where event_type = 'page_view'
    group by visitor_hash
  ),
  series_rows as (
    select
      case
        when period_days = 0 then date_trunc('month', created_at)
        else date_trunc('day', created_at)
      end as bucket,
      count(*) filter (where event_type = 'page_view')::integer as value
    from filtered
    group by 1
    order by 1
  ),
  source_rows as (
    select source_label as label, count(*)::integer as value
    from filtered
    where event_type = 'page_view'
    group by source_label
    order by value desc, label
    limit 6
  ),
  device_rows as (
    select device_type as label, count(*)::integer as value
    from filtered
    where event_type = 'page_view'
    group by device_type
    order by value desc, label
  ),
  content_rows as (
    select
      coalesce(nullif(content_label, ''), path) as title,
      coalesce(nullif(content_kind, ''), 'Pagina') as kind,
      count(*)::integer as views
    from filtered
    where event_type = 'page_view'
    group by 1, 2
    order by views desc, title
    limit 8
  ),
  recent_rows as (
    select event_type, content_label, content_kind, source_label, device_type, created_at
    from filtered
    order by created_at desc
    limit 10
  )
  select jsonb_build_object(
    'startedAt', (select min(created_at) from all_filtered),
    'metrics', jsonb_build_object(
      'visits', (select count(*) from filtered where event_type = 'page_view'),
      'visitors', (select count(*) from visitors),
      'members', (
        select count(distinct visitor_hash)
        from filtered
        where event_type = 'page_view' and user_id is not null
      ),
      'returning', (select count(*) from visitors where sessions > 1),
      'actions', (select count(*) from filtered where event_type = 'action')
    ),
    'series', coalesce((
      select jsonb_agg(jsonb_build_object(
        'label', to_char(bucket, case when period_days = 0 then 'Mon YYYY' else 'DD Mon' end),
        'value', value
      ) order by bucket)
      from series_rows
    ), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(to_jsonb(source_rows)) from source_rows), '[]'::jsonb),
    'devices', coalesce((select jsonb_agg(to_jsonb(device_rows)) from device_rows), '[]'::jsonb),
    'content', coalesce((select jsonb_agg(to_jsonb(content_rows)) from content_rows), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(to_jsonb(recent_rows)) from recent_rows), '[]'::jsonb)
  );
$$;

revoke all on function public.get_site_analytics_report(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.get_site_analytics_report(text, text, integer)
  to service_role;

comment on table public.site_analytics_events is
  'Private First Listen traffic events. Visitor and session identifiers are stored only as server-side hashes.';
comment on function public.get_site_analytics_report(text, text, integer) is
  'Aggregated private analytics consumed only through authorized server routes.';
