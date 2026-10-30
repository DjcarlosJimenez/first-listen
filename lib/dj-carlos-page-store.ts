import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  DJ_CARLOS_PREVIEW_CLIP_MAX_MB,
  defaultDjCarlosPageConfig,
  normalizeDjCarlosPageConfig,
  normalizeDjCarlosUpcomingSignals,
  normalizeDjCarlosVideoPlayCounts,
  type DjCarlosPageConfig,
  type DjCarlosUpcomingReactionKey,
  type DjCarlosUpcomingSignals,
  type DjCarlosVideoPlayCounts,
} from "@/lib/dj-carlos-page";

const DJ_CARLOS_STORAGE_BUCKET = "dj-carlos-page";
const DJ_CARLOS_ASSETS_BUCKET = "dj-carlos-page-assets";
const DJ_CARLOS_PREVIEW_CLIPS_BUCKET = "dj-carlos-preview-clips";
const DJ_CARLOS_CONFIG_PATH = "config.json";
const DJ_CARLOS_UPCOMING_SIGNALS_PATH = "upcoming-signals.json";
const DJ_CARLOS_VIDEO_PLAYS_PATH = "video-plays.json";
const DJ_CARLOS_VIDEO_POPULAR_DAYS = 30;
const DJ_CARLOS_VIDEO_HISTORY_DAYS = 45;
const DJ_CARLOS_MAX_COVER_MB = 20;
const DJ_CARLOS_MAX_COVER_BYTES = DJ_CARLOS_MAX_COVER_MB * 1024 * 1024;
const DJ_CARLOS_COVER_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const DJ_CARLOS_ASSET_BUCKET_OPTIONS = {
  allowedMimeTypes: [...DJ_CARLOS_COVER_TYPES],
  fileSizeLimit: DJ_CARLOS_MAX_COVER_BYTES,
  public: true,
};
const DJ_CARLOS_PREVIEW_CLIP_MAX_BYTES =
  DJ_CARLOS_PREVIEW_CLIP_MAX_MB * 1024 * 1024;
const DJ_CARLOS_PREVIEW_CLIP_TYPES = new Set([
  "audio/aac",
  "audio/mp3",
  "audio/mp4",
  "audio/mpeg",
  "audio/x-aac",
  "audio/x-m4a",
]);
const DJ_CARLOS_PREVIEW_BUCKET_OPTIONS = {
  allowedMimeTypes: [...DJ_CARLOS_PREVIEW_CLIP_TYPES],
  fileSizeLimit: DJ_CARLOS_PREVIEW_CLIP_MAX_BYTES,
  public: false,
};

type DjCarlosVideoPlayHistory = {
  tracks: Record<string, {
    days: Record<string, number>;
    total: number;
  }>;
};

let djCarlosVideoPlayWriteQueue = Promise.resolve();

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function cleanPlayCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function cutoffDay(days: number, now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - Math.max(0, days - 1));
  return dayKey(cutoff);
}

function normalizeDjCarlosVideoPlayHistory(
  value: unknown,
  now = new Date(),
): DjCarlosVideoPlayHistory {
  const rawTracks =
    value && typeof value === "object" &&
    "tracks" in value &&
    (value as { tracks?: unknown }).tracks &&
    typeof (value as { tracks: unknown }).tracks === "object"
      ? (value as { tracks: Record<string, unknown> }).tracks
      : {};
  const historyCutoff = cutoffDay(DJ_CARLOS_VIDEO_HISTORY_DAYS, now);
  const tracks: DjCarlosVideoPlayHistory["tracks"] = {};

  Object.entries(rawTracks).forEach(([trackId, rawEntry]) => {
    if (!trackId.trim() || !rawEntry || typeof rawEntry !== "object") return;
    const entry = rawEntry as Record<string, unknown>;
    const rawDays =
      entry.days && typeof entry.days === "object"
        ? entry.days as Record<string, unknown>
        : {};
    const days = Object.entries(rawDays).reduce<Record<string, number>>(
      (result, [date, count]) => {
        const cleanCount = cleanPlayCount(count);
        if (date >= historyCutoff && cleanCount > 0) result[date] = cleanCount;
        return result;
      },
      {},
    );
    tracks[trackId] = {
      days,
      total: Math.max(
        cleanPlayCount(entry.total),
        Object.values(days).reduce((sum, count) => sum + count, 0),
      ),
    };
  });

  return { tracks };
}

function videoPlayCountsFromHistory(
  history: DjCarlosVideoPlayHistory,
  now = new Date(),
): DjCarlosVideoPlayCounts {
  const popularCutoff = cutoffDay(DJ_CARLOS_VIDEO_POPULAR_DAYS, now);
  return normalizeDjCarlosVideoPlayCounts(
    Object.fromEntries(
      Object.entries(history.tracks).map(([trackId, entry]) => [
        trackId,
        {
          recent: Object.entries(entry.days).reduce(
            (sum, [date, count]) => date >= popularCutoff ? sum + count : sum,
            0,
          ),
          total: entry.total,
        },
      ]),
    ),
  );
}

async function ensureDjCarlosBucket() {
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage.getBucket(
    DJ_CARLOS_STORAGE_BUCKET,
  );

  if (data && !error) return supabase;

  const { error: createError } = await supabase.storage.createBucket(
    DJ_CARLOS_STORAGE_BUCKET,
    {
      allowedMimeTypes: ["application/json"],
      fileSizeLimit: 1024 * 1024,
      public: false,
    },
  );

  if (createError && !createError.message.toLowerCase().includes("already")) {
    throw createError;
  }

  return supabase;
}

async function ensureDjCarlosAssetsBucket() {
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage.getBucket(
    DJ_CARLOS_ASSETS_BUCKET,
  );

  if (data && !error) {
    const { error: updateError } = await supabase.storage.updateBucket(
      DJ_CARLOS_ASSETS_BUCKET,
      DJ_CARLOS_ASSET_BUCKET_OPTIONS,
    );

    if (updateError) throw updateError;

    return supabase;
  }

  const { error: createError } = await supabase.storage.createBucket(
    DJ_CARLOS_ASSETS_BUCKET,
    DJ_CARLOS_ASSET_BUCKET_OPTIONS,
  );

  if (createError && !createError.message.toLowerCase().includes("already")) {
    throw createError;
  }

  return supabase;
}

async function ensureDjCarlosPreviewClipsBucket() {
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage.getBucket(
    DJ_CARLOS_PREVIEW_CLIPS_BUCKET,
  );

  if (data && !error) {
    const { error: updateError } = await supabase.storage.updateBucket(
      DJ_CARLOS_PREVIEW_CLIPS_BUCKET,
      DJ_CARLOS_PREVIEW_BUCKET_OPTIONS,
    );
    if (updateError) throw updateError;
    return supabase;
  }

  const { error: createError } = await supabase.storage.createBucket(
    DJ_CARLOS_PREVIEW_CLIPS_BUCKET,
    DJ_CARLOS_PREVIEW_BUCKET_OPTIONS,
  );
  if (createError && !createError.message.toLowerCase().includes("already")) {
    throw createError;
  }
  return supabase;
}

export async function readDjCarlosPageConfig(
  fallback: DjCarlosPageConfig = defaultDjCarlosPageConfig,
) {
  let config = fallback;

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.storage
      .from(DJ_CARLOS_STORAGE_BUCKET)
      .download(DJ_CARLOS_CONFIG_PATH);

    if (!error && data) {
      config = normalizeDjCarlosPageConfig(JSON.parse(await data.text()), fallback);
    }
  } catch {
    config = fallback;
  }

  try {
    const signals = await readDjCarlosUpcomingSignals(
      config.upcomingRelease.signals,
    );
    return {
      ...config,
      upcomingRelease: {
        ...config.upcomingRelease,
        signals,
      },
    };
  } catch {
    return config;
  }
}

export async function writeDjCarlosPageConfig(
  config: DjCarlosPageConfig,
  fallback: DjCarlosPageConfig = defaultDjCarlosPageConfig,
) {
  const currentSignals = await readDjCarlosUpcomingSignals(
    config.upcomingRelease.signals,
  );
  const cleanConfig = normalizeDjCarlosPageConfig(
    {
      ...config,
      upcomingRelease: {
        ...config.upcomingRelease,
        signals: currentSignals,
      },
      updatedAt: new Date().toISOString(),
    },
    fallback,
  );
  const supabase = await ensureDjCarlosBucket();
  const file = new Blob([JSON.stringify(cleanConfig, null, 2)], {
    type: "application/json",
  });
  const { error } = await supabase.storage
    .from(DJ_CARLOS_STORAGE_BUCKET)
    .upload(DJ_CARLOS_CONFIG_PATH, file, {
      cacheControl: "0",
      contentType: "application/json",
      upsert: true,
    });

  if (error) throw error;

  return cleanConfig;
}

export async function readDjCarlosUpcomingSignals(
  fallback: DjCarlosUpcomingSignals =
    defaultDjCarlosPageConfig.upcomingRelease.signals,
) {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.storage
      .from(DJ_CARLOS_STORAGE_BUCKET)
      .download(DJ_CARLOS_UPCOMING_SIGNALS_PATH);

    if (error || !data) return fallback;

    return normalizeDjCarlosUpcomingSignals(JSON.parse(await data.text()), fallback);
  } catch {
    return fallback;
  }
}

async function writeDjCarlosUpcomingSignals(signals: DjCarlosUpcomingSignals) {
  const cleanSignals = normalizeDjCarlosUpcomingSignals(signals);
  const supabase = await ensureDjCarlosBucket();
  const file = new Blob([JSON.stringify(cleanSignals, null, 2)], {
    type: "application/json",
  });
  const { error } = await supabase.storage
    .from(DJ_CARLOS_STORAGE_BUCKET)
    .upload(DJ_CARLOS_UPCOMING_SIGNALS_PATH, file, {
      cacheControl: "0",
      contentType: "application/json",
      upsert: true,
    });

  if (error) throw error;

  return cleanSignals;
}

export async function recordDjCarlosUpcomingSignal({
  follow = false,
  reaction,
}: {
  follow?: boolean;
  reaction?: DjCarlosUpcomingReactionKey;
}) {
  const current = await readDjCarlosUpcomingSignals();
  const next: DjCarlosUpcomingSignals = {
    followers: current.followers + (follow ? 1 : 0),
    reactions: {
      ...current.reactions,
      ...(reaction
        ? { [reaction]: current.reactions[reaction] + 1 }
        : {}),
    },
  };

  return writeDjCarlosUpcomingSignals(next);
}

async function readDjCarlosVideoPlayHistory() {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.storage
      .from(DJ_CARLOS_STORAGE_BUCKET)
      .download(DJ_CARLOS_VIDEO_PLAYS_PATH);

    if (error || !data) return normalizeDjCarlosVideoPlayHistory(null);
    return normalizeDjCarlosVideoPlayHistory(JSON.parse(await data.text()));
  } catch {
    return normalizeDjCarlosVideoPlayHistory(null);
  }
}

async function writeDjCarlosVideoPlayHistory(
  history: DjCarlosVideoPlayHistory,
) {
  const cleanHistory = normalizeDjCarlosVideoPlayHistory(history);
  const supabase = await ensureDjCarlosBucket();
  const file = new Blob([JSON.stringify(cleanHistory, null, 2)], {
    type: "application/json",
  });
  const { error } = await supabase.storage
    .from(DJ_CARLOS_STORAGE_BUCKET)
    .upload(DJ_CARLOS_VIDEO_PLAYS_PATH, file, {
      cacheControl: "0",
      contentType: "application/json",
      upsert: true,
    });

  if (error) throw error;
  return cleanHistory;
}

export async function readDjCarlosVideoPlayCounts() {
  return videoPlayCountsFromHistory(await readDjCarlosVideoPlayHistory());
}

async function recordDjCarlosVideoPlayUnsafe(trackId: string) {
  const history = await readDjCarlosVideoPlayHistory();
  const today = dayKey();
  const current = history.tracks[trackId] ?? { days: {}, total: 0 };
  history.tracks[trackId] = {
    days: {
      ...current.days,
      [today]: (current.days[today] ?? 0) + 1,
    },
    total: current.total + 1,
  };
  return videoPlayCountsFromHistory(
    await writeDjCarlosVideoPlayHistory(history),
  );
}

export function recordDjCarlosVideoPlay(trackId: string) {
  const cleanTrackId = trackId.trim();
  if (!cleanTrackId) return Promise.resolve<DjCarlosVideoPlayCounts>({});

  const operation = djCarlosVideoPlayWriteQueue.then(() =>
    recordDjCarlosVideoPlayUnsafe(cleanTrackId),
  );
  djCarlosVideoPlayWriteQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

export async function writeDjCarlosImageFile(
  file: File,
  folder: "covers" | "identity" = "covers",
) {
  if (!DJ_CARLOS_COVER_TYPES.has(file.type)) {
    throw new Error("La imagen debe ser JPG, PNG o WEBP.");
  }
  if (file.size > DJ_CARLOS_MAX_COVER_BYTES) {
    throw new Error(`La imagen debe pesar menos de ${DJ_CARLOS_MAX_COVER_MB} MB.`);
  }

  const extension = file.type === "image/png"
    ? "png"
    : file.type === "image/webp"
      ? "webp"
      : "jpg";
  const supabase = await ensureDjCarlosAssetsBucket();
  const path = `${folder}/image-${Date.now()}.${extension}`;
  const { error } = await supabase.storage
    .from(DJ_CARLOS_ASSETS_BUCKET)
    .upload(path, file, {
      cacheControl: "31536000",
      contentType: file.type,
      upsert: true,
    });

  if (error) throw error;

  const { data } = supabase.storage
    .from(DJ_CARLOS_ASSETS_BUCKET)
    .getPublicUrl(path);

  return data.publicUrl;
}

export function writeDjCarlosCoverFile(file: File) {
  return writeDjCarlosImageFile(file, "covers");
}

export async function writeDjCarlosPreviewClipFile(
  file: File,
  clipId: string,
) {
  if (!DJ_CARLOS_PREVIEW_CLIP_TYPES.has(file.type)) {
    throw new Error("El adelanto debe ser MP3, M4A o AAC.");
  }
  if (file.size > DJ_CARLOS_PREVIEW_CLIP_MAX_BYTES) {
    throw new Error(
      `El adelanto debe pesar menos de ${DJ_CARLOS_PREVIEW_CLIP_MAX_MB} MB.`,
    );
  }

  const safeId = clipId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  if (safeId.length < 8) throw new Error("Identificador de adelanto no valido.");
  const extension = file.type === "audio/mpeg" || file.type === "audio/mp3"
    ? "mp3"
    : file.type === "audio/aac" || file.type === "audio/x-aac"
      ? "aac"
      : "m4a";
  const storagePath = `previews/${safeId}-${Date.now()}.${extension}`;
  const supabase = await ensureDjCarlosPreviewClipsBucket();
  const { error } = await supabase.storage
    .from(DJ_CARLOS_PREVIEW_CLIPS_BUCKET)
    .upload(storagePath, file, {
      cacheControl: "0",
      contentType: file.type,
      upsert: false,
    });
  if (error) throw error;
  return storagePath;
}

export async function createDjCarlosPreviewClipSignedUrl(
  storagePath: string,
) {
  if (!storagePath.startsWith("previews/") || storagePath.includes("..")) {
    throw new Error("Ruta de adelanto no valida.");
  }
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(DJ_CARLOS_PREVIEW_CLIPS_BUCKET)
    .createSignedUrl(storagePath, 10 * 60);
  if (error || !data?.signedUrl) {
    throw error ?? new Error("Enlace no disponible.");
  }
  return data.signedUrl;
}

export async function deleteDjCarlosPreviewClipFile(storagePath: string) {
  if (!storagePath.startsWith("previews/") || storagePath.includes("..")) {
    throw new Error("Ruta de adelanto no valida.");
  }
  const supabase = createAdminClient();
  const { error } = await supabase.storage
    .from(DJ_CARLOS_PREVIEW_CLIPS_BUCKET)
    .remove([storagePath]);
  if (error) throw error;
}
