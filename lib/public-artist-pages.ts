export type PublicArtistPageRoute = {
  kind: "dj-carlos";
  name: string;
  slug: string;
};

const RESERVED_ROOT_SEGMENTS = new Set([
  "_next",
  "admin",
  "api",
  "artist",
  "artists",
  "auth",
  "change-password",
  "dashboard",
  "discover",
  "explicit-content",
  "forgot-password",
  "guest",
  "guidelines",
  "help",
  "home",
  "legacy",
  "login",
  "offline",
  "owner",
  "privacy",
  "profile",
  "reset-password",
  "review",
  "signup",
  "submit",
  "terms",
  "verify-email",
  "workspace-v2",
  "workspace-v2-preview",
]);

export const publicArtistPageRoutes = [
  {
    kind: "dj-carlos",
    name: "DJ Carlos Jimenez",
    slug: "DJCarlosJimenez",
  },
] satisfies PublicArtistPageRoute[];

export function publicArtistSlugKey(slug: string) {
  return slug.trim().toLocaleLowerCase("en-US");
}

export function publicArtistPathFor(
  slug: string,
  pathSegments: readonly string[] = [],
) {
  const encodedSegments = [slug, ...pathSegments].map((segment) =>
    encodeURIComponent(segment),
  );
  return `/${encodedSegments.join("/")}`;
}

export function findPublicArtistPageBySlug(slug: string) {
  const slugKey = publicArtistSlugKey(slug);
  return (
    publicArtistPageRoutes.find(
      (route) => publicArtistSlugKey(route.slug) === slugKey,
    ) ?? null
  );
}

export function findPublicArtistSlugConflict(
  slug: string,
  currentSlug?: string,
) {
  const slugKey = publicArtistSlugKey(slug);
  const currentSlugKey = currentSlug ? publicArtistSlugKey(currentSlug) : null;

  return (
    publicArtistPageRoutes.find((route) => {
      const routeSlugKey = publicArtistSlugKey(route.slug);
      return routeSlugKey === slugKey && routeSlugKey !== currentSlugKey;
    }) ?? null
  );
}

export function validatePublicArtistSlug(slug: string, currentSlug?: string) {
  const cleanSlug = slug.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{1,61}$/.test(cleanSlug)) {
    return {
      ok: false,
      reason:
        "El link publico debe usar solo letras, numeros o guiones y tener de 2 a 62 caracteres.",
    } as const;
  }

  if (RESERVED_ROOT_SEGMENTS.has(publicArtistSlugKey(cleanSlug))) {
    return {
      ok: false,
      reason: "Ese link publico ya esta reservado por First Listen.",
    } as const;
  }

  const conflict = findPublicArtistSlugConflict(cleanSlug, currentSlug);
  if (conflict) {
    return {
      conflict,
      ok: false,
      reason: `Ese link publico ya pertenece a ${conflict.name}.`,
    } as const;
  }

  return { ok: true, slug: cleanSlug } as const;
}

function assertNoCaseInsensitiveDuplicateArtistSlugs() {
  const seen = new Map<string, string>();

  for (const route of publicArtistPageRoutes) {
    const slugKey = publicArtistSlugKey(route.slug);
    const existing = seen.get(slugKey);
    if (existing) {
      throw new Error(
        `Duplicate public artist slug differs only by capitalization: ${existing} / ${route.slug}`,
      );
    }
    seen.set(slugKey, route.slug);
  }
}

assertNoCaseInsensitiveDuplicateArtistSlugs();
