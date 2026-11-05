import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceGraphic = path.join(
  root,
  "android",
  "play-store",
  "source",
  "feature-graphic-generated.png",
);
const iconSource = path.join(root, "public", "icons", "first-listen-512x512.png");
const outputDir = path.join(root, "android", "play-store", "assets");

await fs.mkdir(outputDir, { recursive: true });

await sharp(sourceGraphic)
  .resize(1024, 500, { fit: "cover", position: "centre" })
  .flatten({ background: "#101710" })
  .jpeg({ quality: 94, chromaSubsampling: "4:4:4" })
  .toFile(path.join(outputDir, "feature-graphic-1024x500.jpg"));

await sharp(iconSource)
  .resize(512, 512, { fit: "cover" })
  .png({ palette: false, compressionLevel: 9 })
  .toFile(path.join(outputDir, "icon-512.png"));

console.log("Play Store icon and feature graphic generated.");
