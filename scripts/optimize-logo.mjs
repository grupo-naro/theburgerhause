import sharp from "sharp";

const quality = Number(process.argv[2] ?? 80);
await sharp("public/logo.png")
  .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .webp({ quality })
  .toFile("public/brand/logo-512.webp");
