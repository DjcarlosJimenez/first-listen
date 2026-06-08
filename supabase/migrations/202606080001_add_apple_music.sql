-- PostgreSQL enum values must be committed before later migrations use them.
alter type public.music_platform add value if not exists 'apple_music';
