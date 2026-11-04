-- Keep Spanish playback metrics consistent with the product terminology:
-- "escuchar" is the user action, while completed/countable events are
-- "reproducciones".

update public.daily_missions
set description_es =
  U&'Completa reproducciones v\00E1lidas de dos canciones Spotlight diferentes hoy.'
where mission_key = 'review_spotlight_songs';
