"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Disc3,
  ExternalLink,
  Globe2,
  Headphones,
  Music2,
  Radio,
  Star,
  Trophy,
  UserPlus,
  Users,
  Youtube,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { compactClassificationLabel } from "@/lib/content-economy";
import { getDiscoveryLinks } from "@/lib/discovery";
import { createClient } from "@/lib/supabase/client";
import type {
  ArtistCommunityActivity,
  ArtistTopSupporter,
  Platform,
  Song,
} from "@/lib/types";

type PublicArtist = {
  id: string;
  name: string;
  followers: number;
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
};

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
  const [following, setFollowing] = useState(artist.isFollowing);
  const [followerCount, setFollowerCount] = useState(artist.followers);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");

  const requireClient = async () => {
    const supabase = createClient();
    if (!supabase) return null;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push(`/login?next=/artists/${artist.id}`);
      return null;
    }
    return { supabase, userId: user.id };
  };

  const toggleFollow = async () => {
    const client = await requireClient();
    if (!client) return;
    if (client.userId === artist.id) {
      setMessage("This is your public artist profile.");
      return;
    }
    const rpc = following ? "unfollow_artist" : "follow_artist";
    const { error } = await client.supabase.rpc(rpc, { target_artist_id: artist.id });
    if (error) {
      setMessage(error.message);
      return;
    }
    setFollowing((current) => !current);
    setFollowerCount((current) => current + (following ? -1 : 1));
    setMessage(following ? "Artist unfollowed." : "Artist followed.");
  };

  const saveSong = async (songId: string) => {
    const client = await requireClient();
    if (!client) return;
    const { error } = await client.supabase.rpc("save_song_for_later", {
      target_song_id: songId,
    });
    if (error) {
      setMessage(error.message);
      return;
    }
    setSavedIds((current) => current.includes(songId) ? current : [...current, songId]);
    setMessage("Song saved for later.");
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
          <span className="eyebrow">Public artist profile</span>
          <h1>{artist.name}</h1>
          <span className={`artist-activity-badge ${artist.activityStatus}`}>
            {artist.activityStatus === "active"
              ? "Active creator"
              : artist.activityStatus === "paused"
                ? "Paused creator"
                : "Archived creator"}
          </span>
          <div className="artist-profile-stats">
            <span><Users size={14} /> {followerCount} followers</span>
            <span><Music2 size={14} /> {artist.songsSubmitted} songs submitted</span>
            <span><Star size={14} /> {artist.averageRating.toFixed(1)} average rating</span>
            <span><Headphones size={14} /> {artist.listeningHoursReceived.toFixed(1)} listening hours received</span>
            <span><Radio size={14} /> {artist.validListensReceived} valid listens received</span>
            <span><Disc3 size={14} /> {artist.completeListensReceived} complete listens</span>
            <span><Trophy size={14} /> {artist.communityRank}</span>
          </div>
          <div className="artist-profile-tags">
            {artist.genres.map((genre) => <span key={genre}>{genre}</span>)}
            {artist.languages.map((language) => <span key={language}><Globe2 size={11} /> {language}</span>)}
          </div>
        </div>
        <button className={following ? "following" : ""} onClick={toggleFollow}>
          <UserPlus size={16} /> {following ? "Following" : "Follow Artist"}
        </button>
      </section>

      {message && <div className="artist-profile-notice" role="status">{message}</div>}

      <section className="artist-community-grid">
        <div className="artist-community-panel">
          <span className="eyebrow"><Users size={13} /> Top Supporters</span>
          <h2>Creator relationships</h2>
          <div className="top-supporter-list">
            {topSupporters.map((supporter) => (
              <Link href={`/artists/${supporter.id}`} key={supporter.id}>
                <span className="retention-avatar">
                  {supporter.name.slice(0, 2).toUpperCase()}
                </span>
                <span>
                  <strong>{supporter.name}</strong>
                  <small>
                    {supporter.supportsGiven} supports /{" "}
                    {supporter.songsSupported} songs supported
                  </small>
                  {supporter.mutualFollowing && (
                    <em><UserPlus size={11} /> Following each other</em>
                  )}
                </span>
                <ArrowRight size={14} />
              </Link>
            ))}
            {!topSupporters.length && (
              <p className="discovery-empty">
                Public supporters will appear here after supporting this artist.
              </p>
            )}
          </div>
        </div>

        <div className="artist-community-panel">
          <span className="eyebrow"><Radio size={13} /> Recent Activity</span>
          <h2>Community activity</h2>
          <div className="artist-activity-list">
            {activity.map((item) => (
              <article key={item.id}>
                <span>
                  {item.type === "follow" ? (
                    <UserPlus size={14} />
                  ) : item.type === "review" ? (
                    <Star size={14} />
                  ) : (
                    <Headphones size={14} />
                  )}
                </span>
                <div>
                  <strong>
                    {item.type === "follow"
                      ? `${item.actorName} followed this artist`
                      : item.type === "review"
                        ? `${item.actorName} reviewed ${item.songTitle ?? "a song"}`
                        : `${item.actorName} listened to ${item.songTitle ?? "a song"}`}
                  </strong>
                  <small>{new Date(item.createdAt).toLocaleDateString()}</small>
                </div>
                {item.actorId && (
                  <Link href={`/artists/${item.actorId}`}>Profile</Link>
                )}
              </article>
            ))}
            {!activity.length && (
              <p className="discovery-empty">
                Listening, reviews, and follows will appear here.
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="artist-song-grid">
        {songs.map((song) => {
          const discoverySong: Pick<Song, "artist" | "title" | "link" | "platform"> = song;
          const links = getDiscoveryLinks(discoverySong);
          return (
            <article key={song.id}>
              <Image alt={`${song.title} cover`} height={500} src={song.coverUrl} unoptimized width={500} />
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
                <div className="artist-song-links">
                  <a href={links.spotify} rel="noreferrer" target="_blank"><Disc3 size={14} /> Spotify</a>
                  <a href={links.youtube} rel="noreferrer" target="_blank"><Youtube size={14} /> YouTube</a>
                  <a href={links.apple} rel="noreferrer" target="_blank"><Radio size={14} /> Apple Music</a>
                </div>
                <button disabled={savedIds.includes(song.id)} onClick={() => saveSong(song.id)}>
                  <Bookmark size={14} />
                  {savedIds.includes(song.id) ? "Saved" : "Save For Later"}
                </button>
                <a className="original-link" href={song.link} rel="noreferrer" target="_blank">
                  Open original link <ExternalLink size={13} />
                </a>
              </div>
            </article>
          );
        })}
        {songs.length === 0 && (
          <div className="empty-state">
            <p>This artist has no active public songs yet.</p>
            <Link href="/">Explore First Listen <ArrowRight size={13} /></Link>
          </div>
        )}
      </section>
    </main>
  );
}
