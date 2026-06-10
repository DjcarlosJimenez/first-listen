export type PlatformThemePreset =
  | "first_listen_default"
  | "dark_studio"
  | "modern_dark"
  | "midnight"
  | "community_green"
  | "custom";

export type PlatformTheme = {
  preset: PlatformThemePreset;
  backgroundColor: string;
  cardColor: string;
  textColor: string;
  accentColor: string;
  buttonColor: string;
  linkColor: string;
  borderColor: string;
  updatedAt?: string;
};

export const platformThemePresets: Record<
  Exclude<PlatformThemePreset, "custom">,
  PlatformTheme
> = {
  first_listen_default: {
    preset: "first_listen_default",
    backgroundColor: "#F3F4EE",
    cardColor: "#FFFFFF",
    textColor: "#151815",
    accentColor: "#C8FF4F",
    buttonColor: "#171A18",
    linkColor: "#4F7110",
    borderColor: "#D5D9D0",
  },
  dark_studio: {
    preset: "dark_studio",
    backgroundColor: "#141816",
    cardColor: "#202521",
    textColor: "#F4F7F1",
    accentColor: "#C8FF4F",
    buttonColor: "#2A302B",
    linkColor: "#B8EB45",
    borderColor: "#343C35",
  },
  modern_dark: {
    preset: "modern_dark",
    backgroundColor: "#111315",
    cardColor: "#1B1F22",
    textColor: "#F5F6F7",
    accentColor: "#8EEA4D",
    buttonColor: "#29342B",
    linkColor: "#A9F079",
    borderColor: "#30363B",
  },
  midnight: {
    preset: "midnight",
    backgroundColor: "#0D1320",
    cardColor: "#151E2D",
    textColor: "#F4F7FC",
    accentColor: "#B7EE55",
    buttonColor: "#273751",
    linkColor: "#CBF584",
    borderColor: "#2B3850",
  },
  community_green: {
    preset: "community_green",
    backgroundColor: "#EFF5E8",
    cardColor: "#FFFFFF",
    textColor: "#172016",
    accentColor: "#A9E33A",
    buttonColor: "#25421A",
    linkColor: "#3F6C16",
    borderColor: "#C9D8BE",
  },
};

export const defaultPlatformTheme =
  platformThemePresets.first_listen_default;

export const platformThemePresetLabels: Record<PlatformThemePreset, string> = {
  first_listen_default: "First Listen Default",
  dark_studio: "Dark Studio",
  modern_dark: "Modern Dark",
  midnight: "Midnight",
  community_green: "Community Green",
  custom: "Custom",
};

export function mapPlatformThemeRow(
  row: Record<string, unknown> | null | undefined,
): PlatformTheme {
  if (!row) return defaultPlatformTheme;
  return {
    preset: (row.preset as PlatformThemePreset) ?? "first_listen_default",
    backgroundColor: String(row.background_color ?? "#F3F4EE"),
    cardColor: String(row.card_color ?? "#FFFFFF"),
    textColor: String(row.text_color ?? "#151815"),
    accentColor: String(row.accent_color ?? "#C8FF4F"),
    buttonColor: String(row.button_color ?? "#171A18"),
    linkColor: String(row.link_color ?? "#4F7110"),
    borderColor: String(row.border_color ?? "#D5D9D0"),
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
  };
}
