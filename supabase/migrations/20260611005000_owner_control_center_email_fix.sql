-- Owner Control Center repair: use auth.users as the email source.

create or replace function public.admin_get_control_center()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  result jsonb;
begin
  if not public.can_manage_platform_control() then
    raise exception 'Super Admin access required.';
  end if;

  select jsonb_build_object(
    'state', jsonb_build_object(
      'published_config', state.published_config,
      'draft_config', state.draft_config,
      'stable_config', state.stable_config,
      'published_version', state.published_version,
      'draft_revision', state.draft_revision,
      'has_unpublished_changes', state.has_unpublished_changes,
      'updated_at', state.updated_at,
      'published_at', state.published_at
    ),
    'founder_controller', public.is_founder_controller(),
    'preview_enabled', coalesce((
      select access.preview_enabled
      from public.platform_preview_access access
      where access.user_id = auth.uid()
    ), false),
    'snapshots', coalesce((
      select jsonb_agg(to_jsonb(snapshot) order by snapshot.created_at desc)
      from (
        select id, name, description, snapshot_kind, source_version, created_by, created_at
        from public.platform_configuration_snapshots
        order by created_at desc
        limit 50
      ) snapshot
    ), '[]'::jsonb),
    'preview_access', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'user_id', access.user_id,
          'display_name', profile.display_name,
          'email', coalesce(auth_user.email, ''),
          'can_preview', access.can_preview,
          'preview_enabled', access.preview_enabled,
          'updated_at', access.updated_at
        )
        order by profile.display_name
      )
      from public.platform_preview_access access
      join public.profiles profile on profile.id = access.user_id
      left join auth.users auth_user on auth_user.id = profile.id
    ), '[]'::jsonb),
    'audit_history', coalesce((
      select jsonb_agg(to_jsonb(log) order by log.created_at desc)
      from (
        select id, actor_id, action, target_type, target_id, details, created_at
        from public.admin_audit_log
        where target_type in (
          'platform_control_state', 'platform_configuration_snapshot',
          'platform_preview_access'
        )
        order by created_at desc
        limit 100
      ) log
    ), '[]'::jsonb),
    'token_analytics', jsonb_build_object(
      'tokens_generated_today', coalesce((
        select sum(amount)
        from public.credit_transactions
        where amount > 0 and created_at >= date_trunc('day', now())
      ), 0),
      'tokens_gifted_today', coalesce((
        select sum(abs(amount))
        from public.credit_transactions
        where reason ilike '%gift%' and created_at >= date_trunc('day', now())
      ), 0),
      'tokens_spent_today', abs(coalesce((
        select sum(amount)
        from public.credit_transactions
        where amount < 0 and created_at >= date_trunc('day', now())
      ), 0)),
      'tokens_burned_today', abs(coalesce((
        select sum(amount)
        from public.credit_transactions
        where amount < 0
          and reason not ilike '%gift%'
          and created_at >= date_trunc('day', now())
      ), 0)),
      'tokens_in_circulation', coalesce((select sum(credits) from public.profiles), 0),
      'tokens_earned', coalesce((
        select sum(amount) from public.credit_transactions where amount > 0
      ), 0),
      'tokens_spent', abs(coalesce((
        select sum(amount) from public.credit_transactions where amount < 0
      ), 0)),
      'reward_claims', (select count(*) from public.listening_reward_claims),
      'average_balance', coalesce((
        select round(avg(credits)::numeric, 2) from public.profiles
      ), 0)
    ),
    'health', public.admin_get_community_health() || jsonb_build_object(
      'artists_online', (
        select count(distinct session.user_id)
        from public.listening_sessions session
        where session.last_heartbeat_at >= now() - interval '15 minutes'
          and exists (
            select 1 from public.songs song where song.user_id = session.user_id
          )
      ),
      'reviews_today', (
        select count(*) from public.reviews where created_at >= date_trunc('day', now())
      )
    ),
    'top_songs', coalesce((
      select jsonb_agg(to_jsonb(ranked))
      from (
        select song.id, song.title, song.artist_name,
          count(review.id)::integer as reviews
        from public.songs song
        left join public.reviews review on review.song_id = song.id
        where song.removed_at is null
        group by song.id
        order by count(review.id) desc, song.created_at desc
        limit 5
      ) ranked
    ), '[]'::jsonb),
    'top_artists', coalesce((
      select jsonb_agg(to_jsonb(ranked))
      from (
        select profile.id, profile.display_name,
          count(distinct song.id)::integer as songs,
          count(distinct follow.follower_id)::integer as followers
        from public.profiles profile
        left join public.songs song
          on song.user_id = profile.id and song.removed_at is null
        left join public.artist_follows follow on follow.artist_id = profile.id
        group by profile.id
        having count(distinct song.id) > 0
        order by count(distinct follow.follower_id) desc, count(distinct song.id) desc
        limit 5
      ) ranked
    ), '[]'::jsonb),
    'most_shared_songs', coalesce((
      select jsonb_agg(to_jsonb(ranked))
      from (
        select song.id, song.title, song.artist_name,
          count(share.id)::integer as total
        from public.songs song
        join public.song_shares share on share.song_id = song.id
        where song.removed_at is null
        group by song.id
        order by count(share.id) desc
        limit 5
      ) ranked
    ), '[]'::jsonb),
    'most_commented_songs', coalesce((
      select jsonb_agg(to_jsonb(ranked))
      from (
        select song.id, song.title, song.artist_name,
          count(comment.id)::integer as total
        from public.songs song
        join public.song_comments comment
          on comment.song_id = song.id and comment.removed_at is null
        where song.removed_at is null
        group by song.id
        order by count(comment.id) desc
        limit 5
      ) ranked
    ), '[]'::jsonb),
    'most_supported_artists', coalesce((
      select jsonb_agg(to_jsonb(ranked))
      from (
        select profile.id, profile.display_name,
          count(event.id)::integer as total
        from public.profiles profile
        join public.community_support_events event on event.artist_id = profile.id
        group by profile.id
        order by count(event.id) desc
        limit 5
      ) ranked
    ), '[]'::jsonb)
  )
  into result
  from public.platform_control_state state
  where state.id = true;

  return result;
end;
$$;

revoke all on function public.admin_get_control_center() from public;
grant execute on function public.admin_get_control_center() to authenticated;
