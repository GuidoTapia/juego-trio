// Process the source PNGs in cartas/ into web-ready WebPs in public/cartas/.
//
// Pipeline per card:
//   1. Trim the transparent margin (alpha-based, no colour assumptions).
//   2. Force a 65:100 aspect ratio (the standard poker card ratio). If the
//      trimmed art already has that aspect, the resize is a no-op crop;
//      otherwise sharp pads with black so nothing is lost.
//   3. Encode as opaque WebP. Any residual transparency is flattened on black
//      so it blends with the dark scallop edges instead of leaking through.

import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const TARGET_W = 540;
const TARGET_H = 831; // 540 * 100 / 65 → 65:100 card ratio

async function processCard(n) {
  const inPath = path.join(ROOT, "cartas", `carta-trio-${n}.png`);
  const outPath = path.join(ROOT, "public", "cartas", `carta-trio-${n}.webp`);

  const trimmed = await sharp(inPath).trim().toBuffer();

  const out = await sharp(trimmed)
    .resize({
      width: TARGET_W,
      height: TARGET_H,
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    })
    .flatten({ background: { r: 0, g: 0, b: 0 } })
    .webp({ quality: 88 })
    .toBuffer();

  await sharp(out).toFile(outPath);

  const sizeKB = (out.length / 1024).toFixed(1);
  const m = await sharp(trimmed).metadata();
  console.log(`carta-trio-${n}.webp — ${sizeKB} KB  (trimmed ${m.width}x${m.height})`);
}

for (let n = 1; n <= 12; n++) await processCard(n);
console.log("Done.");
