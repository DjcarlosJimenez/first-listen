import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  defaultDjCarlosPageConfig,
  normalizeDjCarlosPageConfig,
  normalizeDjCarlosUpcomingSignals,
  type DjCarlosPageConfig,
  type DjCarlosUpcomingReactionKey,
  type DjCarlosUpcomingSignals,
} from "@/lib/dj-carlos-page";

const DJ_CARLOS_STORAGE_BUCKET = "dj-carlos-page";
const DJ_CARLOS_ASSETS_BUCKET = "dj-carlos-page-assets";
const DJ_CARLOS_CONFIG_PATH = "config.json";
const DJ_CARLOS_UPCOMING_SIGNALS_PATH = "upcoming-signals.json";
const DJ_CARLOS_MAX_COVER_BYTES = 8 * 1024 * 1024;
const DJ_CARLOS_COVER_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

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

  if (data && !error) return supabase;

  const { error: createError } = await supabase.storage.createBucket(
    DJ_CARLOS_ASSETS_BUCKET,
    {
      allowedMimeTypes: [...DJ_CARLOS_COVER_TYPES],
      fileSizeLimit: DJ_CARLOS_MAX_COVER_BYTES,
      public: true,
    },
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

export async function writeDjCarlosCoverFile(file: File) {
  if (!DJ_CARLOS_COVER_TYPES.has(file.type)) {
    throw new Error("La portada debe ser JPG, PNG o WEBP.");
  }
  if (file.size > DJ_CARLOS_MAX_COVER_BYTES) {
    throw new Error("La portada debe pesar menos de 8 MB.");
  }

  const extension = file.type === "image/png"
    ? "png"
    : file.type === "image/webp"
      ? "webp"
      : "jpg";
  const supabase = await ensureDjCarlosAssetsBucket();
  const path = `covers/album-${Date.now()}.${extension}`;
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
