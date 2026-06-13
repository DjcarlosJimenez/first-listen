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
  displayPlatform,
} from "@/lib/content-economy";
import { createClient } from "@/lib/supabase/client";
import type {
  CommunityActivity,
  CommunityNetwork,
  ConnectedPlatform,
  ConnectedPlatformAccount,
} from "@/lib/types";

type ProfileSong = {
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
};

type RemovedSongHistory = {
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

type SavedSong = {
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

function platformStatus(status?: ConnectedPlatformAccount["connectionStatus"]) {
  if (status === "connected") return "Connected";
  if (status === "pending") return "Pending";
  if (status === "needs_reauth") return "Reconnect Required";
  if (status === "revoked") return "Disconnected";
  return "Not Connected";
}

function formatImpactDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${remainder}s`;
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
}: {
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
}) {
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
        "Profile saved.",
    );
  };

  const manageSong = async (
    song: ProfileSong,
    action: "delete" | "archive",
  ) => {
    const confirmation =
      action === "delete"
        ? `Delete "${song.title}" permanently? ${
            song.submission_token_cost > 0
              ? `${song.submission_token_cost} token${song.submission_token_cost === 1 ? "" : "s"} will be refunded.`
              : "No token was charged for this submission."
          }`
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
            ? `Song deleted. ${result.refunded_tokens} token${Number(result.refunded_tokens) === 1 ? "" : "s"} refunded.`
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
        setMessage("Song archived. Its statistics are preserved.");
      }
    }

    setManagingSongId(null);
  };

  return (
    <main className="account-page">
      <header className="account-header">
        <Logo />
        <div className="owner-header-actions">
          <Link href="/help"><CircleHelp size={16} /> Need Help?</Link>
          <Link href="/dashboard"><ArrowLeft size={16} /> Dashboard</Link>
        </div>
      </header>
      <div className="account-grid">
        <section className="account-card">
          <span className="eyebrow">Profile</span>
          <h1>{profile.displayName}</h1>
          <div className="profile-badges">
            <span><ShieldCheck size={14} /> {profile.role.replace("_", " ")}</span>
            {profile.founder && <span><BadgeCheck size={14} /> Founding Artist</span>}
            <span>{profile.role === "super_admin" ? "Unlimited tokens" : `${tokenBalance} tokens`}</span>
            {profile.founder && (
              <span>
                {profile.founderSubmissionsRemaining} Founder submissions remaining
              </span>
            )}
          </div>
          <div className="impact-profile">
            <div>
              <Headphones size={16} />
              <strong>{formatImpactDuration(impact?.supporting_seconds ?? 0)}</strong>
              <span>Time Supporting Creators</span>
            </div>
            <div>
              <MessageSquareText size={16} />
              <strong>{impact?.songs_reviewed ?? 0}</strong>
              <span>Songs Reviewed</span>
            </div>
            <div>
              <Users size={16} />
              <strong>{impact?.creators_supported ?? 0}</strong>
              <span>Creators Supported</span>
            </div>
            <div>
              <Music2 size={16} />
              <strong>{impact?.valid_listens ?? 0}</strong>
              <span>Valid Plays</span>
            </div>
            <div>
              <Gauge size={16} />
              <strong>{formatImpactDuration(impact?.average_listening_seconds ?? 0)}</strong>
              <span>Average Listening Duration</span>
            </div>
            <div>
              <CalendarDays size={16} />
              <strong>{impact?.days_active ?? 0}</strong>
              <span>Days Active</span>
            </div>
          </div>
          <div className="community-rank-card">
            <BadgeCheck size={18} />
            <span>
              <strong>{impact?.community_rank ?? "New Member"}</strong>
              <small>{impact?.community_points ?? 0} Community Points</small>
            </span>
          </div>
          <div className="community-network-grid">
            <div><strong>{network.followers}</strong><span>Followers</span></div>
            <div><strong>{network.following}</strong><span>Following</span></div>
            <div><strong>{network.artistsSupported}</strong><span>Artists Supported</span></div>
            <div><strong>{network.visibleSupports}</strong><span>Visible Supports</span></div>
            <div><strong>{network.anonymousSupports}</strong><span>Anonymous Supports</span></div>
          </div>
          <Link
            className="public-profile-link"
            data-artist-profile-button
            data-ui-component="artistProfileButton"
            href={`/artists/${profile.id}`}
          >
            View public artist profile <ExternalLink size={14} />
          </Link>
          <section
            aria-labelledby="connected-platforms-heading"
            className="connected-platforms-card"
          >
            <div className="connected-platforms-heading">
              <span>
                <strong id="connected-platforms-heading">
                  Connected Platforms
                </strong>
                <small>Future creator account connections</small>
              </span>
              <span className="coming-soon-badge">
                <Construction size={13} /> Coming Soon
              </span>
            </div>
            <div className="connected-platforms-list">
              {platformDefinitions.map((platform) => {
                const account = connectedPlatforms.find(
                  (item) => item.platform === platform.id,
                );
                const PlatformIcon = platform.icon;
                const status = platformStatus(account?.connectionStatus);
                return (
                  <div key={platform.id}>
                    <span className="connected-platform-icon" aria-hidden="true">
                      <PlatformIcon size={17} />
                    </span>
                    <span className="connected-platform-name">
                      <strong>{platform.label}</strong>
                      <small>{platformCompatibility[platform.id]}</small>
                    </span>
                    <span
                      className={
                        status === "Connected"
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
              Future account linking and creator verification will support
              verified profiles, public links, and provider statistics where
              official APIs permit them.
            </p>
          </section>
          <form onSubmit={save}>
            <label className="auth-field">
              <span>Name</span>
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
                <strong>Show Explicit Content</strong>
                Hide explicit songs from your review queue when disabled.
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
                <strong>External Content Warnings</strong>
                Confirm before Spotify, Apple Music, or TikTok opens in a new
                tab.
              </span>
            </label>
            <fieldset className="community-visibility-card">
              <legend>Community Visibility</legend>
              <label>
                <input
                  checked={visibility === "public"}
                  name="community-visibility"
                  onChange={() => setVisibility("public")}
                  type="radio"
                />
                <Eye size={16} />
                <span>
                  <strong>Public Supporter (Recommended)</strong>
                  Artists can see when you support their music. This can lead to
                  more profile visits, followers, and creator connections.
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
                  <strong>Anonymous Supporter</strong>
                  Your support remains valid, but artists see Anonymous Listener
                  instead of your name.
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
                <strong>Auto Play Next Song</strong>
                Load and play the next queued song after the current song ends.
              </span>
            </label>
            {message && <p className="form-message" role="status">{message}</p>}
            <button className="auth-submit" type="submit"><Save size={15} /> Save profile</button>
          </form>
        </section>

        <section className="account-card my-songs" id="community-activity">
          <span className="eyebrow">Recent Community Activity</span>
          <h2>Your creator connections</h2>
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
                      ? `You followed ${item.artistName}`
                      : item.type === "review"
                        ? `You reviewed ${item.songTitle ?? "a song"}`
                        : `You supported ${item.songTitle ?? "a song"}`}
                  </strong>
                  <small>
                    {item.visibility === "public"
                      ? "Visible support"
                      : "Anonymous support"}
                  </small>
                </div>
                <Link
                  data-artist-profile-button
                  data-ui-component="artistProfileButton"
                  href={`/artists/${item.artistId}`}
                >
                  View Artist
                </Link>
              </article>
            ))}
            {!activity.length && (
              <div className="empty-state">
                <p>Your listens, reviews, and follows will appear here.</p>
                <Link href="/review">Support a creator</Link>
              </div>
            )}
          </div>

          <div className="saved-song-heading">
            <span className="eyebrow">My Songs</span>
            <h2>Submitted songs</h2>
          </div>
          {managedSongs.length === 0 ? (
            <div className="empty-state">
              <p>No songs submitted yet.</p>
              <Link href="/submit">Submit your first song</Link>
            </div>
          ) : (
            <div className="song-table">
              {managedSongs.map((song) => (
                <article id={`song-${song.song_id}`} key={song.song_id}>
                  <div>
                    <strong>{song.title}</strong>
                    <span>
                      {song.artist_name} /{" "}
                      {displayPlatform[song.platform] ?? song.platform} /{" "}
                      {displayPlatform[song.platform]
                        ? compactClassificationLabel(
                            displayPlatform[song.platform],
                          )
                        : ""}
                    </span>
                    <small className="song-activity-summary">
                      {song.reviews} reviews /{" "}
                      {song.valid_listens + song.guest_valid_listens} valid
                      listens / {song.community_activity} other activity
                    </small>
                  </div>
                  <span
                    className={
                      song.catalog_status === "active"
                        ? "status-active"
                        : "status-removed"
                    }
                  >
                    {song.catalog_status === "active"
                      ? "In review queue"
                      : song.catalog_status.replaceAll("_", " ")}
                  </span>
                  {song.explicit_content && <small>Explicit</small>}
                  <div className="song-management-actions">
                    {song.can_delete && (
                      <button
                        disabled={managingSongId === song.song_id}
                        onClick={() => void manageSong(song, "delete")}
                        type="button"
                      >
                        <Trash2 size={14} /> Delete Song
                      </button>
                    )}
                    {song.can_archive && (
                      <button
                        disabled={managingSongId === song.song_id}
                        onClick={() => void manageSong(song, "archive")}
                        type="button"
                      >
                        <Archive size={14} /> Archive Song
                      </button>
                    )}
                    <a href={song.music_url} rel="noreferrer" target="_blank" aria-label={`Open ${song.title}`}>
                      <ExternalLink size={15} />
                    </a>
                    <Link
                      data-artist-profile-button
                      data-ui-component="artistProfileButton"
                      href={`/artists/${profile.id}`}
                    >
                      Artist Profile
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
          {message && <p className="form-message" role="status">{message}</p>}

          <details className="removed-song-history" id="removed-song-history">
            <summary>
              Removed Songs History
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
                        ? `${song.refunded_tokens} token refund`
                        : "No token refund"}
                    </small>
                    <a
                      aria-label={`Open ${song.title}`}
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
              <p>No removed songs.</p>
            )}
          </details>

          <div className="saved-song-heading">
            <span className="eyebrow">Saved For Later</span>
            <h2>Music to revisit</h2>
          </div>
          {savedSongs.length === 0 ? (
            <div className="empty-state">
              <p>Songs you save after reviews will appear here.</p>
              <Link href="/review">Review and discover music</Link>
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
                          )
                        : ""}
                    </span>
                  </div>
                  <Link
                    data-artist-profile-button
                    data-ui-component="artistProfileButton"
                    href={`/artists/${song.artist_id}`}
                  >
                    View Artist
                  </Link>
                  <small>{song.genre} / {song.song_language}</small>
                  <a href={song.music_url} rel="noreferrer" target="_blank" aria-label={`Open ${song.title}`}>
                    <ExternalLink size={15} />
                  </a>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
