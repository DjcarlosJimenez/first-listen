import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const source = path.join(root, "public", "brand", "first-listen-icon.svg");
const iconDirectory = path.join(root, "public", "icons");
const sizes = [16, 32, 48, 180, 192, 512];

await mkdir(iconDirectory, { recursive: true });

const pngBuffers = new Map();
for (const size of sizes) {
  const buffer = await sharp(source)
    .resize(size, size)
    .png()
    .toBuffer();
  pngBuffers.set(size, buffer);
  await writeFile(
    path.join(iconDirectory, `first-listen-${size}x${size}.png`),
    buffer,
  );
}

await writeFile(
  path.join(root, "app", "apple-icon.png"),
  pngBuffers.get(180),
);
await writeFile(
  path.join(root, "app", "icon.png"),
  pngBuffers.get(512),
);

const icoSizes = [16, 32, 48];
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoSizes.length, 4);

const directory = Buffer.alloc(icoSizes.length * 16);
let offset = header.length + directory.length;
const images = [];

icoSizes.forEach((size, index) => {
  const image = pngBuffers.get(size);
  const entryOffset = index * 16;
  directory.writeUInt8(size, entryOffset);
  directory.writeUInt8(size, entryOffset + 1);
  directory.writeUInt8(0, entryOffset + 2);
  directory.writeUInt8(0, entryOffset + 3);
  directory.writeUInt16LE(1, entryOffset + 4);
  directory.writeUInt16LE(32, entryOffset + 6);
  directory.writeUInt32LE(image.length, entryOffset + 8);
  directory.writeUInt32LE(offset, entryOffset + 12);
  images.push(image);
  offset += image.length;
});

await writeFile(
  path.join(root, "app", "favicon.ico"),
  Buffer.concat([header, directory, ...images]),
);
