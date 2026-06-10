-- TikTok is an external discovery provider. Keep the enum change isolated so
-- the new value is committed before later migrations reference it.

alter type public.music_platform add value if not exists 'tiktok';
