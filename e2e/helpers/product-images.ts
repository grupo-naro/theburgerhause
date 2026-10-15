import { eq } from "drizzle-orm";
import sharp from "sharp";
import * as s from "../../src/db/schema";
import { saveImage } from "../../src/lib/uploads/storage";
import { db } from "./db";

const palette = [
  { bg: "#fde7b0", bun: "#d9902f", patty: "#5a2e1a" },
  { bg: "#cfe3fb", bun: "#e0a24a", patty: "#6b3a22" },
  { bg: "#ffd9d0", bun: "#c97d2b", patty: "#4a2414" },
];

const burgerSvg = ({ bg, bun, patty }: (typeof palette)[number]) => `
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <rect width="800" height="600" fill="${bg}"/>
  <ellipse cx="400" cy="470" rx="250" ry="26" fill="rgba(0,0,0,0.12)"/>
  <path d="M170 300a230 150 0 0 1 460 0z" fill="${bun}"/>
  <rect x="150" y="300" width="500" height="34" rx="17" fill="#5fae3b"/>
  <rect x="165" y="334" width="470" height="30" fill="#ffc629"/>
  <rect x="150" y="356" width="500" height="58" rx="29" fill="${patty}"/>
  <rect x="170" y="414" width="460" height="46" rx="23" fill="${bun}"/>
</svg>`;

/** Gives the first seeded products a photo so screenshots show real cards next to placeholder ones. */
export async function attachSeedImages(names: string[]): Promise<void> {
  for (const [i, name] of names.entries()) {
    const png = await sharp(Buffer.from(burgerSvg(palette[i % palette.length]))).png().toBuffer();
    const { path } = await saveImage(png);
    await db().update(s.products).set({ imagePath: path }).where(eq(s.products.name, name));
  }
}

