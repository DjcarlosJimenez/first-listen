import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

function loadEnv(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(line)) continue;
    const [key, ...parts] = line.split("=");
    if (!process.env[key]) {
      process.env[key] = parts.join("=").trim().replace(/^['"]|['"]$/g, "");
    }
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

loadEnv(path.join(process.cwd(), ".env.local"));

const password = process.env.SUPABASE_DB_PASSWORD;
assert(password, "SUPABASE_DB_PASSWORD is required.");

const pooler = (
  await readFile(path.join(process.cwd(), "supabase", ".temp", "pooler-url"), "utf8")
).trim();
const connection = new URL(pooler);
connection.password = password;
const client = new Client({
  connectionString: connection.toString(),
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  await client.query("begin");
  const fixture = await client.query(`
    select profiles.id, lower(trim(users.email)) as email
    from public.profiles as profiles
    join auth.users as users on users.id = profiles.id
    where users.email is not null
      and profiles.account_status = 'active'
      and profiles.banned_at is null
      and not exists (
        select 1 from public.songs where songs.user_id = profiles.id
      )
      and not exists (
        select 1
        from public.first_publish_trials as trials
        where lower(trials.email) = lower(users.email)
          and trials.status in ('published', 'retained')
      )
    order by profiles.created_at desc
    limit 1
  `);
  assert(fixture.rowCount === 1, "No reversible verification profile is available.");
  const userId = fixture.rows[0].id;
  const email = fixture.rows[0].email;
  const tokenHash = `verify-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const youtubeId = `FL${Date.now().toString(36)}`.slice(-11).padStart(11, "A");

  await client.query(
    `insert into public.first_publish_trials (
       email, artist_name, title, cover_image_url, music_url, platform,
       genre, song_language, country, content_kind, duration_seconds,
       claim_token_hash, status, verification_expires_at
     ) values ($1, 'First Publish Verification', 'First Publish Verification',
       'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', $2,
       'youtube', 'Cumbia', 'Spanish', 'United States', 'song', 180,
       $3, 'pending_email', now() + interval '1 hour')`,
    [email, `https://www.youtube.com/watch?v=${youtubeId}`, tokenHash],
  );
  await client.query(
    "select set_config('request.jwt.claims', $1, true)",
    [JSON.stringify({ sub: userId, email, role: "authenticated" })],
  );
  await client.query("set local role authenticated");

  const claimed = await client.query(
    "select * from public.claim_first_publish_trial($1)",
    [tokenHash],
  );
  assert(claimed.rowCount === 1, "The verified trial was not published.");
  const songId = claimed.rows[0].published_song_id;
  assert(songId && claimed.rows[0].retained === false, "Unexpected publication result.");

  const published = await client.query(
    `select user_id, is_active, submission_token_cost,
            first_publish_trial_expires_at, first_publish_trial_claimed_at
     from public.songs where id = $1`,
    [songId],
  );
  assert(published.rowCount === 1, "Published trial song is missing.");
  const song = published.rows[0];
  const remainingHours =
    (new Date(song.first_publish_trial_expires_at).getTime() - Date.now()) / 3_600_000;
  assert(
    song.user_id === userId && song.is_active === true &&
      Number(song.submission_token_cost) === 0 &&
      song.first_publish_trial_claimed_at === null &&
      remainingHours > 167 && remainingHours <= 168.1,
    "The seven-day publication state is invalid.",
  );

  const publicSong = await client.query(
    "select * from public.get_first_publish_live_song($1)",
    [songId],
  );
  assert(
    publicSong.rowCount === 1 && publicSong.rows[0].viewer_owns === true,
    "The public first-publication page cannot resolve the active song.",
  );
  const listenerHash = "a".repeat(64);
  const reaction = await client.query(
    "select * from public.add_first_publish_reaction($1, 'liked', $2)",
    [songId, listenerHash],
  );
  assert(
    reaction.rows[0]?.accepted === true && Number(reaction.rows[0]?.liked_count) === 1,
    "The first quick reaction was not counted.",
  );
  const duplicateReaction = await client.query(
    "select * from public.add_first_publish_reaction($1, 'liked', $2)",
    [songId, listenerHash],
  );
  assert(
    duplicateReaction.rows[0]?.accepted === false &&
      Number(duplicateReaction.rows[0]?.liked_count) === 1,
    "A duplicate device reaction was counted more than once.",
  );

  const retained = await client.query(
    "select * from public.retain_first_publish_trial($1)",
    [songId],
  );
  assert(retained.rowCount === 1, "The free retention step failed.");
  await client.query("reset role");
  const finalState = await client.query(
    `select songs.first_publish_trial_expires_at,
            songs.first_publish_trial_claimed_at,
            trials.status, trials.publication_expires_at, trials.retained_at
     from public.songs as songs
     join public.first_publish_trials as trials on trials.song_id = songs.id
     where songs.id = $1`,
    [songId],
  );
  const final = finalState.rows[0];
  assert(
    final && final.first_publish_trial_expires_at === null &&
      final.first_publish_trial_claimed_at && final.status === "retained" &&
      final.publication_expires_at === null && final.retained_at,
    "The retained publication still has an expiration.",
  );
  const funnel = await client.query(
    "select public.get_first_publish_funnel(30) as report",
  );
  assert(
    Array.isArray(funnel.rows[0]?.report) && funnel.rows[0].report.length === 7,
    "The first-publication funnel report is unavailable.",
  );

  await client.query("rollback");
  console.log(JSON.stringify({
    status: "passed",
    transaction: "rolled_back",
    checks: [
      "verified first song published without token charge",
      "seven-day expiration assigned",
      "free retention removed expiration",
      "public page returned only the active trial song",
      "quick reactions were limited to one per device",
      "seven-stage owner funnel is available",
      "all verification data rolled back",
    ],
  }));
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
