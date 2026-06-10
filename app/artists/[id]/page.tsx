import { notFound } from "next/navigation";
import { PublicArtistProfile } from "@/components/public-artist-profile";
import { platformLabels } from "@/lib/discovery";
import { safeCoverUrl } from "@/lib/media";
import { createClient } from "@/lib/supabase/server";
import type {
  ArtistCommunityActivity,
  ArtistTopSupporter,
  Platform,
} from "@/lib/types";

export const dynamic = "force-dynamic";

type PublicArtistRow = {
  artist_id: string;
  artist_name: string;
  followers: number;
  following: number;
  songs_submitted: number;
  genres: string[];
  languages: string[];
  is_following: boolean;
  average_rating: number;
  listening_hours_received: number;
  valid_listens_received: number;
  complete_listens_received: number;
  community_rank: string;
  activity_status: "active" | "paused" | "archived";
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
  platform_links:
    | Array<{ platform: string; music_url: string }>
    | null;
};

export default async function ArtistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const [
    { data: artistRows },
    { data: songRows },
    { data: supporterRows },
    { data: activityRows },
  ] = await Promise.all([
    supabase.rpc("get_public_artist_profile", { target_artist_id: id }),
    supabase.rpc("get_public_artist_songs", { target_artist_id: id }),
    supabase.rpc("get_artist_top_supporters", {
      target_artist_id: id,
      supporter_limit: 8,
    }),
    supabase.rpc("get_public_artist_activity", {
      target_artist_id: id,
      activity_limit: 12,
    }),
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
        following: Number(artist.following ?? 0),
        songsSubmitted: Number(artist.songs_submitted ?? 0),
        genres: artist.genres ?? [],
        languages: artist.languages ?? [],
        isFollowing: Boolean(artist.is_following),
        averageRating: Number(artist.average_rating ?? 0),
        listeningHoursReceived: Number(
          artist.listening_hours_received ?? 0,
        ),
        validListensReceived: Number(
          artist.valid_listens_received ?? 0,
        ),
        completeListensReceived: Number(
          artist.complete_listens_received ?? 0,
        ),
        communityRank: artist.community_rank ?? "New Member",
        activityStatus: artist.activity_status ?? "active",
      }}
      songs={((songRows ?? []) as PublicArtistSongRow[]).map((song) => ({
        id: song.song_id,
        artistId: id,
        title: song.title,
        artist: song.artist_name,
        coverUrl: safeCoverUrl(song.cover_image_url),
        link: song.music_url,
        platform: (platformLabels[song.platform] ?? "Spotify") as Platform,
        genre: song.genre,
        language: song.song_language,
        submittedAt: song.submitted_at,
        reviewsReceived: Number(song.reviews_received ?? 0),
        averageRating: Number(song.average_rating ?? 0),
        hookScore: Number(song.hook_score ?? 0),
        platformLinks:
          song.platform_links?.map((link) => ({
            platform: (platformLabels[link.platform] ??
              platformLabels[song.platform] ??
              "Spotify") as Platform,
            url: link.music_url,
          })) ?? [
            {
              platform: (platformLabels[song.platform] ?? "Spotify") as Platform,
              url: song.music_url,
            },
          ],
      }))}
      topSupporters={(
        (supporterRows ?? []) as Array<Record<string, unknown>>
      ).map((row) => ({
        id: String(row.supporter_id),
        name: String(row.supporter_name),
        supportsGiven: Number(row.supports_given ?? 0),
        songsSupported: Number(row.songs_supported ?? 0),
        mutualFollowing: Boolean(row.mutual_following),
      })) satisfies ArtistTopSupporter[]}
      activity={(
        (activityRows ?? []) as Array<Record<string, unknown>>
      ).map((row) => ({
        id: String(row.event_id),
        type: String(row.event_type) as ArtistCommunityActivity["type"],
        actorId: row.actor_id ? String(row.actor_id) : undefined,
        actorName: String(row.actor_name ?? "Anonymous Listener"),
        songId: row.song_id ? String(row.song_id) : undefined,
        songTitle: row.song_title ? String(row.song_title) : undefined,
        createdAt: String(row.created_at),
      })) satisfies ArtistCommunityActivity[]}
    />
  );
}
