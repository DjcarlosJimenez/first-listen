import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  defaultDjCarlosPageConfig,
  normalizeDjCarlosPageConfig,
  type DjCarlosPageConfig,
} from "@/lib/dj-carlos-page";

const DJ_CARLOS_STORAGE_BUCKET = "dj-carlos-page";
const DJ_CARLOS_CONFIG_PATH = "config.json";

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

export async function readDjCarlosPageConfig(
  fallback: DjCarlosPageConfig = defaultDjCarlosPageConfig,
) {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.storage
      .from(DJ_CARLOS_STORAGE_BUCKET)
      .download(DJ_CARLOS_CONFIG_PATH);

    if (error || !data) return fallback;

    return normalizeDjCarlosPageConfig(JSON.parse(await data.text()), fallback);
  } catch {
    return fallback;
  }
}

export async function writeDjCarlosPageConfig(
  config: DjCarlosPageConfig,
  fallback: DjCarlosPageConfig = defaultDjCarlosPageConfig,
) {
  const cleanConfig = normalizeDjCarlosPageConfig(
    {
      ...config,
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
