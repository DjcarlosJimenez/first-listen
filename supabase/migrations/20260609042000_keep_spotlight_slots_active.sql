-- Spotlight placements must always point to active songs.

create or replace function public.clear_inactive_spotlight_slot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not new.is_active or new.removed_at is not null then
    update public.spotlight_slots
    set
      song_id = null,
      custom_label = '',
      contest_id = null,
      event_id = null,
      active_from = null,
      active_until = null,
      updated_at = now()
    where song_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists songs_clear_inactive_spotlight_slot
  on public.songs;
create trigger songs_clear_inactive_spotlight_slot
after update of is_active, removed_at on public.songs
for each row
when (not new.is_active or new.removed_at is not null)
execute function public.clear_inactive_spotlight_slot();
