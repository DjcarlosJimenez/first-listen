-- Discovery-first dashboard polish and Founder-only song cleanup helpers.
--
-- This migration is additive. It creates owner-scoped RPCs only; no song data
-- is removed unless the Founder explicitly calls owner_permanently_delete_song.

create or replace function public.owner_restore_archived_song(target_song_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_song public.songs%rowtype;
begin
  if public.current_user_role() <> 'super_admin' then
    raise exception 'Forbidden';
  end if;

  select *
  into target_song
  from public.songs
  where id = target_song_id
  for update;

  if not found then
    raise exception 'Song not found';
  end if;

  if target_song.archived_at is null then
    raise exception 'Only archived songs can be restored from this action';
  end if;

  if target_song.merged_into_song_id is not null then
    raise exception 'Merged songs cannot be restored';
  end if;

  update public.songs
  set
    is_active = true,
    featured = false,
    archived_at = null,
    archived_by = null,
    removed_at = null,
    removed_by = null,
    updated_at = now()
  where id = target_song_id;

  insert into public.admin_audit_log (
    actor_id,
    action,
    target_type,
    target_id,
    details
  )
  values (
    auth.uid(),
    'owner_restore_archived_song',
    'song',
    target_song_id,
    jsonb_build_object(
      'title', target_song.title,
      'artist_name', target_song.artist_name,
      'previous_archived_at', target_song.archived_at
    )
  );

  return jsonb_build_object(
    'song_id', target_song_id,
    'action', 'restored',
    'title', target_song.title
  );
end;
$$;

create or replace function public.owner_permanently_delete_song(
  target_song_id uuid,
  deletion_reason text default 'Owner cleanup'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_song public.songs%rowtype;
  activity jsonb;
  dependent record;
  deleted_rows integer := 0;
  dependent_rows integer := 0;
begin
  if public.current_user_role() <> 'super_admin' then
    raise exception 'Forbidden';
  end if;

  select *
  into target_song
  from public.songs
  where id = target_song_id
  for update;

  if not found then
    raise exception 'Song not found';
  end if;

  activity := public.song_activity_snapshot(target_song.id);

  insert into public.song_management_history (
    original_song_id,
    owner_id,
    action,
    title,
    artist_name,
    music_url,
    platform,
    submission_token_cost,
    refunded_tokens,
    merged_into_song_id,
    activity_snapshot,
    performed_by,
    reason
  )
  values (
    target_song.id,
    target_song.user_id,
    'deleted',
    target_song.title,
    target_song.artist_name,
    target_song.music_url,
    target_song.platform,
    greatest(0, target_song.submission_token_cost),
    0,
    target_song.merged_into_song_id,
    activity,
    auth.uid(),
    left(coalesce(nullif(trim(deletion_reason), ''), 'Owner cleanup'), 500)
  );

  insert into public.admin_audit_log (
    actor_id,
    action,
    target_type,
    target_id,
    details
  )
  values (
    auth.uid(),
    'owner_permanently_delete_song',
    'song',
    target_song.id,
    jsonb_build_object(
      'title', target_song.title,
      'artist_name', target_song.artist_name,
      'platform', target_song.platform,
      'activity_snapshot', activity,
      'reason', left(coalesce(nullif(trim(deletion_reason), ''), 'Owner cleanup'), 500)
    )
  );

  for dependent in
    select
      columns.table_schema,
      columns.table_name,
      columns.column_name
    from information_schema.columns
    join information_schema.tables
      on tables.table_schema = columns.table_schema
     and tables.table_name = columns.table_name
    where columns.table_schema = 'public'
      and tables.table_type = 'BASE TABLE'
      and columns.column_name in (
        'song_id',
        'target_song_id',
        'reviewed_song_id'
      )
      and columns.table_name not in (
        'songs',
        'song_management_history',
        'admin_audit_log'
      )
  loop
    execute format(
      'delete from %I.%I where %I = $1',
      dependent.table_schema,
      dependent.table_name,
      dependent.column_name
    )
    using target_song.id;
    get diagnostics deleted_rows = row_count;
    dependent_rows := dependent_rows + deleted_rows;
  end loop;

  update public.songs
  set merged_into_song_id = null
  where merged_into_song_id = target_song.id;

  delete from public.songs
  where id = target_song.id;

  return jsonb_build_object(
    'song_id', target_song.id,
    'action', 'permanently_deleted',
    'title', target_song.title,
    'dependent_rows_deleted', dependent_rows,
    'activity_snapshot', activity
  );
end;
$$;

revoke all on function public.owner_restore_archived_song(uuid)
  from public, anon, authenticated;
revoke all on function public.owner_permanently_delete_song(uuid, text)
  from public, anon, authenticated;

grant execute on function public.owner_restore_archived_song(uuid)
  to authenticated;
grant execute on function public.owner_permanently_delete_song(uuid, text)
  to authenticated;
