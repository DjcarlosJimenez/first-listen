import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const artistDir = path.join(root, "public", "artist", "dj-carlos-jimenez");
const source = path.join(artistDir, "logo.png");
const background = { r: 3, g: 8, b: 18, alpha: 1 };

async function renderIcon(size) {
  const inset = Math.round(size * 0.045);
  const innerSize = size - inset * 2;
  const logo = await sharp(source)
    .resize({
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      fit: "contain",
      height: innerSize,
      width: innerSize,
    })
    .png()
    .toBuffer();

  await sharp({
    create: {
      background,
      channels: 4,
      height: size,
      width: size,
    },
  })
    .composite([{ input: logo, left: inset, top: inset }])
    .png({ compressionLevel: 9, palette: false })
    .toFile(path.join(artistDir, `icon-${size}.png`));
}

await Promise.all([renderIcon(192), renderIcon(512)]);
console.log("DJ Carlos brand icons generated from logo.png.");
