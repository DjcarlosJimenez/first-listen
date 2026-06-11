"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  CirclePlay,
  Cloud,
  Disc3,
  Globe2,
  Headphones,
  Heart,
  MessageSquareText,
  Music2,
  Play,
  Radio,
  Share2,
  Star,
  Trophy,
  UserPlus,
  Users,
  Youtube,
} from "lucide-react";
import { Logo } from "@/components/logo";
import {
  ProviderPlayer,
  type ProviderTelemetrySnapshot,
} from "@/components/provider-player";
import { SongActionBar } from "@/components/song-action-bar";
import type { InterfaceLocale } from "@/lib/catalog";
import { compactClassificationLabel } from "@/lib/content-economy";
import { createClient } from "@/lib/supabase/client";
import type {
  ArtistCommunityActivity,
  ArtistTopSupporter,
  Platform,
} from "@/lib/types";

type PublicArtist = {
  id: string;
  name: string;
  followers: number;
  following: number;
  songsSubmitted: number;
  genres: string[];
  languages: string[];
  isFollowing: boolean;
  averageRating: number;
  listeningHoursReceived: number;
  validListensReceived: number;
  completeListensReceived: number;
  communityRank: string;
  activityStatus: "active" | "paused" | "archived";
};

type PublicSong = {
  id: string;
  artistId: string;
  title: string;
  artist: string;
  coverUrl: string;
  link: string;
  platform: Platform;
  genre: string;
  language: string;
  submittedAt: string;
  reviewsReceived: number;
  averageRating: number;
  hookScore: number;
  platformLinks: Array<{
    platform: Platform;
    url: string;
  }>;
};

const platformOrder: Record<Platform, number> = {
  "YouTube Music": 1,
  YouTube: 2,
  "Apple Music": 3,
  Spotify: 4,
  TikTok: 5,
  SoundCloud: 6,
};

function PlatformIcon({ platform }: { platform: Platform }) {
  if (platform === "YouTube Music") return <CirclePlay size={15} />;
  if (platform === "YouTube") return <Youtube size={15} />;
  if (platform === "Apple Music") return <Radio size={15} />;
  if (platform === "Spotify") return <Disc3 size={15} />;
  if (platform === "SoundCloud") return <Cloud size={15} />;
  return <Music2 size={15} />;
}

function ProfileSong({
  song,
  locale,
  active,
  onPlay,
}: {
  song: PublicSong;
  locale: InterfaceLocale;
  active: boolean;
  onPlay: () => void;
}) {
  const [platformsRevealed, setPlatformsRevealed] = useState(false);
  const sessionRef = useRef<{
    kind: "user" | "guest";
    id: string;
    token?: string;
  } | null>(null);
  const startingRef = useRef(false);
  const heartbeatRef = useRef(false);
  const lastHeartbeatRef = useRef(0);
  const spanish = locale === "es";

  useEffect(() => {
    if (active) return;
    sessionRef.current = null;
    startingRef.current = false;
    heartbeatRef.current = false;
    lastHeartbeatRef.current = 0;
  }, [active]);

  const handleTelemetry = useCallback(
    async (snapshot: ProviderTelemetrySnapshot) => {
      if (
        snapshot.duration > 0 &&
        snapshot.currentTime / snapshot.duration >= 0.5
      ) {
        setPlatformsRevealed(true);
      }

      if (
        !active ||
        !snapshot.supported ||
        !["playing", "ended"].includes(snapshot.playbackState)
      ) {
        return;
      }

      const supabase = createClient();
      if (!supabase) return;

      if (!sessionRef.current && !startingRef.current) {
        startingRef.current = true;
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          const { data } = await supabase.rpc("start_listening_session", {
            target_song_id: song.id,
          });
          const row = Array.isArray(data) ? data[0] : data;
          if (row?.session_id) {
            sessionRef.current = {
              kind: "user",
              id: String(row.session_id),
            };
          }
        } else {
          const token = window.localStorage.getItem(
            "first-listen-guest-token",
          );
          if (token) {
            const { data } = await supabase.rpc(
              "start_guest_listening_session",
              {
                guest_access_token: token,
                target_song_id: song.id,
              },
            );
            const row = Array.isArray(data) ? data[0] : data;
            if (row?.listening_session_id) {
              sessionRef.current = {
                kind: "guest",
                id: String(row.listening_session_id),
                token,
              };
            }
          }
        }
        startingRef.current = false;
        await supabase.rpc("record_song_view", {
          target_song_id: song.id,
          guest_access_token:
            sessionRef.current?.kind === "guest"
              ? sessionRef.current.token
              : null,
        });
      }

      const session = sessionRef.current;
      if (
        !session ||
        heartbeatRef.current ||
        Date.now() - lastHeartbeatRef.current < 10000
      ) {
        return;
      }

      heartbeatRef.current = true;
      lastHeartbeatRef.current = Date.now();
      const params = {
        playback_position_seconds: snapshot.currentTime,
        playback_duration_seconds: snapshot.duration,
        playback_state: snapshot.playbackState,
        playback_muted: snapshot.muted,
        playback_volume: snapshot.volume,
        page_visible: snapshot.pageVisible,
        page_focused: snapshot.pageFocused,
        interaction_recent:
          Date.now() - snapshot.lastInteractionAt <= 5 * 60 * 1000,
      };
      const result =
        session.kind === "user"
          ? await supabase.rpc("record_listening_heartbeat", {
              target_session_id: session.id,
              ...params,
            })
          : await supabase.rpc("record_guest_listening_heartbeat", {
              guest_access_token: session.token,
              target_session_id: session.id,
              ...params,
            });
      heartbeatRef.current = false;
      const row = Array.isArray(result.data) ? result.data[0] : result.data;
      if (row?.valid_listen_recorded) setPlatformsRevealed(true);
    },
    [active, song.id],
  );

  return (
    <article>
      <Image
        alt={`${song.title} cover`}
        height={500}
        src={song.coverUrl}
        unoptimized
        width={500}
      />
      <div className="artist-song-copy">
        <span className="eyebrow">
          {song.platform} / {compactClassificationLabel(song.platform)} /{" "}
          {song.genre} / {song.language}
        </span>
        <h2>{song.title}</h2>
        <div className="artist-song-metrics">
          <span><Headphones size={13} /> {song.reviewsReceived} reviews</span>
          <span><Star size={13} /> {song.averageRating.toFixed(1)}</span>
          <strong>Hook {song.hookScore}</strong>
        </div>

        <button
          className="artist-play-button"
          data-ui-component="playNowButton"
          onClick={onPlay}
          type="button"
        >
          <Play fill="currentColor" size={15} />
          {active
            ? spanish
              ? "Ocultar reproductor"
              : "Hide Player"
            : spanish
              ? "Reproducir ahora"
              : "Play Now"}
        </button>

        {active && (
          <div className="artist-profile-player">
            <ProviderPlayer
              artist={song.artist}
              autoPlay
              coverUrl={song.coverUrl}
              link={song.link}
              locale={locale}
              onTelemetry={handleTelemetry}
              platform={song.platform}
              songLoadedAt={null}
              title={song.title}
            />
          </div>
        )}

        <SongActionBar
          artist={song.artist}
          artistId={song.artistId}
          link={song.link}
          locale={locale}
          platform={song.platform}
          songId={song.id}
          title={song.title}
        />

        {platformsRevealed && (
          <section className="artist-platform-reveal">
            <span className="eyebrow">
              <Globe2 size={13} />
              {spanish
                ? "También disponible en estas plataformas"
                : "Also Available on These Platforms"}
            </span>
            <p>
              {spanish
                ? "Gracias por escuchar. ¿Quieres seguir apoyando a este artista?"
                : "Thanks for listening. Want to continue supporting this artist?"}
            </p>
            <div className="artist-song-links">
              {[...song.platformLinks]
                .sort(
                  (left, right) =>
                    platformOrder[left.platform] -
                    platformOrder[right.platform],
                )
                .map((platformLink) => (
                  <a
                    data-ui-component="openPlatformButton"
                    href={platformLink.url}
                    key={`${song.id}-${platformLink.platform}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <PlatformIcon platform={platformLink.platform} />
                    {platformLink.platform}
                  </a>
                ))}
            </div>
          </section>
        )}
      </div>
    </article>
  );
}

export function PublicArtistProfile({
  artist,
  songs,
  topSupporters,
  activity,
}: {
  artist: PublicArtist;
  songs: PublicSong[];
  topSupporters: ArtistTopSupporter[];
  activity: ArtistCommunityActivity[];
}) {
  const router = useRouter();
  const [locale, setLocale] = useState<InterfaceLocale>("en");
  const [following, setFollowing] = useState(artist.isFollowing);
  const [followerCount, setFollowerCount] = useState(artist.followers);
  const [activeSongId, setActiveSongId] = useState<string | null>(null);
  const [songSortOrder, setSongSortOrder] = useState("newest");
  const [message, setMessage] = useState("");
  const spanish = locale === "es";

  useEffect(() => {
    const stored = window.localStorage.getItem("first-listen-locale");
    const next =
      stored === "es" || stored === "en"
        ? stored
        : navigator.language.toLowerCase().startsWith("es")
          ? "es"
          : "en";
    setLocale(next);
    document.documentElement.lang = next;
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const readSortOrder = () =>
      setSongSortOrder(root.dataset.artistSongSortOrder ?? "newest");
    readSortOrder();
    const observer = new MutationObserver(readSortOrder);
    observer.observe(root, {
      attributeFilter: ["data-artist-song-sort-order"],
    });
    return () => observer.disconnect();
  }, []);

  const sortedSongs = useMemo(() => {
    const next = [...songs];
    if (songSortOrder === "highest_rated") {
      next.sort((left, right) => right.averageRating - left.averageRating);
    } else if (songSortOrder === "most_played") {
      next.sort((left, right) => right.reviewsReceived - left.reviewsReceived);
    } else if (songSortOrder === "most_supported") {
      next.sort((left, right) => right.hookScore - left.hookScore);
    } else if (songSortOrder === "most_shared") {
      next.sort((left, right) =>
        right.platformLinks.length - left.platformLinks.length ||
        right.reviewsReceived - left.reviewsReceived,
      );
    } else {
      next.sort(
        (left, right) =>
          Date.parse(right.submittedAt) - Date.parse(left.submittedAt),
      );
    }
    return next;
  }, [songSortOrder, songs]);

  const toggleFollow = async () => {
    const supabase = createClient();
    if (!supabase) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const guestToken = window.localStorage.getItem(
      "first-listen-guest-token",
    );
    if (!user && !guestToken) {
      router.push("/guest");
      return;
    }
    if (user?.id === artist.id) {
      setMessage(
        spanish
          ? "Este es tu perfil público."
          : "This is your public artist profile.",
      );
      return;
    }
    const { data, error } = await supabase.rpc("toggle_follow_artist", {
      target_artist_id: artist.id,
      guest_access_token: user ? null : guestToken,
    });
    if (error) {
      setMessage(error.message);
      return;
    }
    const next = Boolean(data);
    setFollowing(next);
    setFollowerCount((current) => Math.max(0, current + (next ? 1 : -1)));
    setMessage(
      next
        ? spanish
          ? "Ahora sigues a este artista."
          : "Artist followed."
        : spanish
          ? "Dejaste de seguir a este artista."
          : "Artist unfollowed.",
    );
  };

  return (
    <main className="artist-profile-page">
      <header className="account-header">
        <Logo />
        <Link href="/"><ArrowLeft size={16} /> First Listen</Link>
      </header>

      <section className="artist-profile-hero">
        <div className="artist-avatar">{artist.name.slice(0, 2).toUpperCase()}</div>
        <div>
          <span className="eyebrow">
            {spanish ? "Perfil público del artista" : "Public artist profile"}
          </span>
          <h1>{artist.name}</h1>
          <span className={`artist-activity-badge ${artist.activityStatus}`}>
            {artist.activityStatus === "active"
              ? spanish ? "Creador activo" : "Active creator"
              : artist.activityStatus === "paused"
                ? spanish ? "Creador en pausa" : "Paused creator"
                : spanish ? "Creador archivado" : "Archived creator"}
          </span>
          <div
            className="artist-profile-stats"
            data-artist-profile-section="statistics"
          >
            <span data-artist-profile-field="followers"><Users size={14} /> {followerCount} {spanish ? "seguidores" : "followers"}</span>
            <span><UserPlus size={14} /> {artist.following} {spanish ? "siguiendo" : "following"}</span>
            <span><Music2 size={14} /> {artist.songsSubmitted} {spanish ? "canciones" : "songs submitted"}</span>
            <span><Star size={14} /> {artist.averageRating.toFixed(1)} {spanish ? "rating promedio" : "average rating"}</span>
            <span><Headphones size={14} /> {artist.listeningHoursReceived.toFixed(1)} {spanish ? "horas escuchadas" : "listening hours received"}</span>
            <span><Radio size={14} /> {artist.validListensReceived} {spanish ? "escuchas válidas" : "valid listens received"}</span>
            <span><Disc3 size={14} /> {artist.completeListensReceived} {spanish ? "escuchas completas" : "complete listens"}</span>
            <span><Trophy size={14} /> {artist.communityRank}</span>
          </div>
          <div className="artist-profile-tags">
            {artist.genres.map((genre) => <span key={genre}>{genre}</span>)}
            {artist.languages.map((language) => <span key={language}><Globe2 size={11} /> {language}</span>)}
          </div>
        </div>
        <button
          className={following ? "following" : ""}
          data-ui-component="followButton"
          onClick={toggleFollow}
        >
          <UserPlus size={16} />{" "}
          {following
            ? spanish
              ? "Siguiendo"
              : "Following"
            : spanish
              ? "Seguir artista"
              : "Follow Artist"}
        </button>
      </section>

      {message && <div className="artist-profile-notice" role="status">{message}</div>}

      <section className="artist-community-grid">
        <div
          className="artist-community-panel"
          data-artist-profile-section="supporters"
        >
          <span className="eyebrow"><Users size={13} /> {spanish ? "Mayores colaboradores" : "Top Supporters"}</span>
          <h2>{spanish ? "Relaciones del creador" : "Creator relationships"}</h2>
          <div className="top-supporter-list">
            {topSupporters.map((supporter) => (
              <Link href={`/artists/${supporter.id}`} key={supporter.id}>
                <span className="retention-avatar">
                  {supporter.name.slice(0, 2).toUpperCase()}
                </span>
                <span>
                  <strong>{supporter.name}</strong>
                  <small>
                    {supporter.supportsGiven} {spanish ? "apoyos" : "supports"} /{" "}
                    {supporter.songsSupported} {spanish ? "canciones" : "songs supported"}
                  </small>
                  {supporter.mutualFollowing && (
                    <em><UserPlus size={11} /> {spanish ? "Se siguen mutuamente" : "Following each other"}</em>
                  )}
                </span>
                <ArrowRight size={14} />
              </Link>
            ))}
            {!topSupporters.length && (
              <p className="discovery-empty">
                {spanish
                  ? "Los colaboradores públicos aparecerán aquí."
                  : "Public supporters will appear here after supporting this artist."}
              </p>
            )}
          </div>
        </div>

        <div
          className="artist-community-panel"
          data-artist-profile-section="recentActivity"
        >
          <span className="eyebrow"><Radio size={13} /> {spanish ? "Actividad reciente" : "Recent Activity"}</span>
          <h2>{spanish ? "Actividad comunitaria" : "Community activity"}</h2>
          <div className="artist-activity-list">
            {activity.map((item) => (
              <article key={item.id}>
                <span>
                  {item.type === "follow" ? (
                    <UserPlus size={14} />
                  ) : item.type === "review" ? (
                    <Star size={14} />
                  ) : item.type === "like" ? (
                    <Heart size={14} />
                  ) : item.type === "comment" ? (
                    <MessageSquareText size={14} />
                  ) : item.type === "share" ? (
                    <Share2 size={14} />
                  ) : (
                    <Headphones size={14} />
                  )}
                </span>
                <div>
                  <strong>
                    {item.type === "follow"
                      ? `${item.actorName} ${spanish ? "siguió a este artista" : "followed this artist"}`
                      : item.type === "review"
                        ? `${item.actorName} ${spanish ? "dejó una review de" : "reviewed"} ${item.songTitle ?? (spanish ? "una canción" : "a song")}`
                        : item.type === "like"
                          ? `${item.actorName} ${spanish ? "le dio Like a" : "liked"} ${item.songTitle ?? (spanish ? "una canción" : "a song")}`
                          : item.type === "comment"
                            ? `${item.actorName} ${spanish ? "comentó en" : "commented on"} ${item.songTitle ?? (spanish ? "una canción" : "a song")}`
                            : item.type === "share"
                              ? `${item.actorName} ${spanish ? "compartió" : "shared"} ${item.songTitle ?? (spanish ? "una canción" : "a song")}`
                        : `${item.actorName} ${spanish ? "escuchó" : "listened to"} ${item.songTitle ?? (spanish ? "una canción" : "a song")}`}
                  </strong>
                  <small>{new Date(item.createdAt).toLocaleDateString()}</small>
                </div>
                {item.actorId && (
                  <Link href={`/artists/${item.actorId}`}>
                    {spanish ? "Perfil" : "Profile"}
                  </Link>
                )}
              </article>
            ))}
            {!activity.length && (
              <p className="discovery-empty">
                {spanish
                  ? "Las escuchas, reviews y seguidores aparecerán aquí."
                  : "Listening, reviews, and follows will appear here."}
              </p>
            )}
          </div>
        </div>
      </section>

      <section
        className="artist-song-grid"
        data-artist-profile-section="songs"
      >
        {sortedSongs.map((song) => (
          <ProfileSong
            active={activeSongId === song.id}
            key={song.id}
            locale={locale}
            onPlay={() =>
              setActiveSongId((current) =>
                current === song.id ? null : song.id,
              )
            }
            song={song}
          />
        ))}
        {sortedSongs.length === 0 && (
          <div className="empty-state">
            <p>
              {spanish
                ? "Este artista todavía no tiene canciones públicas activas."
                : "This artist has no active public songs yet."}
            </p>
            <Link href="/">{spanish ? "Explorar First Listen" : "Explore First Listen"} <ArrowRight size={13} /></Link>
          </div>
        )}
      </section>
    </main>
  );
}
