#!/usr/bin/env node
/**
 * Draws the favicons and the social preview from the in-app mark.
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

// The palette of src/index.css, by value: these files are read outside the app's CSS.
const DEEP = '#12110f';
const LAMP = '#f0a23b';
const INK = '#efe9de';
const INK_2 = '#aaa398';

/** Mark() in a 0 0 20 20 viewBox: three level bars, the flat sign of a mixing desk. */
const BARS = [
  { x: 2, y: 8, w: 4, h: 10 },
  { x: 8, y: 2, w: 4, h: 16 },
  { x: 14, y: 11, w: 4, h: 7 },
];

const bars = () =>
  BARS.map(
    ({ x, y, w, h }) =>
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1" fill="${LAMP}" />`,
  ).join('');

/** The mark on its plate. `radius` is a fraction of the side; 0 fills the square. */
function plate(size, radius = 0.22) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 20 20">` +
    `<rect width="20" height="20" rx="${(20 * radius).toFixed(2)}" fill="${DEEP}" />` +
    bars() +
    `</svg>`
  );
}

const ICONS = [
  { file: 'favicon-32.png', size: 32 },
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  // iOS masks the icon itself: give it a full square so no corner is cut twice.
  { file: 'apple-touch-icon.png', size: 180, radius: 0 },
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
  gap: 48px;
}
.mark { width: 140px; height: 140px; }
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
<div class="mark"><svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">${bars()}</svg></div>
<div class="name">DnD Ambiance</div>
<div class="tag">Scenes, mixes and loops for the game table</div>
</body></html>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });

// Icons: the plate fills the frame, so the only transparency is the rounded corners.
for (const { file, size, radius } of ICONS) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block}</style>` +
      plate(size, radius),
  );
  await page.screenshot({ path: path.join(PUBLIC, file), omitBackground: true });
  console.log(`wrote public/${file} (${size}x${size})`);
}

writeFileSync(path.join(PUBLIC, 'favicon.svg'), `${plate(64)}\n`);
console.log('wrote public/favicon.svg');

// Social preview: 1200x630, the size every crawler crops to.
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(previewHtml());
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: path.join(PUBLIC, 'og-image.png') });
console.log('wrote public/og-image.png (1200x630)');

await browser.close();
