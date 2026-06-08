"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BadgeCheck, ExternalLink, Save, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/logo";
import { createClient } from "@/lib/supabase/client";

type ProfileSong = {
  id: string;
  title: string;
  artist_name: string;
  music_url: string;
  platform: string;
  is_active: boolean;
  explicit_content: boolean;
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

export function ProfilePanel({
  profile,
  songs,
  savedSongs,
}: {
  profile: {
    id: string;
    displayName: string;
    email: string;
    founder: boolean;
    role: string;
    credits: number;
    showExplicitContent: boolean;
  };
  songs: ProfileSong[];
  savedSongs: SavedSong[];
}) {
  const [name, setName] = useState(profile.displayName);
  const [showExplicit, setShowExplicit] = useState(profile.showExplicitContent);
  const [message, setMessage] = useState("");

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const supabase = createClient();
    if (!supabase) return;
    const { error } = await supabase.rpc("update_profile_preferences", {
      profile_display_name: name,
      profile_show_explicit_content: showExplicit,
    });
    setMessage(error ? error.message : "Profile saved.");
  };

  return (
    <main className="account-page">
      <header className="account-header">
        <Logo />
        <Link href="/dashboard"><ArrowLeft size={16} /> Dashboard</Link>
      </header>
      <div className="account-grid">
        <section className="account-card">
          <span className="eyebrow">Profile</span>
          <h1>{profile.displayName}</h1>
          <div className="profile-badges">
            <span><ShieldCheck size={14} /> {profile.role.replace("_", " ")}</span>
            {profile.founder && <span><BadgeCheck size={14} /> Founding Artist</span>}
            <span>{profile.role === "super_admin" ? "Unlimited credits" : `${profile.credits} credits`}</span>
          </div>
          <Link className="public-profile-link" href={`/artists/${profile.id}`}>
            View public artist profile <ExternalLink size={14} />
          </Link>
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
            {message && <p className="form-message" role="status">{message}</p>}
            <button className="auth-submit" type="submit"><Save size={15} /> Save profile</button>
          </form>
        </section>

        <section className="account-card my-songs">
          <span className="eyebrow">My Songs</span>
          <h2>Submitted songs</h2>
          {songs.length === 0 ? (
            <div className="empty-state">
              <p>No songs submitted yet.</p>
              <Link href="/submit">Submit your first song</Link>
            </div>
          ) : (
            <div className="song-table">
              {songs.map((song) => (
                <article key={song.id}>
                  <div>
                    <strong>{song.title}</strong>
                    <span>{song.artist_name} / {song.platform.replace("_", " ")}</span>
                  </div>
                  <span className={song.is_active ? "status-active" : "status-removed"}>
                    {song.is_active ? "In review queue" : "Removed"}
                  </span>
                  {song.explicit_content && <small>Explicit</small>}
                  <a href={song.music_url} rel="noreferrer" target="_blank" aria-label={`Open ${song.title}`}>
                    <ExternalLink size={15} />
                  </a>
                </article>
              ))}
            </div>
          )}

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
                    <span>{song.artist_name} / {song.platform.replace("_", " ")}</span>
                  </div>
                  <Link href={`/artists/${song.artist_id}`}>Artist</Link>
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
