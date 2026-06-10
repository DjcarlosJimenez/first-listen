-- Use an ASCII-only Unicode escape so management-shell encoding cannot
-- corrupt the accented character during migration application.

update public.daily_missions
set description_es =
  U&'Completa escuchas v\00E1lidas de dos canciones Spotlight diferentes hoy.'
where mission_key = 'review_spotlight_songs';
