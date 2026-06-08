export const interfaceLocales = ["en", "es"] as const;
export type InterfaceLocale = (typeof interfaceLocales)[number];

export const languageOptions = [
  "English",
  "Spanish",
  "Portuguese",
  "French",
  "German",
  "Italian",
  "Instrumental Only",
  "Other",
] as const;

export const songLanguageOptions = [
  "English",
  "Spanish",
  "Portuguese",
  "French",
  "German",
  "Italian",
  "Instrumental",
  "Other",
] as const;

export type ListenerLanguage = (typeof languageOptions)[number];
export type SongLanguage = (typeof songLanguageOptions)[number];

export const genreOptions = [
  "Pop",
  "Rock",
  "Hip Hop",
  "EDM",
  "Country",
  "Reggaeton",
  "Regional Mexican",
  "Cumbia",
  "Salsa",
  "Bachata",
  "Indie",
  "Alternative",
  "Jazz",
  "Classical",
  "Instrumental",
  "Other",
] as const;

export type Genre = (typeof genreOptions)[number];

export const feedbackFocusOptions = [
  "Production",
  "Lyrics",
  "Mix",
  "Commercial Potential",
  "Hook Strength",
  "Arrangement",
  "General Feedback",
] as const;

export type FeedbackFocus = (typeof feedbackFocusOptions)[number];

export const growthStages = [
  {
    id: "founding",
    label: "Stage 1",
    name: "Founding Artists",
    spots: "50 spots",
    active: true,
  },
  {
    id: "early",
    label: "Stage 2",
    name: "Early Adopters",
    spots: "500 spots",
    active: false,
  },
  {
    id: "launch",
    label: "Stage 3",
    name: "Public Launch",
    spots: "Open access",
    active: false,
  },
] as const;

export const latinGenres: Genre[] = [
  "Reggaeton",
  "Regional Mexican",
  "Cumbia",
  "Salsa",
  "Bachata",
];

export const defaultListenerLanguages: ListenerLanguage[] = ["English", "Spanish"];
export const defaultGenrePreferences: Genre[] = ["Pop", "Indie", "Cumbia"];
