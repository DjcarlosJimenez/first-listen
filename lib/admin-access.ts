export type AccessProfile = {
  founder_number?: number | null;
  role?: string | null;
};

const fallbackFounderOneEmail = "djemas81@gmail.com";

function normalized(value?: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

export function isFounderOneIdentity(
  profile?: AccessProfile | null,
  email?: string | null,
) {
  const configuredEmail =
    normalized(process.env.FOUNDER_ONE_SUPER_ADMIN_EMAIL) ||
    fallbackFounderOneEmail;

  return (
    Number(profile?.founder_number) === 1 ||
    normalized(email) === configuredEmail
  );
}

export function hasOwnerAccess(
  profile?: AccessProfile | null,
  email?: string | null,
) {
  return normalized(profile?.role) === "super_admin" || isFounderOneIdentity(profile, email);
}

export function hasAdminAccess(
  profile?: AccessProfile | null,
  email?: string | null,
) {
  return hasOwnerAccess(profile, email) || normalized(profile?.role) === "admin";
}

export function hasModeratorAccess(profile?: AccessProfile | null) {
  return normalized(profile?.role) === "moderator";
}

export function canAccessAdminRoute(
  profile?: AccessProfile | null,
  email?: string | null,
  options: { allowModerator?: boolean } = {},
) {
  return (
    hasAdminAccess(profile, email) ||
    (options.allowModerator === true && hasModeratorAccess(profile))
  );
}
