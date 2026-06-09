-- First Listen recovery, data reconciliation, and privilege hardening.
-- Apply after the base, security, and music discovery migrations.

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and account_status = 'active'
  );
$$;

create or replace function public.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select role
      from public.profiles
      where id = auth.uid()
        and account_status = 'active'
    ),
    'user'::public.app_role
  );
$$;

insert into public.profiles (
  id,
  display_name,
  avatar_url,
  credits,
  legal_accepted_at,
  explicit_content_acknowledged_at
)
select
  users.id,
  left(
    coalesce(
      nullif(trim(users.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(users.email, ''), '@', 1), ''),
      'New artist'
    ),
    120
  ),
  nullif(trim(users.raw_user_meta_data ->> 'avatar_url'), ''),
  1,
  case
    when lower(coalesce(users.raw_user_meta_data ->> 'legal_accepted', 'false')) = 'true'
    then coalesce(users.created_at, now())
  end,
  case
    when lower(coalesce(users.raw_user_meta_data ->> 'explicit_content_acknowledged', 'false')) = 'true'
    then coalesce(users.created_at, now())
  end
from auth.users
where not exists (
  select 1 from public.profiles where profiles.id = users.id
);

update public.profiles
set display_name = left(
  coalesce(nullif(trim(display_name), ''), 'New artist'),
  120
);

insert into public.founder_claims (user_id, founder_number, claimed_at)
select
  profiles.id,
  profiles.founder_number,
  profiles.created_at
from public.profiles
where profiles.founder_number is not null
on conflict do nothing;

with available_numbers as (
  select
    numbers.founder_number,
    row_number() over (order by numbers.founder_number) as assignment_order
  from generate_series(1, 50) as numbers(founder_number)
  where not exists (
    select 1
    from public.founder_claims
    where founder_claims.founder_number = numbers.founder_number
  )
),
eligible_profiles as (
  select
    profiles.id,
    row_number() over (order by users.created_at, profiles.id) as assignment_order
  from public.profiles
  join auth.users on users.id = profiles.id
  where profiles.founder_number is null
    and lower(coalesce(users.raw_user_meta_data ->> 'system_bootstrap', 'false')) <> 'true'
),
assignments as (
  select
    eligible_profiles.id,
    available_numbers.founder_number
  from eligible_profiles
  join available_numbers using (assignment_order)
),
updated_profiles as (
  update public.profiles
  set
    founder_number = assignments.founder_number,
    founder_premium_year_entitlement = true,
    updated_at = now()
  from assignments
  where profiles.id = assignments.id
  returning profiles.id, profiles.founder_number
)
insert into public.founder_claims (user_id, founder_number)
select id, founder_number
from updated_profiles
on conflict do nothing;

insert into public.credit_transactions (user_id, amount, reason)
select profiles.id, 1, 'Registration credit'
from public.profiles
where not exists (
  select 1
  from public.credit_transactions
  where credit_transactions.user_id = profiles.id
    and credit_transactions.reason = 'Registration credit'
);

with missing_founder_bonus as materialized (
  select founder_claims.user_id
  from public.founder_claims
  where not exists (
    select 1
    from public.credit_transactions
    where credit_transactions.user_id = founder_claims.user_id
      and credit_transactions.reason = 'Founding Artist bonus'
  )
),
credited_profiles as (
  update public.profiles
  set
    credits = credits + 10,
    updated_at = now()
  where id in (select user_id from missing_founder_bonus)
  returning id
)
insert into public.credit_transactions (user_id, amount, reason)
select id, 10, 'Founding Artist bonus'
from credited_profiles;

update public.founder_program
set claimed_count = (
  select count(*)::integer from public.founder_claims
)
where id = true;

with review_counts as (
  select
    reviewer_id,
    count(*)::integer as completed_reviews
  from public.reviews
  where quality_passed
  group by reviewer_id
)
update public.profiles
set
  completed_reviews = greatest(profiles.completed_reviews, review_counts.completed_reviews),
  updated_at = now()
from review_counts
where profiles.id = review_counts.reviewer_id;

with quality_scores as (
  select
    reviewer_id,
    round(avg(quality_score)::numeric, 2) as review_quality_score
  from public.reviews
  group by reviewer_id
)
update public.profiles
set
  review_quality_score = quality_scores.review_quality_score,
  updated_at = now()
from quality_scores
where profiles.id = quality_scores.reviewer_id;

with milestones(milestone, credits_awarded) as (
  values (5, 1), (10, 3), (25, 8), (50, 20)
),
missing_awards as (
  select
    profiles.id as user_id,
    milestones.milestone,
    milestones.credits_awarded
  from public.profiles
  cross join milestones
  where profiles.completed_reviews >= milestones.milestone
    and not exists (
      select 1
      from public.review_reward_awards
      where review_reward_awards.user_id = profiles.id
        and review_reward_awards.milestone = milestones.milestone
    )
),
inserted_awards as (
  insert into public.review_reward_awards (user_id, milestone, credits_awarded)
  select user_id, milestone, credits_awarded
  from missing_awards
  on conflict do nothing
  returning user_id, milestone, credits_awarded
),
award_totals as (
  select user_id, sum(credits_awarded)::integer as credits_awarded
  from inserted_awards
  group by user_id
),
credited_reviewers as (
  update public.profiles
  set
    credits = credits + award_totals.credits_awarded,
    total_review_credits_earned =
      total_review_credits_earned + award_totals.credits_awarded,
    updated_at = now()
  from award_totals
  where profiles.id = award_totals.user_id
  returning profiles.id
)
insert into public.credit_transactions (user_id, amount, reason)
select
  inserted_awards.user_id,
  inserted_awards.credits_awarded,
  inserted_awards.milestone || ' completed reviews'
from inserted_awards;

create index if not exists song_reports_reporter_idx
  on public.song_reports (reporter_id, created_at desc);
create index if not exists song_reports_song_idx
  on public.song_reports (song_id, created_at desc);
create index if not exists saved_songs_song_idx
  on public.saved_songs (song_id);
create index if not exists reviews_song_quality_idx
  on public.reviews (song_id, quality_passed, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists songs_set_updated_at on public.songs;
create trigger songs_set_updated_at
  before update on public.songs
  for each row execute function public.set_updated_at();

create or replace function public.enforce_active_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_active_user() then
    raise exception 'Active account required';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_require_active_actor on public.profiles;
create trigger profiles_require_active_actor
  before insert or update or delete on public.profiles
  for each row execute function public.enforce_active_actor();

drop trigger if exists songs_require_active_actor on public.songs;
create trigger songs_require_active_actor
  before insert or update or delete on public.songs
  for each row execute function public.enforce_active_actor();

drop trigger if exists reviews_require_active_actor on public.reviews;
create trigger reviews_require_active_actor
  before insert or update or delete on public.reviews
  for each row execute function public.enforce_active_actor();

drop trigger if exists reports_require_active_actor on public.song_reports;
create trigger reports_require_active_actor
  before insert or update or delete on public.song_reports
  for each row execute function public.enforce_active_actor();

drop trigger if exists follows_require_active_actor on public.artist_follows;
create trigger follows_require_active_actor
  before insert or update or delete on public.artist_follows
  for each row execute function public.enforce_active_actor();

drop trigger if exists saved_songs_require_active_actor on public.saved_songs;
create trigger saved_songs_require_active_actor
  before insert or update or delete on public.saved_songs
  for each row execute function public.enforce_active_actor();

drop policy if exists "users read own profile or staff reads profiles" on public.profiles;
create policy "users read own profile or staff reads profiles"
  on public.profiles for select
  to authenticated
  using (
    public.is_active_user()
    and (id = auth.uid() or public.current_user_role() = 'super_admin')
  );

drop policy if exists "authenticated users read eligible songs" on public.songs;
create policy "authenticated users read eligible songs"
  on public.songs for select
  to authenticated
  using (
    public.is_active_user()
    and (
      user_id = auth.uid()
      or public.is_staff()
      or (
        is_active
        and removed_at is null
        and (
          not explicit_content
          or coalesce(
            (
              select show_explicit_content
              from public.profiles
              where id = auth.uid()
            ),
            false
          )
        )
      )
    )
  );

drop policy if exists "reviews are readable by reviewer or song owner" on public.reviews;
create policy "reviews are readable by reviewer or song owner"
  on public.reviews for select
  to authenticated
  using (
    public.is_active_user()
    and (
      reviewer_id = auth.uid()
      or public.is_staff()
      or exists (
        select 1
        from public.songs
        where songs.id = reviews.song_id
          and songs.user_id = auth.uid()
      )
    )
  );

drop policy if exists "users read own founder claim or super admin reads claims" on public.founder_claims;
create policy "users read own founder claim or super admin reads claims"
  on public.founder_claims for select
  to authenticated
  using (
    public.is_active_user()
    and (user_id = auth.uid() or public.current_user_role() = 'super_admin')
  );

drop policy if exists "users read own credit history or staff reads all" on public.credit_transactions;
create policy "users read own credit history or staff reads all"
  on public.credit_transactions for select
  to authenticated
  using (
    public.is_active_user()
    and (user_id = auth.uid() or public.current_user_role() = 'super_admin')
  );

drop policy if exists "users read own rewards or staff reads all" on public.review_reward_awards;
create policy "users read own rewards or staff reads all"
  on public.review_reward_awards for select
  to authenticated
  using (
    public.is_active_user()
    and (user_id = auth.uid() or public.current_user_role() = 'super_admin')
  );

drop policy if exists "users read own reports or staff reads reports" on public.song_reports;
create policy "users read own reports or staff reads reports"
  on public.song_reports for select
  to authenticated
  using (
    public.is_active_user()
    and (reporter_id = auth.uid() or public.is_staff())
  );

drop policy if exists "users report eligible songs" on public.song_reports;
create policy "users report eligible songs"
  on public.song_reports for insert
  to authenticated
  with check (
    public.is_active_user()
    and reporter_id = auth.uid()
    and exists (
      select 1
      from public.songs
      where songs.id = song_id
        and songs.user_id <> auth.uid()
        and songs.is_active
        and songs.removed_at is null
    )
  );

drop policy if exists "users manage own follows" on public.artist_follows;
create policy "users manage own follows"
  on public.artist_follows for all
  to authenticated
  using (public.is_active_user() and follower_id = auth.uid())
  with check (public.is_active_user() and follower_id = auth.uid());

drop policy if exists "users manage own saved songs" on public.saved_songs;
create policy "users manage own saved songs"
  on public.saved_songs for all
  to authenticated
  using (public.is_active_user() and user_id = auth.uid())
  with check (public.is_active_user() and user_id = auth.uid());

revoke create on schema public from public, anon, authenticated;
grant usage on schema public to anon, authenticated;

revoke all on table public.founder_program from anon, authenticated;
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.songs from anon, authenticated;
revoke all on table public.reviews from anon, authenticated;
revoke all on table public.waitlist from anon, authenticated;
revoke all on table public.founder_claims from anon, authenticated;
revoke all on table public.credit_transactions from anon, authenticated;
revoke all on table public.review_reward_awards from anon, authenticated;
revoke all on table public.song_reports from anon, authenticated;
revoke all on table public.artist_follows from anon, authenticated;
revoke all on table public.saved_songs from anon, authenticated;
revoke all on table public.song_analytics from anon, authenticated;

grant select on table public.founder_program to anon, authenticated;
grant select on table public.profiles to authenticated;
grant select on table public.songs to authenticated;
grant select on table public.reviews to authenticated;
grant insert on table public.waitlist to anon, authenticated;
grant select on table public.founder_claims to authenticated;
grant select on table public.credit_transactions to authenticated;
grant select on table public.review_reward_awards to authenticated;
grant select, insert on table public.song_reports to authenticated;
grant select, insert, delete on table public.artist_follows to authenticated;
grant select, insert, delete on table public.saved_songs to authenticated;
grant select on table public.song_analytics to authenticated;

revoke all on function public.normalize_feedback(text) from public, anon, authenticated;
revoke all on function public.music_url_matches_platform(text, public.music_platform) from public, anon, authenticated;
revoke all on function public.claim_founder_spot() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.enforce_active_actor() from public, anon, authenticated;
revoke all on function public.is_active_user() from public, anon, authenticated;
revoke all on function public.current_user_role() from public, anon, authenticated;
revoke all on function public.is_staff() from public, anon, authenticated;
revoke all on function public.save_onboarding_preferences(text[], text[], text) from public, anon, authenticated;
revoke all on function public.set_interface_language(text) from public, anon, authenticated;
revoke all on function public.complete_forced_password_change() from public, anon, authenticated;
revoke all on function public.update_profile_preferences(text, boolean) from public, anon, authenticated;
revoke all on function public.submit_song(
  text, text, text, text, public.music_platform, text, text, text[], text, boolean
) from public, anon, authenticated;
revoke all on function public.submit_review(
  uuid, boolean, boolean, boolean, boolean, smallint, text, boolean
) from public, anon, authenticated;
revoke all on function public.get_smart_review_queue(integer) from public, anon, authenticated;
revoke all on function public.report_song(uuid, public.report_reason, text) from public, anon, authenticated;
revoke all on function public.follow_artist(uuid) from public, anon, authenticated;
revoke all on function public.unfollow_artist(uuid) from public, anon, authenticated;
revoke all on function public.save_song_for_later(uuid) from public, anon, authenticated;
revoke all on function public.unsave_song(uuid) from public, anon, authenticated;
revoke all on function public.get_public_artist_profile(uuid) from public, anon, authenticated;
revoke all on function public.get_public_artist_songs(uuid) from public, anon, authenticated;
revoke all on function public.get_my_song_dashboard() from public, anon, authenticated;
revoke all on function public.get_my_song_comments(uuid) from public, anon, authenticated;
revoke all on function public.get_saved_songs() from public, anon, authenticated;
revoke all on function public.admin_adjust_credits(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.admin_set_role(uuid, public.app_role) from public, anon, authenticated;
revoke all on function public.admin_set_account_status(uuid, public.account_status) from public, anon, authenticated;
revoke all on function public.admin_set_song_state(uuid, boolean, boolean) from public, anon, authenticated;
revoke all on function public.admin_resolve_report(uuid, public.report_status) from public, anon, authenticated;
revoke all on function public.admin_get_statistics() from public, anon, authenticated;

grant execute on function public.is_active_user() to authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.save_onboarding_preferences(text[], text[], text) to authenticated;
grant execute on function public.set_interface_language(text) to authenticated;
grant execute on function public.complete_forced_password_change() to authenticated;
grant execute on function public.update_profile_preferences(text, boolean) to authenticated;
grant execute on function public.submit_song(
  text, text, text, text, public.music_platform, text, text, text[], text, boolean
) to authenticated;
grant execute on function public.submit_review(
  uuid, boolean, boolean, boolean, boolean, smallint, text, boolean
) to authenticated;
grant execute on function public.get_smart_review_queue(integer) to authenticated;
grant execute on function public.report_song(uuid, public.report_reason, text) to authenticated;
grant execute on function public.follow_artist(uuid) to authenticated;
grant execute on function public.unfollow_artist(uuid) to authenticated;
grant execute on function public.save_song_for_later(uuid) to authenticated;
grant execute on function public.unsave_song(uuid) to authenticated;
grant execute on function public.get_public_artist_profile(uuid) to anon, authenticated;
grant execute on function public.get_public_artist_songs(uuid) to anon, authenticated;
grant execute on function public.get_my_song_dashboard() to authenticated;
grant execute on function public.get_my_song_comments(uuid) to authenticated;
grant execute on function public.get_saved_songs() to authenticated;
grant execute on function public.admin_adjust_credits(uuid, integer, text) to authenticated;
grant execute on function public.admin_set_role(uuid, public.app_role) to authenticated;
grant execute on function public.admin_set_account_status(uuid, public.account_status) to authenticated;
grant execute on function public.admin_set_song_state(uuid, boolean, boolean) to authenticated;
grant execute on function public.admin_resolve_report(uuid, public.report_status) to authenticated;
grant execute on function public.admin_get_statistics() to authenticated;

create or replace function public.database_health_report()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with expected_tables(name) as (
    values
      ('profiles'),
      ('songs'),
      ('reviews'),
      ('founder_program'),
      ('founder_claims'),
      ('credit_transactions'),
      ('review_reward_awards'),
      ('song_reports'),
      ('artist_follows'),
      ('saved_songs'),
      ('waitlist')
  ),
  expected_functions(name) as (
    values
      ('submit_song'),
      ('submit_review'),
      ('get_smart_review_queue'),
      ('follow_artist'),
      ('unfollow_artist'),
      ('save_song_for_later'),
      ('unsave_song'),
      ('get_saved_songs'),
      ('get_public_artist_profile'),
      ('get_public_artist_songs'),
      ('get_my_song_dashboard'),
      ('get_my_song_comments'),
      ('report_song')
  ),
  expected_indexes(name) as (
    values
      ('songs_queue_idx'),
      ('songs_unique_music_url_idx'),
      ('reviews_song_idx'),
      ('reviews_reviewer_idx'),
      ('song_reports_status_idx'),
      ('artist_follows_artist_idx'),
      ('saved_songs_user_idx')
  )
  select jsonb_build_object(
    'tables',
    (
      select jsonb_object_agg(
        expected_tables.name,
        to_regclass(format('public.%I', expected_tables.name)) is not null
      )
      from expected_tables
    ),
    'music_platform',
    (
      select coalesce(jsonb_agg(pg_enum.enumlabel order by pg_enum.enumsortorder), '[]'::jsonb)
      from pg_enum
      join pg_type on pg_type.oid = pg_enum.enumtypid
      join pg_namespace on pg_namespace.oid = pg_type.typnamespace
      where pg_namespace.nspname = 'public'
        and pg_type.typname = 'music_platform'
    ),
    'functions',
    (
      select jsonb_object_agg(
        expected_functions.name,
        exists (
          select 1
          from pg_proc
          join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
          where pg_namespace.nspname = 'public'
            and pg_proc.proname = expected_functions.name
        )
      )
      from expected_functions
    ),
    'indexes',
    (
      select jsonb_object_agg(
        expected_indexes.name,
        to_regclass(format('public.%I', expected_indexes.name)) is not null
      )
      from expected_indexes
    ),
    'rls',
    (
      select jsonb_object_agg(pg_class.relname, pg_class.relrowsecurity)
      from pg_class
      join pg_namespace on pg_namespace.oid = pg_class.relnamespace
      where pg_namespace.nspname = 'public'
        and pg_class.relname in (select name from expected_tables)
        and pg_class.relkind = 'r'
    ),
    'policy_count',
    (
      select count(*)::integer
      from pg_policies
      where schemaname = 'public'
    ),
    'auth_users',
    (select count(*)::integer from auth.users),
    'profiles',
    (select count(*)::integer from public.profiles),
    'missing_profiles',
    (
      select count(*)::integer
      from auth.users
      where not exists (
        select 1 from public.profiles where profiles.id = users.id
      )
    ),
    'founder_claims',
    (select count(*)::integer from public.founder_claims),
    'founder_counter',
    (
      select claimed_count
      from public.founder_program
      where id = true
    ),
    'duplicate_active_song_urls',
    (
      select count(*)::integer
      from (
        select lower(trim(music_url))
        from public.songs
        where removed_at is null
        group by lower(trim(music_url))
        having count(*) > 1
      ) duplicates
    ),
    'orphan_reviews',
    (
      select count(*)::integer
      from public.reviews
      where not exists (
        select 1 from public.songs where songs.id = reviews.song_id
      )
      or not exists (
        select 1 from public.profiles where profiles.id = reviews.reviewer_id
      )
    )
  );
$$;

revoke all on function public.database_health_report() from public, anon, authenticated;
grant execute on function public.database_health_report() to service_role;
