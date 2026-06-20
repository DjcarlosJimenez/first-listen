"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import {
  Apple,
  ArrowLeft,
  Archive,
  BadgeCheck,
  CalendarDays,
  Clapperboard,
  Cloud,
  CircleHelp,
  Construction,
  ExternalLink,
  Eye,
  EyeOff,
  Gauge,
  Headphones,
  MessageSquareText,
  Music2,
  Link2,
  Play,
  Save,
  ShieldCheck,
  Trash2,
  Users,
  Youtube,
} from "lucide-react";
import { Logo } from "@/components/logo";
import {
  compactClassificationLabel,
  allPlatforms,
  databasePlatform,
  displayPlatform,
  isPrimaryPlatform,
} from "@/lib/content-economy";
import { detectMusicPlatform } from "@/lib/platform";
import { createClient } from "@/lib/supabase/client";
import {
  dismissYoutubeMusicDiscovery,
  shouldShowYoutubeMusicDiscoveryRecommendation,
} from "@/lib/youtube-music-discovery";
import { useInterfaceLocale } from "@/lib/use-interface-locale";
import type {
  CommunityActivity,
  CommunityNetwork,
  ConnectedPlatform,
  ConnectedPlatformAccount,
  Platform,
} from "@/lib/types";

export type ProfileSong = {
  song_id: string;
  title: string;
  artist_name: string;
  music_url: string;
  platform: string;
  is_active: boolean;
  catalog_status: string;
  submission_token_cost: number;
  reviews: number;
  valid_listens: number;
  guest_valid_listens: number;
  community_activity: number;
  can_delete: boolean;
  can_archive: boolean;
  explicit_content: boolean;
  created_at: string;
  platform_links?: ProfilePlatformLinkRow[] | null;
};

export type ProfilePlatformLinkRow = {
  platform?: string;
  music_url?: string;
  is_primary?: boolean;
  resolution_source?: string;
  confidence_score?: number;
};

export type ProfilePlatformLink = {
  platform: Platform;
  url: string;
  primary: boolean;
  resolutionSource: string;
  confidenceScore: number;
};

export type RemovedSongHistory = {
  history_id: string;
  original_song_id: string;
  title: string;
  artist_name: string;
  music_url: string;
  platform: string;
  action: string;
  refunded_tokens: number;
  created_at: string;
};

export type SavedSong = {
  song_id: string;
  artist_id: string;
  title: string;
  artist_name: string;
  music_url: string;
  platform: string;
  genre: string;
  song_language: string;
  saved_at: string;
};

type ProfileNavigationTarget = "dashboard" | "profile" | "review" | "submit";

export type ProfilePanelProps = {
  profile: {
    id: string;
    displayName: string;
    email: string;
    founder: boolean;
    role: string;
    credits: number;
    founderSubmissionsRemaining: number;
    showExplicitContent: boolean;
    communityVisibility: "public" | "anonymous";
    autoplayNextSong: boolean;
    externalRedirectNoticeDisabled: boolean;
  };
  songs: ProfileSong[];
  savedSongs: SavedSong[];
  impact: {
    supporting_seconds: number;
    songs_reviewed: number;
    creators_supported: number;
    valid_listens: number;
    average_listening_seconds: number;
    days_active: number;
    community_points: number;
    community_rank: string;
  } | null;
  network: CommunityNetwork;
  activity: CommunityActivity[];
  connectedPlatforms: ConnectedPlatformAccount[];
  removedSongHistory: RemovedSongHistory[];
  embedded?: boolean;
  onNavigate?: (view: ProfileNavigationTarget) => void;
};

const platformDefinitions: Array<{
  id: ConnectedPlatform;
  label: string;
  icon: typeof Music2;
}> = [
  { id: "spotify", label: "Spotify", icon: Music2 },
  { id: "apple_music", label: "Apple Music", icon: Apple },
  { id: "youtube", label: "YouTube", icon: Youtube },
  { id: "soundcloud", label: "SoundCloud", icon: Cloud },
  { id: "tiktok", label: "TikTok", icon: Clapperboard },
];

const platformCompatibility: Record<ConnectedPlatform, string> = {
  spotify: "Discovery Only",
  apple_music: "Discovery Only",
  youtube: "Partially Supported",
  soundcloud: "Not Recommended",
  tiktok: "Discovery Only",
};

function platformStatus(
  status: ConnectedPlatformAccount["connectionStatus"] | undefined,
  spanish: boolean,
) {
  if (status === "connected") return spanish ? "Conectado" : "Connected";
  if (status === "pending") return spanish ? "Pendiente" : "Pending";
  if (status === "needs_reauth") return spanish ? "Reconectar" : "Reconnect Required";
  if (status === "revoked") return spanish ? "Desconectado" : "Disconnected";
  return spanish ? "No conectado" : "Not Connected";
}

function platformCompatibilityLabel(label: string, spanish: boolean) {
  if (!spanish) return label;
  if (label === "Discovery Only") return "Solo descubrimiento";
  if (label === "Partially Supported") return "Soporte parcial";
  if (label === "Not Recommended") return "No recomendado";
  return label;
}

function roleLabel(role: string, spanish: boolean) {
  const labels: Record<string, { en: string; es: string }> = {
    super_admin: { en: "Super Admin", es: "Super admin" },
    admin: { en: "Admin", es: "Admin" },
    moderator: { en: "Moderator", es: "Moderador" },
    user: { en: "User", es: "Usuario" },
  };
  const match = labels[role];
  return match ? (spanish ? match.es : match.en) : role.replace("_", " ");
}

function formatImpactDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${remainder}s`;
}

function profilePlatformFromDatabase(value: string | undefined, fallback: Platform) {
  return (
    allPlatforms.find((platform) => databasePlatform[platform] === value) ??
    fallback
  );
}

function databasePlatformToDisplay(value: string): Platform {
  return displayPlatform[value] ?? profilePlatformFromDatabase(value, "Other");
}

function mapProfilePlatformLinks(song: ProfileSong): ProfilePlatformLink[] {
  const fallbackPlatform = databasePlatformToDisplay(song.platform);
  const rows = Array.isArray(song.platform_links) ? song.platform_links : [];
  const links = rows.length
    ? rows.map((link) => {
        const platform = profilePlatformFromDatabase(
          String(link.platform ?? song.platform),
          fallbackPlatform,
        );
        return {
          platform,
          url: String(link.music_url ?? song.music_url),
          primary: Boolean(link.is_primary),
          resolutionSource: String(link.resolution_source ?? "submitted"),
          confidenceScore: Number(link.confidence_score ?? 100),
        };
      })
    : [
        {
          platform: fallbackPlatform,
          url: song.music_url,
          primary: true,
          resolutionSource: "submitted",
          confidenceScore: 100,
        },
      ];
  return links.sort(
    (left, right) =>
      Number(right.primary) - Number(left.primary) ||
      allPlatforms.indexOf(left.platform) - allPlatforms.indexOf(right.platform),
  );
}

export function ProfilePanel({
  profile,
  songs,
  savedSongs,
  impact,
  network,
  activity,
  connectedPlatforms,
  removedSongHistory,
  embedded = false,
  onNavigate,
}: ProfilePanelProps) {
  const locale = useInterfaceLocale();
  const spanish = locale === "es";
  const [name, setName] = useState(profile.displayName);
  const [showExplicit, setShowExplicit] = useState(profile.showExplicitContent);
  const [visibility, setVisibility] = useState(profile.communityVisibility);
  const [autoplayNextSong, setAutoplayNextSong] = useState(
    profile.autoplayNextSong,
  );
  const [
    externalRedirectNoticeDisabled,
    setExternalRedirectNoticeDisabled,
  ] = useState(profile.externalRedirectNoticeDisabled);
  const [message, setMessage] = useState("");
  const [tokenBalance, setTokenBalance] = useState(profile.credits);
  const [managedSongs, setManagedSongs] = useState(songs);
  const [removedSongs, setRemovedSongs] = useState(removedSongHistory);
  const [managingSongId, setManagingSongId] = useState<string | null>(null);
  const [platformEditorSongId, setPlatformEditorSongId] = useState<string | null>(
    null,
  );
  const [platformEditorPlatform, setPlatformEditorPlatform] =
    useState<Platform>("Spotify");
  const [platformEditorUrl, setPlatformEditorUrl] = useState("");
  const [platformEditorNote, setPlatformEditorNote] = useState("");
  const [platformEditorMessage, setPlatformEditorMessage] = useState("");
  const [toast, setToast] = useState("");
  const [youtubeMusicRecommendation, setYoutubeMusicRecommendation] =
    useState<{ songId: string; link: ProfilePlatformLink } | null>(null);
  const [platformLinksBySong, setPlatformLinksBySong] = useState<
    Record<string, ProfilePlatformLink[]>
  >(() =>
    Object.fromEntries(
      songs.map((song) => [song.song_id, mapProfilePlatformLinks(song)]),
    ),
  );

  const showToast = (nextMessage: string) => {
    setToast(nextMessage);
    window.setTimeout(() => setToast(""), 3200);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const supabase = createClient();
    if (!supabase) return;
    const [
      { error: profileError },
      { error: communityError },
      { error: redirectError },
    ] =
      await Promise.all([
        supabase.rpc("update_profile_preferences", {
          profile_display_name: name,
          profile_show_explicit_content: showExplicit,
        }),
        supabase.rpc("update_community_preferences", {
          profile_community_visibility: visibility,
          profile_autoplay_next_song: autoplayNextSong,
        }),
        supabase.rpc("update_external_redirect_preference", {
          notice_disabled: externalRedirectNoticeDisabled,
        }),
      ]);
    setMessage(
      profileError?.message ??
        communityError?.message ??
        redirectError?.message ??
        (spanish ? "Perfil guardado." : "Profile saved."),
    );
  };

  const manageSong = async (
    song: ProfileSong,
    action: "delete" | "archive",
  ) => {
    const confirmation =
      action === "delete"
        ? spanish
          ? `¿Eliminar "${song.title}" permanentemente? ${
              song.submission_token_cost > 0
                ? `Se reembolsarán ${song.submission_token_cost} token${song.submission_token_cost === 1 ? "" : "s"}.`
                : "No se cobró ningún token por este envío."
            }`
          : `Delete "${song.title}" permanently? ${
              song.submission_token_cost > 0
                ? `${song.submission_token_cost} token${song.submission_token_cost === 1 ? "" : "s"} will be refunded.`
                : "No token was charged for this submission."
            }`
        : spanish
          ? `¿Archivar "${song.title}"? Saldrá del descubrimiento y de la lista de canciones por escuchar, pero sus estadísticas seguirán disponibles. No se reembolsarán tokens.`
          : `Archive "${song.title}"? It will leave discovery and the review queue, while its statistics remain available. No tokens will be refunded.`;
    if (!window.confirm(confirmation)) return;

    const supabase = createClient();
    if (!supabase) return;
    setManagingSongId(song.song_id);
    setMessage("");

    if (action === "delete") {
      const { data, error } = await supabase.rpc("delete_my_song", {
        target_song_id: song.song_id,
      });
      const result = Array.isArray(data) ? data[0] : data;
      if (error) {
        setMessage(error.message);
      } else {
        setManagedSongs((current) =>
          current.filter((item) => item.song_id !== song.song_id),
        );
        setTokenBalance(
          Number(result?.new_credit_balance ?? tokenBalance),
        );
        setRemovedSongs((current) => [
          {
            history_id: crypto.randomUUID(),
            original_song_id: song.song_id,
            title: song.title,
            artist_name: song.artist_name,
            music_url: song.music_url,
            platform: song.platform,
            action: "deleted",
            refunded_tokens: Number(result?.refunded_tokens ?? 0),
            created_at: new Date().toISOString(),
          },
          ...current,
        ]);
        setMessage(
          Number(result?.refunded_tokens ?? 0) > 0
            ? spanish
              ? `Canción eliminada. Se reembolsaron ${result.refunded_tokens} token${Number(result.refunded_tokens) === 1 ? "" : "s"}.`
              : `Song deleted. ${result.refunded_tokens} token${Number(result.refunded_tokens) === 1 ? "" : "s"} refunded.`
            : spanish
              ? "Canción eliminada."
              : "Song deleted.",
        );
      }
    } else {
      const { error } = await supabase.rpc("archive_my_song", {
        target_song_id: song.song_id,
      });
      if (error) {
        setMessage(error.message);
      } else {
        setManagedSongs((current) =>
          current.map((item) =>
            item.song_id === song.song_id
              ? {
                  ...item,
                  catalog_status: "archived",
                  is_active: false,
                  can_archive: false,
                  can_delete: false,
                }
              : item,
          ),
        );
        setMessage(
          spanish
            ? "Canción archivada. Sus estadísticas se conservan."
            : "Song archived. Its statistics are preserved.",
        );
      }
    }

    setManagingSongId(null);
  };

  const openPlatformEditor = async (song: ProfileSong) => {
    const nextOpen = platformEditorSongId === song.song_id ? null : song.song_id;
    setPlatformEditorSongId(nextOpen);
    setPlatformEditorMessage("");
    setPlatformEditorUrl("");
    setPlatformEditorNote("");
    const primaryPlatform = databasePlatformToDisplay(song.platform);
    setPlatformEditorPlatform(
      allPlatforms.find((platform) => platform !== primaryPlatform) ??
        "Spotify",
    );
    if (!nextOpen || platformLinksBySong[song.song_id]) return;

    const supabase = createClient();
    if (!supabase) return;
    const { data, error } = await supabase.rpc("song_platform_links_json", {
      target_song_id: song.song_id,
    });
    if (error || !Array.isArray(data)) return;
    setPlatformLinksBySong((current) => ({
      ...current,
      [song.song_id]: mapProfilePlatformLinks({
        ...song,
        platform_links: data as ProfilePlatformLinkRow[],
      }),
    }));
  };

  const savePlatformDestination = async (song: ProfileSong) => {
    setPlatformEditorMessage("");
    if (!platformEditorUrl.trim()) {
      setPlatformEditorMessage(
        spanish
          ? "Pega un enlace oficial de la plataforma."
          : "Paste an official platform link.",
      );
      return;
    }
    const detection = detectMusicPlatform(platformEditorUrl);
    if (
      !detection.valid ||
      (platformEditorPlatform !== "Other" &&
        detection.platform !== platformEditorPlatform)
    ) {
      setPlatformEditorMessage(
        spanish
          ? `Detectado: ${detection.platform ?? "no compatible"}. Elige la plataforma correspondiente.`
          : `Detected: ${detection.platform ?? "unsupported"}. Choose the matching platform.`,
      );
      return;
    }
    const supabase = createClient();
    if (!supabase) return;
    setManagingSongId(song.song_id);
    const { data, error } = await supabase.rpc(
      "upsert_song_platform_presence_link",
      {
        target_song_id: song.song_id,
        target_platform: databasePlatform[platformEditorPlatform],
        target_music_url: platformEditorUrl.trim(),
        presence_note: platformEditorNote.trim() || null,
      },
    );
    setManagingSongId(null);
    if (error) {
      setPlatformEditorMessage(error.message);
      return;
    }
    const row = data as ProfilePlatformLinkRow;
    const savedPlatform = profilePlatformFromDatabase(
      String(row.platform ?? databasePlatform[platformEditorPlatform]),
      platformEditorPlatform,
    );
    const existingLinks =
      platformLinksBySong[song.song_id] ?? mapProfilePlatformLinks(song);
    const primaryPlatform = existingLinks.find((link) => link.primary)?.platform;
    const savedLink: ProfilePlatformLink = {
      platform: savedPlatform,
      url: String(row.music_url ?? platformEditorUrl.trim()),
      primary: Boolean(row.is_primary),
      resolutionSource: String(row.resolution_source ?? "manual"),
      confidenceScore: Number(row.confidence_score ?? 100),
    };
    setPlatformLinksBySong((current) => ({
      ...current,
      [song.song_id]: [
        ...(current[song.song_id] ?? mapProfilePlatformLinks(song)).filter(
          (link) => link.platform !== savedPlatform,
        ),
        savedLink,
      ].sort(
        (left, right) =>
          Number(right.primary) - Number(left.primary) ||
          allPlatforms.indexOf(left.platform) -
            allPlatforms.indexOf(right.platform),
      ),
    }));
    setPlatformEditorUrl("");
    setPlatformEditorNote("");
    setPlatformEditorMessage(spanish ? "Enlace guardado." : "Platform link saved.");
    if (
      shouldShowYoutubeMusicDiscoveryRecommendation({
        primaryPlatform: savedLink.primary ? savedPlatform : primaryPlatform,
        savedPlatform,
        songId: song.song_id,
      })
    ) {
      setYoutubeMusicRecommendation({ songId: song.song_id, link: savedLink });
    }
  };

  const removePlatformDestination = async (
    song: ProfileSong,
    link: ProfilePlatformLink,
  ) => {
    const supabase = createClient();
    if (!supabase) return;
    setManagingSongId(song.song_id);
    const { error } = await supabase.rpc("remove_song_platform_presence_link", {
      target_song_id: song.song_id,
      target_platform: databasePlatform[link.platform],
    });
    setManagingSongId(null);
    if (error) {
      setPlatformEditorMessage(error.message);
      return;
    }
    setPlatformLinksBySong((current) => ({
      ...current,
      [song.song_id]: (current[song.song_id] ?? mapProfilePlatformLinks(song)).filter(
        (item) => item.platform !== link.platform || item.primary,
      ),
    }));
    setPlatformEditorMessage(
      spanish ? "Enlace eliminado." : "Platform link removed.",
    );
  };

  const makePrimaryPlatform = async (
    song: ProfileSong,
    link: ProfilePlatformLink,
    options?: { discoveryUpgrade?: boolean },
  ) => {
    if (!isPrimaryPlatform(link.platform)) {
      setPlatformEditorMessage(
        spanish
          ? "Este enlace no puede usarse como plataforma principal de descubrimiento."
          : "This link cannot be used as the primary discovery platform.",
      );
      return false;
    }
    const supabase = createClient();
    if (!supabase) return false;
    setManagingSongId(song.song_id);
    const { data, error } = await supabase.rpc("set_song_primary_platform", {
      target_song_id: song.song_id,
      target_platform: databasePlatform[link.platform],
    });
    setManagingSongId(null);
    if (error) {
      setPlatformEditorMessage(error.message);
      return false;
    }
    const result = data as {
      platform?: string;
      music_url?: string;
      platform_links?: ProfilePlatformLinkRow[];
    };
    const nextPlatform = profilePlatformFromDatabase(
      String(result.platform ?? databasePlatform[link.platform]),
      link.platform,
    );
    const nextUrl = String(result.music_url ?? link.url);
    setManagedSongs((current) =>
      current.map((item) =>
        item.song_id === song.song_id
          ? {
              ...item,
              platform: databasePlatform[nextPlatform],
              music_url: nextUrl,
              platform_links: result.platform_links ?? item.platform_links,
            }
          : item,
      ),
    );
    setPlatformLinksBySong((current) => ({
      ...current,
      [song.song_id]: mapProfilePlatformLinks({
        ...song,
        platform: databasePlatform[nextPlatform],
        music_url: nextUrl,
        platform_links: result.platform_links,
      }),
    }));
    const successMessage = options?.discoveryUpgrade
      ? spanish
        ? "✅ Ajustes de descubrimiento actualizados. YouTube Music ahora es tu plataforma principal de descubrimiento."
        : "✅ Discovery settings updated. YouTube Music is now your Primary Discovery Platform."
      : spanish
        ? `${nextPlatform} ahora es tu plataforma principal de descubrimiento.`
        : `${nextPlatform} is now your Primary Discovery Platform.`;
    setPlatformEditorMessage(successMessage);
    showToast(successMessage);
    return true;
  };

  return (
    <main className={embedded ? "account-page account-page-embedded" : "account-page"}>
      {!embedded && (
        <header className="account-header">
          <Logo />
          <div className="owner-header-actions">
            <Link href="/help"><CircleHelp size={16} /> {spanish ? "¿Necesitas ayuda?" : "Need Help?"}</Link>
            <Link href="/dashboard"><ArrowLeft size={16} /> {spanish ? "Descubrir música" : "Discover Music"}</Link>
          </div>
        </header>
      )}
      <div className="account-grid">
        <section className="account-card">
          <span className="eyebrow">{spanish ? "Perfil" : "Profile"}</span>
          <h1>{profile.displayName}</h1>
          <div className="profile-badges">
            <span><ShieldCheck size={14} /> {roleLabel(profile.role, spanish)}</span>
            {profile.founder && <span><BadgeCheck size={14} /> {spanish ? "Artista fundador" : "Founding Artist"}</span>}
            <span>
              {profile.role === "super_admin"
                ? spanish
                  ? "Balance de tokens: ilimitado"
                  : "Token balance: unlimited"
                : spanish
                  ? `Balance de tokens: ${tokenBalance}`
                  : `Token balance: ${tokenBalance}`}
            </span>
            {profile.founder && (
              <span>
                {spanish
                  ? `Envios Founder gratis: ${profile.founderSubmissionsRemaining}`
                  : `Founder free submissions: ${profile.founderSubmissionsRemaining}`}
              </span>
            )}
          </div>
          <div className="impact-profile">
            <div>
              <Headphones size={16} />
              <strong>{formatImpactDuration(impact?.supporting_seconds ?? 0)}</strong>
              <span>{spanish ? "Tiempo apoyando creadores" : "Time Supporting Creators"}</span>
            </div>
            <div>
              <MessageSquareText size={16} />
              <strong>{impact?.songs_reviewed ?? 0}</strong>
              <span>{spanish ? "Canciones revisadas" : "Songs Reviewed"}</span>
            </div>
            <div>
              <Users size={16} />
              <strong>{impact?.creators_supported ?? 0}</strong>
              <span>{spanish ? "Creadores apoyados" : "Creators Supported"}</span>
            </div>
            <div>
              <Music2 size={16} />
              <strong>{impact?.valid_listens ?? 0}</strong>
              <span>{spanish ? "Reproducciones que suman" : "Plays that count"}</span>
            </div>
            <div>
              <Gauge size={16} />
              <strong>{formatImpactDuration(impact?.average_listening_seconds ?? 0)}</strong>
              <span>{spanish ? "Duración promedio de escucha" : "Average Listening Duration"}</span>
            </div>
            <div>
              <CalendarDays size={16} />
              <strong>{impact?.days_active ?? 0}</strong>
              <span>{spanish ? "Días activos" : "Days Active"}</span>
            </div>
          </div>
          <div className="community-rank-card">
            <BadgeCheck size={18} />
            <span>
              <strong>{impact?.community_rank ?? (spanish ? "Nuevo miembro" : "New Member")}</strong>
              <small>{impact?.community_points ?? 0} {spanish ? "Puntos de la comunidad" : "Community Points"}</small>
            </span>
          </div>
          <div className="community-network-grid">
            <div><strong>{network.followers}</strong><span>{spanish ? "Seguidores" : "Followers"}</span></div>
            <div><strong>{network.following}</strong><span>{spanish ? "Siguiendo" : "Following"}</span></div>
            <div><strong>{network.artistsSupported}</strong><span>{spanish ? "Artistas apoyados" : "Artists Supported"}</span></div>
            <div><strong>{network.visibleSupports}</strong><span>{spanish ? "Apoyos visibles" : "Visible Supports"}</span></div>
            <div><strong>{network.anonymousSupports}</strong><span>{spanish ? "Apoyos anónimos" : "Anonymous Supports"}</span></div>
          </div>
          <Link
            className="public-profile-link"
            data-artist-profile-button
            data-ui-component="artistProfileButton"
            href={`/artists/${profile.id}`}
          >
            {spanish ? "Ver perfil público de artista" : "View public artist profile"} <ExternalLink size={14} />
          </Link>
          <section
            aria-labelledby="connected-platforms-heading"
            className="connected-platforms-card"
          >
            <div className="connected-platforms-heading">
              <span>
                <strong id="connected-platforms-heading">
                  {spanish ? "Plataformas conectadas" : "Connected Platforms"}
                </strong>
                <small>{spanish ? "Futuras conexiones de creador" : "Future creator account connections"}</small>
              </span>
              <span className="coming-soon-badge">
                <Construction size={13} /> {spanish ? "Próximamente" : "Coming Soon"}
              </span>
            </div>
            <div className="connected-platforms-list">
              {platformDefinitions.map((platform) => {
                const account = connectedPlatforms.find(
                  (item) => item.platform === platform.id,
                );
                const PlatformIcon = platform.icon;
                const status = platformStatus(account?.connectionStatus, spanish);
                return (
                  <div key={platform.id}>
                    <span className="connected-platform-icon" aria-hidden="true">
                      <PlatformIcon size={17} />
                    </span>
                    <span className="connected-platform-name">
                      <strong>{platform.label}</strong>
                      <small>{platformCompatibilityLabel(platformCompatibility[platform.id], spanish)}</small>
                    </span>
                    <span
                      className={
                        account?.connectionStatus === "connected"
                          ? "platform-status connected"
                          : "platform-status"
                      }
                    >
                      {status}
                    </span>
                  </div>
                );
              })}
            </div>
            <p>
              {spanish
                ? "Las futuras conexiones de cuenta permitirán perfiles verificados, enlaces públicos y estadísticas cuando las APIs oficiales lo permitan."
                : "Future account linking and creator verification will support verified profiles, public links, and provider statistics where official APIs permit them."}
            </p>
          </section>
          <form onSubmit={save}>
            <label className="auth-field">
              <span>{spanish ? "Nombre" : "Name"}</span>
              <input onChange={(event) => setName(event.target.value)} required value={name} />
            </label>
            <label className="auth-field">
              <span>Email</span>
              <input disabled value={profile.email} />
            </label>
            <label className="setting-toggle">
              <input
                checked={showExplicit}
                onChange={(event) => setShowExplicit(event.target.checked)}
                type="checkbox"
              />
              <span>
                <strong>{spanish ? "Mostrar contenido explícito" : "Show Explicit Content"}</strong>
                {spanish
                  ? " Si lo desactivas, ocultamos canciones marcadas como explícitas en tu lista de canciones por escuchar."
                  : " Hide explicit songs from your review queue when disabled."}
              </span>
            </label>
            <label className="setting-toggle">
              <input
                checked={!externalRedirectNoticeDisabled}
                onChange={(event) =>
                  setExternalRedirectNoticeDisabled(!event.target.checked)
                }
                type="checkbox"
              />
              <Link2 size={16} />
              <span>
                <strong>{spanish ? "Avisos al abrir fuera de First Listen" : "External Content Warnings"}</strong>
                {spanish
                  ? " Confirma antes de abrir Spotify, Apple Music o TikTok en una pestaña nueva."
                  : " Confirm before Spotify, Apple Music, or TikTok opens in a new tab."}
              </span>
            </label>
            <fieldset className="community-visibility-card">
              <legend>{spanish ? "Visibilidad en la comunidad" : "Community Visibility"}</legend>
              <label>
                <input
                  checked={visibility === "public"}
                  name="community-visibility"
                  onChange={() => setVisibility("public")}
                  type="radio"
                />
                <Eye size={16} />
                <span>
                  <strong>{spanish ? "Colaborador público (recomendado)" : "Public Supporter (Recommended)"}</strong>
                  {spanish
                    ? " Los artistas pueden ver cuando apoyas su música. Esto puede generar más visitas, seguidores y conexiones."
                    : " Artists can see when you support their music. This can lead to more profile visits, followers, and creator connections."}
                </span>
              </label>
              <label>
                <input
                  checked={visibility === "anonymous"}
                  name="community-visibility"
                  onChange={() => setVisibility("anonymous")}
                  type="radio"
                />
                <EyeOff size={16} />
                <span>
                  <strong>{spanish ? "Colaborador anónimo" : "Anonymous Supporter"}</strong>
                  {spanish
                    ? " Tu apoyo sigue contando, pero los artistas verán Oyente anónimo en lugar de tu nombre."
                    : " Your support remains valid, but artists see Anonymous Listener instead of your name."}
                </span>
              </label>
            </fieldset>
            <label className="setting-toggle">
              <input
                checked={autoplayNextSong}
                onChange={(event) => setAutoplayNextSong(event.target.checked)}
                type="checkbox"
              />
              <Play size={16} />
              <span>
                <strong>{spanish ? "Reproducir siguiente canción automáticamente" : "Auto Play Next Song"}</strong>
                {spanish
                  ? " Carga y reproduce la siguiente canción cuando termine la actual."
                  : " Load and play the next queued song after the current song ends."}
              </span>
            </label>
            {message && <p className="form-message" role="status">{message}</p>}
            <button className="auth-submit" type="submit"><Save size={15} /> {spanish ? "Guardar perfil" : "Save profile"}</button>
          </form>
        </section>

        <section className="account-card my-songs" id="submitted-songs">
          <div className="saved-song-heading">
            <span className="eyebrow">{spanish ? "Mis canciones" : "My Songs"}</span>
            <h2>{spanish ? "Canciones enviadas" : "Submitted songs"}</h2>
          </div>
          {managedSongs.length === 0 ? (
            <div className="empty-state">
              <p>{spanish ? "Todavía no has enviado canciones." : "No songs submitted yet."}</p>
              {onNavigate ? (
                <button className="text-link-button" onClick={() => onNavigate("submit")} type="button">
                  {spanish ? "Enviar tu primera canción" : "Submit your first song"}
                </button>
              ) : (
                <Link href="/submit">{spanish ? "Enviar tu primera canción" : "Submit your first song"}</Link>
              )}
            </div>
          ) : (
            <div className="song-table">
              {managedSongs.map((song) => {
                const editorOpen = platformEditorSongId === song.song_id;
                const songPlatform = databasePlatformToDisplay(song.platform);
                const links =
                  platformLinksBySong[song.song_id] ??
                  mapProfilePlatformLinks(song);
                const primaryLink = links.find((link) => link.primary);
                const youtubeMusicLink = links.find(
                  (link) => link.platform === "YouTube Music",
                );
                const showYoutubeMusicTip =
                  Boolean(youtubeMusicLink) &&
                  primaryLink?.platform === "Spotify";
                const addablePlatforms = allPlatforms.filter(
                  (platform) => platform !== songPlatform,
                );
                return (
                <article
                  className="submitted-song-card"
                  id={`song-${song.song_id}`}
                  key={song.song_id}
                >
                  <div className="submitted-song-copy">
                    <strong className="submitted-song-title" title={song.title}>
                      {song.title}
                    </strong>
                    <span
                      className="submitted-song-meta"
                      title={`${song.artist_name} / ${displayPlatform[song.platform] ?? song.platform}`}
                    >
                      {song.artist_name} /{" "}
                      {displayPlatform[song.platform] ?? song.platform} /{" "}
                      {displayPlatform[song.platform]
                        ? compactClassificationLabel(
                            displayPlatform[song.platform],
                            locale,
                          )
                        : ""}
                    </span>
                    <small className="song-activity-summary submitted-song-metrics">
                      {song.reviews} {spanish ? "reseñas" : "reviews"} /{" "}
                      {song.valid_listens + song.guest_valid_listens}{" "}
                      {spanish ? "reproducciones que suman" : "plays that count"} /{" "}
                      {song.community_activity} {spanish ? "acciones de comunidad" : "community actions"}
                    </small>
                  </div>
                  <span
                    className={
                      song.catalog_status === "active"
                        ? "status-active submitted-song-status"
                        : "status-removed submitted-song-status"
                    }
                  >
                    {song.catalog_status === "active"
                      ? spanish
                        ? "🟢 Activa"
                        : "🟢 Active"
                      : song.catalog_status.replaceAll("_", " ")}
                  </span>
                  {song.explicit_content && <small>{spanish ? "Explícita" : "Explicit"}</small>}
                  <div className="song-management-actions">
                    {song.can_delete && (
                      <button
                        disabled={managingSongId === song.song_id}
                        onClick={() => void manageSong(song, "delete")}
                        type="button"
                      >
                        <Trash2 size={14} /> {spanish ? "Eliminar canción" : "Delete Song"}
                      </button>
                    )}
                    {song.can_archive && (
                      <button
                        disabled={managingSongId === song.song_id}
                        onClick={() => void manageSong(song, "archive")}
                        type="button"
                      >
                        <Archive size={14} /> {spanish ? "Archivar canción" : "Archive Song"}
                      </button>
                    )}
                    <button
                      aria-controls={`platform-presence-${song.song_id}`}
                      aria-expanded={editorOpen}
                      className="song-platform-presence-cta"
                      data-ui-component="profilePlatformPresenceButton"
                      disabled={managingSongId === song.song_id}
                      onClick={() => void openPlatformEditor(song)}
                      type="button"
                    >
                      <Music2 size={14} />
                      <span>
                        {editorOpen
                          ? spanish
                            ? "Cerrar plataformas"
                            : "Close Platforms"
                          : spanish
                            ? "Agregar plataformas"
                            : "Add Platforms"}
                        <small>Spotify, Apple, TikTok, YouTube Music</small>
                      </span>
                    </button>
                    <a href={song.music_url} rel="noreferrer" target="_blank" aria-label={spanish ? `Abrir ${song.title}` : `Open ${song.title}`}>
                      <ExternalLink size={15} />
                    </a>
                    <Link
                      data-artist-profile-button
                      data-ui-component="artistProfileButton"
                      href={`/artists/${profile.id}`}
                    >
                      {spanish ? "Perfil de artista" : "Artist Profile"}
                    </Link>
                  </div>
                  {editorOpen && (
                    <div
                      className="profile-platform-editor"
                      id={`platform-presence-${song.song_id}`}
                    >
                      <div className="platform-editor-heading">
                        <span className="eyebrow">{spanish ? "Plataformas de descubrimiento" : "Discovery Platforms"}</span>
                        <strong>{song.title}</strong>
                        <small>
                          {spanish
                            ? `Plataforma principal de descubrimiento: ${songPlatform}. Los enlaces adicionales se abren fuera de First Listen.`
                            : `Primary discovery platform: ${songPlatform}. Additional links open outside First Listen.`}
                        </small>
                      </div>
                      <div className="platform-disclaimer-card">
                        <strong>{spanish ? "💡 Importante" : "💡 Important"}</strong>
                        <p>
                          {spanish
                            ? "Los enlaces adicionales deben pertenecer a la misma canción o video. Puedes agregarlos ahora o después desde los ajustes de la canción."
                            : "Additional platforms must belong to the same song or video you are publishing. You can add them now or later from the song settings."}
                        </p>
                      </div>
                      <div className="platform-reminder-card">
                        <strong>{spanish ? "💡 Recordatorio" : "💡 Reminder"}</strong>
                        <p>
                          {spanish
                            ? "La plataforma principal de descubrimiento controla la reproducción usada por First Listen. Los enlaces adicionales son destinos de descubrimiento y deben corresponder a la misma canción o video."
                            : "The Primary Discovery Platform controls playback in First Listen. Additional links are discovery destinations and must match the same song or video."}
                        </p>
                      </div>
                      {showYoutubeMusicTip && youtubeMusicLink && (
                        <div className="platform-discovery-tip-card">
                          <strong>{spanish ? "💡 Consejo de descubrimiento" : "💡 Discovery Tip"}</strong>
                          <p>
                            {spanish
                              ? "YouTube Music está disponible para esta canción."
                              : "YouTube Music is available for this song."}
                            <br />
                            {spanish
                              ? "Las recomendaciones de YouTube pueden ayudar a nuevos oyentes a descubrir tu música."
                              : "YouTube recommendations can help new listeners discover your music."}
                          </p>
                          <button
                            className="primary-button"
                            disabled={managingSongId === song.song_id}
                            onClick={() =>
                              void makePrimaryPlatform(song, youtubeMusicLink, {
                                discoveryUpgrade: true,
                              })
                            }
                            type="button"
                          >
                            {spanish ? "🚀 Aumentar mi descubrimiento" : "🚀 Increase My Discovery"}
                          </button>
                        </div>
                      )}
                      <div className="profile-platform-link-list">
                        {links.map((link) => (
                          <div key={`${song.song_id}-${link.platform}`}>
                            <span>
                              <Music2 size={14} />
                              <strong>{link.platform}</strong>
                              <small>
                                {link.primary
                                  ? spanish
                                    ? "Plataforma principal de descubrimiento"
                                    : "Primary Discovery Platform"
                                  : spanish
                                    ? "Enlace adicional"
                                    : "Additional Link"}
                              </small>
                            </span>
                            <div>
                              <a href={link.url} rel="noreferrer" target="_blank">
                                <ExternalLink size={13} /> {spanish ? "Abrir enlace" : "Open link"}
                              </a>
                              {!link.primary && isPrimaryPlatform(link.platform) && (
                                <button
                                  disabled={managingSongId === song.song_id}
                                  onClick={() =>
                                    void makePrimaryPlatform(song, link)
                                  }
                                  type="button"
                                >
                                  {spanish ? "🚀 Aumentar descubrimiento" : "🚀 Increase discovery"}
                                </button>
                              )}
                              {!link.primary && (
                                <button
                                  disabled={managingSongId === song.song_id}
                                  onClick={() =>
                                    void removePlatformDestination(song, link)
                                  }
                                  type="button"
                                >
                                  {spanish ? "Quitar" : "Remove"}
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      <form
                        className="profile-platform-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void savePlatformDestination(song);
                        }}
                      >
                        <label>
                          {spanish ? "Plataforma" : "Platform"}
                          <select
                            onChange={(event) =>
                              setPlatformEditorPlatform(
                                event.target.value as Platform,
                              )
                            }
                            value={platformEditorPlatform}
                          >
                            {addablePlatforms.map((platform) => (
                              <option key={platform} value={platform}>
                                {platform}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          {spanish ? "Enlace oficial" : "Official link"}
                          <input
                            onChange={(event) =>
                              setPlatformEditorUrl(event.target.value)
                            }
                            placeholder="https://"
                            type="url"
                            value={platformEditorUrl}
                          />
                        </label>
                        <label>
                          {spanish ? "Nota opcional" : "Optional note"}
                          <input
                            maxLength={120}
                            onChange={(event) =>
                              setPlatformEditorNote(event.target.value)
                            }
                            placeholder={spanish ? "Enlace oficial del artista" : "Official artist link"}
                            value={platformEditorNote}
                          />
                        </label>
                        <button
                          disabled={managingSongId === song.song_id}
                          type="submit"
                        >
                          <Save size={14} /> {spanish ? "Guardar enlace" : "Save link"}
                        </button>
                      </form>
                      {platformEditorMessage && (
                        <small className="form-message" role="status">
                          {platformEditorMessage}
                        </small>
                      )}
                    </div>
                  )}
                </article>
                );
              })}
            </div>
          )}
          {message && <p className="form-message" role="status">{message}</p>}

          <details className="removed-song-history" id="removed-song-history">
            <summary>
              {spanish ? "Historial de canciones quitadas" : "Removed Songs History"}
              <span>{removedSongs.length}</span>
            </summary>
            {removedSongs.length ? (
              <div className="song-table">
                {removedSongs.map((song) => (
                  <article key={song.history_id}>
                    <div>
                      <strong>{song.title}</strong>
                      <span>
                        {song.artist_name} /{" "}
                        {displayPlatform[song.platform] ?? song.platform}
                      </span>
                    </div>
                    <span className="status-removed">
                      {song.action.replaceAll("_", " ")}
                    </span>
                    <small>
                      {song.refunded_tokens > 0
                        ? spanish
                          ? `${song.refunded_tokens} token reembolsado${song.refunded_tokens === 1 ? "" : "s"}`
                          : `${song.refunded_tokens} token refund`
                        : spanish
                          ? "Sin reembolso de tokens"
                          : "No token refund"}
                    </small>
                    <a
                      aria-label={spanish ? `Abrir ${song.title}` : `Open ${song.title}`}
                      href={song.music_url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <ExternalLink size={15} />
                    </a>
                  </article>
                ))}
              </div>
            ) : (
              <p>{spanish ? "No hay canciones quitadas." : "No removed songs."}</p>
            )}
          </details>

          <div className="profile-community-activity-section" id="community-activity">
            <span className="eyebrow">{spanish ? "Actividad reciente de la comunidad" : "Recent Community Activity"}</span>
            <h2>{spanish ? "Tus conexiones con creadores" : "Your creator connections"}</h2>
            <div className="profile-activity-list">
              {activity.map((item) => (
                <article key={item.id}>
                  <span>
                    {item.type === "follow" ? (
                      <Users size={15} />
                    ) : item.type === "review" ? (
                      <MessageSquareText size={15} />
                    ) : (
                      <Headphones size={15} />
                    )}
                  </span>
                  <div>
                    <strong>
                      {item.type === "follow"
                        ? spanish
                          ? `Seguiste a ${item.artistName}`
                          : `You followed ${item.artistName}`
                        : item.type === "review"
                          ? spanish
                            ? `Comentaste ${item.songTitle ?? "una canción"}`
                            : `You reviewed ${item.songTitle ?? "a song"}`
                          : spanish
                            ? `Apoyaste ${item.songTitle ?? "una canción"}`
                            : `You supported ${item.songTitle ?? "a song"}`}
                    </strong>
                    <small>
                      {item.visibility === "public"
                        ? spanish
                          ? "Apoyo visible"
                          : "Visible support"
                        : spanish
                          ? "Apoyo anónimo"
                          : "Anonymous support"}
                    </small>
                  </div>
                  <Link
                    data-artist-profile-button
                    data-ui-component="artistProfileButton"
                  href={`/artists/${item.artistId}`}
                >
                    {spanish ? "Ver artista" : "View Artist"}
                  </Link>
                </article>
              ))}
              {!activity.length && (
                <div className="empty-state">
                  <p>{spanish ? "Tus escuchas, comentarios y artistas seguidos aparecerán aquí." : "Your listens, reviews, and follows will appear here."}</p>
                  {onNavigate ? (
                    <button className="text-link-button" onClick={() => onNavigate("dashboard")} type="button">
                      {spanish ? "Apoyar a un creador" : "Support a creator"}
                    </button>
                  ) : (
                    <Link href="/dashboard">{spanish ? "Apoyar a un creador" : "Support a creator"}</Link>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="saved-song-heading">
            <span className="eyebrow">{spanish ? "Guardadas para después" : "Saved For Later"}</span>
            <h2>{spanish ? "Música para volver a escuchar" : "Music to revisit"}</h2>
          </div>
          {savedSongs.length === 0 ? (
            <div className="empty-state">
              <p>{spanish ? "Las canciones que guardes aparecerán aquí." : "Songs you save after reviews will appear here."}</p>
              {onNavigate ? (
                <button className="text-link-button" onClick={() => onNavigate("dashboard")} type="button">
                  {spanish ? "Escuchar y descubrir música" : "Review and discover music"}
                </button>
              ) : (
                <Link href="/dashboard">{spanish ? "Escuchar y descubrir música" : "Review and discover music"}</Link>
              )}
            </div>
          ) : (
            <div className="song-table">
              {savedSongs.map((song) => (
                <article key={song.song_id}>
                  <div>
                    <strong>{song.title}</strong>
                    <span>
                      {song.artist_name} /{" "}
                      {displayPlatform[song.platform] ?? song.platform} /{" "}
                      {displayPlatform[song.platform]
                        ? compactClassificationLabel(
                            displayPlatform[song.platform],
                            locale,
                          )
                        : ""}
                    </span>
                  </div>
                  <Link
                    data-artist-profile-button
                    data-ui-component="artistProfileButton"
                  href={`/artists/${song.artist_id}`}
                >
                    {spanish ? "Ver artista" : "View Artist"}
                  </Link>
                  <small>{song.genre} / {song.song_language}</small>
                  <a href={song.music_url} rel="noreferrer" target="_blank" aria-label={spanish ? `Abrir ${song.title}` : `Open ${song.title}`}>
                    <ExternalLink size={15} />
                  </a>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
      {toast && (
        <div className="toast visible" role="status">
          <BadgeCheck size={18} />
          {toast}
        </div>
      )}
      {youtubeMusicRecommendation && (
        <div className="platform-discovery-dialog-backdrop">
          <div
            aria-labelledby="profile-youtube-music-discovery-title"
            aria-modal="true"
            className="platform-discovery-dialog"
            role="dialog"
          >
            <h3 id="profile-youtube-music-discovery-title">
              {spanish ? "🚀 Más descubrimiento disponible" : "🚀 More Discovery Available"}
            </h3>
            <p>{spanish ? "Agregaste YouTube Music." : "You just added YouTube Music."}</p>
            <p>
              {spanish
                ? "Las recomendaciones de YouTube pueden ayudar a nuevos oyentes a descubrir tu música."
                : "YouTube recommendations can help new listeners discover your music."}
            </p>
            <p>
              {spanish
                ? "Cambiar a YouTube Music como plataforma principal de descubrimiento puede aumentar tus oportunidades de descubrimiento."
                : "Switching to YouTube Music as your Primary Discovery Platform may increase your discovery opportunities."}
            </p>
            <div className="platform-guidance-actions">
              <button
                className="primary-button"
                disabled={Boolean(managingSongId)}
                onClick={async () => {
                  const targetSong = managedSongs.find(
                    (song) =>
                      song.song_id === youtubeMusicRecommendation.songId,
                  );
                  if (!targetSong) {
                    setYoutubeMusicRecommendation(null);
                    return;
                  }
                  const updated = await makePrimaryPlatform(
                    targetSong,
                    youtubeMusicRecommendation.link,
                    { discoveryUpgrade: true },
                  );
                  if (updated) {
                    setYoutubeMusicRecommendation(null);
                  }
                }}
                type="button"
              >
                {spanish ? "🚀 Aumentar mi descubrimiento" : "🚀 Increase My Discovery"}
              </button>
              <button
                className="ghost-button"
                disabled={Boolean(managingSongId)}
                onClick={() => {
                  dismissYoutubeMusicDiscovery(
                    youtubeMusicRecommendation.songId,
                  );
                  setYoutubeMusicRecommendation(null);
                }}
                type="button"
              >
                {spanish ? "Ahora no" : "Not Right Now"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
