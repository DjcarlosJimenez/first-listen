-- Guest activity is preserved during account conversion by moving its actor
-- to the new profile. Direct guest deletion should remove remaining activity.

alter table public.community_support_events
  drop constraint if exists
    community_support_events_guest_session_id_fkey;

alter table public.community_support_events
  add constraint community_support_events_guest_session_id_fkey
  foreign key (guest_session_id)
  references public.guest_sessions(id)
  on delete cascade;
