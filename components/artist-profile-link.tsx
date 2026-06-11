import Link from "next/link";
import { ArrowRight, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import type { InterfaceLocale } from "@/lib/catalog";

export function ArtistNameLink({
  artistId,
  name,
  className,
  children,
}: {
  artistId?: string;
  name: string;
  className?: string;
  children?: ReactNode;
}) {
  if (!artistId) {
    return <span className={className}>{children ?? name}</span>;
  }

  return (
    <Link
      className={className}
      data-artist-name-link
      href={`/artists/${artistId}`}
    >
      {children ?? name}
    </Link>
  );
}

export function ArtistProfileButton({
  artistId,
  artistName,
  locale,
  className = "artist-profile-link-button",
  compact = false,
}: {
  artistId?: string;
  artistName: string;
  locale: InterfaceLocale;
  className?: string;
  compact?: boolean;
}) {
  if (!artistId) return null;
  const spanish = locale === "es";

  return (
    <Link
      className={className}
      data-artist-profile-button
      data-ui-component="artistProfileButton"
      href={`/artists/${artistId}`}
      title={spanish ? `Ver perfil de ${artistName}` : `View ${artistName}'s profile`}
    >
      <UserRound size={compact ? 13 : 15} />
      <span>{spanish ? "Perfil de artista" : "Artist Profile"}</span>
      {!compact && <ArrowRight size={13} />}
    </Link>
  );
}
