import fs from 'node:fs'
import path from 'node:path'

// Flattens each icon library into a manifest the web app fetches as a static asset, one
// file per source plus an index. Keeping them out of the bundle matters: there are ~14k
// icons across the libraries, and only the picker ever needs more than a handful.
//
// Adapted from rnest-mindmap-cms-main/scripts/build-icon-libraries.mjs.
// Key differences from the CMS version:
//   - Material set uses @material-symbols/svg-400 (decision D10), not @material-design-icons/svg
//   - Twemoji keeps its own fills (full-colour art) and takes labels from emojibase-data,
//     its filenames being bare codepoints
//   - SVGs keep `currentColor` directly (no colour sentinel)
//   - Slugs are validated against ^[a-z0-9][a-z0-9-]*$
//   - Material underscores are converted to hyphens
//   - Each set file is shaped { icons: { slug: { m, l } } }
const OUT_DIR = path.join('apps', 'web-v2', 'public', 'icons')
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/

// `qualifier` — how the slug stays unique *within* a library.
//   'none'     -> flat directory, filenames already unique      (tabler, lucide)
//   'category' -> one directory level below the style dir       (healthicons)
//   'style'    -> the style name                                (material)
//
// `color` — what happens to the root <svg> fills.
//   'keep'        -> SVGs already use currentColor (tabler, lucide, healthicons) or carry
//                    their own fills (twemoji); just clean up
//   'inject-fill' -> no fill attribute at all, so one is added      (material)
const SOURCES = [
  {
    id: 'tabler',
    label: 'Tabler',
    packageName: '@tabler/icons',
    licence: 'MIT — Tabler',
    qualifier: 'none',
    color: 'keep',
    styles: [{ name: 'outline', dir: path.join('icons', 'outline') }],
  },
  {
    id: 'lucide',
    label: 'Lucide',
    packageName: 'lucide-static',
    licence: 'ISC — Lucide Contributors',
    qualifier: 'none',
    color: 'keep',
    styles: [{ name: 'outline', dir: 'icons' }],
  },
  {
    id: 'healthicons',
    label: 'Health Icons',
    packageName: 'healthicons',
    // The npm package is the healthicons.org website repo; the art in public/icons
    // is released as CC0 — a public-domain dedication.
    licence: 'CC0 — public domain',
    qualifier: 'category',
    color: 'keep',
    styles: [{ name: 'filled', dir: path.join('public', 'icons', 'svg', 'filled') }],
  },
  {
    id: 'material',
    label: 'Material Symbols',
    packageName: '@material-symbols/svg-400',
    licence: 'Apache-2.0 — Google',
    qualifier: 'style',
    color: 'inject-fill',
    // Material Symbols ships 3 styles (outlined, rounded, sharp) and fill-0/fill-1
    // variants. Only outlined (fill-0) is included to keep the total ~12k. Adding
    // more styles is one line each — the qualifier keeps slugs unique.
    filter: (filename) => !filename.endsWith('-fill.svg'),
    styles: [{ name: 'outlined', dir: 'outlined' }],
  },
  {
    id: 'twemoji',
    label: 'Twemoji',
    packageName: '@discordapp/twemoji',
    // The art is Twitter's Twemoji, packaged by Discord; CC-BY requires attribution.
    licence: 'CC-BY 4.0 — Twitter and contributors',
    qualifier: 'none',
    color: 'keep',
    styles: [{ name: 'colored', dir: path.join('dist', 'svg') }],
    // Filenames are hex codepoints (`1f469-200d-1f3a4`), which the picker's search could
    // never match; `labelFor` looks the name up in emojibase-data instead.
    filter: (filename) => {
      const parts = filename.slice(0, -4).split('-')
      const inRange = (hex, low, high) => {
        const code = parseInt(hex, 16)
        return code >= low && code <= high
      }
      // Base art only: the five skin-tone copies of each person emoji (same face,
      // different skin) would five-fold the grid, a lone regional indicator is a bare
      // letter rather than a picture, and `e50a` is a private-use codepoint no font
      // renders. Flags, keycaps and other sequences stay.
      return !(
        parts.some((part) => inRange(part, 0x1f3fb, 0x1f3ff) || inRange(part, 0xe000, 0xf8ff)) ||
        (parts.length === 1 && inRange(parts[0], 0x1f1e6, 0x1f1ff))
      )
    },
    labelFor: (name) => {
      const parts = name.split('-')
      // Match on hexcode: the filenames drop the variation selectors (fe0f) and leading
      // zeros that emoji hexcodes carry (`23-20e3` is `0023-FE0F-20E3`). Without a
      // name, the emoji itself labels the few sequences emojibase does not know.
      const hex = parts
        .map((part) => part.toUpperCase())
        .filter((part) => part !== 'FE0F')
        .map((part) => part.replace(/^0+/, ''))
        .join('-')
      return (
        emojiNames().get(hex) ??
        parts.map((part) => String.fromCodePoint(parseInt(part, 16))).join('')
      )
    },
  },
]

function packageDir(packageName) {
  return [
    path.join('node_modules', packageName),
    path.join('apps', 'web-v2', 'node_modules', packageName),
  ].find((candidate) => fs.existsSync(candidate))
}

// CLDR names for Twemoji, whose filenames are bare codepoints. emojibase-data ships one
// label per emoji hexcode, normalised here the same way `labelFor` normalises filenames.
// Built once, on first use.
let emojiNamesCache

function emojiNames() {
  if (!emojiNamesCache) {
    const root = packageDir('emojibase-data')
    const compact = JSON.parse(fs.readFileSync(path.join(root, 'en', 'compact.json'), 'utf8'))
    emojiNamesCache = new Map()
    for (const entry of compact) {
      if (!entry.label) continue
      const hex = entry.hexcode
        .toUpperCase()
        .split('-')
        .filter((part) => part !== 'FE0F')
        .map((part) => part.replace(/^0+/, ''))
        .join('-')
      if (!emojiNamesCache.has(hex)) emojiNamesCache.set(hex, entry.label)
    }
  }
  return emojiNamesCache
}

// Strip comments, collapse whitespace, remove fixed dimensions and utility classes.
// viewBox is always preserved — that's what makes the art scale.
function normalise(svg, mode) {
  const flat = svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s*\n\s*/g, ' ')
    .trim()

  return flat.replace(/<svg([^>]*)>/, (_match, attrs) => {
    let next = attrs
      .replace(/\s+(width|height)="[^"]*"/g, '')
      .replace(/\s+class="[^"]*"/g, '')
    if (mode === 'inject-fill') {
      // Material Symbols SVGs have no fill attribute; inject currentColor on root.
      if (!/\sfill=/.test(next)) {
        next = ` fill="currentColor"${next}`
      }
    }
    return `<svg${next.trimEnd()}>`
  })
}

function humanise(slug) {
  return slug.replace(/[-_]/g, ' ').trim()
}

function toSlug(name) {
  // Material names use underscores; convert to hyphens. Strip anything that isn't a
  // valid slug character (healthicons ships a `!` in one filename).
  return name
    .replace(/_/g, '-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function slugFor(source, style, relativePath) {
  const rawName = path.basename(relativePath, '.svg')
  const name = toSlug(rawName)
  let slug
  if (source.qualifier === 'style') {
    slug = `${style.name}-${name}`
  } else if (source.qualifier === 'category') {
    const parts = path.dirname(relativePath).split(path.sep).filter((p) => p && p !== '.')
    const category = parts[0]
    slug = category ? `${toSlug(category)}-${name}` : name
  } else {
    slug = name
  }
  // Clean up any trailing hyphens from sanitised names.
  return slug.replace(/-+$/g, '')
}

function svgFilesIn(dir, filter) {
  const found = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      found.push(
        ...svgFilesIn(path.join(dir, entry.name), filter).map((p) =>
          path.join(entry.name, p)
        )
      )
    } else if (entry.name.endsWith('.svg')) {
      if (!filter || filter(entry.name)) {
        found.push(entry.name)
      }
    }
  }
  return found
}

function buildSource(source) {
  const root = packageDir(source.packageName)
  if (!root) {
    console.error(`${source.packageName} is not installed. Run pnpm install first.`)
    process.exit(1)
  }

  const icons = {}
  for (const style of source.styles) {
    const styleDir = path.join(root, style.dir)
    if (!fs.existsSync(styleDir)) {
      console.error(`Missing ${styleDir} for ${source.id}.`)
      process.exit(1)
    }
    for (const relativePath of svgFilesIn(styleDir, source.filter).sort()) {
      const slug = slugFor(source, style, relativePath)
      if (!SLUG_RE.test(slug)) {
        console.error(`Invalid slug "${slug}" in ${source.id} (${relativePath}).`)
        process.exit(1)
      }
      if (icons[slug]) {
        console.error(
          `Duplicate slug ${source.id}:${slug} (${relativePath}). Fix the qualifier.`
        )
        process.exit(1)
      }
      const markup = normalise(
        fs.readFileSync(path.join(styleDir, relativePath), 'utf8'),
        source.color
      )
      const rawName = path.basename(relativePath, '.svg')
      const label = source.labelFor ? source.labelFor(rawName) : humanise(rawName)
      icons[slug] = { m: markup, l: label }
    }
  }

  const count = Object.keys(icons).length
  if (count === 0) {
    console.error(`No icons found for ${source.id}.`)
    process.exit(1)
  }

  const { version } = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8')
  )
  const outFile = path.join(OUT_DIR, `${source.id}.json`)
  fs.writeFileSync(outFile, JSON.stringify({ icons }))

  const kb = Math.round(fs.statSync(outFile).size / 1024)
  console.log(
    `  ${source.label.padEnd(20)} ${String(count).padStart(5)} icons  ${String(kb).padStart(5)} kB` +
      `  ${source.packageName}@${version}`
  )
  return { id: source.id, label: source.label, licence: source.licence, version, count }
}

// undefined
fs.rmSync(OUT_DIR, { recursive: true, force: true })
fs.mkdirSync(OUT_DIR, { recursive: true })

console.log('Icon libraries:')
const index = SOURCES.map(buildSource)

// Lets the picker show every library with its count before fetching any of them.
fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index))

const total = index.reduce((sum, source) => sum + source.count, 0)
console.log(`  ${'total'.padEnd(20)} ${String(total).padStart(5)} icons -> ${OUT_DIR}/`)
