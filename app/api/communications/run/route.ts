import { NextRequest, NextResponse } from "next/server";
import {
  ACTIVE_MEMBER_WINDOW_DAYS,
  CommunicationSong,
  MINIMUM_EXTERNAL_CONTACT_DAYS,
  communicationUnsubscribeUrl,
  isQuietHour,
  sendInactiveReminderEmail,
  sendMusicDigestEmail,
} from "@/lib/communications";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type PreferenceRow = {
  digest_interval_days: number;
  email_consent_at: string | null;
  email_music_digest_enabled: boolean;
  email_unsubscribed_at: string | null;
  inactive_community_reminders: boolean;
  last_external_contact_at: string | null;
  preferred_genres: string[] | null;
  quiet_hours_end: number;
  quiet_hours_start: number;
  reminder_interval_days: number;
  time_zone: string;
  user_id: string;
};

type SongRow = {
  artist_name: string;
  cover_image_url: string;
  created_at: string;
  genre: string;
  id: string;
  music_url: string;
  title: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function authorized(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  return Boolean(
    cronSecret && request.headers.get("authorization") === `Bearer ${cronSecret}`,
  );
}

function elapsedDays(value: string | null | undefined, now: Date) {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? Math.max(0, (now.getTime() - parsed) / DAY_MS)
    : Number.POSITIVE_INFINITY;
}

function normalized(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}

function mapSong(song: SongRow): CommunicationSong {
  return {
    artistName: song.artist_name,
    coverImageUrl: song.cover_image_url,
    genre: song.genre,
    id: song.id,
    musicUrl: song.music_url,
    title: song.title,
  };
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (process.env.COMMUNICATIONS_DELIVERY_ENABLED !== "true") {
    return NextResponse.json({
      delivery: "disabled",
      reason: "COMMUNICATIONS_DELIVERY_ENABLED is not true",
      status: "safe",
    });
  }

  const now = new Date();
  const supabase = createAdminClient();
  const [{ data: preferenceData, error: preferenceError }, { data: songData, error: songError }] =
    await Promise.all([
      supabase
        .from("user_notification_preferences")
        .select(
          "user_id,email_music_digest_enabled,inactive_community_reminders,digest_interval_days,reminder_interval_days,quiet_hours_start,quiet_hours_end,time_zone,preferred_genres,email_consent_at,email_unsubscribed_at,last_external_contact_at",
        )
        .or("email_music_digest_enabled.eq.true,inactive_community_reminders.eq.true")
        .limit(250),
      supabase
        .from("songs")
        .select("id,title,artist_name,cover_image_url,music_url,genre,created_at")
        .eq("is_active", true)
        .is("removed_at", null)
        .gte("created_at", new Date(now.getTime() - 45 * DAY_MS).toISOString())
        .order("created_at", { ascending: false })
        .limit(80),
    ]);

  if (preferenceError || songError) {
    return NextResponse.json(
      {
        error: "Communications query failed",
        preferenceCode: preferenceError?.code ?? null,
        songCode: songError?.code ?? null,
      },
      { status: 500 },
    );
  }

  const preferences = (preferenceData ?? []) as PreferenceRow[];
  const songs = (songData ?? []) as SongRow[];
  const summary = {
    activeMembersKeptInApp: 0,
    delivered: 0,
    failed: 0,
    noEligibleContent: 0,
    notDue: 0,
    quietHours: 0,
  };

  for (const preference of preferences) {
    if (!preference.email_consent_at || preference.email_unsubscribed_at) {
      summary.notDue += 1;
      continue;
    }
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(
      preference.user_id,
    );
    const user = userData.user;
    if (userError || !user?.email) {
      summary.failed += 1;
      continue;
    }
    const inactiveDays = elapsedDays(user.last_sign_in_at, now);
    if (inactiveDays < ACTIVE_MEMBER_WINDOW_DAYS) {
      summary.activeMembersKeptInApp += 1;
      continue;
    }
    if (
      elapsedDays(preference.last_external_contact_at, now) <
      MINIMUM_EXTERNAL_CONTACT_DAYS
    ) {
      summary.notDue += 1;
      continue;
    }
    if (
      isQuietHour(
        now,
        preference.time_zone || "America/Chicago",
        Number(preference.quiet_hours_start ?? 21),
        Number(preference.quiet_hours_end ?? 9),
      )
    ) {
      summary.quietHours += 1;
      continue;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("interface_language")
      .eq("id", preference.user_id)
      .maybeSingle();
    const locale = profile?.interface_language === "es" ? "es" : "en";
    const preferredGenres = new Set(
      (preference.preferred_genres ?? []).map(normalized),
    );
    const contentCutoff = preference.last_external_contact_at
      ? Date.parse(preference.last_external_contact_at)
      : now.getTime() - Number(preference.digest_interval_days ?? 14) * DAY_MS;
    const digestSongs = songs
      .filter(
        (song) =>
          Date.parse(song.created_at) > contentCutoff &&
          (preferredGenres.size ? preferredGenres.has(normalized(song.genre)) : true),
      )
      .slice(0, 4);
    const digestDue =
      preference.email_music_digest_enabled &&
      inactiveDays >= Number(preference.digest_interval_days ?? 14) &&
      digestSongs.length > 0;
    const reminderDue =
      preference.inactive_community_reminders &&
      inactiveDays >= Number(preference.reminder_interval_days ?? 30);

    if (!digestDue && !reminderDue) {
      if (preference.email_music_digest_enabled && !digestSongs.length) {
        summary.noEligibleContent += 1;
      } else {
        summary.notDue += 1;
      }
      continue;
    }

    const kind = digestDue ? "music_digest" : "inactive_reminder";
    const cycleDays = digestDue
      ? Number(preference.digest_interval_days ?? 14)
      : Number(preference.reminder_interval_days ?? 30);
    const cycle = Math.floor(inactiveDays / Math.max(MINIMUM_EXTERNAL_CONTACT_DAYS, cycleDays));
    const latestSongId = digestSongs[0]?.id ?? "community";
    const eventKey = `${kind}:${latestSongId}:${cycle}`;
    const { error: claimError } = await supabase
      .from("user_communication_deliveries")
      .insert({
        channel: "email",
        communication_kind: kind,
        event_key: eventKey,
        status: "processing",
        subject_song_ids: digestDue ? digestSongs.map((song) => song.id) : [],
        user_id: preference.user_id,
      });
    if (claimError) {
      summary.notDue += 1;
      continue;
    }

    try {
      const unsubscribeUrl = communicationUnsubscribeUrl(preference.user_id);
      const providerMessageId = digestDue
        ? await sendMusicDigestEmail({
            email: user.email,
            eventKey,
            locale,
            songs: digestSongs.map(mapSong),
            unsubscribeUrl,
          })
        : await sendInactiveReminderEmail({
            email: user.email,
            eventKey,
            locale,
            unsubscribeUrl,
          });
      const sentAt = new Date().toISOString();
      const preferenceUpdate: Record<string, string> = {
        last_external_contact_at: sentAt,
        updated_at: sentAt,
      };
      if (digestDue) preferenceUpdate.last_digest_sent_at = sentAt;
      if (reminderDue && !digestDue) {
        preferenceUpdate.last_reminder_sent_at = sentAt;
      }

      await Promise.all([
        supabase
          .from("user_communication_deliveries")
          .update({
            provider_message_id: providerMessageId,
            sent_at: sentAt,
            status: "sent",
            updated_at: sentAt,
          })
          .eq("user_id", preference.user_id)
          .eq("event_key", eventKey),
        supabase
          .from("user_notification_preferences")
          .update(preferenceUpdate)
          .eq("user_id", preference.user_id),
      ]);
      summary.delivered += 1;
    } catch (error) {
      await supabase
        .from("user_communication_deliveries")
        .update({
          failure_code: error instanceof Error ? error.message.slice(0, 160) : "delivery_failed",
          status: "failed",
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", preference.user_id)
        .eq("event_key", eventKey);
      summary.failed += 1;
    }
  }

  return NextResponse.json({
    policy: {
      activeMembers: "in_app_only",
      minimumExternalContactDays: MINIMUM_EXTERNAL_CONTACT_DAYS,
      push: "disabled_until_reviewed",
      singleChannelPerEvent: true,
    },
    status: "complete",
    summary,
  });
}
