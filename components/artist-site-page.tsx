"use client";

import Image from "next/image";
import Link from "next/link";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ArrowUpRight, Disc3, ExternalLink, ListMusic,
  Pause, Play, Share2, SkipBack, SkipForward, Video,
} from "lucide-react";
import { ArtistPwaInstallBrand } from "@/components/pwa-install-prompt";
import { ProviderPlayer, type ProviderTelemetrySnapshot } from "@/components/provider-player";
import {
  artistSiteThumbnail,
  type ArtistSiteConfig,
  type ArtistSiteTrack,
} from "@/lib/artist-sites";
import { detectDjCarlosPlatform } from "@/lib/dj-carlos-page";
import { dispatchWorkspaceV2PlaybackCommand } from "@/lib/workspace-v2";

type Playable = ArtistSiteTrack & {
  albumId?: string;
  albumTitle?: string;
  coverUrl: string;
};

type QueueMode = "all" | "album" | "top-ten" | "videos";

type ArtistSiteSummary = {
  id: string;
  name: string;
  slug: string;
};

const END_MARGIN_SECONDS = 1.5;

function coverFor(track: ArtistSiteTrack, albumCover: string, logoUrl: string) {
  return artistSiteThumbnail(track.link) || albumCover || logoUrl || "/icon.png";
}

async function shareUrl(path: string, title: string) {
  const url = new URL(path, window.location.origin).toString();
  if (navigator.share) {
    await navigator.share({ title, url });
  } else {
    await navigator.clipboard.writeText(url);
  }
}

export function ArtistSitePage({
  albumSlug,
  config,
  site,
}: {
  albumSlug?: string;
  config: ArtistSiteConfig;
  site: ArtistSiteSummary;
}) {
  const album = config.albums.find((item) => item.slug === albumSlug);
  const [selectedRhythm, setSelectedRhythm] = useState("");
  const [showTopTen, setShowTopTen] = useState(false);
  const [showAllVideos, setShowAllVideos] = useState(false);
  const [queueMode, setQueueMode] = useState<QueueMode>(album ? "album" : "all");
  const [activeId, setActiveId] = useState("");
  const [autoPlay, setAutoPlay] = useState(true);
  const [pausedByUser, setPausedByUser] = useState(false);
  const [playerVersion, setPlayerVersion] = useState(0);
  const [snapshot, setSnapshot] = useState<ProviderTelemetrySnapshot | null>(null);
  const [shareNotice, setShareNotice] = useState("");
  const previousTelemetryRef = useRef<ProviderTelemetrySnapshot["playbackState"]>("loading");
  const lastAdvanceRef = useRef("");
  const lastDeepLinkRef = useRef("");
  const requestPlaybackRef = useRef<(() => void) | null>(null);
  const pausedByUserRef = useRef(false);
  const autoPlayRef = useRef(true);
  const channel = `artist-site-${site.id}`;
  const rootPath = `/${site.slug}`;
  const pagePath = album ? `${rootPath}/album/${album.slug}` : rootPath;

  const albumSongs = useMemo<Playable[]>(() =>
    config.albums.flatMap((item) => item.tracks.filter((track) => track.link).map((track) => ({
      ...track,
      albumId: item.id,
      albumTitle: item.title,
      coverUrl: coverFor(track, item.coverUrl, config.logoUrl),
    }))),
  [config.albums, config.logoUrl]);
  const videoTracks = useMemo<Playable[]>(() =>
    config.videos.filter((track) => track.link).map((track) => ({
      ...track,
      coverUrl: coverFor(track, "", config.logoUrl),
    })),
  [config.videos, config.logoUrl]);
  const topTenTracks = useMemo(() => config.topTenIds
    .map((id) => albumSongs.find((song) => song.id === id))
    .filter((track): track is Playable => Boolean(track)),
  [albumSongs, config.topTenIds]);
  const queue = useMemo(() => {
    if (queueMode === "album") return album
      ? albumSongs.filter((song) => song.albumId === album.id)
      : albumSongs;
    if (queueMode === "top-ten") return topTenTracks;
    if (queueMode === "videos") return videoTracks;
    return [...albumSongs, ...videoTracks];
  }, [album, albumSongs, queueMode, topTenTracks, videoTracks]);
  const activeTrack = queue.find((track) => track.id === activeId)
    ?? albumSongs.find((track) => track.id === activeId)
    ?? videoTracks.find((track) => track.id === activeId)
    ?? queue[0];

  useEffect(() => { pausedByUserRef.current = pausedByUser; }, [pausedByUser]);
  useEffect(() => { autoPlayRef.current = autoPlay; }, [autoPlay]);
  useEffect(() => {
    if (!activeId && queue[0]) setActiveId(queue[0].id);
  }, [activeId, queue]);

  const selectTrack = (trackId: string, mode: QueueMode) => {
    lastAdvanceRef.current = "";
    previousTelemetryRef.current = "loading";
    setSnapshot(null);
    setQueueMode(mode);
    setActiveId(trackId);
    setAutoPlay(true);
    setPausedByUser(false);
    setPlayerVersion((version) => version + 1);
  };

  useEffect(() => {
    const requestedId = new URLSearchParams(window.location.search).get("track");
    const requestedPath = `${window.location.pathname}?track=${requestedId ?? ""}`;
    if (!requestedId || lastDeepLinkRef.current === requestedPath) return;
    const isAlbumSong = albumSongs.some((track) => track.id === requestedId);
    const isVideo = videoTracks.some((track) => track.id === requestedId);
    if (!isAlbumSong && !isVideo) return;
    lastDeepLinkRef.current = requestedPath;
    selectTrack(requestedId, isVideo ? "videos" : album ? "album" : "all");
  }, [album, albumSongs, videoTracks]);

  const handleTelemetry = useCallback((next: ProviderTelemetrySnapshot) => {
    if (pausedByUserRef.current && next.playbackState === "playing") {
      dispatchWorkspaceV2PlaybackCommand("pause", { channel, source: "user-click" });
      return;
    }
    let result = next;
    if (next.playbackState === "paused" && previousTelemetryRef.current === "playing") {
      const ended = next.duration > 0 && next.currentTime >= Math.max(0, next.duration - END_MARGIN_SECONDS);
      if (ended && autoPlayRef.current && !pausedByUserRef.current) {
        result = { ...next, currentTime: next.duration, playbackState: "completed" };
      } else {
        setAutoPlay(false);
        setPausedByUser(true);
      }
    }
    setSnapshot(result);
    if (result.playbackState === "playing") setPausedByUser(false);
    previousTelemetryRef.current = result.playbackState;
  }, [channel]);

  useEffect(() => {
    if (snapshot?.playbackState !== "completed" || pausedByUser || !autoPlay || queue.length < 2) return;
    const currentIndex = queue.findIndex((track) => track.id === activeTrack?.id);
    const next = queue[(currentIndex + 1) % queue.length];
    if (!next) return;
    const key = `${activeTrack?.id}:${playerVersion}`;
    if (lastAdvanceRef.current === key) return;
    lastAdvanceRef.current = key;
    const timer = window.setTimeout(() => selectTrack(next.id, queueMode), 700);
    return () => window.clearTimeout(timer);
  }, [activeTrack?.id, autoPlay, pausedByUser, playerVersion, queue, queueMode, snapshot?.playbackState]);

  const pause = () => {
    requestPlaybackRef.current = null;
    pausedByUserRef.current = true;
    autoPlayRef.current = false;
    setAutoPlay(false);
    setPausedByUser(true);
    setSnapshot((current) => current ? { ...current, playbackState: "paused" } : current);
    dispatchWorkspaceV2PlaybackCommand("pause", { channel, source: "user-click" });
  };
  const play = () => {
    pausedByUserRef.current = false;
    autoPlayRef.current = true;
    setSnapshot(null);
    setAutoPlay(true);
    setPausedByUser(false);
    requestPlaybackRef.current?.();
    dispatchWorkspaceV2PlaybackCommand("play", { channel, source: "user-click" });
  };
  const jump = (direction: -1 | 1) => {
    if (!queue.length) return;
    const index = queue.findIndex((track) => track.id === activeTrack?.id);
    selectTrack(queue[(index + direction + queue.length) % queue.length].id, queueMode);
  };
  const share = async (path: string, title: string) => {
    try {
      await shareUrl(path, title);
      setShareNotice("Enlace compartido.");
      window.setTimeout(() => setShareNotice(""), 2500);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setShareNotice("No se pudo compartir el enlace.");
    }
  };

  const rhythms = [...new Set([
    ...config.albums.map((item) => item.rhythm),
    ...albumSongs.map((item) => item.rhythm),
    ...videoTracks.map((item) => item.rhythm),
  ].filter(Boolean))];
  const visibleAlbums = config.albums.filter((item) => !selectedRhythm ||
    item.rhythm === selectedRhythm || item.tracks.some((track) => track.rhythm === selectedRhythm));
  const visibleVideos = videoTracks.filter((item) => !selectedRhythm || item.rhythm === selectedRhythm);
  const visibleTopTen = topTenTracks.filter((item) => !selectedRhythm || item.rhythm === selectedRhythm);
  const selectedAlbumSongs = albumSongs.filter((track) => track.albumId === album?.id &&
    (!selectedRhythm || track.rhythm === selectedRhythm || album?.rhythm === selectedRhythm));
  const playerLabel = snapshot?.playbackState === "playing"
    ? "REPRODUCIENDO"
    : pausedByUser ? "PAUSADO" : "LISTO";
  const accentStyle = { "--artist-accent": config.accentColor } as CSSProperties;

  return (
    <>
      <ArtistPwaInstallBrand
        accentColor={config.accentColor}
        logoUrl={config.logoUrl}
        name={site.name}
        slug={site.slug}
      />
      <main className="artist-template" style={accentStyle}>
      <div className="artist-template-topline">
        <Link href="/paginas-de-artistas"><ArrowLeft size={15} /> Artistas</Link>
        <span>FIRST LISTEN</span>
        <button aria-label="Compartir pagina" onClick={() => void share(pagePath, site.name)} title="Compartir pagina" type="button"><Share2 size={17} /></button>
      </div>

      <section aria-label="Reproductor" className="artist-template-player">
        <div className="artist-template-player-title">
          {config.logoUrl ? <Image alt="" height={52} src={config.logoUrl} unoptimized width={52} /> : <span>{site.name.slice(0, 1)}</span>}
          <div><small>{playerLabel}</small><strong>{activeTrack?.title || site.name}</strong><span>{activeTrack?.albumTitle || site.name}</span></div>
        </div>
        <div className="artist-template-player-frame">
          {activeTrack && (
            <ProviderPlayer
              artist={site.name}
              autoPlay={autoPlay && !pausedByUser}
              controlChannel={channel}
              coverUrl={activeTrack.coverUrl}
              key={`${activeTrack.id}:${playerVersion}`}
              link={activeTrack.link}
              locale="es"
              onTelemetry={handleTelemetry}
              onTrustedPlaybackRequestReady={(request) => { requestPlaybackRef.current = request; }}
              platform={detectDjCarlosPlatform(activeTrack.link)}
              preserveAutoPlayOnProviderPause
              songLoadedAt={new Date().toISOString()}
              title={activeTrack.title}
            />
          )}
          {activeTrack && pausedByUser && (
            <button className="artist-template-paused" onClick={play} type="button">
              <Image alt="" fill sizes="(max-width: 800px) 100vw, 400px" src={activeTrack.coverUrl} unoptimized />
              <span><Play fill="currentColor" size={20} /> Continuar</span>
            </button>
          )}
          {!activeTrack && <div className="artist-template-player-empty">La musica llegara pronto.</div>}
        </div>
        <div className="artist-template-player-controls">
          <button aria-label="Anterior" disabled={!activeTrack} onClick={() => jump(-1)} type="button"><SkipBack size={18} /></button>
          <button aria-label="Reproducir" disabled={!activeTrack} onClick={play} type="button"><Play fill="currentColor" size={18} /></button>
          <button aria-label="Pausar" disabled={!activeTrack} onClick={pause} type="button"><Pause size={18} /></button>
          <button aria-label="Siguiente" disabled={!activeTrack} onClick={() => jump(1)} type="button"><SkipForward size={18} /></button>
          {activeTrack && <a aria-label="Abrir en YouTube" href={activeTrack.link} rel="noreferrer" target="_blank" title="Abrir en YouTube"><ExternalLink size={17} /></a>}
          {activeTrack && <button aria-label="Compartir cancion" onClick={() => void share(`${pagePath}?track=${encodeURIComponent(activeTrack.id)}`, activeTrack.title)} title="Compartir cancion" type="button"><Share2 size={17} /></button>}
        </div>
        {shareNotice && <span className="artist-template-share-notice" role="status">{shareNotice}</span>}
      </section>

      <section className="artist-template-hero">
        <div className="artist-template-hero-copy">
          <span className="artist-template-eyebrow">PAGINA OFICIAL</span>
          <h1>{album ? album.title : site.name}</h1>
          <p>{album ? album.description : config.tagline}</p>
          <div className="artist-template-hero-actions">
            {(album ? selectedAlbumSongs.length > 0 : albumSongs.length > 0) && <button onClick={() => selectTrack((album ? selectedAlbumSongs : albumSongs)[0].id, "album")} type="button"><Disc3 size={17} /> Reproducir album</button>}
            {videoTracks.length > 0 && <button onClick={() => selectTrack(videoTracks[0].id, "videos")} type="button"><Video size={17} /> Videos oficiales</button>}
            {config.channelUrl && <a href={config.channelUrl} rel="noreferrer" target="_blank"><ExternalLink size={17} /> Canal oficial</a>}
            <button aria-label="Compartir" onClick={() => void share(pagePath, site.name)} title="Compartir" type="button"><Share2 size={17} /></button>
          </div>
        </div>
        <div className="artist-template-identity">
          {config.logoUrl && <div className="artist-template-logo"><Image alt={`Logo de ${site.name}`} fill priority sizes="(max-width: 700px) 70vw, 360px" src={config.logoUrl} unoptimized /></div>}
          {config.portraitUrl && <div className="artist-template-portrait"><Image alt={site.name} fill priority sizes="(max-width: 700px) 42vw, 190px" src={config.portraitUrl} unoptimized /></div>}
          {!config.logoUrl && !config.portraitUrl && <span className="artist-template-initial">{site.name.slice(0, 1)}</span>}
        </div>
      </section>

      {rhythms.length > 0 && (
        <div className="artist-template-rhythms"><strong>QUE QUIERES ESCUCHAR?</strong><div>
          <button aria-pressed={!selectedRhythm} className={!selectedRhythm ? "active" : ""} onClick={() => setSelectedRhythm("")} type="button">Todos</button>
          {rhythms.map((rhythm) => <button aria-pressed={selectedRhythm === rhythm} className={selectedRhythm === rhythm ? "active" : ""} key={rhythm} onClick={() => setSelectedRhythm(rhythm)} type="button">{rhythm}</button>)}
        </div></div>
      )}

      {album ? (
        <section className="artist-template-section">
          <div className="artist-template-section-head"><div><span>ALBUM EN ORDEN</span><h2>{album.title}</h2></div><Link href={rootPath}><ArrowLeft size={16} /> Todos los albumes</Link></div>
          <div className="artist-template-track-list">
            {selectedAlbumSongs.map((track, index) => <TrackRow index={index} key={track.id} onPlay={() => selectTrack(track.id, "album")} onShare={() => void share(`${pagePath}?track=${encodeURIComponent(track.id)}`, track.title)} track={track} />)}
            {!selectedAlbumSongs.length && <p className="artist-template-empty">Aun no hay canciones para este album.</p>}
          </div>
        </section>
      ) : config.albums.length > 0 ? (
        <section className="artist-template-section">
          <div className="artist-template-section-head"><div><span>BIBLIOTECA</span><h2>Albumes principales</h2></div><strong>{visibleAlbums.length} albumes</strong></div>
          <div className="artist-template-album-grid">
            {visibleAlbums.map((item) => (
              <article className="artist-template-album" key={item.id}>
                <Link href={`${rootPath}/album/${item.slug}`}>
                  {item.coverUrl ? <Image alt="" height={106} src={item.coverUrl} unoptimized width={106} /> : <span className="artist-template-cover-empty"><Disc3 size={32} /></span>}
                  <span><small>{item.rhythm || "ALBUM"}</small><strong>{item.title}</strong><em>{item.tracks.length} canciones</em></span>
                  <ArrowUpRight size={17} />
                </Link>
                <button aria-label={`Compartir ${item.title}`} onClick={() => void share(`${rootPath}/album/${item.slug}`, item.title)} title="Compartir album" type="button"><Share2 size={17} /></button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {config.upcoming.enabled && !album && (
        <section className="artist-template-upcoming">
          {config.upcoming.coverUrl && <Image alt={`Posible portada de ${config.upcoming.title}`} height={170} src={config.upcoming.coverUrl} unoptimized width={170} />}
          <div><span>PROXIMO LANZAMIENTO</span><h2>{config.upcoming.title}</h2><p>{config.upcoming.note}</p>
            {config.upcoming.songs.length > 0 && <ol>{config.upcoming.songs.map((song, index) => <li key={`${song}-${index}`}>{song}</li>)}</ol>}
          </div>
        </section>
      )}

      {videoTracks.length > 0 && <section className="artist-template-section">
        <div className="artist-template-section-head"><div><span>VIDEOS OFICIALES</span><h2>Videos</h2></div>{visibleVideos.length > 6 && <button onClick={() => setShowAllVideos((value) => !value)} type="button">{showAllVideos ? "Ver menos" : "Ver todos"}</button>}</div>
        <div className="artist-template-video-grid">
          {visibleVideos.slice(0, showAllVideos ? undefined : 6).map((track) => (
            <article key={track.id}>
              <button onClick={() => selectTrack(track.id, "videos")} type="button"><Image alt="" fill sizes="(max-width: 760px) 80vw, 280px" src={track.coverUrl} unoptimized /><Play fill="currentColor" size={22} /></button>
              <strong>{track.title}</strong>
              <div><span>{track.rhythm || "Video oficial"}</span><button aria-label={`Compartir ${track.title}`} onClick={() => void share(`${rootPath}?track=${encodeURIComponent(track.id)}`, track.title)} title="Compartir video" type="button"><Share2 size={16} /></button></div>
            </article>
          ))}
          {!visibleVideos.length && <p className="artist-template-empty">Aun no hay videos publicados.</p>}
        </div>
      </section>}

      {topTenTracks.length > 0 && <section className="artist-template-section">
        <div className="artist-template-section-head"><div><span>FAVORITAS PARA REPRODUCIR</span><h2>Top Ten</h2></div>{visibleTopTen.length > 0 && <button onClick={() => setShowTopTen((value) => !value)} type="button"><ListMusic size={16} /> {showTopTen ? "Cerrar lista" : "Ver lista"}</button>}</div>
        {showTopTen && <div className="artist-template-track-list">
          {visibleTopTen.map((track, index) => <TrackRow index={index} key={track.id} onPlay={() => selectTrack(track.id, "top-ten")} onShare={() => void share(`${rootPath}?track=${encodeURIComponent(track.id)}`, track.title)} track={track} />)}
        </div>}
        {!visibleTopTen.length && <p className="artist-template-empty">Pronto habra canciones destacadas.</p>}
      </section>}

      <footer className="artist-template-footer">
        <Link href="/paginas-de-artistas">Mas artistas</Link>
        {site.id !== "preview" && <Link href={`${rootPath}/admin`}>Panel del artista</Link>}
      </footer>
      </main>
    </>
  );
}

function TrackRow({
  index, onPlay, onShare, track,
}: {
  index: number;
  onPlay: () => void;
  onShare: () => void;
  track: Playable;
}) {
  return (
    <article className="artist-template-track">
      <button aria-label={`Reproducir ${track.title}`} onClick={onPlay} type="button"><Play fill="currentColor" size={17} /></button>
      <b>{String(index + 1).padStart(2, "0")}</b>
      <Image alt="" height={54} src={track.coverUrl} unoptimized width={54} />
      <div><strong>{track.title}</strong><small>{track.albumTitle || track.rhythm}</small></div>
      <button aria-label={`Compartir ${track.title}`} onClick={onShare} title="Compartir" type="button"><Share2 size={16} /></button>
      <a aria-label={`Abrir ${track.title} en YouTube`} href={track.link} rel="noreferrer" target="_blank" title="Abrir en YouTube"><ExternalLink size={16} /></a>
    </article>
  );
}
