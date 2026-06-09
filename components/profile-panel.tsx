"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  CalendarDays,
  ExternalLink,
  Gauge,
  Headphones,
  MessageSquareText,
  Music2,
  Save,
  ShieldCheck,
  Users,
} from "lucide-react";
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
            <span>{profile.role === "super_admin" ? "Unlimited tokens" : `${profile.credits} tokens`}</span>
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
              <span>Valid Listens</span>
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
