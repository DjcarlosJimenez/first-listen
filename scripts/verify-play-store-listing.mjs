import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const listing = JSON.parse(
  await fs.readFile(path.join(root, "android", "play-store", "listing.json"), "utf8"),
);
const declarations = JSON.parse(
  await fs.readFile(path.join(root, "android", "play-console-declarations.json"), "utf8"),
);
const failures = [];
const pass = (condition, message) => {
  if (!condition) failures.push(message);
};
const length = (value) => Array.from(value).length;

for (const [locale, copy] of Object.entries(listing.locales)) {
  pass(length(copy.appName) <= 30, `${locale}: app name exceeds 30 characters`);
  pass(
    length(copy.shortDescription) <= 80,
    `${locale}: short description exceeds 80 characters`,
  );
  pass(
    length(copy.fullDescription) <= 4000,
    `${locale}: full description exceeds 4,000 characters`,
  );
  pass(
    !/escuchas verificadas/i.test(copy.fullDescription),
    `${locale}: use Reproducciones verificadas instead of Escuchas verificadas`,
  );
}

pass(listing.category === "MUSIC_AND_AUDIO", "Category must be MUSIC_AND_AUDIO");
pass(
  listing.audience.ageGroups.length === 1 && listing.audience.ageGroups[0] === "18 and over",
  "The listing must target only 18 and over",
);
pass(listing.audience.restrictMinorAccess === true, "Restrict Minor Access must be enabled");
pass(
  declarations.targetAudience.restrictMinorAccess === true,
  "The declaration must require Restrict Minor Access",
);

async function inspectAsset(relativePath) {
  const absolutePath = path.join(root, relativePath);
  const metadata = await sharp(absolutePath).metadata();
  return { absolutePath, metadata };
}

try {
  const { metadata } = await inspectAsset(listing.assets.icon);
  pass(metadata.width === 512 && metadata.height === 512, "Store icon must be 512 x 512");
  pass(metadata.format === "png", "Store icon must be PNG");
} catch (error) {
  failures.push(`Store icon is missing or unreadable: ${error.message}`);
}

try {
  const { metadata } = await inspectAsset(listing.assets.featureGraphic);
  pass(
    metadata.width === 1024 && metadata.height === 500,
    "Feature graphic must be 1024 x 500",
  );
  pass(["jpeg", "png"].includes(metadata.format), "Feature graphic must be JPG or PNG");
} catch (error) {
  failures.push(`Feature graphic is missing or unreadable: ${error.message}`);
}

pass(listing.assets.phoneScreenshots.length >= 2, "At least two phone screenshots are required");
for (const screenshot of listing.assets.phoneScreenshots) {
  try {
    const { metadata } = await inspectAsset(screenshot);
    const shortSide = Math.min(metadata.width, metadata.height);
    const longSide = Math.max(metadata.width, metadata.height);
    pass(shortSide >= 320, `${screenshot}: shortest side must be at least 320 px`);
    pass(longSide <= 3840, `${screenshot}: longest side must be at most 3,840 px`);
    pass(longSide <= shortSide * 2, `${screenshot}: longest side cannot exceed 2x shortest`);
    pass(["jpeg", "png"].includes(metadata.format), `${screenshot}: must be JPG or PNG`);
  } catch (error) {
    failures.push(`${screenshot}: missing or unreadable (${error.message})`);
  }
}

if (failures.length) {
  console.error("Play Store block 5 verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Play Store block 5 verification passed.");
for (const [locale, copy] of Object.entries(listing.locales)) {
  console.log(
    `${locale}: name ${length(copy.appName)}/30, short ${length(copy.shortDescription)}/80, full ${length(copy.fullDescription)}/4000`,
  );
}
