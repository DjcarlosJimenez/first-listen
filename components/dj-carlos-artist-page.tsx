"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Disc3,
  ExternalLink,
  ListMusic,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Smartphone,
  Sparkles,
  Video,
} from "lucide-react";
import { ProviderPlayer, type ProviderTelemetrySnapshot } from "@/components/provider-player";
import { PwaInstallButton } from "@/components/pwa-install-prompt";
import {
  DJ_CARLOS_PAGE_STORAGE_KEY,
  detectDjCarlosPlatform,
  isPlayableDjCarlosLink,
  labelForDjCarlosTrackSection,
  normalizeDjCarlosPageConfig,
  type DjCarlosAlbum,
  type DjCarlosPageConfig,
  type DjCarlosTrack,
} from "@/lib/dj-carlos-page";
import { nextDjCarlosQueueTrackId } from "@/lib/dj-carlos-playback";
import { dispatchWorkspaceV2PlaybackCommand } from "@/lib/workspace-v2";

const PLAYER_CHANNEL = "dj-carlos-jimenez";

function playbackLabel(snapshot: ProviderTelemetrySnapshot | null) {
  if (!snapshot) return "LISTO";
  if (snapshot.playbackState === "playing") return "REPRODUCIENDO";
  if (snapshot.playbackState === "paused") return "PAUSADO";
  if (snapshot.playbackState === "completed") return "TERMINADO";
  if (snapshot.playbackState === "error") return "REVISAR LINK";
  return "CARGANDO";
}

function albumsForConfig(config: DjCarlosPageConfig) {
  return config.albums?.length ? config.albums : [config.album];
}

function findAlbumBySlug(config: DjCarlosPageConfig, albumSlug?: string) {
  const normalizedSlug = albumSlug?.trim().toLowerCase();
  if (!normalizedSlug) return undefined;
  return albumsForConfig(config).find(
    (album) => album.slug.toLowerCase() === normalizedSlug,
  );
}

function selectedAlbumForConfig(
  config: DjCarlosPageConfig,
  albumSlug?: string,
) {
  const albums = albumsForConfig(config);
  return (
    findAlbumBySlug(config, albumSlug) ??
    albums[0] ??
    config.album
  );
}

function firstTrackIdForAlbum(config: DjCarlosPageConfig, albumSlug?: string) {
  const album = selectedAlbumForConfig(config, albumSlug);
  return (
    config.tracks.find(
      (track) => track.section === "album" && track.albumId === album.id,
    )?.id ??
    config.tracks[0]?.id ??
    ""
  );
}

export function DjCarlosArtistPage({
  initialConfig,
  initialAlbumSlug,
  logoUrl,
}: {
  initialConfig: DjCarlosPageConfig;
  initialAlbumSlug?: string;
  logoUrl: string;
}) {
  const requestPlaybackRef = useRef<(() => void) | null>(null);
  const lastAutoAdvanceKeyRef = useRef<string | null>(null);
  const [config, setConfig] = useState(() =>
    normalizeDjCarlosPageConfig(initialConfig),
  );
  const [activeId, setActiveId] = useState(() =>
    firstTrackIdForAlbum(initialConfig, initialAlbumSlug),
  );
  const [autoPlayEnabled, setAutoPlayEnabled] = useState(true);
  const [playerPausedByUser, setPlayerPausedByUser] = useState(false);
  const [playerVersion, setPlayerVersion] = useState(0);
  const [snapshot, setSnapshot] = useState<ProviderTelemetrySnapshot | null>(null);
  const [usingLocalDraft, setUsingLocalDraft] = useState(false);

  useEffect(() => {
    const loadLocalConfig = () => {
      try {
        const saved = window.localStorage.getItem(DJ_CARLOS_PAGE_STORAGE_KEY);
        if (!saved) {
          setUsingLocalDraft(false);
          return;
        }
        const nextConfig = normalizeDjCarlosPageConfig(
          JSON.parse(saved),
          initialConfig,
        );
        const savedAt = Date.parse(nextConfig.updatedAt);
        const serverAt = Date.parse(initialConfig.updatedAt);
        if (
          Number.isFinite(serverAt) &&
          (!Number.isFinite(savedAt) || savedAt <= serverAt)
        ) {
          setUsingLocalDraft(false);
          return;
        }
        const routeNeedsLocalAlbum = Boolean(
          initialAlbumSlug &&
            !findAlbumBySlug(initialConfig, initialAlbumSlug) &&
            findAlbumBySlug(nextConfig, initialAlbumSlug),
        );
        setUsingLocalDraft(true);
        setConfig(nextConfig);
        setActiveId(
          (current) =>
            routeNeedsLocalAlbum
              ? firstTrackIdForAlbum(nextConfig, initialAlbumSlug)
              : current || firstTrackIdForAlbum(nextConfig, initialAlbumSlug),
        );
      } catch {
        window.localStorage.removeItem(DJ_CARLOS_PAGE_STORAGE_KEY);
        setUsingLocalDraft(false);
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === DJ_CARLOS_PAGE_STORAGE_KEY) loadLocalConfig();
    };

    loadLocalConfig();
    window.addEventListener("focus", loadLocalConfig);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("focus", loadLocalConfig);
      window.removeEventListener("storage", handleStorage);
    };
  }, [initialAlbumSlug, initialConfig]);

  const { tracks } = config;
  const albums = useMemo(() => albumsForConfig(config), [config]);
  const album = useMemo(
    () => selectedAlbumForConfig(config, initialAlbumSlug),
    [config, initialAlbumSlug],
  );
  const isAlbumDetail = Boolean(initialAlbumSlug);
  const albumTracks = useMemo(
    () =>
      tracks.filter(
        (track) => track.section === "album" && track.albumId === album.id,
      ),
    [album.id, tracks],
  );
  const topTenTracks = useMemo(
    () => tracks.filter((track) => track.section === "top-ten").slice(0, 10),
    [tracks],
  );
  const officialVideos = useMemo(
    () => tracks.filter((track) => track.section === "official-video"),
    [tracks],
  );
  const albumTrackCounts = useMemo(() => {
    const counts = new Map<string, number>();
    tracks.forEach((track) => {
      if (track.section !== "album" || !track.albumId) return;
      counts.set(track.albumId, (counts.get(track.albumId) ?? 0) + 1);
    });
    return counts;
  }, [tracks]);
  const serverAlbumSlugs = useMemo(
    () => new Set(albumsForConfig(initialConfig).map((item) => item.slug)),
    [initialConfig],
  );
  const albumPlayerTrack = useMemo<DjCarlosTrack | null>(() => {
    if (!isPlayableDjCarlosLink(album.link)) return null;
    return {
      artist: "DJ Carlos Jimenez Compositor",
      badge: album.badge,
      coverUrl: album.coverUrl || logoUrl,
      id: "dj-carlos-album-main-link",
      link: album.link,
      mood: "Album",
      platform: detectDjCarlosPlatform(album.link),
      release: album.title,
      section: "album",
      subtitle: album.subtitle,
      title: album.title,
    };
  }, [album, logoUrl]);
  const playQueue = useMemo(
    () => [...albumTracks, ...topTenTracks, ...officialVideos],
    [albumTracks, officialVideos, topTenTracks],
  );
  const activeTrack = useMemo(() => {
    if (albumPlayerTrack?.id === activeId) return albumPlayerTrack;
    return (
      tracks.find((track) => track.id === activeId) ??
      playQueue[0] ??
      tracks[0] ??
      null
    );
  }, [activeId, albumPlayerTrack, playQueue, tracks]);
  const moodFilters = useMemo(() => {
    const moods = tracks
      .map((track) => track.mood)
      .filter(Boolean)
      .filter((mood, index, all) => all.indexOf(mood) === index);
    return moods.slice(0, 5);
  }, [tracks]);

  useEffect(() => {
    if (activeTrack || !playQueue[0]) return;
    setActiveId(playQueue[0].id);
  }, [activeTrack, playQueue]);

  useEffect(() => {
    if (
      snapshot?.playbackState !== "completed" ||
      playerPausedByUser ||
      !autoPlayEnabled
    ) {
      return;
    }

    const activeTrackId = activeTrack?.id ?? null;
    const nextTrackId = nextDjCarlosQueueTrackId(activeTrackId, playQueue);
    if (!nextTrackId) return;

    const completionKey = `${activeTrackId ?? "none"}:${playerVersion}`;
    if (lastAutoAdvanceKeyRef.current === completionKey) return;
    lastAutoAdvanceKeyRef.current = completionKey;

    const advanceTimer = window.setTimeout(() => {
      setSnapshot(null);
      setAutoPlayEnabled(true);
      setPlayerPausedByUser(false);
      setActiveId(nextTrackId);
      setPlayerVersion((version) => version + 1);
    }, 700);

    return () => window.clearTimeout(advanceTimer);
  }, [
    activeTrack?.id,
    autoPlayEnabled,
    playQueue,
    playerPausedByUser,
    playerVersion,
    snapshot?.playbackState,
  ]);

  const playTrack = (trackId: string) => {
    setSnapshot(null);
    setAutoPlayEnabled(true);
    setPlayerPausedByUser(false);
    setActiveId(trackId);
    setPlayerVersion((version) => version + 1);
  };

  const playAlbum = () => {
    if (albumPlayerTrack) {
      playTrack(albumPlayerTrack.id);
      return;
    }
    if (albumTracks[0]) playTrack(albumTracks[0].id);
  };

  const playCurrent = () => {
    setSnapshot(null);
    setAutoPlayEnabled(true);
    setPlayerPausedByUser(false);
    requestPlaybackRef.current?.();
    dispatchWorkspaceV2PlaybackCommand("play", {
      channel: PLAYER_CHANNEL,
      source: "user-click",
    });
    setPlayerVersion((version) => version + 1);
  };

  const pauseCurrent = () => {
    requestPlaybackRef.current = null;
    setAutoPlayEnabled(false);
    setPlayerPausedByUser(true);
    setSnapshot((current) =>
      current
        ? { ...current, playbackState: "paused" }
        : current,
    );
    dispatchWorkspaceV2PlaybackCommand("pause", {
      channel: PLAYER_CHANNEL,
      source: "user-click",
    });
    setPlayerVersion((version) => version + 1);
  };

  const jumpTrack = (direction: 1 | -1) => {
    if (!activeTrack || playQueue.length < 2) return;
    const index = playQueue.findIndex((track) => track.id === activeTrack.id);
    const nextIndex =
      index === -1 ? 0 : (index + direction + playQueue.length) % playQueue.length;
    playTrack(playQueue[nextIndex].id);
  };

  const playFirstTopTen = () => {
    if (topTenTracks[0]) {
      playTrack(topTenTracks[0].id);
      return;
    }
    playAlbum();
  };

  const playFirstVideo = () => {
    if (officialVideos[0]) playTrack(officialVideos[0].id);
  };

  return (
    <main className="djcx-page">
      <section className="djcx-player-strip" aria-label="Reproductor principal">
        <div className="djcx-player-shell">
          <div className="djcx-now-playing">
            <Image
              alt="DJ Carlos Jimenez logo"
              className="djcx-now-logo"
              height={54}
              priority
              src={logoUrl}
              width={82}
            />
            <div>
              <span>{playbackLabel(snapshot)}</span>
              <strong>{activeTrack?.title ?? "DJ Carlos Jimenez"}</strong>
              <small>{activeTrack?.platform ?? "YouTube Music"}</small>
            </div>
          </div>

          <div className="djcx-player-frame">
            {activeTrack && !playerPausedByUser && (
              <ProviderPlayer
                artist={activeTrack.artist}
                autoPlay={autoPlayEnabled}
                controlChannel={PLAYER_CHANNEL}
                coverUrl={activeTrack.coverUrl}
                key={`${activeTrack.id}-${playerVersion}`}
                link={activeTrack.link}
                locale="es"
                onTelemetry={setSnapshot}
                onTrustedPlaybackRequestReady={(requestPlayback) => {
                  requestPlaybackRef.current = requestPlayback;
                }}
                platform={activeTrack.platform}
                songLoadedAt={new Date().toISOString()}
                title={activeTrack.title}
              />
            )}
            {activeTrack && playerPausedByUser && (
              <button
                className="djcx-player-paused"
                onClick={playCurrent}
                type="button"
              >
                <Image
                  alt={`${activeTrack.title} cover`}
                  fill
                  sizes="(max-width: 760px) 100vw, 420px"
                  src={activeTrack.coverUrl}
                  unoptimized
                />
                <span>
                  <Play fill="currentColor" size={18} />
                  Pausado
                </span>
              </button>
            )}
          </div>

          <div className="djcx-player-controls" aria-label="Controles">
            <button aria-label="Anterior" onClick={() => jumpTrack(-1)} type="button">
              <SkipBack size={17} />
            </button>
            <button className="djcx-play-button" onClick={playCurrent} type="button">
              <Play fill="currentColor" size={17} />
              <span>Play</span>
            </button>
            <button aria-label="Pausar" onClick={pauseCurrent} type="button">
              <Pause size={17} />
            </button>
            <button aria-label="Siguiente" onClick={() => jumpTrack(1)} type="button">
              <SkipForward size={17} />
            </button>
            {activeTrack && (
              <a
                aria-label="Abrir en la plataforma"
                href={activeTrack.link}
                rel="noreferrer"
                target="_blank"
              >
                <ExternalLink size={16} />
              </a>
            )}
          </div>
        </div>
      </section>

      <section className="djcx-hero">
        <div className="djcx-hero-copy">
          <span className="djcx-eyebrow">
            <Sparkles size={14} /> Pagina oficial
          </span>
          <h1>{isAlbumDetail ? album.title : "DJ Carlos Jimenez"}</h1>
          <p>{isAlbumDetail ? album.description : album.subtitle}</p>
          <div className="djcx-hero-actions">
            <button onClick={playAlbum} type="button">
              <Disc3 size={17} />
              {isAlbumDetail ? "Reproducir este album" : "Reproducir album"}
            </button>
            <button onClick={playFirstVideo} type="button">
              <Video size={17} />
              Videos oficiales
            </button>
          </div>
        </div>

        <div className="djcx-logo-stage" aria-hidden="true">
          <Image
            alt=""
            fill
            priority
            sizes="(max-width: 900px) 92vw, 520px"
            src={logoUrl}
          />
        </div>
      </section>

      <section className="djcx-taste-bar" aria-label="Explorar por gusto">
        <span>Que quieres escuchar?</span>
        <div>
          {moodFilters.map((mood) => (
            <button
              key={mood}
              onClick={() => {
                const match = tracks.find((track) => track.mood === mood);
                if (match) playTrack(match.id);
              }}
              type="button"
            >
              {mood}
            </button>
          ))}
        </div>
      </section>

      <section className="djcx-feature-grid">
        <article className="djcx-album-panel">
          <AlbumCase album={album} />
          <div>
            <span>{album.badge}</span>
            <h2>{album.title}</h2>
            <p>{album.description}</p>
            <button onClick={playAlbum} type="button">
              <Play fill="currentColor" size={16} />
              Empezar por el album
            </button>
          </div>
        </article>

        <ArtistInstallPanel logoUrl={logoUrl} />

        <article className="djcx-quick-stats">
          <div>
            <strong>{albumTracks.length}</strong>
            <span>{isAlbumDetail ? "Canciones" : "Album actual"}</span>
          </div>
          <div>
            <strong>{topTenTracks.length}</strong>
            <span>Top Ten</span>
          </div>
          <div>
            <strong>{officialVideos.length}</strong>
            <span>Videos</span>
          </div>
        </article>
      </section>

        <AlbumLibrary
          activeAlbumId={album.id}
          albums={albums}
          serverAlbumSlugs={serverAlbumSlugs}
          trackCounts={albumTrackCounts}
          usingLocalDraft={usingLocalDraft}
        />

      <TrackSection
        heading={isAlbumDetail ? album.title : "Album en orden"}
        kicker={isAlbumDetail ? "Canciones del album" : "Playlist oficial"}
        onPlayAll={playAlbum}
        onPlayTrack={playTrack}
        tracks={albumTracks}
      />

      <TrackSection
        heading="Top Ten"
        kicker="Favoritas para reproducir"
        onPlayAll={playFirstTopTen}
        onPlayTrack={playTrack}
        tracks={topTenTracks}
      />

      <section className="djcx-list-section djcx-video-section" id="videos">
        <div className="djcx-section-heading">
          <div>
            <span>
              <Video size={14} /> YouTube
            </span>
            <h2>Videos musicales oficiales</h2>
          </div>
          <button onClick={playFirstVideo} type="button">
            <Play fill="currentColor" size={16} />
            Ver ahora
          </button>
        </div>

        <div className="djcx-video-grid">
          {officialVideos.map((track) => (
            <button
              className="djcx-video-card"
              key={track.id}
              onClick={() => playTrack(track.id)}
              type="button"
            >
              <span>
                <Image
                  alt={`${track.title} cover`}
                  fill
                  sizes="(max-width: 700px) 92vw, 320px"
                  src={track.coverUrl}
                  unoptimized
                />
                <Play fill="currentColor" size={20} />
              </span>
              <strong>{track.title}</strong>
              <small>{track.subtitle}</small>
            </button>
          ))}
        </div>
      </section>

      <footer className="djcx-footer">
        {isAlbumDetail && <Link href="/DJCarlosJimenez">Volver a la pagina principal</Link>}
        <Link href="/DJCarlosJimenez/admin">Panel artista</Link>
        <Link href="/guest?localPreview=1">Explorar First Listen</Link>
        <a
          href="https://www.youtube.com/results?search_query=DJ+Carlos+Jimenez+Compositor"
          rel="noreferrer"
          target="_blank"
        >
          Buscar en YouTube
        </a>
      </footer>
    </main>
  );
}

function AlbumLibrary({
  activeAlbumId,
  albums,
  serverAlbumSlugs,
  trackCounts,
  usingLocalDraft,
}: {
  activeAlbumId: string;
  albums: DjCarlosAlbum[];
  serverAlbumSlugs: Set<string>;
  trackCounts: Map<string, number>;
  usingLocalDraft: boolean;
}) {
  return (
    <section className="djcx-list-section djcx-album-library">
      <div className="djcx-section-heading">
        <div>
          <span>
            <Disc3 size={14} /> Biblioteca
          </span>
          <h2>Albumes principales</h2>
        </div>
      </div>

      <div className="djcx-album-library-grid">
        {albums.map((album) => (
          <Link
            className={
              album.id === activeAlbumId
                ? "djcx-album-card is-active"
                : "djcx-album-card"
            }
            href={
              usingLocalDraft && !serverAlbumSlugs.has(album.slug)
                ? `/DJCarlosJimenez/album/${album.slug}?localPreview=1`
                : `/DJCarlosJimenez/album/${album.slug}`
            }
            key={album.id}
          >
            <AlbumCase album={album} compact />
            <div>
              <span>{album.badge}</span>
              <strong>{album.title}</strong>
              <small>{trackCounts.get(album.id) ?? 0} canciones</small>
            </div>
            <em>
              Abrir album <ExternalLink size={13} />
            </em>
          </Link>
        ))}
      </div>
    </section>
  );
}

function AlbumCase({
  album,
  compact = false,
}: {
  album: DjCarlosAlbum;
  compact?: boolean;
}) {
  return (
    <div
      className={compact ? "djcx-cd-case djcx-cd-case-small" : "djcx-cd-case"}
      aria-label={`Portada de ${album.title}`}
    >
      <div className="djcx-cd-spine">DJ CARLOS JIMENEZ</div>
      <div className="djcx-cd-cover">
        <Image
          alt={`Portada de ${album.title}`}
          fill
          priority
          sizes="(max-width: 700px) 68vw, 220px"
          src={album.coverUrl}
          unoptimized
        />
      </div>
      <div className="djcx-cd-disc" aria-hidden="true">
        <span />
      </div>
    </div>
  );
}

function ArtistInstallPanel({ logoUrl }: { logoUrl: string }) {
  return (
    <article className="djcx-install-panel">
      <Image alt="" height={72} src={logoUrl} width={72} />
      <div>
        <span>
          <Smartphone size={14} /> App directa
        </span>
        <h2>Acceso directo DJ Carlos</h2>
        <p>Instala un acceso directo con el logo de DJ Carlos para entrar facil y rapido a esta pagina.</p>
        <PwaInstallButton
          className="djcx-install-button"
          label="Instalar DJ Carlos"
          locale="es"
        />
      </div>
    </article>
  );
}

function TrackSection({
  heading,
  kicker,
  onPlayAll,
  onPlayTrack,
  tracks,
}: {
  heading: string;
  kicker: string;
  onPlayAll: () => void;
  onPlayTrack: (trackId: string) => void;
  tracks: DjCarlosTrack[];
}) {
  return (
    <section className="djcx-list-section">
      <div className="djcx-section-heading">
        <div>
          <span>
            <ListMusic size={14} /> {kicker}
          </span>
          <h2>{heading}</h2>
        </div>
        <button onClick={onPlayAll} type="button">
          <Play fill="currentColor" size={16} />
          Reproducir
        </button>
      </div>

      <div className="djcx-track-list">
        {tracks.map((track, index) => (
          <TrackRow
            index={index + 1}
            key={track.id}
            onPlay={() => onPlayTrack(track.id)}
            track={track}
          />
        ))}
      </div>
    </section>
  );
}

function TrackRow({
  index,
  onPlay,
  track,
}: {
  index: number;
  onPlay: () => void;
  track: DjCarlosTrack;
}) {
  return (
    <article className="djcx-track-row">
      <button
        aria-label={`Reproducir ${track.title}`}
        className="djcx-track-play"
        onClick={onPlay}
        type="button"
      >
        <Play fill="currentColor" size={16} />
      </button>
      <span className="djcx-track-number">{String(index).padStart(2, "0")}</span>
      <Image
        alt={`${track.title} cover`}
        className="djcx-track-cover"
        height={58}
        src={track.coverUrl}
        unoptimized
        width={58}
      />
      <div className="djcx-track-copy">
        <strong>{track.title}</strong>
        <small>
          {labelForDjCarlosTrackSection(track.section)} / {track.subtitle}
        </small>
      </div>
      <span className="djcx-track-badge">{track.badge}</span>
    </article>
  );
}
