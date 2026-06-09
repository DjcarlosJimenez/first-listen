import { redirect } from "next/navigation";
import { ProfilePanel } from "@/components/profile-panel";
import { createClient } from "@/lib/supabase/server";
import type { CommunityActivity, CommunityNetwork } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/profile");

  const [
    { data: profile },
    { data: songs },
    { data: savedSongs },
    { data: impactRows },
    { data: networkRows },
    { data: activityRows },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, founder_number, founder_free_submissions_remaining, role, credits, show_explicit_content, community_visibility, autoplay_next_song")
      .eq("id", user.id)
      .single(),
    supabase
      .from("songs")
      .select("id, title, artist_name, music_url, platform, is_active, explicit_content, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase.rpc("get_saved_songs"),
    supabase.rpc("get_listener_impact_profile"),
    supabase.rpc("get_my_community_network"),
    supabase.rpc("get_my_recent_community_activity", {
      activity_limit: 12,
    }),
  ]);
  if (!profile) redirect("/login?error=profile");
  const networkRow = (
    Array.isArray(networkRows) ? networkRows[0] : networkRows
  ) as Record<string, unknown> | null;
  const network: CommunityNetwork = {
    followers: Number(networkRow?.followers ?? 0),
    following: Number(networkRow?.following ?? 0),
    artistsSupported: Number(networkRow?.artists_supported ?? 0),
    visibleSupports: Number(networkRow?.visible_supports ?? 0),
    anonymousSupports: Number(networkRow?.anonymous_supports ?? 0),
    visibility:
      networkRow?.community_visibility === "anonymous"
        ? "anonymous"
        : "public",
    autoplayNextSong: Boolean(networkRow?.autoplay_next_song ?? true),
  };

  return (
    <ProfilePanel
      profile={{
        id: user.id,
        displayName: profile.display_name,
        email: user.email ?? "",
        founder: profile.founder_number !== null,
        role: profile.role,
        credits: profile.credits,
        founderSubmissionsRemaining:
          profile.founder_free_submissions_remaining,
        showExplicitContent: profile.show_explicit_content,
        communityVisibility:
          profile.community_visibility === "anonymous" ? "anonymous" : "public",
        autoplayNextSong: Boolean(profile.autoplay_next_song),
      }}
      impact={(
        Array.isArray(impactRows) ? impactRows[0] : impactRows
      ) as never}
      savedSongs={(savedSongs ?? []) as never}
      songs={songs ?? []}
      network={network}
      activity={((activityRows ?? []) as Array<Record<string, unknown>>).map(
        (row) => ({
          id: String(row.event_id),
          type: String(row.event_type) as CommunityActivity["type"],
          artistId: String(row.artist_id),
          artistName: String(row.artist_name),
          songId: row.song_id ? String(row.song_id) : undefined,
          songTitle: row.song_title ? String(row.song_title) : undefined,
          visibility:
            row.visibility === "anonymous" ? "anonymous" : "public",
          createdAt: String(row.created_at),
        }),
      )}
    />
  );
}
