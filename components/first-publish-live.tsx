"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import {
  BadgeCheck,
  CheckCircle2,
  Clock3,
  Copy,
  Drum,
  Heart,
  LoaderCircle,
  Mic2,
  Play,
  Repeat2,
  Share2,
} from "lucide-react";
import { ProviderPlayer } from "@/components/provider-player";
import {
  firstPublishFunnelLabels,
  trackFirstPublishStage,
  type FirstPublishLiveSong,
  type FirstPublishReactionKey,
} from "@/lib/first-publish";

const reactionOptions: Array<{
  icon: typeof Heart;
  key: FirstPublishReactionKey;
  label: string;
}> = [
  { icon: Heart, key: "liked", label: "Me gustó" },
  { icon: Mic2, key: "good_voice", label: "Buena voz" },
  { icon: Drum, key: "good_rhythm", label: "Buen ritmo" },
  { icon: Repeat2, key: "listen_again", label: "La escucharía otra vez" },
];

export function FirstPublishLive({ song }: { song: FirstPublishLiveSong }) {
  const [started, setStarted] = useState(false);
  const [requestPlayback, setRequestPlayback] = useState<(() => void) | null>(null);
  const [counts, setCounts] = useState(song.reactions);
  const [reacted, setReacted] = useState<FirstPublishReactionKey[]>([]);
  const [reactionLoading, setReactionLoading] = useState<FirstPublishReactionKey | null>(null);
  const [retained, setRetained] = useState(song.retained);
  const [retaining, setRetaining] = useState(false);
  const [notice, setNotice] = useState("");
  const liveUrl = typeof window === "undefined"
    ? `https://www.firstlisten.net/first-publish/live/${song.id}`
    : window.location.href;

  const play = useCallback(() => {
    setStarted(true);
    requestPlayback?.();
  }, [requestPlayback]);

  async function react(reaction: FirstPublishReactionKey) {
    if (reactionLoading || reacted.includes(reaction)) return;
    setReactionLoading(reaction);
    setNotice("");
    try {
      const response = await fetch("/api/first-publish/reaction", {
        body: JSON.stringify({ reaction, songId: song.id }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = (await response.json()) as {
        counts?: FirstPublishLiveSong["reactions"];
        error?: string;
      };
      if (!response.ok || !data.counts) {
        throw new Error(data.error || "No pudimos guardar tu reacción.");
      }
      setCounts(data.counts);
      setReacted((current) => [...current, reaction]);
      setNotice("¡Gracias! Tu reacción ya cuenta para el artista.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No pudimos guardar tu reacción.");
    } finally {
      setReactionLoading(null);
    }
  }

  async function share() {
    trackFirstPublishStage(firstPublishFunnelLabels.shared);
    const data = {
      text: `Escucha “${song.title}” de ${song.artistName} en First Listen.`,
      title: `${song.title} · ${song.artistName}`,
      url: liveUrl,
    };
    try {
      if (navigator.share) {
        await navigator.share(data);
        setNotice("Publicación lista para compartir.");
        return;
      }
      await navigator.clipboard.writeText(liveUrl);
      setNotice("Enlace copiado.");
    } catch {
      setNotice("No pudimos abrir el menú. Usa el botón Copiar enlace.");
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(liveUrl);
      setNotice("Enlace copiado.");
      trackFirstPublishStage(firstPublishFunnelLabels.shared);
    } catch {
      setNotice("Mantén presionada la dirección del navegador para copiarla.");
    }
  }

  async function retain() {
    if (retaining) return;
    setRetaining(true);
    setNotice("");
    try {
      const response = await fetch("/api/first-publish/retain", {
        body: JSON.stringify({ songId: song.id }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "No pudimos conservar la canción.");
      setRetained(true);
      setNotice("Tu canción quedó activa sin fecha de vencimiento.");
      trackFirstPublishStage(firstPublishFunnelLabels.retained);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No pudimos conservar la canción.");
    } finally {
      setRetaining(false);
    }
  }

  const expiration = song.expiresAt
    ? new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(new Date(song.expiresAt))
    : "";

  return (
    <main className="first-publish-live-page">
      <header className="first-publish-live-header">
        <Link href="/guest">FIRST <span>LISTEN</span></Link>
        <Link href="/first-publish">Publicar mi canción</Link>
      </header>

      <section className="first-publish-live-card">
        <div className="first-publish-live-copy">
          <span className="eyebrow"><BadgeCheck size={14} /> PRIMERA PUBLICACIÓN</span>
          <h1>{song.title}</h1>
          <p>{song.artistName}</p>
          <div className="first-publish-live-tags">
            <span>{song.genre}</span><span>{song.platform}</span>
            <span>{song.contentKind === "music_video" ? "Video musical" : "Canción"}</span>
          </div>
          <div className="first-publish-live-share">
            <button onClick={share} type="button"><Share2 size={17} /> Compartir</button>
            <button onClick={copy} type="button"><Copy size={17} /> Copiar enlace</button>
          </div>
        </div>

        <div className="first-publish-live-player">
          <ProviderPlayer
            artist={song.artistName}
            autoPlay={started}
            coverUrl={song.coverImageUrl}
            link={song.musicUrl}
            locale="es"
            onTrustedPlaybackRequestReady={(request) => setRequestPlayback(() => request)}
            platform={song.platform}
            preserveAutoPlayOnProviderPause
            songLoadedAt={null}
            title={song.title}
          />
          {!started && (
            <button
              aria-label="Escuchar canción"
              className="first-publish-live-cover"
              onClick={play}
              style={{ backgroundImage: `url("${song.coverImageUrl}")` }}
              type="button"
            >
              <span><Play fill="currentColor" size={28} /></span>
              <strong>Escuchar ahora</strong>
            </button>
          )}
        </div>
      </section>

      <section className="first-publish-live-reactions">
        <div><span className="eyebrow">REACCIÓN RÁPIDA</span><h2>¿Qué te pareció?</h2><p>Un toque ayuda al artista. No necesitas registrarte.</p></div>
        <div className="first-publish-live-reaction-grid">
          {reactionOptions.map((option) => {
            const Icon = option.icon;
            const selected = reacted.includes(option.key);
            return (
              <button
                className={selected ? "is-selected" : ""}
                disabled={selected || reactionLoading === option.key}
                key={option.key}
                onClick={() => react(option.key)}
                type="button"
              >
                {reactionLoading === option.key ? <LoaderCircle className="spin" size={20} /> : <Icon size={20} />}
                <span>{option.label}</span><strong>{counts[option.key]}</strong>
              </button>
            );
          })}
        </div>
      </section>

      {song.isOwner && (
        <section className="first-publish-owner-panel">
          <div>
            <span className="eyebrow"><CheckCircle2 size={14} /> TU PUBLICACIÓN</span>
            <h2>{retained ? "Tu canción se mantendrá activa" : "Tu canción está activa por 7 días"}</h2>
            <p>{retained ? "Ya no tiene fecha de vencimiento." : `Visible hasta ${expiration}. Consérvala gratis y administra tus próximas publicaciones.`}</p>
          </div>
          {!retained ? (
            <button disabled={retaining} onClick={retain} type="button">
              {retaining ? <LoaderCircle className="spin" size={18} /> : <Clock3 size={18} />}
              {retaining ? "Conservando..." : "Conservar gratis"}
            </button>
          ) : <Link href="/dashboard">Administrar mi música</Link>}
        </section>
      )}

      {notice && <p className="first-publish-live-notice" role="status">{notice}</p>}
      <footer className="first-publish-live-footer">Descubre música nueva en <Link href="/guest">First Listen</Link>.</footer>
    </main>
  );
}
