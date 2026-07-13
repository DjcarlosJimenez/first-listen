export function clearBrowserAuthSession({
  clearGuest = true,
}: { clearGuest?: boolean } = {}) {
  if (typeof window === "undefined") return;

  const clearStorage = (storage: Storage) => {
    for (const key of Object.keys(storage)) {
      if (
        key.startsWith("sb-") ||
        key.includes("supabase") ||
        (clearGuest &&
          (key === "first-listen-guest-token" ||
            key === "first-listen-guest-recovery-code"))
      ) {
        storage.removeItem(key);
      }
    }
  };

  clearStorage(window.localStorage);
  clearStorage(window.sessionStorage);
  window.sessionStorage.removeItem("first-listen-pending-email");

  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=")[0]?.trim();
    if (!name) continue;
    if (
      name.startsWith("sb-") ||
      name.includes("supabase") ||
      (clearGuest && name === "first-listen-guest-token")
    ) {
      document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
    }
  }
}
