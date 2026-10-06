/**
 * Generates the default PWA icon PNGs referenced by the staff manifest
 * (and used as the customer-manifest fallback) from `public/icons/app-icon.svg`.
 * Re-run after changing the SVG: `pnpm --filter @rms/web icons`.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const iconsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/icons');
const svgSource = path.join(iconsDir, 'app-icon.svg');

await mkdir(iconsDir, { recursive: true });

// Regular icons: the SVG's own rounded square is kept as-is.
await sharp(svgSource).resize(192, 192).png({ compressionLevel: 9 }).toFile(path.join(iconsDir, 'icon-192.png'));
await sharp(svgSource).resize(512, 512).png({ compressionLevel: 9 }).toFile(path.join(iconsDir, 'icon-512.png'));
await sharp(svgSource).resize(180, 180).png({ compressionLevel: 9 }).toFile(path.join(iconsDir, 'icon-180.png'));

// Maskable icon: full-bleed square background with the mark inside the 80%
// safe zone so platform masking never clips it.
const safeZone = await sharp(svgSource).resize(410, 410, { fit: 'contain', background: { r: 18, g: 24, b: 22, alpha: 1 } }).png().toBuffer();
await sharp({
  create: { width: 512, height: 512, channels: 4, background: { r: 18, g: 24, b: 22, alpha: 1 } },
})
  .composite([{ input: safeZone, gravity: 'centre' }])
  .png({ compressionLevel: 9 })
  .toFile(path.join(iconsDir, 'icon-maskable.png'));

console.log('Generated icon-180.png, icon-192.png, icon-512.png, icon-maskable.png');
