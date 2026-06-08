import { notFound } from "next/navigation";
import { PublicArtistProfile } from "@/components/public-artist-profile";
import { platformLabels } from "@/lib/discovery";
import { createClient } from "@/lib/supabase/server";
import type { Platform } from "@/lib/types";

export const dynamic = "force-dynamic";

type PublicArtistRow = {
  artist_id: string;
  artist_name: string;
  followers: number;
  songs_submitted: number;
  genres: string[];
  languages: string[];
  is_following: boolean;
};

type PublicArtistSongRow = {
  song_id: string;
  title: string;
  artist_name: string;
  cover_image_url: string;
  music_url: string;
  platform: string;
  genre: string;
  song_language: string;
  submitted_at: string;
  reviews_received: number;
  average_rating: number;
  hook_score: number;
};

export default async function ArtistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: artistRows }, { data: songRows }] = await Promise.all([
    supabase.rpc("get_public_artist_profile", { target_artist_id: id }),
    supabase.rpc("get_public_artist_songs", { target_artist_id: id }),
  ]);

  const artist = (
    Array.isArray(artistRows) ? artistRows[0] : artistRows
  ) as PublicArtistRow | null;
  if (!artist) notFound();

  return (
    <PublicArtistProfile
      artist={{
        id: artist.artist_id,
        name: artist.artist_name,
        followers: Number(artist.followers ?? 0),
        songsSubmitted: Number(artist.songs_submitted ?? 0),
        genres: artist.genres ?? [],
        languages: artist.languages ?? [],
        isFollowing: Boolean(artist.is_following),
      }}
      songs={((songRows ?? []) as PublicArtistSongRow[]).map((song) => ({
        id: song.song_id,
        artistId: id,
        title: song.title,
        artist: song.artist_name,
        coverUrl: song.cover_image_url,
        link: song.music_url,
        platform: (platformLabels[song.platform] ?? "Spotify") as Platform,
        genre: song.genre,
        language: song.song_language,
        submittedAt: song.submitted_at,
        reviewsReceived: Number(song.reviews_received ?? 0),
        averageRating: Number(song.average_rating ?? 0),
        hookScore: Number(song.hook_score ?? 0),
      }))}
    />
  );
}
