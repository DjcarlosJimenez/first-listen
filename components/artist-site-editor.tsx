"use client";

import Image from "next/image";
import Link from "next/link";
import { ChangeEvent, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, ImagePlus, Plus, Save, Trash2 } from "lucide-react";
import {
  normalizeArtistSiteConfig,
  type ArtistSiteAlbum,
  type ArtistSiteConfig,
  type ArtistSiteTrack,
} from "@/lib/artist-sites";
import { isPlayableDjCarlosLink } from "@/lib/dj-carlos-page";
import { createClient } from "@/lib/supabase/client";

type EditorSite = {
  id: string;
  slug: string;
  name: string;
  published: boolean;
  config: unknown;
};

type EditorTab = "identity" | "albums" | "top-ten" | "videos" | "upcoming";

function move<T>(items: T[], index: number, direction: -1 | 1) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= items.length) return items;
  const next = [...items];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next;
}

function newTrack(): ArtistSiteTrack {
  return { id: crypto.randomUUID(), title: "", link: "", rhythm: "" };
}

function newAlbum(index: number): ArtistSiteAlbum {
  const id = crypto.randomUUID();
  return {
    id,
    slug: `album-${index}-${id.slice(0, 8)}`,
    title: `Nuevo album ${index}`,
    description: "",
    coverUrl: "",
    rhythm: "",
    tracks: [],
  };
}

function validateLinks(config: ArtistSiteConfig) {
  const images = [
    ["logo", config.logoUrl],
    ["foto", config.portraitUrl],
    ["proximo lanzamiento", config.upcoming.coverUrl],
    ...config.albums.map((album) => [`portada de ${album.title || "un album"}`, album.coverUrl]),
  ];
  for (const [label, value] of images) {
    if (!value) continue;
    try {
      const url = new URL(value, window.location.origin);
      if (url.protocol !== "https:" && !(value.startsWith("/") && !value.startsWith("//"))) {
        return `La imagen de ${label} debe usar HTTPS.`;
      }
    } catch {
      return `Revisa la URL de ${label}.`;
    }
  }
  for (const album of config.albums) {
    if (!album.title.trim()) return "Pon un titulo a cada album antes de guardar.";
    for (const track of album.tracks) {
      if (track.link && !track.title.trim()) return `Pon titulo a una cancion de ${album.title}.`;
      if (track.link && !isPlayableDjCarlosLink(track.link)) {
        return `Revisa el enlace de ${track.title || "una cancion"}. Solo se admiten enlaces de YouTube o YouTube Music.`;
      }
    }
  }
  for (const video of config.videos) {
    if (video.link && !video.title.trim()) return "Pon titulo a cada video con enlace.";
    if (video.link && !isPlayableDjCarlosLink(video.link)) {
      return `Revisa el enlace de ${video.title || "un video"}. Solo se admiten enlaces de YouTube.`;
    }
  }
  return null;
}

export function ArtistSiteEditor({ site }: { site: EditorSite }) {
  const [config, setConfig] = useState(() => normalizeArtistSiteConfig(site.config));
  const [tab, setTab] = useState<EditorTab>("identity");
  const [selectedAlbumId, setSelectedAlbumId] = useState(() =>
    normalizeArtistSiteConfig(site.config).albums[0]?.id ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState("");
  const [message, setMessage] = useState("");
  const revisionRef = useRef(0);
  const configRef = useRef(config);

  const selectedAlbum = config.albums.find((album) => album.id === selectedAlbumId)
    ?? config.albums[0];
  const songs = useMemo(
    () => config.albums.flatMap((album) => album.tracks.filter((track) => track.link).map((track) => ({
      ...track,
      albumTitle: album.title,
    }))),
    [config.albums],
  );

  const change = (next: ArtistSiteConfig) => {
    configRef.current = next;
    setConfig(next);
    revisionRef.current += 1;
    setMessage("Cambios sin guardar.");
  };

  const updateAlbum = (albumId: string, update: Partial<ArtistSiteAlbum>) => {
    change({
      ...config,
      albums: config.albums.map((album) => album.id === albumId
        ? { ...album, ...update }
        : album),
    });
  };

  const updateTrack = (
    albumId: string,
    trackId: string,
    update: Partial<ArtistSiteTrack>,
  ) => {
    change({
      ...config,
      albums: config.albums.map((album) => album.id === albumId
        ? {
            ...album,
            tracks: album.tracks.map((track) => track.id === trackId
              ? { ...track, ...update }
              : track),
          }
        : album),
    });
  };

  const save = async (nextConfig = configRef.current) => {
    const startingRevision = revisionRef.current;
    const client = createClient();
    if (!client) {
      setMessage("No hay conexion con el servicio. Intenta otra vez.");
      return false;
    }
    const linkError = validateLinks(nextConfig);
    if (linkError) {
      setMessage(linkError);
      return false;
    }
    setSaving(true);
    const cleanConfig = normalizeArtistSiteConfig(nextConfig);
    const { error } = await client.rpc("artist_save_site_config", {
      site_id: site.id,
      site_config: cleanConfig,
    });
    setSaving(false);
    if (error) {
      setMessage(`No se guardo: ${error.message}`);
      return false;
    }
    if (startingRevision === revisionRef.current) {
      configRef.current = cleanConfig;
      setConfig(cleanConfig);
      setMessage("Guardado correctamente. Los cambios ya estan en la pagina.");
    }
    return true;
  };

  const uploadImage = async (
    event: ChangeEvent<HTMLInputElement>,
    target: "logo" | "portrait" | "album" | "upcoming",
    albumId?: string,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setMessage("La imagen debe ser PNG, JPG o WEBP.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setMessage("La imagen no puede superar 20 MB.");
      return;
    }
    const client = createClient();
    if (!client) {
      setMessage("No hay conexion con el servicio.");
      return;
    }
    setUploading(target);
    setMessage("");
    const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${site.id}/${target}/${crypto.randomUUID()}.${extension}`;
    const { error } = await client.storage.from("artist-site-assets").upload(path, file, {
      cacheControl: "31536000",
      contentType: file.type,
      upsert: false,
    });
    if (error) {
      setMessage(`No se pudo subir la imagen: ${error.message}`);
      setUploading("");
      return;
    }
    const { data } = client.storage.from("artist-site-assets").getPublicUrl(path);
    const url = data.publicUrl;
    const current = configRef.current;
    const next = target === "logo"
      ? { ...current, logoUrl: url }
      : target === "portrait"
        ? { ...current, portraitUrl: url }
        : target === "upcoming"
          ? { ...current, upcoming: { ...current.upcoming, coverUrl: url } }
          : {
              ...current,
              albums: current.albums.map((album) => album.id === albumId
                ? { ...album, coverUrl: url }
                : album),
            };
    configRef.current = next;
    setConfig(next);
    const saved = await save(next);
    if (!saved) setMessage("Imagen subida, pero no se pudo aplicar. Pulsa Guardar para reintentar.");
    setUploading("");
  };

  const addAlbum = () => {
    if (config.albums.length >= 40) {
      setMessage("Se alcanzo el limite de 40 albumes por pagina.");
      return;
    }
    const album = newAlbum(config.albums.length + 1);
    change({ ...config, albums: [...config.albums, album] });
    setSelectedAlbumId(album.id);
  };

  const deleteAlbum = (albumId: string) => {
    if (!window.confirm("¿Quitar este album y sus canciones de la pagina?")) return;
    const albums = config.albums.filter((album) => album.id !== albumId);
    const songIds = new Set(albums.flatMap((album) => album.tracks.map((track) => track.id)));
    change({
      ...config,
      albums,
      topTenIds: config.topTenIds.filter((id) => songIds.has(id)),
    });
    setSelectedAlbumId(albums[0]?.id ?? "");
  };

  return (
    <main className="artist-site-editor-page">
      <header className="artist-site-editor-header">
        <Link href="/paginas-de-artistas"><ArrowLeft size={16} /> First Listen</Link>
        <div><span>PANEL DEL ARTISTA</span><h1>{site.name}</h1></div>
        <div className="artist-site-editor-header-actions">
          <Link href={`/${site.slug}`}>Ver pagina</Link>
          <button disabled={saving || Boolean(uploading)} onClick={() => void save()} type="button">
            <Save size={16} /> {saving ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </header>
      {!site.published && <div className="artist-site-editor-draft">Borrador: solo tu y el propietario de First Listen pueden verlo hasta que se publique.</div>}
      {message && <p className="artist-site-editor-status" role="status">{message}</p>}

      <nav aria-label="Secciones del editor" className="artist-site-editor-tabs">
        {([
          ["identity", "Identidad"],
          ["albums", "Albumes"],
          ["top-ten", "Top Ten"],
          ["videos", "Videos"],
          ["upcoming", "Proximo lanzamiento"],
        ] as const).map(([id, label]) => (
          <button
            aria-current={tab === id ? "page" : undefined}
            className={tab === id ? "active" : ""}
            key={id}
            onClick={() => setTab(id)}
            type="button"
          >{label}</button>
        ))}
      </nav>

      {tab === "identity" && (
        <section className="artist-site-editor-section">
          <h2>Identidad</h2>
          <div className="artist-site-editor-identity">
            <div className="artist-site-editor-images">
              {config.logoUrl && <Image alt="Logo actual" height={160} src={config.logoUrl} unoptimized width={160} />}
              {config.portraitUrl && <Image alt="Foto actual" height={160} src={config.portraitUrl} unoptimized width={160} />}
            </div>
            <div className="artist-site-editor-fields">
              <label>Frase principal
                <input maxLength={240} onChange={(event) => change({ ...config, tagline: event.target.value })} value={config.tagline} />
              </label>
              <label>Canal oficial
                <input onChange={(event) => change({ ...config, channelUrl: event.target.value })} placeholder="https://www.youtube.com/@canal" type="url" value={config.channelUrl} />
              </label>
              <label>Color principal
                <input onChange={(event) => change({ ...config, accentColor: event.target.value })} type="color" value={config.accentColor} />
              </label>
              <label>URL del logo
                <input onChange={(event) => change({ ...config, logoUrl: event.target.value })} type="url" value={config.logoUrl} />
              </label>
              <label className="artist-site-editor-upload"><ImagePlus size={16} /> {uploading === "logo" ? "Subiendo..." : "Cargar logo"}
                <input accept="image/png,image/jpeg,image/webp" disabled={Boolean(uploading)} onChange={(event) => void uploadImage(event, "logo")} type="file" />
              </label>
              <label>URL de la foto
                <input onChange={(event) => change({ ...config, portraitUrl: event.target.value })} type="url" value={config.portraitUrl} />
              </label>
              <label className="artist-site-editor-upload"><ImagePlus size={16} /> {uploading === "portrait" ? "Subiendo..." : "Cargar foto"}
                <input accept="image/png,image/jpeg,image/webp" disabled={Boolean(uploading)} onChange={(event) => void uploadImage(event, "portrait")} type="file" />
              </label>
              {config.portraitUrl && <button className="artist-site-editor-secondary" onClick={() => change({ ...config, portraitUrl: "" })} type="button">Quitar foto</button>}
            </div>
          </div>
        </section>
      )}

      {tab === "albums" && (
        <section className="artist-site-editor-section">
          <div className="artist-site-editor-section-head"><h2>Albumes</h2><button disabled={config.albums.length >= 40} onClick={addAlbum} title="Maximo 40 albumes" type="button"><Plus size={16} /> Agregar album</button></div>
          <div className="artist-site-editor-album-layout">
            <div className="artist-site-editor-album-list">
              {config.albums.map((album, index) => (
                <div className={selectedAlbum?.id === album.id ? "selected" : ""} key={album.id}>
                  <button onClick={() => setSelectedAlbumId(album.id)} type="button">{album.title || `Album ${index + 1}`} <small>{album.tracks.length} canciones</small></button>
                  <button aria-label="Subir album" disabled={index === 0} onClick={() => change({ ...config, albums: move(config.albums, index, -1) })} type="button"><ArrowUp size={15} /></button>
                  <button aria-label="Bajar album" disabled={index === config.albums.length - 1} onClick={() => change({ ...config, albums: move(config.albums, index, 1) })} type="button"><ArrowDown size={15} /></button>
                </div>
              ))}
            </div>
            {selectedAlbum && (
              <div className="artist-site-editor-album-detail" key={selectedAlbum.id}>
                <div className="artist-site-editor-fields">
                  <label>Titulo
                    <input maxLength={160} onChange={(event) => updateAlbum(selectedAlbum.id, { title: event.target.value })} value={selectedAlbum.title} />
                  </label>
                  <label>Ritmo del album
                    <input maxLength={80} onChange={(event) => updateAlbum(selectedAlbum.id, { rhythm: event.target.value })} value={selectedAlbum.rhythm} />
                  </label>
                  <label>Descripcion
                    <textarea maxLength={1000} onChange={(event) => updateAlbum(selectedAlbum.id, { description: event.target.value })} value={selectedAlbum.description} />
                  </label>
                  <label>URL de portada
                    <input onChange={(event) => updateAlbum(selectedAlbum.id, { coverUrl: event.target.value })} type="url" value={selectedAlbum.coverUrl} />
                  </label>
                  <label className="artist-site-editor-upload"><ImagePlus size={16} /> {uploading === "album" ? "Subiendo..." : "Cargar portada"}
                    <input accept="image/png,image/jpeg,image/webp" disabled={Boolean(uploading)} onChange={(event) => void uploadImage(event, "album", selectedAlbum.id)} type="file" />
                  </label>
                </div>
                {selectedAlbum.coverUrl && <Image alt={`Portada de ${selectedAlbum.title}`} height={150} src={selectedAlbum.coverUrl} unoptimized width={150} />}
                <div className="artist-site-editor-section-head"><h3>Canciones</h3><button disabled={selectedAlbum.tracks.length >= 150} onClick={() => updateAlbum(selectedAlbum.id, { tracks: [...selectedAlbum.tracks, newTrack()] })} title="Maximo 150 canciones por album" type="button"><Plus size={16} /> Agregar cancion</button></div>
                <div className="artist-site-editor-track-list">
                  {selectedAlbum.tracks.map((track, index) => (
                    <div className="artist-site-editor-track" key={track.id}>
                      <strong>{String(index + 1).padStart(2, "0")}</strong>
                      <input aria-label={`Titulo cancion ${index + 1}`} onChange={(event) => updateTrack(selectedAlbum.id, track.id, { title: event.target.value })} placeholder="Titulo" value={track.title} />
                      <input aria-label={`Enlace cancion ${index + 1}`} onChange={(event) => updateTrack(selectedAlbum.id, track.id, { link: event.target.value })} placeholder="Enlace YouTube" value={track.link} />
                      <input aria-label={`Ritmo cancion ${index + 1}`} onChange={(event) => updateTrack(selectedAlbum.id, track.id, { rhythm: event.target.value })} placeholder="Ritmo" value={track.rhythm} />
                      <button aria-label="Subir cancion" disabled={index === 0} onClick={() => updateAlbum(selectedAlbum.id, { tracks: move(selectedAlbum.tracks, index, -1) })} type="button"><ArrowUp size={15} /></button>
                      <button aria-label="Bajar cancion" disabled={index === selectedAlbum.tracks.length - 1} onClick={() => updateAlbum(selectedAlbum.id, { tracks: move(selectedAlbum.tracks, index, 1) })} type="button"><ArrowDown size={15} /></button>
                      <button aria-label="Quitar cancion" onClick={() => {
                        change({
                          ...config,
                          albums: config.albums.map((album) => album.id === selectedAlbum.id
                            ? { ...album, tracks: album.tracks.filter((item) => item.id !== track.id) }
                            : album),
                          topTenIds: config.topTenIds.filter((id) => id !== track.id),
                        });
                      }} type="button"><Trash2 size={15} /></button>
                    </div>
                  ))}
                </div>
                <button className="artist-site-editor-secondary" onClick={() => deleteAlbum(selectedAlbum.id)} type="button"><Trash2 size={16} /> Quitar album</button>
              </div>
            )}
          </div>
        </section>
      )}

      {tab === "top-ten" && (
        <section className="artist-site-editor-section">
          <h2>Top Ten</h2>
          <div className="artist-site-editor-top-ten">
            {config.topTenIds.map((id, index) => {
              const song = songs.find((track) => track.id === id);
              if (!song) return null;
              return (
                <div key={id}>
                  <strong>{String(index + 1).padStart(2, "0")}</strong>
                  <span>{song.title || "Sin titulo"} <small>{song.albumTitle}</small></span>
                  <button aria-label="Subir en Top Ten" disabled={index === 0} onClick={() => change({ ...config, topTenIds: move(config.topTenIds, index, -1) })} type="button"><ArrowUp size={16} /></button>
                  <button aria-label="Bajar en Top Ten" disabled={index === config.topTenIds.length - 1} onClick={() => change({ ...config, topTenIds: move(config.topTenIds, index, 1) })} type="button"><ArrowDown size={16} /></button>
                  <button aria-label="Quitar de Top Ten" onClick={() => change({ ...config, topTenIds: config.topTenIds.filter((trackId) => trackId !== id) })} type="button"><Trash2 size={16} /></button>
                </div>
              );
            })}
          </div>
          <h3>Canciones disponibles</h3>
          <div className="artist-site-editor-song-options">
            {songs.filter((song) => !config.topTenIds.includes(song.id)).map((song) => (
              <button
                disabled={config.topTenIds.length >= 10}
                key={song.id}
                onClick={() => change({ ...config, topTenIds: [...config.topTenIds, song.id] })}
                type="button"
              ><Plus size={15} /> {song.title || "Sin titulo"} <small>{song.albumTitle}</small></button>
            ))}
          </div>
        </section>
      )}

      {tab === "videos" && (
        <section className="artist-site-editor-section">
          <div className="artist-site-editor-section-head"><h2>Videos oficiales</h2><button disabled={config.videos.length >= 80} onClick={() => change({ ...config, videos: [...config.videos, newTrack()] })} title="Maximo 80 videos" type="button"><Plus size={16} /> Agregar video</button></div>
          <div className="artist-site-editor-track-list">
            {config.videos.map((video, index) => (
              <div className="artist-site-editor-track" key={video.id}>
                <strong>{String(index + 1).padStart(2, "0")}</strong>
                <input aria-label={`Titulo video ${index + 1}`} onChange={(event) => change({ ...config, videos: config.videos.map((item) => item.id === video.id ? { ...item, title: event.target.value } : item) })} placeholder="Titulo" value={video.title} />
                <input aria-label={`Enlace video ${index + 1}`} onChange={(event) => change({ ...config, videos: config.videos.map((item) => item.id === video.id ? { ...item, link: event.target.value } : item) })} placeholder="Enlace YouTube" value={video.link} />
                <input aria-label={`Ritmo video ${index + 1}`} onChange={(event) => change({ ...config, videos: config.videos.map((item) => item.id === video.id ? { ...item, rhythm: event.target.value } : item) })} placeholder="Ritmo" value={video.rhythm} />
                <button aria-label="Subir video" disabled={index === 0} onClick={() => change({ ...config, videos: move(config.videos, index, -1) })} type="button"><ArrowUp size={15} /></button>
                <button aria-label="Bajar video" disabled={index === config.videos.length - 1} onClick={() => change({ ...config, videos: move(config.videos, index, 1) })} type="button"><ArrowDown size={15} /></button>
                <button aria-label="Quitar video" onClick={() => change({ ...config, videos: config.videos.filter((item) => item.id !== video.id) })} type="button"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === "upcoming" && (
        <section className="artist-site-editor-section">
          <h2>Proximo lanzamiento</h2>
          <div className="artist-site-editor-fields">
            <label className="artist-site-editor-toggle"><input checked={config.upcoming.enabled} onChange={(event) => change({ ...config, upcoming: { ...config.upcoming, enabled: event.target.checked } })} type="checkbox" /> Mostrar en la pagina</label>
            <label>Titulo posible<input onChange={(event) => change({ ...config, upcoming: { ...config.upcoming, title: event.target.value } })} value={config.upcoming.title} /></label>
            <label>Nota para visitantes<textarea onChange={(event) => change({ ...config, upcoming: { ...config.upcoming, note: event.target.value } })} value={config.upcoming.note} /></label>
            <label>URL de portada<input onChange={(event) => change({ ...config, upcoming: { ...config.upcoming, coverUrl: event.target.value } })} type="url" value={config.upcoming.coverUrl} /></label>
            <label className="artist-site-editor-upload"><ImagePlus size={16} /> {uploading === "upcoming" ? "Subiendo..." : "Cargar portada"}<input accept="image/png,image/jpeg,image/webp" disabled={Boolean(uploading)} onChange={(event) => void uploadImage(event, "upcoming")} type="file" /></label>
            <label>Posibles canciones<textarea onChange={(event) => change({ ...config, upcoming: { ...config.upcoming, songs: event.target.value.split("\n") } })} rows={9} value={config.upcoming.songs.join("\n")} /></label>
          </div>
          {config.upcoming.coverUrl && <Image alt="Portada proxima" height={180} src={config.upcoming.coverUrl} unoptimized width={180} />}
        </section>
      )}

      <div className="artist-site-editor-bottom"><button disabled={saving || Boolean(uploading)} onClick={() => void save()} type="button"><Save size={16} /> {saving ? "Guardando..." : "Guardar cambios"}</button></div>
    </main>
  );
}
