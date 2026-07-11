import { NextResponse } from "next/server";
import { detectMusicPlatform } from "@/lib/platform";
import { getProviderEmbed } from "@/lib/player";

type OEmbedResponse = {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
  duration?: number | string;
  duration_ms?: number | string;
  duration_seconds?: number | string;
};

const DEFAULT_COVER = "https://www.firstlisten.net/covers/default-song.svg";

async function readOEmbed(url: string) {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "First Listen Metadata Resolver/1.0" },
      next: { revalidate: 3600 },
    });
    if (!response.ok) return null;
    return (await response.json()) as OEmbedResponse;
  } catch (error) {
    console.warn("[First Listen metadata] Provider lookup failed", { error, url });
    return null;
  }
}

function normalizeDurationSeconds(metadata: OEmbedResponse | null) {
  if (!metadata) return null;
  const directDuration = Number(metadata.duration_seconds ?? metadata.duration);
  if (Number.isFinite(directDuration) && directDuration > 0) {
    return Math.round(directDuration);
  }

  const durationMs = Number(metadata.duration_ms);
  if (Number.isFinite(durationMs) && durationMs > 0) {
    return Math.round(durationMs / 1000);
  }

  return null;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const musicUrl = requestUrl.searchParams.get("url")?.trim() ?? "";
  const detection = detectMusicPlatform(musicUrl);

  if (!detection.valid || !detection.platform || !detection.parsedUrl) {
    return NextResponse.json(
      { error: detection.message, detection },
      { status: 400 },
    );
  }

  const embed = getProviderEmbed(
    detection.parsedUrl,
    detection.platform,
    requestUrl.origin,
  );
  let metadata: OEmbedResponse | null = null;
  if (
    detection.platform === "YouTube" ||
    detection.platform === "YouTube Music"
  ) {
    metadata = await readOEmbed(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(detection.parsedUrl)}`,
    );
  } else if (detection.platform === "Spotify") {
    metadata = await readOEmbed(
      `https://open.spotify.com/oembed?url=${encodeURIComponent(detection.parsedUrl)}`,
    );
  } else if (detection.platform === "SoundCloud") {
    metadata = await readOEmbed(
      `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(detection.parsedUrl)}`,
    );
  }

  return NextResponse.json({
    platform: detection.platform,
    parsedUrl: detection.parsedUrl,
    resourceId: detection.resourceId,
    resourceType: detection.resourceType,
    embedUrl: embed?.src ?? null,
    telemetry: embed?.telemetry ?? null,
    title: metadata?.title ?? "",
    artistName: metadata?.author_name ?? "",
    coverImageUrl: metadata?.thumbnail_url ?? DEFAULT_COVER,
    durationSeconds: normalizeDurationSeconds(metadata),
  });
}
