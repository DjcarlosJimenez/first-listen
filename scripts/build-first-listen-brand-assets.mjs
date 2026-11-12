import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const wideSource = "C:/Users/Dj Carlos Jimenez/Downloads/First Listen_ Futuristic Audio Emblem.png";
const squareSource = "C:/Users/Dj Carlos Jimenez/Downloads/First Listen Neon Chrome Emblem.png";
const brandDir = path.join(root, "public", "brand");
const iconDir = path.join(root, "public", "icons");
const appDir = path.join(root, "app");
const background = { r: 3, g: 8, b: 18, alpha: 1 };

await Promise.all([mkdir(brandDir, { recursive: true }), mkdir(iconDir, { recursive: true })]);

await sharp(wideSource)
  .extract({ left: 0, top: 215, width: 1752, height: 440 })
  .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
  .resize({ width: 920, withoutEnlargement: true })
  .png({ compressionLevel: 9, palette: false })
  .toFile(path.join(brandDir, "first-listen-wordmark.png"));

await sharp(wideSource)
  .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
  .resize({ width: 1400, withoutEnlargement: true })
  .png({ compressionLevel: 9, palette: false })
  .toFile(path.join(brandDir, "first-listen-hero-logo.png"));

await sharp(squareSource)
  .resize({ width: 1024, height: 1024, fit: "contain" })
  .png({ compressionLevel: 9, palette: false })
  .toFile(path.join(brandDir, "first-listen-emblem.png"));

async function renderIcon(size, output, inset = 0) {
  const innerSize = Math.max(1, size - inset * 2);
  const emblem = await sharp(squareSource)
    .resize({ width: innerSize, height: innerSize, fit: "contain" })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background,
    },
  })
    .composite([{ input: emblem, left: inset, top: inset }])
    .png({ compressionLevel: 9, palette: false })
    .toFile(output);
}

for (const size of [16, 32, 48, 180, 192, 512]) {
  await renderIcon(size, path.join(iconDir, `first-listen-${size}x${size}.png`));
}

await renderIcon(192, path.join(iconDir, "first-listen-maskable-192x192.png"), 18);
await renderIcon(512, path.join(iconDir, "first-listen-maskable-512x512.png"), 48);
await renderIcon(512, path.join(appDir, "icon.png"));
await renderIcon(180, path.join(appDir, "apple-icon.png"));

const faviconPng = await sharp(squareSource)
  .resize({ width: 32, height: 32, fit: "contain", background })
  .flatten({ background })
  .png({ compressionLevel: 9 })
  .toBuffer();
const faviconHeader = Buffer.alloc(22);
faviconHeader.writeUInt16LE(0, 0);
faviconHeader.writeUInt16LE(1, 2);
faviconHeader.writeUInt16LE(1, 4);
faviconHeader.writeUInt8(32, 6);
faviconHeader.writeUInt8(32, 7);
faviconHeader.writeUInt8(0, 8);
faviconHeader.writeUInt8(0, 9);
faviconHeader.writeUInt16LE(1, 10);
faviconHeader.writeUInt16LE(32, 12);
faviconHeader.writeUInt32LE(faviconPng.length, 14);
faviconHeader.writeUInt32LE(22, 18);
await writeFile(path.join(appDir, "favicon.ico"), Buffer.concat([faviconHeader, faviconPng]));

console.log("FirstListen brand assets generated.");
