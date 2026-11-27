# Web app — design spec

The look and feel of the client, and the components to build its screens from.

## Reuse the components (spec)

Screens are assembled from the components in `src/components`, `src/board` and `src/editors`
(the inventory below). **Reach for an existing one first; do not hand-roll a parallel button,
field, dialog, fader or picker.**

If nothing fits, **do not quietly add a new primitive**: propose it first (what it is, which
screen needs it, where it would live) so the same gap is not filled twice, differently. A new
component either belongs in the inventory below or it is a composition of the ones that are —
never a second way to do what a primitive already does.

## Direction

A mixing desk on a dim game table: steady, tactile, low-light. Surfaces recede into one warm
dark ramp; a single amber lamp marks what is making sound right now; the interface stays out of
the way of the table.

## Colour

One warm, very low-saturation dark neutral ramp for every surface (`deep` → `page` → `card` →
`raised`), hairline borders, and three text roles (`ink`, `ink-2`, `ink-3`).

**One accent, lamp amber**, reserved for what is producing sound now — the lamp dot, a lit tile
border and icon, lit faders, one-shot progress — and for the focus ring. **Never for buttons.**
One off-white primary action per view; everything else a quieter variant. `danger` and `ok`
exist for errors and success.

Every token is a CSS custom property in `src/index.css` (Tailwind reads them; no config file).
Read the values there — do not copy them elsewhere.

## Type

- **Instrument Sans** for the interface.
- **Geist Mono** for bare numbers only (volume percent, counts, the storage figure). Text with
  words stays in the sans face.
- **Cinzel**, an inscriptional Roman face, for the product name only — it has no lowercase and
  sets the name in caps. Never for headings, labels or body.
- Weights **400 and 500** only. **Sentence case.** No exclamation marks, no trailing periods on
  labels.

## Space, shape, motion

- A **4px spacing grid**.
- Comfortable **touch targets**; small controls, larger cards, rounder dialogs.
- **One easing.** Animate **colour, opacity and transform only**. The only looping animation is
  a spinner; the one-shot progress bar is the only animated bar.
- Entrance animations use fill mode **`backwards`** — never `both` (see [`platform.md`](platform.md)).
- `prefers-reduced-motion` collapses animation and transition durations at the root.

## Icons

- **Interface icons**: the `Icon` component — a lucide glyph at the house size and stroke, in the
  colour of its text. Mode, kind and fallback glyphs are centralised in `components/kinds.ts`;
  read them from there, do not re-declare a glyph for a mode or kind.
- **Content illustrations** (what a tile shows): the icon picker / `Illustration` — never a bare
  lucide glyph.

## Tooltips

Never use the browser's native `title` attribute for a hover note. Every note goes through the
`Popover` component: a labeled control wraps in it directly, and an icon-only control that needs
a note is wrapped with `Popover wrap` with the button's `title` set to `undefined`, so the app's
own note is the only one.

## Component inventory

Reuse these. Primitives are in `components/ui.tsx`; the rest in `components/`, `board/` and
`editors/`.

### Primitives — `components/ui.tsx`

| Component | What it is |
| --- | --- |
| `Button` | Variants `primary` \| `secondary` \| `ghost` \| `danger`; optional `icon`, `busy` |
| `IconButton` | Icon-only, with a required accessible `label` |
| `Field` | Label + hint/error wrapper around an input |
| `TextInput`, `Select`, `SearchField` | The house text field, platform select and search field |
| `Segmented` | A small set of exclusive choices, shown at once |
| `Fader` | A volume slider; `lit` paints the fill in lamp |
| `Percent` | The value as tabular mono percent |
| `Lamp` | The signature lamp dot |
| `Spinner`, `ErrorNote` | Loading block and inline error |
| `EmptyState` | Icon, title, optional body and action for an empty list |
| `Icon`, `cx`, `useMedia` | The house icon, a class joiner, and a media-query hook |

### Layout, tiles and fields — `components/`, `board/`

| Component | What it is |
| --- | --- |
| `Page` | A list page: title, action, sticky search, filters, sort, pager |
| `QueryGate` | Loading / error / retry wrapper for a query |
| `Pagination` | The paged row (`pinned` for the fixed foot) |
| `Tile`, `TileGrid` | The tile frame and grid; board tiles wrap `Tile` |
| `SoundTile`, `MixTile`, `SceneTile` | The board tiles |
| `Illustration`, `Thumb` | Shows an item's image or icon |
| `IllustrationField`, `IconPicker` | Icon picker, image upload, "choose image" |
| `PickField`, `PickList` | Choose sounds/mixes/playlists/scenes (stacked dialog) |
| `SortControl`, `Disclosure`, `Menu`, `Popover` | Sort menu, folding section, menu, popover |
| `StorageMeter`, `Marquee`, `VirtualRows` | Storage bar, long-text carrier, virtualised rows |

### Sharing, tags, feedback

| Component | What it is |
| --- | --- |
| `OwnerOnly`, `OwnerNote` | Greyed-out fields for an added item, and its owner note |
| `UnpublishDialog`, `RemoveSoundDialog`, `AddMixDialog`, `RemoveMixDialog` | Library and visibility actions |
| `EditorFooter` | Save/cancel/delete foot, with confirmations |
| `TagFields`, `useTagsDraft`, `SynonymsField` | The per-item synonyms + categories block |
| `CategoryChip`, `CategoryFilter`, `CategoryDialog`, `CategoryField` | Categories |
| `AddedBadge`, `OwnerBadge`, `LicenseBadge`, `LicenseGlyphs` | Added-by count, sharer, license |
| `SoundDetails`, `MixContents` | Sound metadata, a mix's stack of pictures |
| `LimitFields`, `LicenseField`, `TextArea`, `VisibilityField` | Editor fields |
| `RulesEditor`, `RulesCard` | The server-rules text (lazy) and its read-only card |

### Dialogs and editors

| Component | What it is |
| --- | --- |
| `Dialog` | The dialog shell (stacks — see [`platform.md`](platform.md)) |
| `InstallDialog`, `TermsDialog`, `ChangelogDialog`, `ContactDialog`, `PrivacyDialog`, `CreditsDialog` | Product dialogs |
| `PausesDialog`, `ContactMessageDialog`, `UserDialog` | Random-gaps suggestions, a contact message, an admin user |
| `SoundEditor`, `MixEditor`, `SceneEditor` | The item editors |
| `LoopEditorDialog`, `UploadDialog` | The waveform loop editor, and the multi-file upload |

## Brand

The mark (a cartoon sword and a music note, in lamp amber and one shade darker) and the product
name live in `components/Brand.tsx`. The favicons, web app manifest icons and social preview are
drawn from the same geometry by `scripts/build-brand-assets.mjs`.
