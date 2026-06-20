-- Owner Control economy sync
--
-- Keep Owner Control's published/draft economy display aligned with the
-- live reward engine stored in listening_reward_settings.

create or replace function public.owner_control_config_with_live_economy(
  target_config jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  settings public.listening_reward_settings%rowtype;
  next_config jsonb := coalesce(target_config, '{}'::jsonb);
begin
  select *
  into settings
  from public.listening_reward_settings
  where id = true;

  if not found then
    return next_config;
  end if;

  next_config := jsonb_set(
    next_config,
    '{tokens}',
    coalesce(next_config->'tokens', '{}'::jsonb),
    true
  );
  next_config := jsonb_set(
    next_config,
    '{tokens,emergency}',
    coalesce(next_config#>'{tokens,emergency}', '{}'::jsonb),
    true
  );
  next_config := jsonb_set(
    next_config,
    '{listeningBank}',
    coalesce(next_config->'listeningBank', '{}'::jsonb),
    true
  );
  next_config := jsonb_set(
    next_config,
    '{listeningBank,rewards}',
    coalesce(next_config#>'{listeningBank,rewards}', '{}'::jsonb),
    true
  );

  next_config := jsonb_set(
    next_config,
    '{tokens,minutesPerToken}',
    to_jsonb(settings.minutes_per_credit),
    true
  );
  next_config := jsonb_set(
    next_config,
    '{tokens,dailyListeningLimit}',
    to_jsonb(settings.daily_cap_minutes),
    true
  );
  next_config := jsonb_set(
    next_config,
    '{tokens,emergency,pauseTokenGeneration}',
    to_jsonb(not settings.enabled),
    true
  );
  next_config := jsonb_set(
    next_config,
    '{listeningBank,rewards,minutesPerToken}',
    to_jsonb(settings.minutes_per_credit),
    true
  );
  next_config := jsonb_set(
    next_config,
    '{listeningBank,rewards,dailyCapMinutes}',
    to_jsonb(settings.daily_cap_minutes),
    true
  );

  return next_config;
end;
$$;

create or replace function public.sync_owner_control_economy_state()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  with synced as (
    select
      id,
      public.owner_control_config_with_live_economy(published_config) as next_published_config,
      public.owner_control_config_with_live_economy(draft_config) as next_draft_config,
      public.owner_control_config_with_live_economy(stable_config) as next_stable_config
    from public.platform_control_state
    where id = true
  )
  update public.platform_control_state as state
  set
    published_config = synced.next_published_config,
    draft_config = synced.next_draft_config,
    stable_config = synced.next_stable_config,
    has_unpublished_changes =
      synced.next_draft_config is distinct from synced.next_published_config,
    updated_at = now()
  from synced
  where state.id = synced.id;
end;
$$;

create or replace function public.sync_owner_control_economy_state_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.sync_owner_control_economy_state();
  return new;
end;
$$;

drop trigger if exists sync_owner_control_economy_on_reward_settings
  on public.listening_reward_settings;

create trigger sync_owner_control_economy_on_reward_settings
after insert or update of minutes_per_credit, daily_cap_minutes, enabled
on public.listening_reward_settings
for each row
execute function public.sync_owner_control_economy_state_trigger();

select public.sync_owner_control_economy_state();

revoke all on function public.owner_control_config_with_live_economy(jsonb)
  from public, anon, authenticated;
revoke all on function public.sync_owner_control_economy_state()
  from public, anon, authenticated;
revoke all on function public.sync_owner_control_economy_state_trigger()
  from public, anon, authenticated;
