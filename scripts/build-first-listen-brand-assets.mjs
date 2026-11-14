import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const brandDir = path.join(root, "public", "brand");
const iconDir = path.join(root, "public", "icons");
const appDir = path.join(root, "app");
const androidDir = path.join(root, "android");
const fullLogoSource = path.join(brandDir, "first-listen-link-logo.png");
const markSource = path.join(brandDir, "first-listen-mark.png");
const background = { r: 3, g: 8, b: 18, alpha: 1 };

await Promise.all([mkdir(brandDir, { recursive: true }), mkdir(iconDir, { recursive: true })]);

await sharp(fullLogoSource)
  .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
  .resize({ width: 920, withoutEnlargement: true })
  .png({ compressionLevel: 9, palette: false })
  .toFile(path.join(brandDir, "first-listen-wordmark.png"));

await sharp(fullLogoSource)
  .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
  .resize({ width: 1400, withoutEnlargement: true })
  .png({ compressionLevel: 9, palette: false })
  .toFile(path.join(brandDir, "first-listen-hero-logo.png"));

await sharp(markSource)
  .resize({
    width: 1024,
    height: 1024,
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png({ compressionLevel: 9, palette: false })
  .toFile(path.join(brandDir, "first-listen-emblem.png"));

async function renderIcon(size, output, inset = 0) {
  const innerSize = Math.max(1, size - inset * 2);
  const emblem = await sharp(markSource)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
    .resize({
      width: innerSize,
      height: innerSize,
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
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
  await renderIcon(
    size,
    path.join(iconDir, `first-listen-${size}x${size}.png`),
    Math.max(1, Math.round(size * 0.06)),
  );
}

await renderIcon(192, path.join(iconDir, "first-listen-maskable-192x192.png"), 34);
await renderIcon(512, path.join(iconDir, "first-listen-maskable-512x512.png"), 92);
await renderIcon(512, path.join(appDir, "icon.png"), 31);
await renderIcon(180, path.join(appDir, "apple-icon.png"), 11);
await renderIcon(512, path.join(androidDir, "twa", "store_icon.png"), 31);
await renderIcon(512, path.join(androidDir, "play-store", "assets", "icon-512.png"), 31);

const androidLauncherSizes = {
  "mipmap-mdpi": { launcher: 48, maskable: 82 },
  "mipmap-hdpi": { launcher: 72, maskable: 123 },
  "mipmap-xhdpi": { launcher: 96, maskable: 164 },
  "mipmap-xxhdpi": { launcher: 144, maskable: 246 },
  "mipmap-xxxhdpi": { launcher: 192, maskable: 328 },
};

for (const [density, sizes] of Object.entries(androidLauncherSizes)) {
  const densityDir = path.join(androidDir, "twa", "app", "src", "main", "res", density);
  await mkdir(densityDir, { recursive: true });
  await renderIcon(
    sizes.launcher,
    path.join(densityDir, "ic_launcher.png"),
    Math.max(1, Math.round(sizes.launcher * 0.06)),
  );
  await renderIcon(
    sizes.maskable,
    path.join(densityDir, "ic_maskable.png"),
    Math.max(1, Math.round(sizes.maskable * 0.04)),
  );
}

const faviconPng = await sharp(markSource)
  .resize({
    width: 32,
    height: 32,
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
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
