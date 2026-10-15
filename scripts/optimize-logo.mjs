import sharp from "sharp";

const quality = Number(process.argv[2] ?? 80);
await sharp("public/logo.png")
  .resize(512, 512)
  .webp({ quality })
  .toFile("public/brand/logo-512.webp");
