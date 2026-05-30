/**
 * Generates the app icon, splash image, and in-app brand marks from the Suhail
 * logo source art.
 *
 * The brand mark is a four-pointed star inside an orbital ring ("Suhail"/سهيل =
 * the star Canopus). The app is dark-themed, so the WHITE mark is primary. iOS
 * app icons must be OPAQUE (alpha flattens to black), so the icon composites the
 * white mark on a solid brand-navy background.
 *
 * Run from anywhere under the repo (resolves `sharp` from the repo-root
 * node_modules):
 *   bun mobile/scripts/make-icons.ts
 *
 * Re-run + commit the generated PNGs after swapping the source art. Source art
 * lives outside the repo (the team's design folder) — update SRC_* below if it
 * moves.
 */
import sharp from "sharp";
import path from "node:path";

// Brand background (theme `bg` token).
const BG = "#020617";

// Source art (1024x1024 RGBA). Outside the repo — the team's design folder.
const SRC_DIR = "/Users/abdullahalqobaisi/Desktop/UNI 4th YEAR 2ND TERM!!!/Suhail/RES";
const SRC_WHITE = path.join(SRC_DIR, "transparent white logo.png");
const SRC_BLACK = path.join(SRC_DIR, "Suahil logo black and transparent.png");

// Output into mobile/assets (this script lives in mobile/scripts).
const ASSETS = path.resolve(import.meta.dir, "..", "assets");
const OUT_ICON = path.join(ASSETS, "icon.png");
const OUT_SPLASH = path.join(ASSETS, "splash.png");
const OUT_LOGO_WHITE = path.join(ASSETS, "logo-white.png");
const OUT_LOGO_BLACK = path.join(ASSETS, "logo-black.png");

/**
 * Composite `src` centered on a solid `BG` square of `size`px, with the mark
 * occupying `logoFrac` of the canvas. Output is fully opaque (no alpha) — safe
 * for an iOS app icon.
 */
async function compositeOnBrand(src: string, out: string, size: number, logoFrac: number): Promise<void> {
  const logoPx = Math.round(size * logoFrac);
  const logo = await sharp(src)
    .resize(logoPx, logoPx, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  await sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([{ input: logo, gravity: "centre" }])
    .flatten({ background: BG }) // drop alpha -> opaque icon
    .png({ compressionLevel: 9, palette: true })
    .toFile(out);
  console.log(`wrote ${path.relative(ASSETS, out)} (${size}x${size}, logo ${Math.round(logoFrac * 100)}%)`);
}

/**
 * Normalize a source logo to a 512 PNG with transparency preserved. 512 is
 * plenty for a ~140pt in-app mark at 3x, and palette compression keeps the
 * 2-colour line art tiny so it doesn't bloat the bundle.
 */
async function copyLogo(src: string, out: string): Promise<void> {
  await sharp(src)
    .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, palette: true })
    .toFile(out);
  console.log(`wrote ${path.relative(ASSETS, out)} (512x512, transparent)`);
}

async function main(): Promise<void> {
  // App icon: white mark, ~62% of canvas so the orbital ring clears iOS's
  // rounded-corner mask (~19% edge padding).
  await compositeOnBrand(SRC_WHITE, OUT_ICON, 1024, 0.62);
  // Splash: smaller mark on the same brand navy (resizeMode contain in config).
  await compositeOnBrand(SRC_WHITE, OUT_SPLASH, 1024, 0.42);
  // In-app marks (transparent) — white for dark surfaces, black kept for any
  // future light-background use.
  await copyLogo(SRC_WHITE, OUT_LOGO_WHITE);
  await copyLogo(SRC_BLACK, OUT_LOGO_BLACK);
}

main().catch((err) => {
  console.error("make-icons failed:", err);
  process.exit(1);
});
