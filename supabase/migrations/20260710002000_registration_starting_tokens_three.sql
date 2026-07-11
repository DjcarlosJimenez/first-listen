-- Registration economy correction:
-- New users should start with 3 submission tokens.
-- Founder benefits remain separate as founder_free_submissions_remaining = 3.
-- This migration only changes future signups; it does not alter existing users.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  founder_spot integer;
  starting_credits integer := 3;
  accepted boolean := coalesce((new.raw_user_meta_data ->> 'legal_accepted')::boolean, false);
begin
  if not accepted then
    raise exception 'Legal terms must be accepted';
  end if;

  if not coalesce((new.raw_user_meta_data ->> 'system_bootstrap')::boolean, false) then
    update public.founder_program
    set claimed_count = claimed_count + 1
    where id = true and claimed_count < capacity
    returning claimed_count into founder_spot;
  end if;

  insert into public.profiles (
    id,
    display_name,
    avatar_url,
    founder_number,
    founder_free_submission_available,
    founder_free_submissions_remaining,
    founder_premium_year_entitlement,
    credits,
    legal_accepted_at,
    explicit_content_acknowledged_at
  )
  values (
    new.id,
    left(
      coalesce(
        nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
        'New artist'
      ),
      120
    ),
    new.raw_user_meta_data ->> 'avatar_url',
    founder_spot,
    founder_spot is not null,
    case when founder_spot is null then 0 else 3 end,
    founder_spot is not null,
    starting_credits,
    now(),
    now()
  );

  insert into public.credit_transactions (user_id, amount, reason)
  values (new.id, starting_credits, 'Registration credit');

  if founder_spot is not null then
    insert into public.founder_claims (user_id, founder_number)
    values (new.id, founder_spot);
  end if;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
