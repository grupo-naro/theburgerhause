import sharp from "sharp";

const quality = Number(process.argv[2] ?? 80);
await sharp("public/logo.png")
  .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .webp({ quality })
  .toFile("public/brand/logo-512.webp");

// Small variants for the product-card placeholder (shown at 56-96 px; srcset picks the one a screen needs).
for (const size of [112, 192]) {
  await sharp("public/logo.png")
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality })
    .toFile(`public/brand/logo-${size}.webp`);
}
// src/app/favicon.ico is a single 32x32 RGBA PNG wrapped in an ICO container (~2 KB; the old multi-size one was 15 KB).
