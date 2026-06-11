-- Production UX audit repair:
-- Ensure every profile has a baseline activity timestamp for retention health,
-- even before the user submits a song, review, listen, or social action.

update public.profiles
set last_contribution_at = created_at
where last_contribution_at is null;

alter table public.profiles
  alter column last_contribution_at set default now();
