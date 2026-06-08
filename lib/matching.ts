import { latinGenres, type Genre, type ListenerLanguage, type SongLanguage } from "@/lib/catalog";
import type { Song } from "@/lib/types";

export type ReviewerProfile = {
  languages: ListenerLanguage[];
  genrePreferences: Genre[];
  activityScore: number;
};

function languageMatches(songLanguage: SongLanguage, languages: ListenerLanguage[]) {
  if (songLanguage === "Instrumental") {
    return languages.includes("Instrumental Only") || languages.length > 0;
  }

  return languages.some((language) => language === songLanguage);
}

function genreMatches(songGenre: Genre, genrePreferences: Genre[]) {
  if (genrePreferences.includes(songGenre)) return true;

  return latinGenres.includes(songGenre) && genrePreferences.some((genre) => latinGenres.includes(genre));
}

export function scoreReviewMatch(
  song: Pick<Song, "genre" | "language" | "submittedAt">,
  reviewer: ReviewerProfile,
  index: number,
) {
  const languageScore = languageMatches(song.language, reviewer.languages) ? 100 : 0;
  const genreScore = genreMatches(song.genre, reviewer.genrePreferences) ? 70 : 0;
  const activityScore = Math.min(25, reviewer.activityScore);
  const fairnessScore = Math.max(0, 20 - index * 4);

  return languageScore + genreScore + activityScore + fairnessScore;
}

export function prioritizeReviewQueue(
  songs: Song[],
  reviewer: ReviewerProfile,
) {
  return [...songs].sort((left, right) => {
    const leftScore = scoreReviewMatch(left, reviewer, songs.indexOf(left));
    const rightScore = scoreReviewMatch(right, reviewer, songs.indexOf(right));
    return rightScore - leftScore;
  });
}

export function describeMatch(song: Pick<Song, "genre" | "language">, reviewer: ReviewerProfile) {
  const reasons: string[] = [];
  if (languageMatches(song.language, reviewer.languages)) reasons.push(song.language);
  if (genreMatches(song.genre, reviewer.genrePreferences)) reasons.push(song.genre);
  return reasons.length ? reasons.join(" + ") : "Queue fairness";
}
