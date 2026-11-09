"use client";

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Search, UsersRound } from "lucide-react";

export type ArtistDirectoryEntry = {
  accentColor?: string;
  description: string;
  href: string;
  id: string;
  imageUrl?: string;
  name: string;
  searchText?: string;
};

function searchable(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-US")
    .trim();
}

export function ArtistDirectoryBrowser({
  artists,
}: {
  artists: ArtistDirectoryEntry[];
}) {
  const [query, setQuery] = useState("");
  const visibleArtists = useMemo(() => {
    const normalizedQuery = searchable(query);
    if (!normalizedQuery) return artists;
    return artists.filter((artist) =>
      searchable(`${artist.name} ${artist.description} ${artist.searchText ?? ""}`).includes(
        normalizedQuery,
      ),
    );
  }, [artists, query]);

  return (
    <section className="artist-directory-browser" aria-label="Directorio de artistas">
      <label className="artist-directory-search">
        <Search aria-hidden="true" size={19} />
        <input
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar artista, grupo o estilo musical"
          type="search"
          value={query}
        />
      </label>

      {visibleArtists.length ? (
        <div className="artist-directory-grid">
          {visibleArtists.map((artist) => (
            <Link
              className="artist-directory-card"
              href={artist.href}
              key={artist.id}
              style={
                {
                  "--artist-directory-accent": artist.accentColor || "#a8ee32",
                } as CSSProperties
              }
            >
              {artist.imageUrl ? (
                <Image
                  alt={`Logo de ${artist.name}`}
                  height={88}
                  src={artist.imageUrl}
                  unoptimized
                  width={88}
                />
              ) : (
                <span aria-hidden="true" className="artist-directory-initial">
                  {artist.name.slice(0, 1)}
                </span>
              )}
              <span>
                <small>PÁGINA OFICIAL</small>
                <strong>{artist.name}</strong>
                <em>{artist.description}</em>
              </span>
              <ArrowUpRight aria-hidden="true" size={18} />
            </Link>
          ))}
        </div>
      ) : (
        <div className="artist-directory-empty" role="status">
          <UsersRound aria-hidden="true" size={26} />
          <strong>No encontramos ese artista</strong>
          <span>Prueba con otro nombre o estilo musical.</span>
        </div>
      )}
    </section>
  );
}
