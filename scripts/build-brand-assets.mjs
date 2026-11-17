#!/usr/bin/env node
/**
 * Draws the favicons, the web app icons and the social preview from the in-app mark.
 *
 *   node scripts/build-brand-assets.mjs
 *
 * The geometry below is Mark() in apps/web-v2/src/components/Brand.tsx: keep the two in
 * sync. Chromium renders the PNGs against the same bundled fonts the app ships, so the
 * name on the preview is the name in the product, not a second copy of the type.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(REPO, 'apps', 'web-v2', 'public');
const FONTS = path.join(REPO, 'apps', 'web-v2', 'node_modules', '@fontsource-variable');

const NAME = 'Roleplay Tunes';

// The palette of src/index.css, by value: these files are read outside the app's CSS.
const DEEP = '#12110f';
const INK = '#efe9de';
const INK_2 = '#aaa398';

// The colors of Mark(): lamp amber for the blade, a shade darker for the gold and the note.
const BLADE_LIGHT = '#f7bf6d';
const BLADE = '#f0a23b';
const GOLD = '#d98a26';
const GRIP = '#9c5f1d';
const GRIP_DARK = '#6e3f0f';

/** Mark() in a 0 0 64 64 viewBox: a cartoon sword and a music note, side by side. */
const MARK =
  `<g transform="translate(21 33) rotate(45) scale(1.06)">` +
  `<path d="M5 6 V-21 L0 -29 V6 Z" fill="${BLADE}"/>` +
  `<path d="M-5 6 V-21 L0 -29 L0.2 -28.7 V6 Z" fill="${BLADE_LIGHT}"/>` +
  `<rect x="-3.2" y="7" width="6.4" height="14" rx="1" fill="${GRIP}"/>` +
  `<path d="M-3.2 10 L3.2 8 V10 L-3.2 12 Z M-3.2 14 L3.2 12 V14 L-3.2 16 Z M-3.2 18 L3.2 16 V18 L-3.2 20 Z" fill="${GRIP_DARK}"/>` +
  `<path d="M-11 9 Q-11 5 -7 5 H7 Q11 5 11 9 A2.4 2.4 0 0 1 6.4 9.6 Q6 8.4 4.6 8.4 H-4.6 Q-6 8.4 -6.4 9.6 A2.4 2.4 0 0 1 -11 9 Z" fill="${GOLD}"/>` +
  `<path d="M-4.6 21 H4.6 A4.6 4.6 0 0 1 -4.6 21 Z" fill="${GOLD}"/>` +
  `</g>` +
  `<g fill="${GOLD}">` +
  `<path d="M52.6 49.3 V11.2 Q52.6 10 53.8 10 H55 Q56 10 56.2 11 C57 17 63.6 20 63.2 30 C63 34 61.8 37 60.4 39 C61.4 33 60.2 26.4 56.2 23.4 V49.3 Z"/>` +
  `<ellipse cx="49.67" cy="50.56" rx="6.8" ry="4.9" transform="rotate(-24 49.67 50.56)"/>` +
  `</g>`;

/**
 * The mark on its dark plate. `radius` is a fraction of the side, 0 fills the square.
 * `inset` is the empty margin on each side, as a fraction of the side: the mark never
 * touches the edge of the plate.
 */
function plate(size, { radius = 0.22, inset = 0.17 } = {}) {
  const side = 64 / (1 - 2 * inset);
  const x = (-(side - 64) / 2).toFixed(2);
  // The drawing spans y 10 to 56 of its 64 box: center that span, not the box.
  const y = (-(side - 64) / 2 + 1).toFixed(2);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="${x} ${y} ${side.toFixed(2)} ${side.toFixed(2)}">` +
    `<rect x="${x}" y="${y}" width="${side.toFixed(2)}" ` +
    `height="${side.toFixed(2)}" rx="${(side * radius).toFixed(2)}" fill="${DEEP}"/>` +
    MARK +
    `</svg>`
  );
}

const ICONS = [
  { file: 'favicon-32.png', size: 32, inset: 0.1 },
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  // iOS masks the icon itself: give it a full square so no corner is cut twice.
  { file: 'apple-touch-icon.png', size: 180, radius: 0 },
  // Android crops maskable icons to a circle or a squircle: the mark stays in the
  // central safe zone, a circle of 80% of the side.
  { file: 'icon-maskable-512.png', size: 512, radius: 0, inset: 0.24 },
];

const fontFace = (family, file) =>
  `@font-face{font-family:'${family}';font-style:normal;font-weight:400 900;` +
  `src:url(data:font/woff2;base64,${readFileSync(path.join(FONTS, file)).toString('base64')})` +
  ` format('woff2-variations');}`;

function previewHtml() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><style>
${fontFace('Cinzel', 'cinzel/files/cinzel-latin-wght-normal.woff2')}
${fontFace('Instrument Sans', 'instrument-sans/files/instrument-sans-latin-wght-normal.woff2')}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 1200px; height: 630px; overflow: hidden; }
body {
  background: radial-gradient(120% 130% at 50% -10%, #201d1a 0%, ${DEEP} 60%);
  color: ${INK};
  font-family: 'Instrument Sans', sans-serif;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 44px;
}
.mark { width: 168px; height: 168px; }
.mark svg { display: block; width: 100%; height: 100%; }
.name {
  font-family: 'Cinzel', serif;
  font-weight: 600;
  font-size: 92px;
  line-height: 1;
  letter-spacing: 0.1em;
  padding-left: 0.1em; /* the last letter carries tracking too: keep the line optically centered */
}
.tag { font-size: 28px; line-height: 1.4; color: ${INK_2}; }
</style></head><body>
<div class="mark"><svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${MARK}</svg></div>
<div class="name">${NAME}</div>
<div class="tag">Scenes, mixes and loops for the game table</div>
</body></html>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });

// Icons: the plate fills the frame, so the only transparency is the rounded corners.
for (const { file, size, ...options } of ICONS) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block}</style>` +
      plate(size, options),
  );
  await page.screenshot({ path: path.join(PUBLIC, file), omitBackground: true });
  console.log(`wrote public/${file} (${size}x${size})`);
}

writeFileSync(path.join(PUBLIC, 'favicon.svg'), `${plate(64, { inset: 0.1 })}\n`);
console.log('wrote public/favicon.svg');

// Social preview: 1200x630, the size every crawler crops to.
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(previewHtml());
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: path.join(PUBLIC, 'og-image.png') });
console.log('wrote public/og-image.png (1200x630)');

await browser.close();
