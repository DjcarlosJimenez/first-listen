-- Qualify the retained_at column so it cannot conflict with the RPC output name.

create or replace function public.retain_first_publish_trial(
  target_song_id uuid
)
returns table (
  retained_song_id uuid,
  retained_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  retained_time timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  update public.songs
  set
    first_publish_trial_claimed_at = coalesce(
      first_publish_trial_claimed_at,
      retained_time
    ),
    first_publish_trial_expires_at = null,
    is_active = true
  where id = target_song_id
    and user_id = auth.uid()
    and (
      first_publish_trial_expires_at is not null
      or first_publish_trial_claimed_at is not null
    );

  if not found then
    raise exception 'Publication not found for this account.';
  end if;

  update public.first_publish_trials as trials
  set
    status = 'retained',
    retained_at = coalesce(trials.retained_at, retained_time),
    publication_expires_at = null,
    updated_at = retained_time
  where trials.song_id = target_song_id
    and trials.user_id = auth.uid();

  return query select target_song_id, retained_time;
end;
$$;

revoke all on function public.retain_first_publish_trial(uuid)
  from public, anon, authenticated;
grant execute on function public.retain_first_publish_trial(uuid)
  to authenticated;

comment on function public.retain_first_publish_trial(uuid) is
  'Retains the authenticated artist first publication without an expiration.';
