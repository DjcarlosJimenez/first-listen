import { redirect } from "next/navigation";
import { ProfilePanel } from "@/components/profile-panel";
import { createClient } from "@/lib/supabase/server";
import type {
  CommunityActivity,
  CommunityNetwork,
  ConnectedPlatform,
  ConnectedPlatformAccount,
} from "@/lib/types";

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
    { data: connectedPlatformRows },
    { data: removedSongHistory },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, founder_number, founder_free_submissions_remaining, role, credits, show_explicit_content, community_visibility, autoplay_next_song, external_redirect_notice_disabled")
      .eq("id", user.id)
      .single(),
    supabase.rpc("get_my_song_management"),
    supabase.rpc("get_saved_songs"),
    supabase.rpc("get_listener_impact_profile"),
    supabase.rpc("get_my_community_network"),
    supabase.rpc("get_my_recent_community_activity", {
      activity_limit: 12,
    }),
    supabase
      .from("connected_platform_accounts")
      .select(
        "platform, connection_status, provider_username, display_name, profile_url, avatar_url, creator_account, provider_verified, follower_count, following_count, content_count, likes_count, connected_at, last_synced_at",
      )
      .eq("user_id", user.id),
    supabase.rpc("get_my_removed_song_history"),
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
        externalRedirectNoticeDisabled: Boolean(
          profile.external_redirect_notice_disabled,
        ),
      }}
      impact={(
        Array.isArray(impactRows) ? impactRows[0] : impactRows
      ) as never}
      savedSongs={(savedSongs ?? []) as never}
      songs={songs ?? []}
      removedSongHistory={(removedSongHistory ?? []) as never}
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
      connectedPlatforms={(
        (connectedPlatformRows ?? []) as Array<Record<string, unknown>>
      ).map(
        (row): ConnectedPlatformAccount => ({
          platform: String(row.platform) as ConnectedPlatform,
          connectionStatus:
            String(
              row.connection_status ?? "not_connected",
            ) as ConnectedPlatformAccount["connectionStatus"],
          username: row.provider_username
            ? String(row.provider_username)
            : undefined,
          displayName: row.display_name ? String(row.display_name) : undefined,
          profileUrl: row.profile_url ? String(row.profile_url) : undefined,
          avatarUrl: row.avatar_url ? String(row.avatar_url) : undefined,
          creatorAccount: Boolean(row.creator_account),
          providerVerified: Boolean(row.provider_verified),
          followerCount:
            row.follower_count === null
              ? undefined
              : Number(row.follower_count),
          followingCount:
            row.following_count === null
              ? undefined
              : Number(row.following_count),
          contentCount:
            row.content_count === null ? undefined : Number(row.content_count),
          likesCount:
            row.likes_count === null ? undefined : Number(row.likes_count),
          connectedAt: row.connected_at
            ? String(row.connected_at)
            : undefined,
          lastSyncedAt: row.last_synced_at
            ? String(row.last_synced_at)
            : undefined,
        }),
      )}
    />
  );
}
