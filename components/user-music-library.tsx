"use client";

import Link from "next/link";
import Image from "next/image";
import {
  ArrowDown,
  ArrowUp,
  Bell,
  BookmarkPlus,
  Check,
  Heart,
  ListMusic,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { InterfaceLocale } from "@/lib/catalog";
import { createClient } from "@/lib/supabase/client";
import type { WorkspaceV2Song } from "@/lib/workspace-v2";

const LOCAL_PLAYLISTS_KEY = "first-listen-local-playlists-v1";
const LOCAL_LIKES_KEY = "first-listen-liked-song-snapshots-v1";
const LOCAL_REMINDER_KEY = "first-listen-inactive-reminder-preference-v1";

function libraryImageLoader({ src }: { src: string }) {
  return src;
}

function isLocalPreviewHost() {
  if (typeof window === "undefined") return false;
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

export type LibrarySong = {
  artist: string;
  coverUrl: string;
  genre: string;
  id: string;
  link: string;
  platform: string;
  title: string;
};

type Playlist = {
  id: string;
  itemCount: number;
  name: string;
  updatedAt: string;
};

type PlaylistItem = {
  playlistId: string;
  position: number;
  song: LibrarySong;
};

type LocalPlaylist = {
  id: string;
  items: LibrarySong[];
  name: string;
  updatedAt: string;
};

function firstRow(value: unknown) {
  return Array.isArray(value) ? value[0] : value;
}

function toLibrarySong(song: WorkspaceV2Song): LibrarySong {
  return {
    artist: song.artist,
    coverUrl: song.coverUrl,
    genre: song.genre ?? song.subcategory ?? song.category ?? "",
    id: song.id,
    link: song.link,
    platform: song.platform,
    title: song.title,
  };
}

function mapLibraryRow(row: Record<string, unknown>): LibrarySong {
  return {
    artist: String(row.artist_name ?? "Unknown Artist"),
    coverUrl: String(row.cover_image_url ?? "/icon.png"),
    genre: String(row.genre ?? ""),
    id: String(row.song_id ?? ""),
    link: String(row.music_url ?? ""),
    platform: String(row.platform ?? "YouTube"),
    title: String(row.title ?? "Untitled Song"),
  };
}

function readLocalPlaylists(): LocalPlaylist[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(LOCAL_PLAYLISTS_KEY) ?? "[]");
    return Array.isArray(value) ? (value as LocalPlaylist[]) : [];
  } catch {
    return [];
  }
}

function writeLocalPlaylists(playlists: LocalPlaylist[]) {
  window.localStorage.setItem(LOCAL_PLAYLISTS_KEY, JSON.stringify(playlists));
}

function readLocalLikes(): LibrarySong[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(LOCAL_LIKES_KEY) ?? "[]");
    return Array.isArray(value) ? (value as LibrarySong[]) : [];
  } catch {
    return [];
  }
}

function mirrorLike(song: LibrarySong, liked: boolean) {
  const current = readLocalLikes().filter((item) => item.id !== song.id);
  if (liked) current.unshift(song);
  window.localStorage.setItem(LOCAL_LIKES_KEY, JSON.stringify(current.slice(0, 200)));
}

function localPlaylistSnapshot(playlists: LocalPlaylist[]) {
  return {
    items: playlists.flatMap((playlist) =>
      playlist.items.map((song, position) => ({
        playlistId: playlist.id,
        position,
        song,
      })),
    ),
    playlists: playlists.map((playlist) => ({
      id: playlist.id,
      itemCount: playlist.items.length,
      name: playlist.name,
      updatedAt: playlist.updatedAt,
    })),
  };
}

async function loadRemoteLibrary() {
  const supabase = createClient();
  if (!supabase) throw new Error("First Listen is not configured.");
  const [{ data: playlistRows, error: playlistError }, { data: itemRows, error: itemError }] =
    await Promise.all([
      supabase.rpc("get_my_music_playlists"),
      supabase.rpc("get_my_music_playlist_items", { target_playlist_id: null }),
    ]);
  if (playlistError) throw playlistError;
  if (itemError) throw itemError;
  return {
    items: ((itemRows ?? []) as Array<Record<string, unknown>>).map((row) => ({
      playlistId: String(row.playlist_id),
      position: Number(row.position ?? 0),
      song: mapLibraryRow(row),
    })),
    playlists: ((playlistRows ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.playlist_id),
      itemCount: Number(row.item_count ?? 0),
      name: String(row.playlist_name ?? "Playlist"),
      updatedAt: String(row.updated_at ?? ""),
    })),
  };
}

function createLocalPlaylist(name: string, firstSong?: LibrarySong) {
  const now = new Date().toISOString();
  const playlists = readLocalPlaylists();
  const existing = playlists.find(
    (playlist) => playlist.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  if (existing) {
    if (firstSong && !existing.items.some((item) => item.id === firstSong.id)) {
      existing.items.push(firstSong);
      existing.updatedAt = now;
    }
    writeLocalPlaylists(playlists);
    return existing.id;
  }
  const id = `local-${crypto.randomUUID()}`;
  playlists.unshift({ id, items: firstSong ? [firstSong] : [], name: name.trim(), updatedAt: now });
  writeLocalPlaylists(playlists);
  return id;
}

export function SongLibraryActions({
  authenticated,
  locale,
  song,
}: {
  authenticated: boolean;
  locale: InterfaceLocale;
  song: WorkspaceV2Song;
}) {
  const spanish = locale === "es";
  const librarySong = useMemo(() => toLibrarySong(song), [song]);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistItems, setPlaylistItems] = useState<PlaylistItem[]>([]);
  const [newName, setNewName] = useState("");
  const [message, setMessage] = useState("");
  const [localDraft, setLocalDraft] = useState(false);

  const guestToken =
    typeof window === "undefined"
      ? null
      : window.localStorage.getItem("first-listen-guest-token");

  const refreshEngagement = useCallback(async () => {
    const localLiked = readLocalLikes().some((item) => item.id === song.id);
    if (isLocalPreviewHost()) setLiked(localLiked);
    const supabase = createClient();
    if (!supabase) return;
    const { data } = await supabase.rpc("get_song_engagement", {
      target_song_id: song.id,
      guest_access_token: guestToken,
    });
    const row = firstRow(data) as Record<string, unknown> | null;
    if (!row) return;
    setLiked(isLocalPreviewHost() ? localLiked : Boolean(row.liked));
    setLikeCount(Number(row.like_count ?? 0));
  }, [guestToken, song.id]);

  useEffect(() => {
    void refreshEngagement();
  }, [refreshEngagement]);

  const toggleLike = async () => {
    if (isLocalPreviewHost()) {
      const nextLiked = !liked;
      setLiked(nextLiked);
      mirrorLike(librarySong, nextLiked);
      setMessage(
        nextLiked
          ? spanish
            ? "Me gusta guardado solamente en esta prueba local."
            : "Like saved only in this local preview."
          : spanish
            ? "Se quitó de tus Me gusta locales."
            : "Removed from your local likes.",
      );
      return;
    }
    const supabase = createClient();
    if (!supabase || busy) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("toggle_song_like", {
      target_song_id: song.id,
      guest_access_token: guestToken,
    });
    setBusy(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    const nextLiked = Boolean(data);
    setLiked(nextLiked);
    setLikeCount((current) => Math.max(0, current + (nextLiked ? 1 : -1)));
    mirrorLike(librarySong, nextLiked);
    setMessage(
      nextLiked
        ? authenticated
          ? spanish
            ? "Agregada a Canciones que me gustan."
            : "Added to Liked Songs."
          : spanish
            ? "Guardada en este dispositivo. Crea una cuenta para conservarla."
            : "Saved on this device. Create an account to keep it."
        : spanish
          ? "Se quitó de tus Me gusta."
          : "Removed from your likes.",
    );
  };

  const openPlaylists = async () => {
    setDialogOpen(true);
    setMessage("");
    if (!authenticated) return;
    if (isLocalPreviewHost()) {
      const snapshot = localPlaylistSnapshot(readLocalPlaylists());
      setPlaylists(snapshot.playlists);
      setPlaylistItems(snapshot.items);
      setLocalDraft(true);
      return;
    }
    try {
      const snapshot = await loadRemoteLibrary();
      setPlaylists(snapshot.playlists);
      setPlaylistItems(snapshot.items);
      setLocalDraft(false);
    } catch {
      const snapshot = localPlaylistSnapshot(readLocalPlaylists());
      setPlaylists(snapshot.playlists);
      setPlaylistItems(snapshot.items);
      setLocalDraft(true);
    }
  };

  const refreshPlaylists = async () => {
    if (isLocalPreviewHost()) {
      const snapshot = localPlaylistSnapshot(readLocalPlaylists());
      setPlaylists(snapshot.playlists);
      setPlaylistItems(snapshot.items);
      setLocalDraft(true);
      return;
    }
    try {
      const snapshot = await loadRemoteLibrary();
      setPlaylists(snapshot.playlists);
      setPlaylistItems(snapshot.items);
      setLocalDraft(false);
    } catch {
      const snapshot = localPlaylistSnapshot(readLocalPlaylists());
      setPlaylists(snapshot.playlists);
      setPlaylistItems(snapshot.items);
      setLocalDraft(true);
    }
  };

  const togglePlaylist = async (playlist: Playlist) => {
    const included = playlistItems.some(
      (item) => item.playlistId === playlist.id && item.song.id === song.id,
    );
    if (localDraft || playlist.id.startsWith("local-")) {
      const local = readLocalPlaylists().map((item) => {
        if (item.id !== playlist.id) return item;
        return {
          ...item,
          items: included
            ? item.items.filter((entry) => entry.id !== song.id)
            : [...item.items, librarySong],
          updatedAt: new Date().toISOString(),
        };
      });
      writeLocalPlaylists(local);
      await refreshPlaylists();
      return;
    }
    const supabase = createClient();
    if (!supabase) return;
    const { error } = await supabase.rpc("set_music_playlist_song", {
      target_playlist_id: playlist.id,
      target_song_id: song.id,
      should_include: !included,
    });
    if (error) {
      setMessage(error.message);
      return;
    }
    await refreshPlaylists();
  };

  const createPlaylist = async (event: FormEvent) => {
    event.preventDefault();
    const cleanName = newName.trim();
    if (!cleanName || !authenticated) return;
    const supabase = createClient();
    if (supabase && !localDraft && !isLocalPreviewHost()) {
      const { data, error } = await supabase.rpc("create_music_playlist", {
        playlist_name: cleanName,
      });
      if (!error && data) {
        await supabase.rpc("set_music_playlist_song", {
          target_playlist_id: data,
          target_song_id: song.id,
          should_include: true,
        });
        setNewName("");
        await refreshPlaylists();
        return;
      }
    }
    createLocalPlaylist(cleanName, librarySong);
    setLocalDraft(true);
    setNewName("");
    await refreshPlaylists();
  };

  return (
    <div className="first-listen-library-actions">
      <button
        aria-pressed={liked}
        className={liked ? "active" : ""}
        disabled={busy}
        onClick={() => void toggleLike()}
        type="button"
      >
        <Heart fill={liked ? "currentColor" : "none"} size={17} />
        <span>{spanish ? "Me gusta" : "Like"}</span>
        {likeCount > 0 && <small>{likeCount}</small>}
      </button>
      <button onClick={() => void openPlaylists()} type="button">
        <BookmarkPlus size={17} />
        <span>{spanish ? "Guardar" : "Save"}</span>
      </button>
      {message && <p role="status">{message}</p>}

      {dialogOpen && (
        <div className="first-listen-library-dialog-backdrop" role="presentation">
          <section
            aria-labelledby="save-song-title"
            aria-modal="true"
            className="first-listen-library-dialog"
            role="dialog"
          >
            <button
              aria-label={spanish ? "Cerrar" : "Close"}
              className="first-listen-library-dialog-close"
              onClick={() => setDialogOpen(false)}
              type="button"
            >
              <X size={18} />
            </button>
            <span className="eyebrow">{spanish ? "TU BIBLIOTECA" : "YOUR LIBRARY"}</span>
            <h3 id="save-song-title">
              {authenticated
                ? spanish
                  ? "Guardar en una playlist"
                  : "Save to a playlist"
                : spanish
                  ? "Conserva tus playlists"
                  : "Keep your playlists"}
            </h3>
            <p>
              {authenticated
                ? song.title
                : spanish
                  ? "Puedes marcar Me gusta como visitante. Para crear playlists con nombre y sincronizarlas, entra o crea una cuenta gratis."
                  : "You can like songs as a guest. Log in or create a free account to name and sync playlists."}
            </p>

            {!authenticated ? (
              <div className="first-listen-library-dialog-actions">
                <Link className="primary-button" href="/signup">
                  {spanish ? "Crear cuenta gratis" : "Create free account"}
                </Link>
                <Link className="ghost-button" href="/login?next=/dashboard">
                  {spanish ? "Entrar" : "Log in"}
                </Link>
              </div>
            ) : (
              <>
                {localDraft && (
                  <p className="first-listen-library-local-note">
                    {spanish
                      ? "Vista local: estas playlists son un borrador en este navegador hasta aplicar la actualización de base de datos."
                      : "Local preview: these playlists are a browser draft until the database update is applied."}
                  </p>
                )}
                <div className="first-listen-library-playlist-options">
                  {playlists.length === 0 ? (
                    <p>{spanish ? "Crea tu primera playlist." : "Create your first playlist."}</p>
                  ) : (
                    playlists.map((playlist) => {
                      const included = playlistItems.some(
                        (item) => item.playlistId === playlist.id && item.song.id === song.id,
                      );
                      return (
                        <button
                          className={included ? "active" : ""}
                          key={playlist.id}
                          onClick={() => void togglePlaylist(playlist)}
                          type="button"
                        >
                          <ListMusic size={17} />
                          <span>
                            <strong>{playlist.name}</strong>
                            <small>
                              {playlist.itemCount} {spanish ? "canciones" : "songs"}
                            </small>
                          </span>
                          {included && <Check size={18} />}
                        </button>
                      );
                    })
                  )}
                </div>
                <form className="first-listen-library-create" onSubmit={createPlaylist}>
                  <input
                    aria-label={spanish ? "Nombre de la playlist" : "Playlist name"}
                    maxLength={60}
                    onChange={(event) => setNewName(event.target.value)}
                    placeholder={spanish ? "Ejemplo: Para manejar" : "Example: Road trip"}
                    value={newName}
                  />
                  <button disabled={!newName.trim()} type="submit">
                    <Plus size={17} />
                    {spanish ? "Crear" : "Create"}
                  </button>
                </form>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

export function UserMusicLibrary({
  availableSongs = [],
  locale,
  onPlaySong,
}: {
  availableSongs?: WorkspaceV2Song[];
  locale: InterfaceLocale;
  onPlaySong?: (songId: string) => void;
}) {
  const spanish = locale === "es";
  const [tab, setTab] = useState<"liked" | "playlists">("liked");
  const [likedSongs, setLikedSongs] = useState<LibrarySong[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistItems, setPlaylistItems] = useState<PlaylistItem[]>([]);
  const [activePlaylistId, setActivePlaylistId] = useState("");
  const [newName, setNewName] = useState("");
  const [editingName, setEditingName] = useState("");
  const [localDraft, setLocalDraft] = useState(false);
  const [remindersEnabled, setRemindersEnabled] = useState(false);
  const [reminderDays, setReminderDays] = useState(30);
  const [reminderMessage, setReminderMessage] = useState("");

  const availableById = useMemo(
    () => new Map(availableSongs.map((song) => [song.id, toLibrarySong(song)])),
    [availableSongs],
  );

  const loadLibrary = useCallback(async () => {
    if (isLocalPreviewHost()) {
      const local = localPlaylistSnapshot(readLocalPlaylists());
      const localLikes = readLocalLikes().map((song) => availableById.get(song.id) ?? song);
      setPlaylists(local.playlists);
      setPlaylistItems(local.items);
      setLikedSongs(localLikes);
      setLocalDraft(true);
      try {
        const reminder = JSON.parse(window.localStorage.getItem(LOCAL_REMINDER_KEY) ?? "null") as
          | { enabled?: boolean; days?: number }
          | null;
        setRemindersEnabled(Boolean(reminder?.enabled));
        setReminderDays(Number(reminder?.days ?? 30));
      } catch {
        // Keep safe defaults.
      }
      return;
    }
    const supabase = createClient();
    if (supabase) {
      const [remoteLibrary, likesResponse, preferencesResponse] = await Promise.all([
        loadRemoteLibrary().catch(() => null),
        supabase.rpc("get_my_liked_songs"),
        supabase.rpc("get_my_notification_preferences"),
      ]);
      if (remoteLibrary && !likesResponse.error) {
        setPlaylists(remoteLibrary.playlists);
        setPlaylistItems(remoteLibrary.items);
        setLikedSongs(
          ((likesResponse.data ?? []) as Array<Record<string, unknown>>).map(mapLibraryRow),
        );
        setLocalDraft(false);
        const preference = firstRow(preferencesResponse.data) as Record<string, unknown> | null;
        if (preference) {
          setRemindersEnabled(Boolean(preference.inactive_community_reminders));
          setReminderDays(Number(preference.reminder_interval_days ?? 30));
        }
        return;
      }
    }

    const local = localPlaylistSnapshot(readLocalPlaylists());
    const localLikes = readLocalLikes().map((song) => availableById.get(song.id) ?? song);
    setPlaylists(local.playlists);
    setPlaylistItems(local.items);
    setLikedSongs(localLikes);
    setLocalDraft(true);
    try {
      const reminder = JSON.parse(window.localStorage.getItem(LOCAL_REMINDER_KEY) ?? "null") as
        | { enabled?: boolean; days?: number }
        | null;
      setRemindersEnabled(Boolean(reminder?.enabled));
      setReminderDays(Number(reminder?.days ?? 30));
    } catch {
      // Keep safe defaults.
    }
  }, [availableById]);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    if (!activePlaylistId && playlists[0]) setActivePlaylistId(playlists[0].id);
    if (activePlaylistId && !playlists.some((playlist) => playlist.id === activePlaylistId)) {
      setActivePlaylistId(playlists[0]?.id ?? "");
    }
  }, [activePlaylistId, playlists]);

  const activePlaylist = playlists.find((playlist) => playlist.id === activePlaylistId);
  const activeItems = playlistItems
    .filter((item) => item.playlistId === activePlaylistId)
    .sort((left, right) => left.position - right.position);

  const playSong = (song: LibrarySong) => {
    if (onPlaySong) {
      onPlaySong(song.id);
      return;
    }
    window.location.assign(`/dashboard?play=${encodeURIComponent(song.id)}`);
  };

  const createPlaylist = async (event: FormEvent) => {
    event.preventDefault();
    const cleanName = newName.trim();
    if (!cleanName) return;
    const supabase = createClient();
    if (supabase && !localDraft && !isLocalPreviewHost()) {
      const { data, error } = await supabase.rpc("create_music_playlist", {
        playlist_name: cleanName,
      });
      if (!error && data) {
        setNewName("");
        await loadLibrary();
        setActivePlaylistId(String(data));
        return;
      }
    }
    const id = createLocalPlaylist(cleanName);
    setNewName("");
    setLocalDraft(true);
    await loadLibrary();
    setActivePlaylistId(id);
  };

  const renamePlaylist = async () => {
    const cleanName = editingName.trim();
    if (!activePlaylist || !cleanName) return;
    const supabase = createClient();
    if (supabase && !localDraft && !isLocalPreviewHost() && !activePlaylist.id.startsWith("local-")) {
      const { error } = await supabase.rpc("rename_music_playlist", {
        target_playlist_id: activePlaylist.id,
        playlist_name: cleanName,
      });
      if (!error) {
        setEditingName("");
        await loadLibrary();
        return;
      }
    }
    writeLocalPlaylists(
      readLocalPlaylists().map((playlist) =>
        playlist.id === activePlaylist.id
          ? { ...playlist, name: cleanName, updatedAt: new Date().toISOString() }
          : playlist,
      ),
    );
    setEditingName("");
    await loadLibrary();
  };

  const deletePlaylist = async () => {
    if (!activePlaylist) return;
    if (!window.confirm(spanish ? `¿Eliminar "${activePlaylist.name}"?` : `Delete "${activePlaylist.name}"?`)) return;
    const supabase = createClient();
    if (supabase && !localDraft && !isLocalPreviewHost() && !activePlaylist.id.startsWith("local-")) {
      const { error } = await supabase.rpc("delete_music_playlist", {
        target_playlist_id: activePlaylist.id,
      });
      if (!error) {
        await loadLibrary();
        return;
      }
    }
    writeLocalPlaylists(readLocalPlaylists().filter((playlist) => playlist.id !== activePlaylist.id));
    await loadLibrary();
  };

  const changeItem = async (item: PlaylistItem, action: "up" | "down" | "remove") => {
    const supabase = createClient();
    if (supabase && !localDraft && !isLocalPreviewHost() && !item.playlistId.startsWith("local-")) {
      const { error } =
        action === "remove"
          ? await supabase.rpc("set_music_playlist_song", {
              target_playlist_id: item.playlistId,
              target_song_id: item.song.id,
              should_include: false,
            })
          : await supabase.rpc("move_music_playlist_song", {
              target_playlist_id: item.playlistId,
              target_song_id: item.song.id,
              move_direction: action === "up" ? -1 : 1,
            });
      if (!error) {
        await loadLibrary();
        return;
      }
    }
    const local = readLocalPlaylists().map((playlist) => {
      if (playlist.id !== item.playlistId) return playlist;
      const items = [...playlist.items];
      const index = items.findIndex((song) => song.id === item.song.id);
      if (index < 0) return playlist;
      if (action === "remove") items.splice(index, 1);
      else {
        const nextIndex = action === "up" ? index - 1 : index + 1;
        if (nextIndex >= 0 && nextIndex < items.length) {
          [items[index], items[nextIndex]] = [items[nextIndex], items[index]];
        }
      }
      return { ...playlist, items, updatedAt: new Date().toISOString() };
    });
    writeLocalPlaylists(local);
    await loadLibrary();
  };

  const saveReminderPreference = async () => {
    const supabase = createClient();
    if (supabase && !localDraft && !isLocalPreviewHost()) {
      const { error } = await supabase.rpc("update_inactive_reminder_preference", {
        reminders_enabled: remindersEnabled,
        interval_days: reminderDays,
      });
      if (!error) {
        setReminderMessage(spanish ? "Preferencia guardada. Aún no se enviarán correos." : "Preference saved. Emails are not enabled yet.");
        return;
      }
    }
    window.localStorage.setItem(
      LOCAL_REMINDER_KEY,
      JSON.stringify({ days: reminderDays, enabled: remindersEnabled }),
    );
    setReminderMessage(spanish ? "Preferencia guardada en esta vista local." : "Preference saved in this local preview.");
  };

  const songCards = (songs: LibrarySong[]) => (
    <div className="first-listen-library-song-list">
      {songs.length === 0 ? (
        <p className="first-listen-library-empty">
          {spanish
            ? "Aún no hay canciones aquí. Usa el corazón mientras escuchas."
            : "No songs here yet. Use the heart while listening."}
        </p>
      ) : (
        songs.map((song) => (
          <article key={song.id}>
            <Image
              alt=""
              height={48}
              loader={libraryImageLoader}
              src={song.coverUrl || "/icon.png"}
              unoptimized
              width={48}
            />
            <span>
              <strong>{song.title}</strong>
              <small>{song.artist}{song.genre ? ` · ${song.genre}` : ""}</small>
            </span>
            <button onClick={() => playSong(song)} type="button">
              <Play fill="currentColor" size={15} />
              {spanish ? "Reproducir" : "Play"}
            </button>
          </article>
        ))
      )}
    </div>
  );

  return (
    <section className="first-listen-user-library" id="my-library">
      <div className="first-listen-user-library-heading">
        <div>
          <span className="eyebrow">{spanish ? "TU MÚSICA" : "YOUR MUSIC"}</span>
          <h2>{spanish ? "Tu biblioteca personal" : "Your personal library"}</h2>
          <p>
            {spanish
              ? "Tus Me gusta y playlists son privados. FirstListen guarda enlaces, nunca archivos de audio."
              : "Your likes and playlists are private. FirstListen stores links, never audio files."}
          </p>
        </div>
        {localDraft && (
          <span className="first-listen-library-preview-badge">
            {spanish ? "BORRADOR LOCAL" : "LOCAL DRAFT"}
          </span>
        )}
      </div>

      <div className="first-listen-library-tabs" role="tablist">
        <button
          aria-selected={tab === "liked"}
          className={tab === "liked" ? "active" : ""}
          onClick={() => setTab("liked")}
          role="tab"
          type="button"
        >
          <Heart fill={tab === "liked" ? "currentColor" : "none"} size={17} />
          {spanish ? "Canciones que me gustan" : "Liked Songs"}
          <small>{likedSongs.length}</small>
        </button>
        <button
          aria-selected={tab === "playlists"}
          className={tab === "playlists" ? "active" : ""}
          onClick={() => setTab("playlists")}
          role="tab"
          type="button"
        >
          <ListMusic size={17} />
          Playlists
          <small>{playlists.length}</small>
        </button>
      </div>

      {tab === "liked" ? (
        songCards(likedSongs)
      ) : (
        <div className="first-listen-playlist-manager">
          <aside>
            <form onSubmit={createPlaylist}>
              <input
                aria-label={spanish ? "Nueva playlist" : "New playlist"}
                maxLength={60}
                onChange={(event) => setNewName(event.target.value)}
                placeholder={spanish ? "Nombre de nueva playlist" : "New playlist name"}
                value={newName}
              />
              <button disabled={!newName.trim()} title={spanish ? "Crear playlist" : "Create playlist"} type="submit">
                <Plus size={17} />
              </button>
            </form>
            <div>
              {playlists.map((playlist) => (
                <button
                  className={playlist.id === activePlaylistId ? "active" : ""}
                  key={playlist.id}
                  onClick={() => setActivePlaylistId(playlist.id)}
                  type="button"
                >
                  <ListMusic size={16} />
                  <span>
                    <strong>{playlist.name}</strong>
                    <small>{playlist.itemCount} {spanish ? "canciones" : "songs"}</small>
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <div className="first-listen-playlist-detail">
            {!activePlaylist ? (
              <p className="first-listen-library-empty">
                {spanish ? "Crea una playlist y agrega canciones con el botón Guardar." : "Create a playlist and add songs with the Save button."}
              </p>
            ) : (
              <>
                <header>
                  <div>
                    <span className="eyebrow">PLAYLIST PRIVADA</span>
                    <h3>{activePlaylist.name}</h3>
                  </div>
                  <div>
                    <button
                      onClick={() => {
                        setEditingName(activePlaylist.name);
                      }}
                      title={spanish ? "Cambiar nombre" : "Rename"}
                      type="button"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      onClick={() => void deletePlaylist()}
                      title={spanish ? "Eliminar playlist" : "Delete playlist"}
                      type="button"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </header>
                {editingName && (
                  <div className="first-listen-playlist-rename">
                    <input
                      maxLength={60}
                      onChange={(event) => setEditingName(event.target.value)}
                      value={editingName}
                    />
                    <button onClick={() => void renamePlaylist()} type="button"><Check size={16} /></button>
                    <button onClick={() => setEditingName("")} type="button"><X size={16} /></button>
                  </div>
                )}
                <div className="first-listen-playlist-items">
                  {activeItems.length === 0 ? (
                    <p className="first-listen-library-empty">
                      {spanish ? "Esta playlist está vacía." : "This playlist is empty."}
                    </p>
                  ) : (
                    activeItems.map((item, index) => (
                      <article key={item.song.id}>
                        <span className="first-listen-playlist-position">{index + 1}</span>
                        <Image
                          alt=""
                          height={42}
                          loader={libraryImageLoader}
                          src={item.song.coverUrl || "/icon.png"}
                          unoptimized
                          width={42}
                        />
                        <span>
                          <strong>{item.song.title}</strong>
                          <small>{item.song.artist}</small>
                        </span>
                        <button onClick={() => playSong(item.song)} title={spanish ? "Reproducir" : "Play"} type="button"><Play fill="currentColor" size={14} /></button>
                        <button disabled={index === 0} onClick={() => void changeItem(item, "up")} title={spanish ? "Subir" : "Move up"} type="button"><ArrowUp size={14} /></button>
                        <button disabled={index === activeItems.length - 1} onClick={() => void changeItem(item, "down")} title={spanish ? "Bajar" : "Move down"} type="button"><ArrowDown size={14} /></button>
                        <button onClick={() => void changeItem(item, "remove")} title={spanish ? "Quitar" : "Remove"} type="button"><X size={14} /></button>
                      </article>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="first-listen-reminder-preference">
        <Bell size={19} />
        <span>
          <strong>{spanish ? "Recordatorio de comunidad" : "Community reminder"}</strong>
          <small>
            {spanish
              ? "Opcional: avísame por correo si llevo tiempo sin participar. No se enviará nada durante esta revisión local."
              : "Optional: email me if I have been inactive. Nothing will be sent during this local review."}
          </small>
        </span>
        <label>
          <input
            checked={remindersEnabled}
            onChange={(event) => setRemindersEnabled(event.target.checked)}
            type="checkbox"
          />
          {spanish ? "Permitir" : "Allow"}
        </label>
        <select
          aria-label={spanish ? "Frecuencia del recordatorio" : "Reminder frequency"}
          disabled={!remindersEnabled}
          onChange={(event) => setReminderDays(Number(event.target.value))}
          value={reminderDays}
        >
          <option value={14}>{spanish ? "Después de 14 días" : "After 14 days"}</option>
          <option value={30}>{spanish ? "Después de 30 días" : "After 30 days"}</option>
          <option value={60}>{spanish ? "Después de 60 días" : "After 60 days"}</option>
          <option value={90}>{spanish ? "Después de 90 días" : "After 90 days"}</option>
        </select>
        <button onClick={() => void saveReminderPreference()} type="button">
          {spanish ? "Guardar preferencia" : "Save preference"}
        </button>
        {reminderMessage && <p role="status">{reminderMessage}</p>}
      </div>
    </section>
  );
}
