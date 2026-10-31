import "server-only";

export function getAppVersion() {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
    process.env.VERCEL_DEPLOYMENT_ID?.trim() ||
    process.env.NEXT_PUBLIC_APP_VERSION?.trim() ||
    "development"
  );
}
