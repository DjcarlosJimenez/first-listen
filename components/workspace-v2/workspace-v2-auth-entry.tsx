import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Logo } from "@/components/logo";
import type { ProfilePanelProps } from "@/components/profile-panel";
import { WorkspaceV2PreviewErrorBoundary } from "@/components/workspace-v2/workspace-v2-preview-error-boundary";
import { WorkspaceV2Shell, type WorkspaceV2ViewerMode } from "@/components/workspace-v2/workspace-v2-shell";
import type { InterfaceLocale } from "@/lib/catalog";
import {
  displayPlatform,
  getContentClassification,
  isExternalPlatform,
} from "@/lib/content-economy";
import { loadFounderOperationsSnapshot } from "@/lib/founder-operations";
import { safeCoverUrl } from "@/lib/media";
import { createClient } from "@/lib/supabase/server";
import type {
  CommunityActivity,
  CommunityNetwork,
  ConnectedPlatform,
  ConnectedPlatformAccount,
  ContentEconomySetting,
  Platform,
} from "@/lib/types";
import type {
  WorkspaceV2ExternalDiscoveryItem,
  WorkspaceV2Queue,
  WorkspaceV2Song,
} from "@/lib/workspace-v2";

type WorkspaceV2Profile = {
  autoplay_next_song: boolean | null;
  community_visibility: string | null;
  credits: number | null;
  display_name: string | null;
  external_redirect_notice_disabled: boolean | null;
  founder_free_submissions_remaining: number | null;
  founder_number: number | null;
  interface_language: string | null;
  role: string | null;
  show_explicit_content: boolean | null;
};

type WorkspaceV2SongRow = {
  artist_name: string | null;
  category?: string | null;
  content_duration_seconds: number | null;
  content_type?: string | null;
  cover_image_url: string | null;
  created_at: string | null;
  exposure_score?: number | string | null;
  featured: boolean | null;
  genre?: string | null;
  id: string;
  last_heard_at?: string | null;
  music_url: string | null;
  platform: string | null;
  subcategory?: string | null;
  title: string | null;
  user_id: string | null;
};

type ContentEconomyRow = {
  activation_at: string | null;
  activation_pending: boolean | null;
  classification: "internal" | "external" | null;
  compatibility_status:
    | "Partially Supported"
    | "Discovery Only"
    | "Not Recommended"
    | null;
  current_token_cost: number | null;
  effective_token_cost: number | null;
  platform: string | null;
  scheduled_token_cost: number | null;
};

type WorkspaceV2ExternalDiscoveryRow = WorkspaceV2SongRow & {
  artist_id?: string | null;
  badge?: string | null;
  feed_kind?: string | null;
  platform_links?: unknown;
  recommended_platform?: string | null;
  song_id?: string | null;
};

function mapContentEconomyRows(
  rows: ContentEconomyRow[] | null | undefined,
): ContentEconomySetting[] {
  return (rows ?? []).map((setting) => {
    const platform = displayPlatform[String(setting.platform ?? "")] ?? "YouTube";
    return {
      activationAt: setting.activation_at ?? undefined,
      activationPending: Boolean(setting.activation_pending),
      classification:
        setting.classification === "external" ? "external" : "internal",
      compatibilityStatus:
        setting.compatibility_status ?? "Partially Supported",
      currentTokenCost: Number(setting.current_token_cost ?? 1),
      effectiveTokenCost: Number(setting.effective_token_cost ?? 1),
      platform,
      scheduledTokenCost: Number(setting.scheduled_token_cost ?? 1),
    };
  });
}

function localeFromProfile(profile: WorkspaceV2Profile | null): InterfaceLocale {
  return profile?.interface_language === "en" ? "en" : "es";
}

function viewerModeFromProfile(profile: WorkspaceV2Profile | null): WorkspaceV2ViewerMode {
  if (profile?.role === "super_admin") return "founder";
  if (profile?.role === "admin") return "admin";
  return "member";
}

function numericValue(value: number | string | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestampMs(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function toWorkspaceSong(row: WorkspaceV2SongRow): WorkspaceV2Song | null {
  const platform = displayPlatform[String(row.platform ?? "")] ?? "YouTube Music";
  const link = String(row.music_url ?? "").trim();
  if (!link) return null;
  const exposureScore = numericValue(row.exposure_score);
  const lastHeardAt = timestampMs(row.last_heard_at);
  return {
    artist: String(row.artist_name ?? "Unknown Artist"),
    artistId: row.user_id ?? undefined,
    category: row.category ?? row.content_type ?? null,
    coverUrl: safeCoverUrl(row.cover_image_url),
    durationSeconds:
      typeof row.content_duration_seconds === "number"
        ? row.content_duration_seconds
        : null,
    exposureScore: exposureScore ?? (row.featured ? 0 : 50),
    genre: row.genre ?? row.subcategory ?? null,
    id: row.id,
    lastHeardAt,
    link,
    playbackKind:
      getContentClassification(platform) === "internal" ? "internal" : "external",
    platform,
    subcategory: row.subcategory ?? row.genre ?? null,
    title: String(row.title ?? "Untitled Song"),
  };
}

function normalizePlatformLink(row: unknown) {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const platform =
    displayPlatform[String(record.platform ?? "")] ??
    displayPlatform[String(record.platform_key ?? "")] ??
    null;
  const url = String(record.music_url ?? record.url ?? "").trim();
  if (!platform || !url) return null;
  return { platform, url };
}

function pickExternalDiscoveryDestination(row: WorkspaceV2ExternalDiscoveryRow) {
  const links = Array.isArray(row.platform_links)
    ? row.platform_links.map(normalizePlatformLink).filter(Boolean)
    : [];
  const external = links.find((link) =>
    isExternalPlatform(link!.platform as Platform),
  );
  if (external) return external;

  const fallbackPlatform =
    displayPlatform[String(row.recommended_platform ?? row.platform ?? "")] ??
    "Spotify";
  return {
    platform: fallbackPlatform,
    url: String(row.music_url ?? "").trim(),
  };
}

function toExternalDiscoveryItem(
  row: WorkspaceV2ExternalDiscoveryRow,
): WorkspaceV2ExternalDiscoveryItem | null {
  const destination = pickExternalDiscoveryDestination(row);
  if (!destination.url) return null;
  return {
    artist: String(row.artist_name ?? "Unknown Artist"),
    artistId: row.artist_id ?? row.user_id ?? undefined,
    badge: row.badge ?? undefined,
    category: row.category ?? row.content_type ?? null,
    coverUrl: safeCoverUrl(row.cover_image_url),
    feedKind: row.feed_kind ?? undefined,
    genre: row.genre ?? row.subcategory ?? null,
    id: row.id ?? row.song_id ?? "",
    link: destination.url,
    platform: destination.platform,
    subcategory: row.subcategory ?? row.genre ?? null,
    title: String(row.title ?? "Untitled Song"),
  };
}

function buildPublicBetaQueue(rows: WorkspaceV2SongRow[], locale: InterfaceLocale): WorkspaceV2Queue {
  const songs = rows
    .map(toWorkspaceSong)
    .filter((song): song is WorkspaceV2Song => Boolean(song))
    .filter((song) => song.playbackKind === "internal");

  return {
    id: "workspace-v2-public-beta",
    mode: "discovery",
    songs,
    source: "discovery_pool",
    title:
      locale === "es"
        ? "Descubrimiento continuo"
        : "Continuous Discovery",
  };
}

async function enrichWorkspaceV2SongRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: WorkspaceV2SongRow[],
) {
  const missingMetadata = rows.some(
    (row) => !row.genre && !row.category && !row.subcategory,
  );
  if (!rows.length || !missingMetadata) return rows;

  const ids = rows.map((row) => row.id).filter(Boolean);
  if (!ids.length) return rows;

  const { data } = await supabase
    .from("songs")
    .select("id, genre, category, subcategory, content_type")
    .in("id", ids);
  const metadataById = new Map(
    ((data ?? []) as WorkspaceV2SongRow[]).map((row) => [row.id, row]),
  );

  return rows.map((row) => {
    const metadata = metadataById.get(row.id);
    if (!metadata) return row;
    return {
      ...row,
      category: row.category ?? metadata.category ?? metadata.content_type ?? null,
      content_type: row.content_type ?? metadata.content_type ?? null,
      genre: row.genre ?? metadata.genre ?? metadata.subcategory ?? null,
      subcategory: row.subcategory ?? metadata.subcategory ?? metadata.genre ?? null,
    };
  });
}

function profileDisplayName(
  profile: WorkspaceV2Profile | null,
  userEmail: string | undefined,
) {
  return (
    profile?.display_name?.trim() ||
    userEmail?.split("@")[0] ||
    "First Listen Member"
  );
}

function buildProfilePanelPayload({
  activityRows,
  connectedPlatformRows,
  impactRows,
  networkRows,
  profile,
  profileSongRows,
  removedSongHistoryRows,
  savedSongRows,
  userEmail,
  userId,
}: {
  activityRows: unknown[] | null;
  connectedPlatformRows: unknown[] | null;
  impactRows: unknown[] | Record<string, unknown> | null;
  networkRows: unknown[] | Record<string, unknown> | null;
  profile: WorkspaceV2Profile | null;
  profileSongRows: unknown[] | null;
  removedSongHistoryRows: unknown[] | null;
  savedSongRows: unknown[] | null;
  userEmail: string | undefined;
  userId: string;
}): ProfilePanelProps {
  const networkRow = (
    Array.isArray(networkRows) ? networkRows[0] : networkRows
  ) as Record<string, unknown> | null;
  const network: CommunityNetwork = {
    anonymousSupports: Number(networkRow?.anonymous_supports ?? 0),
    artistsSupported: Number(networkRow?.artists_supported ?? 0),
    autoplayNextSong: Boolean(networkRow?.autoplay_next_song ?? true),
    followers: Number(networkRow?.followers ?? 0),
    following: Number(networkRow?.following ?? 0),
    visibleSupports: Number(networkRow?.visible_supports ?? 0),
    visibility:
      networkRow?.community_visibility === "anonymous" ? "anonymous" : "public",
  };

  return {
    activity: ((activityRows ?? []) as Array<Record<string, unknown>>).map(
      (row): CommunityActivity => ({
        artistId: String(row.artist_id ?? ""),
        artistName: String(row.artist_name ?? "Unknown Artist"),
        createdAt: String(row.created_at ?? ""),
        id: String(row.event_id ?? row.id ?? ""),
        songId: row.song_id ? String(row.song_id) : undefined,
        songTitle: row.song_title ? String(row.song_title) : undefined,
        type: String(row.event_type ?? "listen") as CommunityActivity["type"],
        visibility: row.visibility === "anonymous" ? "anonymous" : "public",
      }),
    ),
    connectedPlatforms: (
      (connectedPlatformRows ?? []) as Array<Record<string, unknown>>
    ).map(
      (row): ConnectedPlatformAccount => ({
        avatarUrl: row.avatar_url ? String(row.avatar_url) : undefined,
        connectedAt: row.connected_at ? String(row.connected_at) : undefined,
        connectionStatus: String(
          row.connection_status ?? "not_connected",
        ) as ConnectedPlatformAccount["connectionStatus"],
        contentCount:
          row.content_count === null || row.content_count === undefined
            ? undefined
            : Number(row.content_count),
        creatorAccount: Boolean(row.creator_account),
        displayName: row.display_name ? String(row.display_name) : undefined,
        followerCount:
          row.follower_count === null || row.follower_count === undefined
            ? undefined
            : Number(row.follower_count),
        followingCount:
          row.following_count === null || row.following_count === undefined
            ? undefined
            : Number(row.following_count),
        lastSyncedAt: row.last_synced_at
          ? String(row.last_synced_at)
          : undefined,
        likesCount:
          row.likes_count === null || row.likes_count === undefined
            ? undefined
            : Number(row.likes_count),
        platform: String(row.platform) as ConnectedPlatform,
        profileUrl: row.profile_url ? String(row.profile_url) : undefined,
        providerVerified: Boolean(row.provider_verified),
        username: row.provider_username
          ? String(row.provider_username)
          : undefined,
      }),
    ),
    impact: (
      Array.isArray(impactRows) ? impactRows[0] : impactRows
    ) as ProfilePanelProps["impact"],
    network,
    profile: {
      autoplayNextSong: Boolean(profile?.autoplay_next_song ?? true),
      communityVisibility:
        profile?.community_visibility === "anonymous" ? "anonymous" : "public",
      credits: Number(profile?.credits ?? 0),
      displayName: profileDisplayName(profile, userEmail),
      email: userEmail ?? "",
      externalRedirectNoticeDisabled: Boolean(
        profile?.external_redirect_notice_disabled ?? false,
      ),
      founder: profile?.founder_number !== null && profile?.founder_number !== undefined,
      founderSubmissionsRemaining: Number(
        profile?.founder_free_submissions_remaining ?? 0,
      ),
      id: userId,
      role: String(profile?.role ?? "user"),
      showExplicitContent: Boolean(profile?.show_explicit_content ?? false),
    },
    removedSongHistory: (
      removedSongHistoryRows ?? []
    ) as ProfilePanelProps["removedSongHistory"],
    savedSongs: (savedSongRows ?? []) as ProfilePanelProps["savedSongs"],
    songs: (profileSongRows ?? []) as ProfilePanelProps["songs"],
  };
}

export async function WorkspaceV2AuthEntry({
  loginRedirectPath = "/dashboard",
}: {
  loginRedirectPath?: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`/login?next=${encodeURIComponent(loginRedirectPath)}`);

  const queueRowsPromise = supabase
    .rpc("get_workspace_v2_smart_queue", { queue_limit: 100 })
    .then(async ({ data, error: smartQueueError }) => {
      if (!smartQueueError && data) {
        return {
          data: data as WorkspaceV2SongRow[],
          error: null,
        };
      }

      const fallback = await supabase
        .from("songs")
        .select(
          "id, user_id, title, artist_name, genre, category, subcategory, content_type, cover_image_url, music_url, platform, content_duration_seconds, featured, created_at",
        )
        .eq("is_active", true)
        .is("archived_at", null)
        .is("removed_at", null)
        .in("platform", ["youtube_music", "youtube", "soundcloud"])
        .order("featured", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(100);

      return {
        data: (fallback.data ?? []) as WorkspaceV2SongRow[],
        error: fallback.error,
      };
    });

  const [
    { data: profile },
    { data: rows, error },
    { data: profileSongRows },
    { data: savedSongRows },
    { data: impactRows },
    { data: networkRows },
    { data: activityRows },
    { data: connectedPlatformRows },
    { data: removedSongHistoryRows },
    { data: contentEconomyRows },
    { data: externalDiscoveryRows },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "display_name, role, founder_number, interface_language, credits, founder_free_submissions_remaining, show_explicit_content, community_visibility, autoplay_next_song, external_redirect_notice_disabled",
      )
      .eq("id", user.id)
      .maybeSingle(),
    queueRowsPromise,
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
    supabase.rpc("get_content_economy_settings"),
    supabase.rpc("get_external_discovery_feed", { feed_limit: 36 }),
  ]);

  const typedProfile = profile as WorkspaceV2Profile | null;
  const locale = localeFromProfile(typedProfile);
  const spanish = locale === "es";
  const enrichedRows = await enrichWorkspaceV2SongRows(
    supabase,
    (rows ?? []) as WorkspaceV2SongRow[],
  );
  const queue = buildPublicBetaQueue(enrichedRows, locale);
  const externalDiscoveryItems = (
    (externalDiscoveryRows ?? []) as WorkspaceV2ExternalDiscoveryRow[]
  )
    .map(toExternalDiscoveryItem)
    .filter((item): item is WorkspaceV2ExternalDiscoveryItem => Boolean(item));
  const viewerMode = viewerModeFromProfile(typedProfile);
  const canAccessAdmin = viewerMode === "founder" || viewerMode === "admin";
  const founderOperations =
    viewerMode === "founder" ? await loadFounderOperationsSnapshot() : null;
  const profilePanel = buildProfilePanelPayload({
    activityRows,
    connectedPlatformRows,
    impactRows,
    networkRows,
    profile: typedProfile,
    profileSongRows,
    removedSongHistoryRows,
    savedSongRows,
    userEmail: user.email,
    userId: user.id,
  });

  return (
    <main className="workspace-v2-preview-page">
      <header className="account-header workspace-v2-preview-topbar">
        <Logo />
        <div className="owner-header-actions">
          {canAccessAdmin && (
            <Link href="/owner">
              <ShieldCheck size={16} /> Owner Control Center
            </Link>
          )}
        </div>
      </header>

      {error && (
        <section className="admin-notice" role="alert">
          {spanish
            ? "No se pudo cargar la cola beta:"
            : "Could not load the beta queue:"}{" "}
          {error.message}
        </section>
      )}

      {queue.songs.length === 0 ? (
        <section className="workspace-v2-empty">
          <h2>{spanish ? "No hay canciones internas disponibles" : "No internal songs available"}</h2>
          <p>
            {spanish
              ? "Workspace V2 necesita canciones que reproduzcan dentro de First Listen."
              : "Workspace V2 needs songs that play inside First Listen."}
          </p>
        </section>
      ) : (
        <WorkspaceV2PreviewErrorBoundary>
          <WorkspaceV2Shell
            economyMode="live"
            founderOperations={founderOperations}
            initialFounderSubmissionsRemaining={Number(
              typedProfile?.founder_free_submissions_remaining ?? 0,
            )}
            initialSubmissionTokens={Number(typedProfile?.credits ?? 0)}
            initialQueue={queue}
            externalDiscoveryItems={externalDiscoveryItems}
            locale={locale}
            contentEconomy={mapContentEconomyRows(
              contentEconomyRows as ContentEconomyRow[] | null,
            )}
            profilePanel={profilePanel}
            viewerMode={viewerMode}
          />
        </WorkspaceV2PreviewErrorBoundary>
      )}
    </main>
  );
}
