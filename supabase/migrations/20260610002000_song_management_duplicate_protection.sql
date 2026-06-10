-- Creator song lifecycle management, owner-scoped duplicate protection,
-- removed-content cleanup, and audited administrator duplicate tools.

alter table public.songs
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id),
  add column if not exists merged_into_song_id uuid references public.songs(id),
  add column if not exists merged_at timestamptz,
  add column if not exists merged_by uuid references public.profiles(id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'songs_cannot_merge_into_self'
      and conrelid = 'public.songs'::regclass
  ) then
    alter table public.songs
      add constraint songs_cannot_merge_into_self
      check (merged_into_song_id is null or merged_into_song_id <> id);
  end if;
end
$$;

drop index if exists public.songs_unique_music_url_idx;
create unique index if not exists songs_owner_platform_music_url_idx
  on public.songs (user_id, platform, lower(trim(music_url)));
create index if not exists songs_archived_owner_idx
  on public.songs (user_id, archived_at desc)
  where archived_at is not null;
create index if not exists songs_merged_into_idx
  on public.songs (merged_into_song_id)
  where merged_into_song_id is not null;

create table if not exists public.song_management_history (
  id uuid primary key default uuid_generate_v4(),
  original_song_id uuid not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  action text not null
    check (action in ('deleted', 'archived', 'removed', 'merged')),
  title text not null,
  artist_name text not null,
  music_url text not null,
  platform public.music_platform not null,
  submission_token_cost smallint not null default 0
    check (submission_token_cost >= 0),
  refunded_tokens smallint not null default 0
    check (refunded_tokens >= 0),
  merged_into_song_id uuid,
  activity_snapshot jsonb not null default '{}'::jsonb,
  performed_by uuid references public.profiles(id) on delete set null,
  reason text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists song_management_history_owner_idx
  on public.song_management_history (owner_id, created_at desc);
create index if not exists song_management_history_original_song_idx
  on public.song_management_history (original_song_id, created_at desc);

alter table public.song_management_history enable row level security;
revoke all on table public.song_management_history
  from public, anon, authenticated;
grant select on table public.song_management_history to authenticated;

drop policy if exists "owners read song management history"
  on public.song_management_history;
create policy "owners read song management history"
  on public.song_management_history for select
  to authenticated
  using (
    owner_id = auth.uid()
    or public.current_user_role() in ('super_admin', 'admin', 'moderator')
  );

create or replace function public.normalize_song_title(input text)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select trim(
    regexp_replace(
      lower(coalesce(input, '')),
      '[^[:alnum:]]+',
      ' ',
      'g'
    )
  );
$$;

create or replace function public.song_title_similarity(
  left_title text,
  right_title text
)
returns numeric
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  left_normalized text := public.normalize_song_title(left_title);
  right_normalized text := public.normalize_song_title(right_title);
  left_words text[];
  right_words text[];
  overlap_count integer := 0;
  left_count integer := 0;
  right_count integer := 0;
  overlap_score numeric := 0;
  containment_score numeric := 0;
begin
  if left_normalized = '' or right_normalized = '' then return 0; end if;
  if left_normalized = right_normalized then return 1; end if;

  select coalesce(array_agg(distinct word order by word), array[]::text[])
  into left_words
  from unnest(regexp_split_to_array(left_normalized, '\s+')) as word
  where char_length(word) > 1;

  select coalesce(array_agg(distinct word order by word), array[]::text[])
  into right_words
  from unnest(regexp_split_to_array(right_normalized, '\s+')) as word
  where char_length(word) > 1;

  left_count := cardinality(left_words);
  right_count := cardinality(right_words);

  if left_count > 0 and right_count > 0 then
    select count(*)::integer
    into overlap_count
    from unnest(left_words) as word
    where word = any(right_words);

    overlap_score :=
      (2.0 * overlap_count) / greatest(1, left_count + right_count);
  end if;

  if char_length(left_normalized) >= 5
    and char_length(right_normalized) >= 5
    and (
      left_normalized like '%' || right_normalized || '%'
      or right_normalized like '%' || left_normalized || '%'
    )
  then
    containment_score :=
      least(char_length(left_normalized), char_length(right_normalized))::numeric
      / greatest(char_length(left_normalized), char_length(right_normalized));
  end if;

  return round(greatest(overlap_score, containment_score), 4);
end;
$$;

create or replace function public.song_activity_snapshot(target_song_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'reviews', (
      select count(*)::integer
      from public.reviews
      where reviews.song_id = target_song_id
    ),
    'valid_listens', (
      select count(*)::integer
      from public.listening_sessions
      where listening_sessions.song_id = target_song_id
        and listening_sessions.valid_listen_at is not null
    ),
    'guest_valid_listens', (
      select count(*)::integer
      from public.guest_listening_sessions
      where guest_listening_sessions.song_id = target_song_id
        and guest_listening_sessions.valid_listen_at is not null
    ),
    'community_events', (
      select count(*)::integer
      from public.community_support_events
      where community_support_events.song_id = target_song_id
    ),
    'followers', (
      select count(*)::integer
      from public.community_support_events
      where community_support_events.song_id = target_song_id
        and community_support_events.event_type = 'follow'
    ),
    'saves', (
      select count(*)::integer
      from public.saved_songs
      where saved_songs.song_id = target_song_id
    ),
    'reports', (
      select count(*)::integer
      from public.song_reports
      where song_reports.song_id = target_song_id
    ),
    'boosts', (
      select count(*)::integer
      from public.song_boosts
      where song_boosts.song_id = target_song_id
    ),
    'contest_entries', (
      select count(*)::integer
      from public.contest_entries
      where contest_entries.song_id = target_song_id
    ),
    'spotlight_placements', (
      select count(*)::integer
      from public.spotlight_slots
      where spotlight_slots.song_id = target_song_id
    )
  );
$$;

create or replace function public.song_activity_total(activity jsonb)
returns integer
language sql
immutable
set search_path = pg_catalog, public
as $$
  select
    coalesce((activity ->> 'reviews')::integer, 0)
    + coalesce((activity ->> 'valid_listens')::integer, 0)
    + coalesce((activity ->> 'guest_valid_listens')::integer, 0)
    + coalesce((activity ->> 'community_events')::integer, 0)
    + coalesce((activity ->> 'saves')::integer, 0)
    + coalesce((activity ->> 'reports')::integer, 0)
    + coalesce((activity ->> 'boosts')::integer, 0)
    + coalesce((activity ->> 'contest_entries')::integer, 0)
    + coalesce((activity ->> 'spotlight_placements')::integer, 0);
$$;

create or replace function public.check_song_submission_duplicates(
  song_title text,
  song_platform public.music_platform,
  song_music_url text
)
returns table (
  song_id uuid,
  existing_title text,
  existing_music_url text,
  existing_platform public.music_platform,
  catalog_status text,
  exact_match boolean,
  similarity_score numeric,
  submitted_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    songs.id,
    songs.title,
    songs.music_url,
    songs.platform,
    case
      when songs.removed_at is not null then 'removed'
      when songs.merged_into_song_id is not null then 'merged'
      when songs.archived_at is not null then 'archived'
      when songs.is_active then 'active'
      else songs.approval_status
    end,
    lower(trim(songs.music_url)) = lower(trim(song_music_url)),
    public.song_title_similarity(songs.title, song_title),
    songs.created_at
  from public.songs
  where songs.user_id = auth.uid()
    and songs.platform = song_platform
    and (
      lower(trim(songs.music_url)) = lower(trim(song_music_url))
      or (
        songs.removed_at is null
        and songs.merged_into_song_id is null
        and public.song_title_similarity(songs.title, song_title) >= 0.72
      )
    )
  order by
    (lower(trim(songs.music_url)) = lower(trim(song_music_url))) desc,
    public.song_title_similarity(songs.title, song_title) desc,
    songs.created_at desc
  limit 5;
$$;

create or replace function public.get_my_song_management()
returns table (
  song_id uuid,
  title text,
  artist_name text,
  music_url text,
  platform public.music_platform,
  explicit_content boolean,
  is_active boolean,
  catalog_status text,
  submission_token_cost integer,
  reviews integer,
  valid_listens integer,
  guest_valid_listens integer,
  community_activity integer,
  can_delete boolean,
  can_archive boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    songs.id,
    songs.title,
    songs.artist_name,
    songs.music_url,
    songs.platform,
    songs.explicit_content,
    songs.is_active,
    case
      when songs.merged_into_song_id is not null then 'merged'
      when songs.archived_at is not null then 'archived'
      when songs.is_active then 'active'
      else songs.approval_status
    end,
    songs.submission_token_cost::integer,
    coalesce((activity.snapshot ->> 'reviews')::integer, 0),
    coalesce((activity.snapshot ->> 'valid_listens')::integer, 0),
    coalesce((activity.snapshot ->> 'guest_valid_listens')::integer, 0),
    public.song_activity_total(activity.snapshot)
      - coalesce((activity.snapshot ->> 'reviews')::integer, 0)
      - coalesce((activity.snapshot ->> 'valid_listens')::integer, 0)
      - coalesce((activity.snapshot ->> 'guest_valid_listens')::integer, 0),
    public.song_activity_total(activity.snapshot) = 0
      and songs.archived_at is null
      and songs.merged_into_song_id is null,
    public.song_activity_total(activity.snapshot) > 0
      and songs.archived_at is null
      and songs.merged_into_song_id is null,
    songs.created_at
  from public.songs
  cross join lateral (
    select public.song_activity_snapshot(songs.id) as snapshot
  ) activity
  where songs.user_id = auth.uid()
    and songs.removed_at is null
    and public.is_active_user()
  order by songs.created_at desc;
$$;

create or replace function public.get_my_removed_song_history()
returns table (
  history_id uuid,
  original_song_id uuid,
  title text,
  artist_name text,
  music_url text,
  platform public.music_platform,
  action text,
  refunded_tokens integer,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select history_rows.*
  from (
    select
      songs.id as history_id,
      songs.id as original_song_id,
      songs.title,
      songs.artist_name,
      songs.music_url,
      songs.platform,
      'removed'::text as action,
      0 as refunded_tokens,
      songs.removed_at as created_at
    from public.songs
    where songs.user_id = auth.uid()
      and songs.removed_at is not null

    union all

    select
      history.id,
      history.original_song_id,
      history.title,
      history.artist_name,
      history.music_url,
      history.platform,
      history.action,
      history.refunded_tokens::integer,
      history.created_at
    from public.song_management_history as history
    where history.owner_id = auth.uid()
      and history.action in ('deleted', 'merged')
  ) as history_rows
  order by history_rows.created_at desc;
$$;

create or replace function public.delete_my_song(target_song_id uuid)
returns table (
  action text,
  refunded_tokens integer,
  new_credit_balance integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_song public.songs%rowtype;
  activity jsonb;
  refund_amount integer;
  balance integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select *
  into target_song
  from public.songs
  where id = target_song_id
    and user_id = auth.uid()
    and removed_at is null
    and archived_at is null
    and merged_into_song_id is null
  for update;
  if not found then raise exception 'Song is unavailable'; end if;

  activity := public.song_activity_snapshot(target_song.id);
  if public.song_activity_total(activity) > 0 then
    raise exception 'This song has activity and must be archived instead';
  end if;

  refund_amount := greatest(0, target_song.submission_token_cost);

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
    target_song.submission_token_cost,
    refund_amount,
    activity,
    auth.uid(),
    'Creator deleted an untouched song'
  );

  if refund_amount > 0 then
    update public.profiles
    set credits = credits + refund_amount, updated_at = now()
    where id = target_song.user_id
    returning credits into balance;

    insert into public.credit_transactions (
      user_id,
      amount,
      reason,
      created_by
    )
    values (
      target_song.user_id,
      refund_amount,
      'Song deletion refund: ' || target_song.title,
      auth.uid()
    );
  else
    select credits into balance
    from public.profiles
    where id = target_song.user_id;
  end if;

  delete from public.songs where id = target_song.id;

  return query select 'deleted'::text, refund_amount, balance;
end;
$$;

create or replace function public.archive_my_song(target_song_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_song public.songs%rowtype;
  activity jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select *
  into target_song
  from public.songs
  where id = target_song_id
    and user_id = auth.uid()
    and removed_at is null
    and archived_at is null
    and merged_into_song_id is null
  for update;
  if not found then raise exception 'Song is unavailable'; end if;

  activity := public.song_activity_snapshot(target_song.id);
  if public.song_activity_total(activity) = 0 then
    raise exception 'This untouched song can be deleted instead';
  end if;

  update public.songs
  set
    is_active = false,
    featured = false,
    archived_at = now(),
    archived_by = auth.uid(),
    updated_at = now()
  where id = target_song.id;

  insert into public.song_management_history (
    original_song_id,
    owner_id,
    action,
    title,
    artist_name,
    music_url,
    platform,
    submission_token_cost,
    activity_snapshot,
    performed_by,
    reason
  )
  values (
    target_song.id,
    target_song.user_id,
    'archived',
    target_song.title,
    target_song.artist_name,
    target_song.music_url,
    target_song.platform,
    target_song.submission_token_cost,
    activity,
    auth.uid(),
    'Creator archived a song with activity'
  );

  return 'archived';
end;
$$;

create or replace function public.admin_get_duplicate_song_candidates()
returns table (
  canonical_song_id uuid,
  canonical_title text,
  canonical_owner_id uuid,
  canonical_owner_name text,
  duplicate_song_id uuid,
  duplicate_title text,
  duplicate_owner_id uuid,
  duplicate_owner_name text,
  platform public.music_platform,
  match_type text,
  similarity_score numeric,
  same_owner boolean,
  duplicate_activity integer,
  duplicate_can_delete boolean,
  duplicate_status text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with pairs as (
    select
      left_song.id as left_id,
      left_song.title as left_title,
      left_song.user_id as left_owner,
      left_song.created_at as left_created_at,
      right_song.id as right_id,
      right_song.title as right_title,
      right_song.user_id as right_owner,
      right_song.created_at as right_created_at,
      left_song.platform,
      lower(trim(left_song.music_url)) =
        lower(trim(right_song.music_url)) as exact_url,
      public.song_title_similarity(
        left_song.title,
        right_song.title
      ) as title_score
    from public.songs as left_song
    join public.songs as right_song
      on left_song.id < right_song.id
      and left_song.platform = right_song.platform
    where left_song.removed_at is null
      and right_song.removed_at is null
      and left_song.merged_into_song_id is null
      and right_song.merged_into_song_id is null
      and (
        lower(trim(left_song.music_url)) = lower(trim(right_song.music_url))
        or public.song_title_similarity(
          left_song.title,
          right_song.title
        ) >= 0.72
      )
  ),
  scored as (
    select
      pairs.*,
      public.song_activity_total(
        public.song_activity_snapshot(pairs.left_id)
      ) as left_activity,
      public.song_activity_total(
        public.song_activity_snapshot(pairs.right_id)
      ) as right_activity
    from pairs
  ),
  ordered as (
    select
      case
        when left_activity > right_activity then left_id
        when right_activity > left_activity then right_id
        when left_created_at <= right_created_at then left_id
        else right_id
      end as canonical_id,
      case
        when left_activity > right_activity then right_id
        when right_activity > left_activity then left_id
        when left_created_at <= right_created_at then right_id
        else left_id
      end as duplicate_id,
      platform,
      exact_url,
      title_score
    from scored
  )
  select
    canonical.id,
    canonical.title,
    canonical.user_id,
    canonical_owner.display_name,
    duplicate.id,
    duplicate.title,
    duplicate.user_id,
    duplicate_owner.display_name,
    ordered.platform,
    case when ordered.exact_url then 'exact_url' else 'similar_title' end,
    ordered.title_score,
    canonical.user_id = duplicate.user_id,
    public.song_activity_total(duplicate_activity.snapshot),
    public.song_activity_total(duplicate_activity.snapshot) = 0
      and (
        ordered.exact_url
        or (
          canonical.user_id = duplicate.user_id
          and public.normalize_song_title(canonical.title) =
            public.normalize_song_title(duplicate.title)
        )
      ),
    case
      when duplicate.archived_at is not null then 'archived'
      when duplicate.is_active then 'active'
      else duplicate.approval_status
    end
  from ordered
  join public.songs as canonical on canonical.id = ordered.canonical_id
  join public.profiles as canonical_owner
    on canonical_owner.id = canonical.user_id
  join public.songs as duplicate on duplicate.id = ordered.duplicate_id
  join public.profiles as duplicate_owner
    on duplicate_owner.id = duplicate.user_id
  cross join lateral (
    select public.song_activity_snapshot(duplicate.id) as snapshot
  ) duplicate_activity
  where public.current_user_role() in ('super_admin', 'admin')
  order by ordered.exact_url desc, ordered.title_score desc,
    duplicate.created_at desc;
$$;

create or replace function public.admin_get_duplicate_statistics()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when public.current_user_role() not in ('super_admin', 'admin')
      then jsonb_build_object('forbidden', true)
    else jsonb_build_object(
      'exact_url_pairs', (
        select count(*)::integer
        from public.admin_get_duplicate_song_candidates()
        where match_type = 'exact_url'
      ),
      'possible_title_pairs', (
        select count(*)::integer
        from public.admin_get_duplicate_song_candidates()
        where match_type = 'similar_title'
      ),
      'abandoned_duplicates', (
        select count(*)::integer
        from public.admin_get_duplicate_song_candidates()
        where duplicate_can_delete
      ),
      'archived_songs', (
        select count(*)::integer
        from public.songs
        where archived_at is not null
      ),
      'removed_songs', (
        select count(*)::integer
        from public.songs
        where removed_at is not null
      ),
      'merged_songs', (
        select count(*)::integer
        from public.songs
        where merged_into_song_id is not null
      )
    )
  end;
$$;

create or replace function public.admin_merge_duplicate_songs(
  canonical_song_id uuid,
  duplicate_song_id uuid
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  canonical public.songs%rowtype;
  duplicate public.songs%rowtype;
  activity jsonb;
begin
  if public.current_user_role() not in ('super_admin', 'admin') then
    raise exception 'Forbidden';
  end if;
  if canonical_song_id = duplicate_song_id then
    raise exception 'Choose two different songs';
  end if;

  select * into canonical
  from public.songs
  where id = canonical_song_id
    and removed_at is null
    and archived_at is null
    and merged_into_song_id is null
  for update;
  if not found then raise exception 'Canonical song is unavailable'; end if;

  select * into duplicate
  from public.songs
  where id = duplicate_song_id
    and removed_at is null
    and merged_into_song_id is null
  for update;
  if not found then raise exception 'Duplicate song is unavailable'; end if;

  if canonical.user_id <> duplicate.user_id then
    raise exception 'Only songs from the same creator can be merged';
  end if;
  if canonical.platform <> duplicate.platform then
    raise exception 'Songs from different platforms cannot be merged';
  end if;
  if lower(trim(canonical.music_url)) <> lower(trim(duplicate.music_url))
    and public.song_title_similarity(canonical.title, duplicate.title) < 0.72
  then
    raise exception 'Songs do not meet duplicate matching requirements';
  end if;

  activity := public.song_activity_snapshot(duplicate.id);

  update public.songs
  set
    is_active = false,
    featured = false,
    archived_at = coalesce(archived_at, now()),
    archived_by = auth.uid(),
    merged_into_song_id = canonical.id,
    merged_at = now(),
    merged_by = auth.uid(),
    updated_at = now()
  where id = duplicate.id;

  insert into public.song_management_history (
    original_song_id,
    owner_id,
    action,
    title,
    artist_name,
    music_url,
    platform,
    submission_token_cost,
    merged_into_song_id,
    activity_snapshot,
    performed_by,
    reason
  )
  values (
    duplicate.id,
    duplicate.user_id,
    'merged',
    duplicate.title,
    duplicate.artist_name,
    duplicate.music_url,
    duplicate.platform,
    duplicate.submission_token_cost,
    canonical.id,
    activity,
    auth.uid(),
    'Administrator merged a duplicate catalog record'
  );

  insert into public.admin_audit_log (
    actor_id, action, target_type, target_id, details
  )
  values (
    auth.uid(),
    'merge_duplicate_song',
    'song',
    duplicate.id,
    jsonb_build_object(
      'canonical_song_id', canonical.id,
      'activity', activity
    )
  );

  return 'merged';
end;
$$;

create or replace function public.admin_delete_abandoned_duplicate(
  target_song_id uuid,
  matching_song_id uuid
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_song public.songs%rowtype;
  matching_song public.songs%rowtype;
  activity jsonb;
  refund_amount integer;
begin
  if public.current_user_role() not in ('super_admin', 'admin') then
    raise exception 'Forbidden';
  end if;
  if target_song_id = matching_song_id then
    raise exception 'Choose two different songs';
  end if;

  select * into target_song
  from public.songs
  where id = target_song_id
    and removed_at is null
    and merged_into_song_id is null
  for update;
  if not found then raise exception 'Duplicate song is unavailable'; end if;

  select * into matching_song
  from public.songs
  where id = matching_song_id
    and removed_at is null
    and merged_into_song_id is null;
  if not found then raise exception 'Matching song is unavailable'; end if;

  if target_song.platform <> matching_song.platform
    or not (
      lower(trim(target_song.music_url)) =
        lower(trim(matching_song.music_url))
      or (
        target_song.user_id = matching_song.user_id
        and public.normalize_song_title(target_song.title) =
          public.normalize_song_title(matching_song.title)
      )
    )
  then
    raise exception 'Only confirmed abandoned duplicates can be deleted';
  end if;

  activity := public.song_activity_snapshot(target_song.id);
  if public.song_activity_total(activity) > 0 then
    raise exception 'Duplicate has activity and cannot be deleted';
  end if;

  refund_amount := greatest(0, target_song.submission_token_cost);

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
    target_song.submission_token_cost,
    refund_amount,
    matching_song.id,
    activity,
    auth.uid(),
    'Administrator deleted an abandoned duplicate'
  );

  if refund_amount > 0 then
    update public.profiles
    set credits = credits + refund_amount, updated_at = now()
    where id = target_song.user_id;

    insert into public.credit_transactions (
      user_id, amount, reason, created_by
    )
    values (
      target_song.user_id,
      refund_amount,
      'Abandoned duplicate refund: ' || target_song.title,
      auth.uid()
    );
  end if;

  insert into public.admin_audit_log (
    actor_id, action, target_type, target_id, details
  )
  values (
    auth.uid(),
    'delete_abandoned_duplicate',
    'song',
    target_song.id,
    jsonb_build_object(
      'matching_song_id', matching_song.id,
      'refunded_tokens', refund_amount
    )
  );

  delete from public.songs where id = target_song.id;
  return refund_amount;
end;
$$;

create or replace function public.admin_set_song_state(
  target_song_id uuid,
  active boolean,
  feature boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_song public.songs%rowtype;
begin
  if public.current_user_role() not in (
    'super_admin', 'admin', 'moderator'
  ) then
    raise exception 'Forbidden';
  end if;
  if public.current_user_role() = 'moderator' and feature then
    raise exception 'Moderators cannot feature songs';
  end if;

  select * into target_song
  from public.songs
  where id = target_song_id
  for update;
  if not found then raise exception 'Song not found'; end if;
  if target_song.merged_into_song_id is not null then
    raise exception 'Merged songs cannot be restored';
  end if;

  update public.songs
  set
    is_active = active,
    featured = feature and active,
    removed_at = case when active then null else now() end,
    removed_by = case when active then null else auth.uid() end,
    archived_at = case when active then null else archived_at end,
    archived_by = case when active then null else archived_by end,
    updated_at = now()
  where id = target_song_id;

  insert into public.admin_audit_log (
    actor_id, action, target_type, target_id, details
  )
  values (
    auth.uid(),
    case when active then 'restore_song' else 'remove_song' end,
    'song',
    target_song_id,
    jsonb_build_object('feature', feature and active)
  );
end;
$$;

create or replace function public.submit_song(
  song_title text,
  song_artist_name text,
  song_cover_image_url text,
  song_music_url text,
  song_platform public.music_platform,
  song_genre text,
  song_language text,
  song_feedback_focus text[],
  song_country text,
  song_explicit_content boolean default false,
  song_content_kind text default 'song',
  song_duration_seconds integer default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  new_song_id uuid;
  submitter_role public.app_role;
  founder_remaining smallint;
  used_founder_submission boolean := false;
  charged_token_cost integer := 0;
  quoted_token_cost integer;
  next_queue_tier text := 'public';
  next_approval_status text := 'auto_approved';
  next_active boolean := true;
  normalized_cover text;
  next_classification text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select role, founder_free_submissions_remaining
  into submitter_role, founder_remaining
  from public.profiles
  where id = auth.uid()
    and account_status = 'active'
    and banned_at is null
  for update;
  if not found then raise exception 'Active account required'; end if;

  normalized_cover := coalesce(
    nullif(trim(song_cover_image_url), ''),
    'https://www.firstlisten.net/covers/default-song.svg'
  );

  if char_length(trim(song_title)) not between 1 and 120
    or char_length(trim(song_artist_name)) not between 1 and 120
    or char_length(trim(song_country)) not between 2 and 120
    or normalized_cover !~* '^https://'
    or char_length(normalized_cover) > 2000
    or char_length(trim(song_music_url)) > 2000
  then
    raise exception 'Required song metadata is invalid';
  end if;

  if song_genre not in (
    'Pop', 'Rock', 'Hip Hop', 'EDM', 'Country', 'Reggaeton',
    'Regional Mexican', 'Cumbia', 'Salsa', 'Bachata', 'Indie',
    'Alternative', 'Jazz', 'Classical', 'Instrumental', 'Other'
  ) then
    raise exception 'Unsupported genre';
  end if;

  if song_content_kind not in (
    'song', 'music_video', 'remix', 'live_session',
    'performance', 'long_form'
  ) then
    raise exception 'Unsupported content type';
  end if;

  if song_duration_seconds is not null
    and song_duration_seconds not between 15 and 43200
  then
    raise exception 'Content duration is invalid';
  end if;

  if not public.music_url_matches_platform(
    song_music_url,
    song_platform
  ) then
    raise exception 'Unsupported or invalid music link';
  end if;

  if exists (
    select 1
    from public.songs
    where user_id = auth.uid()
      and platform = song_platform
      and lower(trim(music_url)) = lower(trim(song_music_url))
  ) then
    raise exception 'Song already submitted.';
  end if;

  if coalesce(song_duration_seconds, 0) > 480
    or song_content_kind = 'long_form'
  then
    next_queue_tier := 'manual_review';
    next_approval_status := 'pending';
    next_active := false;
  end if;

  next_classification :=
    public.content_classification_for_platform(song_platform);
  quoted_token_cost :=
    public.current_submission_token_cost(song_platform);

  if submitter_role <> 'super_admin' then
    if founder_remaining > 0 then
      update public.profiles
      set
        founder_free_submissions_remaining =
          founder_free_submissions_remaining - 1,
        founder_free_submission_available =
          founder_free_submissions_remaining - 1 > 0,
        updated_at = now()
      where id = auth.uid();
      used_founder_submission := true;
    else
      update public.profiles
      set credits = credits - quoted_token_cost, updated_at = now()
      where id = auth.uid() and credits >= quoted_token_cost;
      if not found then
        raise exception '% tokens are required', quoted_token_cost;
      end if;
      charged_token_cost := quoted_token_cost;

      insert into public.credit_transactions (user_id, amount, reason)
      values (
        auth.uid(),
        -quoted_token_cost,
        format(
          '%s content submission: %s',
          initcap(next_classification),
          song_platform
        )
      );
    end if;
  end if;

  begin
    insert into public.songs (
      user_id,
      title,
      artist_name,
      cover_image_url,
      music_url,
      platform,
      genre,
      song_language,
      feedback_focus,
      country,
      explicit_content,
      submitted_with_founder_credit,
      is_active,
      media_vertical,
      content_kind,
      content_duration_seconds,
      queue_tier,
      approval_status,
      content_classification,
      submission_token_cost
    )
    values (
      auth.uid(),
      trim(song_title),
      trim(song_artist_name),
      normalized_cover,
      trim(song_music_url),
      song_platform,
      song_genre,
      song_language,
      song_feedback_focus,
      trim(song_country),
      song_explicit_content,
      used_founder_submission,
      next_active,
      'music',
      song_content_kind,
      song_duration_seconds,
      next_queue_tier,
      next_approval_status,
      next_classification,
      charged_token_cost
    )
    returning id into new_song_id;
  exception
    when unique_violation then
      raise exception 'Song already submitted.';
  end;

  return new_song_id;
end;
$$;

create or replace function public.get_my_song_dashboard_v2()
returns table (
  song_id uuid,
  artist_id uuid,
  title text,
  artist_name text,
  cover_image_url text,
  music_url text,
  platform public.music_platform,
  genre text,
  song_language text,
  submitted_at timestamptz,
  reviews_received integer,
  average_rating numeric,
  hook_score integer,
  report_count integer,
  total_listening_seconds bigint,
  average_listening_seconds numeric,
  completion_rate numeric,
  playlist_intent numeric,
  share_intent numeric,
  listener_retention numeric,
  boost_status text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    songs.id,
    songs.user_id,
    songs.title,
    songs.artist_name,
    songs.cover_image_url,
    songs.music_url,
    songs.platform,
    songs.genre,
    songs.song_language,
    songs.created_at,
    coalesce(review_metrics.reviews_received, 0),
    coalesce(review_metrics.average_rating, 0),
    coalesce(review_metrics.hook_score, 0),
    coalesce(report_counts.report_count, 0),
    coalesce(listening_metrics.total_listening_seconds, 0),
    coalesce(listening_metrics.average_listening_seconds, 0),
    coalesce(listening_metrics.completion_rate, 0),
    coalesce(review_metrics.playlist_intent, 0),
    coalesce(review_metrics.share_intent, 0),
    coalesce(listening_metrics.listener_retention, 0),
    boost_state.status::text
  from public.songs
  left join lateral (
    select
      count(*)::integer as reviews_received,
      round(avg(reviews.rating)::numeric, 2) as average_rating,
      round((
        avg(case when reviews.listen_full then 100 else 0 end)
        + avg(case when reviews.add_to_playlist then 100 else 0 end)
        + avg(case when reviews.grabbed_attention then 100 else 0 end)
        + avg(case when reviews.share_with_friend then 100 else 0 end)
      ) / 4, 0)::integer as hook_score,
      round(
        avg(case when reviews.add_to_playlist then 100 else 0 end)::numeric,
        2
      ) as playlist_intent,
      round(
        avg(case when reviews.share_with_friend then 100 else 0 end)::numeric,
        2
      ) as share_intent
    from public.reviews
    where reviews.song_id = songs.id
      and reviews.quality_passed
  ) review_metrics on true
  left join lateral (
    select
      coalesce(sum(listening_sessions.settled_seconds), 0)::bigint
        as total_listening_seconds,
      round(
        avg(listening_sessions.settled_seconds)
          filter (where listening_sessions.settled_seconds > 0),
        2
      ) as average_listening_seconds,
      round(
        avg(
          case
            when listening_sessions.provider_duration_seconds > 0
              and listening_sessions.max_position_seconds
                / listening_sessions.provider_duration_seconds >= 0.9
            then 100
            else 0
          end
        ) filter (
          where listening_sessions.provider_duration_seconds > 0
        ),
        2
      ) as completion_rate,
      round(
        avg(
          least(
            100,
            listening_sessions.max_position_seconds
              / nullif(
                listening_sessions.provider_duration_seconds,
                0
              ) * 100
          )
        ) filter (
          where listening_sessions.provider_duration_seconds > 0
        ),
        2
      ) as listener_retention
    from public.listening_sessions
    where listening_sessions.song_id = songs.id
      and listening_sessions.settled_seconds > 0
  ) listening_metrics on true
  left join lateral (
    select count(*)::integer as report_count
    from public.song_reports
    where song_reports.song_id = songs.id
  ) report_counts on true
  left join lateral (
    select song_boosts.status
    from public.song_boosts
    where song_boosts.song_id = songs.id
      and song_boosts.status in ('pending', 'approved')
    order by song_boosts.requested_at desc
    limit 1
  ) boost_state on true
  where songs.user_id = auth.uid()
    and songs.removed_at is null
    and public.is_active_user()
  order by songs.created_at desc;
$$;

create or replace function public.get_my_song_comments(
  target_song_id uuid default null
)
returns table (
  review_id uuid,
  reviewer_id uuid,
  song_id uuid,
  song_title text,
  rating smallint,
  comment text,
  quality_score smallint,
  helpful boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    reviews.id,
    reviews.reviewer_id,
    songs.id,
    songs.title,
    reviews.rating,
    reviews.comment,
    reviews.quality_score,
    reviews.helpful_at is not null,
    reviews.created_at
  from public.reviews
  join public.songs on songs.id = reviews.song_id
  where songs.user_id = auth.uid()
    and songs.removed_at is null
    and public.is_active_user()
    and (target_song_id is null or songs.id = target_song_id)
    and reviews.comment_removed_at is null
    and nullif(trim(reviews.comment), '') is not null
  order by reviews.created_at desc;
$$;

create or replace function public.get_public_artist_profile(
  target_artist_id uuid
)
returns table (
  artist_id uuid,
  artist_name text,
  followers integer,
  songs_submitted integer,
  genres text[],
  languages text[],
  is_following boolean,
  average_rating numeric,
  listening_hours_received numeric,
  valid_listens_received integer,
  complete_listens_received integer,
  community_rank text,
  activity_status public.creator_activity_status
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    profiles.id,
    profiles.display_name,
    coalesce(follower_counts.followers, 0)::integer,
    coalesce(song_counts.songs_submitted, 0)::integer,
    coalesce(song_counts.genres, array[]::text[]),
    coalesce(song_counts.languages, array[]::text[]),
    exists (
      select 1
      from public.artist_follows as follows
      where follows.follower_id = auth.uid()
        and follows.artist_id = profiles.id
    ),
    coalesce(artist_metrics.average_rating, 0),
    round(coalesce(artist_metrics.listening_seconds, 0)::numeric / 3600, 2),
    coalesce(artist_metrics.valid_listens_received, 0)::integer,
    coalesce(artist_metrics.complete_listens_received, 0)::integer,
    public.community_rank_name(profiles.community_points),
    case
      when coalesce(profiles.last_contribution_at, profiles.created_at)
        <= now() - interval '60 days'
        then 'archived'::public.creator_activity_status
      when coalesce(profiles.last_contribution_at, profiles.created_at)
        <= now() - interval '14 days'
        then 'paused'::public.creator_activity_status
      else 'active'::public.creator_activity_status
    end
  from public.profiles
  left join lateral (
    select count(*)::integer as followers
    from public.artist_follows as follows
    where follows.artist_id = profiles.id
  ) follower_counts on true
  left join lateral (
    select
      count(*)::integer as songs_submitted,
      array_remove(array_agg(distinct songs.genre), null) as genres,
      array_remove(
        array_agg(distinct songs.song_language),
        null
      ) as languages
    from public.songs
    where songs.user_id = profiles.id
      and songs.is_active
      and songs.removed_at is null
      and songs.archived_at is null
      and songs.merged_into_song_id is null
  ) song_counts on true
  left join lateral (
    select
      (
        select round(avg(reviews.rating)::numeric, 2)
        from public.reviews
        join public.songs on songs.id = reviews.song_id
        where songs.user_id = profiles.id
          and songs.removed_at is null
          and reviews.quality_passed
      ) as average_rating,
      (
        coalesce((
          select sum(listens.settled_seconds)
          from public.listening_sessions as listens
          join public.songs on songs.id = listens.song_id
          where songs.user_id = profiles.id
            and songs.removed_at is null
            and listens.reward_eligible
        ), 0)
        + coalesce((
          select sum(guest_listens.verified_seconds)
          from public.guest_listening_sessions as guest_listens
          join public.songs on songs.id = guest_listens.song_id
          where songs.user_id = profiles.id
            and songs.removed_at is null
        ), 0)
      )::bigint as listening_seconds,
      (
        (
          select count(*)
          from public.listening_sessions as listens
          join public.songs on songs.id = listens.song_id
          where songs.user_id = profiles.id
            and songs.removed_at is null
            and listens.reward_eligible
            and listens.valid_listen_at is not null
        )
        + (
          select count(*)
          from public.guest_listening_sessions as guest_listens
          join public.songs on songs.id = guest_listens.song_id
          where songs.user_id = profiles.id
            and songs.removed_at is null
            and guest_listens.valid_listen_at is not null
        )
      )::integer as valid_listens_received,
      (
        (
          select count(*)
          from public.listening_sessions as listens
          join public.songs on songs.id = listens.song_id
          where songs.user_id = profiles.id
            and songs.removed_at is null
            and listens.reward_eligible
            and listens.complete_listen_at is not null
        )
        + (
          select count(*)
          from public.guest_listening_sessions as guest_listens
          join public.songs on songs.id = guest_listens.song_id
          where songs.user_id = profiles.id
            and songs.removed_at is null
            and guest_listens.complete_listen_at is not null
        )
      )::integer as complete_listens_received
  ) artist_metrics on true
  where profiles.id = target_artist_id
    and profiles.account_status = 'active'
    and profiles.banned_at is null;
$$;

create or replace function public.song_management_health_report()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'tables', jsonb_build_object(
      'song_management_history',
        to_regclass('public.song_management_history') is not null
    ),
    'functions', jsonb_build_object(
      'check_song_submission_duplicates',
        to_regprocedure(
          'public.check_song_submission_duplicates(text,public.music_platform,text)'
        ) is not null,
      'get_my_song_management',
        to_regprocedure('public.get_my_song_management()') is not null,
      'delete_my_song',
        to_regprocedure('public.delete_my_song(uuid)') is not null,
      'archive_my_song',
        to_regprocedure('public.archive_my_song(uuid)') is not null,
      'admin_get_duplicate_song_candidates',
        to_regprocedure(
          'public.admin_get_duplicate_song_candidates()'
        ) is not null,
      'admin_merge_duplicate_songs',
        to_regprocedure(
          'public.admin_merge_duplicate_songs(uuid,uuid)'
        ) is not null
    ),
    'rls_enabled', (
      select relrowsecurity
      from pg_class
      where oid = 'public.song_management_history'::regclass
    ),
    'owner_unique_index',
      to_regclass('public.songs_owner_platform_music_url_idx') is not null,
    'owner_duplicate_groups', (
      select count(*)::integer
      from (
        select user_id, platform, lower(trim(music_url))
        from public.songs
        group by user_id, platform, lower(trim(music_url))
        having count(*) > 1
      ) duplicates
    ),
    'invalid_archives', (
      select count(*)::integer
      from public.songs
      where archived_at is not null and is_active
    ),
    'invalid_merges', (
      select count(*)::integer
      from public.songs
      where merged_into_song_id is not null
        and (
          is_active
          or archived_at is null
          or merged_into_song_id = id
        )
    ),
    'removed_in_active_catalog', (
      select count(*)::integer
      from public.songs
      where removed_at is not null and is_active
    )
  );
$$;

revoke all on function public.normalize_song_title(text)
  from public, anon, authenticated;
revoke all on function public.song_title_similarity(text, text)
  from public, anon, authenticated;
revoke all on function public.song_activity_snapshot(uuid)
  from public, anon, authenticated;
revoke all on function public.song_activity_total(jsonb)
  from public, anon, authenticated;
revoke all on function public.check_song_submission_duplicates(
  text, public.music_platform, text
) from public, anon, authenticated;
revoke all on function public.get_my_song_management()
  from public, anon, authenticated;
revoke all on function public.get_my_removed_song_history()
  from public, anon, authenticated;
revoke all on function public.delete_my_song(uuid)
  from public, anon, authenticated;
revoke all on function public.archive_my_song(uuid)
  from public, anon, authenticated;
revoke all on function public.admin_get_duplicate_song_candidates()
  from public, anon, authenticated;
revoke all on function public.admin_get_duplicate_statistics()
  from public, anon, authenticated;
revoke all on function public.admin_merge_duplicate_songs(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.admin_delete_abandoned_duplicate(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.song_management_health_report()
  from public, anon, authenticated;

grant execute on function public.check_song_submission_duplicates(
  text, public.music_platform, text
) to authenticated;
grant execute on function public.get_my_song_management()
  to authenticated;
grant execute on function public.get_my_removed_song_history()
  to authenticated;
grant execute on function public.delete_my_song(uuid)
  to authenticated;
grant execute on function public.archive_my_song(uuid)
  to authenticated;
grant execute on function public.admin_get_duplicate_song_candidates()
  to authenticated;
grant execute on function public.admin_get_duplicate_statistics()
  to authenticated;
grant execute on function public.admin_merge_duplicate_songs(uuid, uuid)
  to authenticated;
grant execute on function public.admin_delete_abandoned_duplicate(uuid, uuid)
  to authenticated;
grant execute on function public.song_management_health_report()
  to service_role;
