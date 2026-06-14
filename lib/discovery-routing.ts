export function discoveryGenreSlug(genre: string) {
  const slug = genre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "other";
}

export function genreFromDiscoverySlug(
  slug: string,
  genres: readonly string[],
) {
  return (
    genres.find((genre) => discoveryGenreSlug(genre) === slug) ?? null
  );
}
