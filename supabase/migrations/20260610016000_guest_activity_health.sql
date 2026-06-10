-- Guest-authored community events are valid when their guest identity exists.

create or replace function public.community_network_health_report()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'tables', jsonb_build_object(
      'community_support_events',
        to_regclass('public.community_support_events') is not null,
      'community_notifications',
        to_regclass('public.community_notifications') is not null
    ),
    'functions', jsonb_build_object(
      'update_community_preferences',
        to_regprocedure(
          'public.update_community_preferences(text,boolean)'
        ) is not null,
      'get_my_community_network',
        to_regprocedure('public.get_my_community_network()') is not null,
      'get_my_community_notifications',
        to_regprocedure(
          'public.get_my_community_notifications(integer)'
        ) is not null,
      'get_artist_top_supporters',
        to_regprocedure(
          'public.get_artist_top_supporters(uuid,integer)'
        ) is not null,
      'get_public_artist_activity',
        to_regprocedure(
          'public.get_public_artist_activity(uuid,integer)'
        ) is not null
    ),
    'rls', jsonb_build_object(
      'community_support_events', coalesce((
        select relrowsecurity
        from pg_class
        where oid = 'public.community_support_events'::regclass
      ), false),
      'community_notifications', coalesce((
        select relrowsecurity
        from pg_class
        where oid = 'public.community_notifications'::regclass
      ), false)
    ),
    'invalid_visibility_profiles', (
      select count(*)::integer
      from public.profiles
      where community_visibility not in ('public', 'anonymous')
    ),
    'orphan_support_events', (
      select count(*)::integer
      from public.community_support_events as events
      left join public.profiles as supporters
        on supporters.id = events.supporter_id
      left join public.guest_sessions as guests
        on guests.id = events.guest_session_id
      left join public.profiles as artists
        on artists.id = events.artist_id
      where artists.id is null
        or (
          events.supporter_id is not null
          and supporters.id is null
        )
        or (
          events.guest_session_id is not null
          and guests.id is null
        )
    ),
    'orphan_notifications', (
      select count(*)::integer
      from public.community_notifications as notifications
      left join public.profiles as recipients
        on recipients.id = notifications.recipient_id
      where recipients.id is null
    ),
    'realtime_enabled', exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'community_notifications'
    )
  );
$$;

revoke all on function public.community_network_health_report()
  from public, anon, authenticated;
grant execute on function public.community_network_health_report()
  to service_role;
