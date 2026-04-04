# PROJECT_STATE.md

*Last Updated: 2026-04-04 (major feature session)*

------------------------------------------------------------------------

# Current State Summary

Full rendering pipeline stable in vertical orientation. ICS 2024/12 data
(189 units). Dual zoom modes, four scale types, data editor, filter tree,
scroll sync — all working. This session added: text wrapping + auto-shrink,
per-column orientation/font-size, bold/italic/underline, time-interval font
size rules, GSSP markers, import/export edits, keyboard arrow navigation,
URL share state, and a minimap overview panel. Several bugs were also fixed
(scroll sync math, lateral offset on mode switch, tooltip edge clamping,
equalSize scale visibility).

------------------------------------------------------------------------

# Architecture Overview

## Rendering Pipeline

-   Single `useEffect` owns all SVG construction (clear → rebuild).
-   Second `useEffect` owns zoom/pan event binding, tears down cleanly.
-   Third `useEffect` re-applies counter-scale after each render
    — **must be declared after the render effect** (React runs effects
    in declaration order).
-   Two more `useEffect`s manage scrollbar ↔ zoom state sync.
-   Two more `useEffect`s persist preferences to `localStorage`.
-   After those: minimap drawing useEffect, minimap click useEffect.
-   `buildScale()` is a pure function returning one of four scale impls.
-   `computeLayout()` accepts `initialOffset` so columns start after the
    `MARGIN` header zone.
-   Layered SVG groups inside zoomLayer: `backgroundLayer` → `blockLayer`
    → `picksLayer` → `gsspLayer`.

## Counter-Scale

-   `applyCounterScale(k)` is a stable `useCallback(fn, [])` defined in
    App() scope, closed over `svgRef` only.
-   Block label text elements carry `data-block-w`, `data-block-h`,
    `data-label`, `data-user-font-size`, `data-font-family`,
    `data-label-orient` attributes.
-   On zoom, `applyCounterScale` re-runs `computeFitAndWrap` for each
    block label using current screen dimensions (blockDim × k), updates
    tspans and font-size in-place.
-   Non-block text (tick labels, picks, GSSP markers) use the standard
    `data-base-font-size / k` path.
-   The counter-scale useEffect and the D3 zoom callback both call the
    same `applyCounterScale`.

## Data Layer

-   `ALL_UNITS` and `UNIT_MAP` are module-level constants (built once).
-   `_initPrefs`, `_initUnitEdits`, `_initFromHash` are module-level IIFEs
    that parse `localStorage` / URL hash once on load.
-   `effectiveUnits` = `ALL_UNITS` with `unitEdits` overlaid — used everywhere.
-   `isUnitVisible(unitId, hiddenUnits)` walks ancestor chain.
-   `dynamicMinAge` / `dynamicMaxAge` derived from visible units.

## Orientation

-   **Vertical only.** Young (0 Ma) at top, old at bottom.
-   Horizontal orientation code fully deleted.
-   Per-column orientation overrides stored in `columnConfig[].orientation`
    (null = auto). Auto default: levels 0–3 → vertical, 4+ → horizontal.

------------------------------------------------------------------------

# Data File

`src/data/geologicTime.json` — ICS 2024/12, 178 units + 11 manually-added
Subepoch units = **189 total**.

**Fields per unit:**

| Field                      | Coverage    | Notes                                                           |
|----------------------------|-------------|-----------------------------------------------------------------|
| `startUncertainty`         | 104 / 178   | null for Cenozoic and Precambrian units                         |
| `startApproximate`         | 18 / 178    | `true` = `skos:note "uncertain"` on start boundary             |
| `endUncertainty`           | 102 / 178   |                                                                 |
| `endApproximate`           | 18 / 178    |                                                                 |
| `ratifiedGSSP`             | 130 / 178   | `true` = has ratified GSSP                                      |
| `ratifiedGSSA`             | 19 / 178    |                                                                 |
| `shortCode`                | 178 / 178   | CGMW short codes                                               |
| `order`                    | 178 / 178   |                                                                 |
| `displayNameStratigraphic` | 15 / 178    | Only set when stratigraphic name differs from timescale name    |

Parser: `scripts/parse-chart.cjs`. Re-running drops the 11 Subepoch units
and resets 15 re-parented daughter Ages — run post-parser patch after each
parser run.

------------------------------------------------------------------------

# Feature Status

## ✅ Dual Zoom Modes

### Transform Mode (default)
-   D3 zoom applies a matrix transform to zoomLayer `<g>`.
-   Counter-scale keeps text and strokes constant screen size.
-   Ctrl+wheel or drag to pan/zoom. Arrow keys pan 10% of viewport.

### Dynamic Mode
-   No matrix transform — `visibleDomain` drives `buildScale()` each render.
-   Wheel zoom updates `visibleDomain`. Mouse drag pans axially and laterally.
-   Arrow keys shift `visibleDomain` (up/down) or `lateralOffset` (left/right).
-   Switching modes converts between representations (lateral offset preserved).

## ✅ Scroll Sync (corrected)

-   Forward formula: `ty = MARGIN*(1-k) - scrollTop*(viewH-2*MARGIN)/viewH`
-   Reverse formula: `scrollTop = (MARGIN*(1-k) - ty)*viewH/(viewH-2*MARGIN)`
-   Both anchored so timeline top = scrollTop=0 and bottom = scrollTop=max.

## ✅ Time Scale Types

Linear, Log, Equal Size (visible-only units), Era Equal.

## ✅ Text Wrapping + Auto-Shrink (`BlockRenderer.js`)

-   `computeFitAndWrap(words, screenW, screenH, fontFamily, maxSize, minSize=5)`
    exported from `BlockRenderer.js`; greedy word-wrap + font-size shrink loop.
-   Labels **never hidden** — shrink to 5px minimum instead.
-   Multi-line horizontal labels use `<tspan>` elements centered at `labelY`.
-   Vertical labels: single line, rotated, size fitted to block height.
-   `data-block-w/h/label/user-font-size/font-family/label-orient` stored on
    each text element so `applyCounterScale` can re-wrap on zoom.

## ✅ Per-Column Orientation and Font Size

-   `columnConfig[].orientation`: null (auto) | "horizontal" | "vertical"
-   `columnConfig[].fontSize`: null (use global) | number
-   Auto default: levels 0–3 (Supereon/Eon/Era/Period) → vertical; 4+ → horizontal.
-   Columns tab shows orientation dropdown and font size input per column.

## ✅ Font Style (Bold / Italic / Underline)

-   `fontBold`, `fontItalic`, `fontUnderline` state; persisted to localStorage.
-   Applied as SVG attributes on all block label text elements.
-   Display tab checkboxes.

## ✅ Time-Interval Font Size Rules

-   `fontRules`: `[{ id, minAge, maxAge, fontSize }]`; persisted.
-   Block fontSize resolved: matching rule → colConf.fontSize → global fontSize.
-   Display tab UI: list of rules with age range + size inputs, add/remove.

## ✅ GSSP Markers

-   `showGSSP` toggle in Display tab (default off).
-   Renders `▶` in goldenrod (#DAA520) at each `ratifiedGSSP === true` boundary.
-   `data-base-font-size="8"` — participates in counter-scale automatically.

## ✅ Tooltip on Block Hover (with edge clamping)

-   Tooltip flips left/above when within 260×90px of viewport right/bottom edge.
-   Block label `<text>` elements also carry `data-unit-id` (tooltip persists
    when cursor is over the label text, not just the rect).

## ✅ Minimap

-   55px canvas on right edge; shows Era + Period ICS color blocks.
-   Blue translucent rectangle indicates current viewport.
-   Click to center view on that age (both zoom modes).
-   `showMinimap` toggle in View tab; persisted.

## ✅ URL Share State

-   `_initFromHash` IIFE decodes base64 JSON from `window.location.hash`.
-   State encoded: `zoomMode`, `currentTransform {k,x,y}`, `visibleDomain`,
    `lateralOffset`, `hiddenUnits`.
-   Debounced `replaceState` (300ms) writes hash on every view change.
-   Hash values override localStorage on load.

## ✅ Keyboard Navigation

-   Arrow Up/Down: pan 10% of visible span along time axis.
-   Arrow Left/Right: pan 10% of SVG width laterally.
-   Ctrl+=/+/-: zoom in/out (existing).
-   Works in both zoom modes.

## ✅ Import / Export Unit Edits

-   **Export Edits**: downloads `geotimeline-edits.json`.
-   **Import Edits**: file picker merges parsed JSON into `unitEdits` state.
-   Buttons in Data tab alongside existing Reset All Edits.

## ✅ Picks Column

-   Auto/manual boundary mode, uncertainty (±), approximate (~), sigFigs.
-   `formatAge` epsilon guard: `Math.floor(Math.log10(Math.abs(age)) + 1e-10)`.
-   Font size tracks global `fontSize` and counter-scale. ⚠️ Needs browser verify.

## ✅ Export Tab

SVG download, PNG download, copy PNG to clipboard.

## ✅ localStorage Persistence

All UI preferences in `gt_prefs`; unit edits in `gt_unitEdits`.
Prefs include: timeUnit, columnConfig (with orientation/fontSize), columnWidths,
labelMode, contrastText, fontSize, fontFamily, labelOrientation, scaleType,
equalSizeLevel, picksMode, manualPicksLevel, showUncertainty, picksSigFigs,
hiddenUnits, showMinimap, showGSSP, fontBold, fontItalic, fontUnderline, fontRules.

## ✅ Filter Tab

Recursive tree, expand/collapse, ancestor-aware disabling, Show All reset.

## ✅ Data Editor Sidebar

Resizable, sortable, inline editing, color picker, yellow highlight for edits.

------------------------------------------------------------------------

# Known Issues

1.  **Picks rounding** — epsilon fix applied to `formatAge`, needs browser verify.
2.  **Minimap canvas height** — reads `offsetHeight` at draw time; may be 0 on
    first paint before layout. A `ResizeObserver` may be needed if blank on load.
3.  **PNG export with external fonts** — canvas rasterization may not embed
    custom web fonts; system fonts (Arial etc.) are safe.
4.  **Counter-scale in dynamic mode** — font sizes are 1:1 (no matrix transform).
    Intentional; document if ever questioned.

------------------------------------------------------------------------

# Known Data Considerations

-   **ICS 2024/12** data — current as of project start.
-   **Subepoch units**: 11 manually added; re-running parser drops them.
-   **Approximate boundaries**: 18 units with `startApproximate` / `endApproximate`.
-   ICS chart GitHub repo cloned at `C:\Users\scott.meek\Documents\ics-chart`.

------------------------------------------------------------------------

# Architecture Lessons (Carry Forward)

1.  Single render useEffect — never split.
2.  Zoom mode switching must convert state, not reset.
3.  `isScrollSyncing` ref prevents scroll↔zoom feedback loops.
4.  `transformRef` / `visibleDomainRef` / `lateralOffsetRef` prevent stale closures.
5.  Counter-scale useEffect declared **after** render useEffect.
6.  `applyCounterScale` must be a stable reference (useCallback(fn,[])) so
    the zoom useEffect closure always calls the current version.
7.  `data-block-*` attributes on text elements decouple render-time layout from
    zoom-time re-layout — the DOM is the source of truth for re-wrap.
8.  Block label text and its parent rect both need `data-unit-id` for tooltip.
9.  `computeFitAndWrap` is module-level in BlockRenderer.js and exported for
    reuse in `applyCounterScale`.
10. Structural changes must be introduced in minimal deltas.

------------------------------------------------------------------------

# Next Session Plan

## Priority 1 — Browser Verification
-   Verify all new features end-to-end in browser.
-   Specifically: Picks rounding fix, font-size-shift on sigFigs change,
    minimap canvas height on first paint, URL hash round-trip.

## Priority 2 — Highlight Block on Hover
-   Brighten/outline hovered block rect via `data-unit-id` (direct DOM mutation,
    no re-render needed).

## Priority 3 — Adaptive Tick Spacing
-   Tick intervals auto-adjust as zoom level changes (e.g. 1 Ma / 0.1 Ma
    when zoomed into the Cenozoic).

## Priority 4 — Named Zoom Shortcuts
-   Dropdown in View tab to jump to full extent, Phanerozoic, Cenozoic,
    Mesozoic, Paleozoic, Precambrian.

## Priority 5 — Double-Click Zoom
-   Double-click a block to zoom in to its age range.

------------------------------------------------------------------------

# Startup Prompt For Next Session

Paste this at the start of the next chat:

------------------------------------------------------------------------

GeoTimeline — Resume from 2026-04-04 state.
Stack: React 19 + D3 v7 + Vite. SVG-driven geologic timescale visualizer.
ICS 2024/12 data (189 units in src/data/geologicTime.json).

Architecture constraints (never break):
- Single useEffect owns all SVG construction (clear → rebuild). Never split.
- Second useEffect owns zoom/pan event binding.
- Third useEffect calls applyCounterScale(k) — must be declared after render effect.
- applyCounterScale is a stable useCallback(fn,[]) in App() scope; re-wraps block labels on zoom using data-block-* DOM attributes and computeFitAndWrap (exported from BlockRenderer.js).
- Two more useEffects manage scrollbar ↔ zoom sync (corrected math: ty = MARGIN*(1-k) - scrollTop*(viewH-2*MARGIN)/viewH).
- Two localStorage save useEffects (gt_prefs, gt_unitEdits). Then minimap draw + click useEffects.
- buildScale() pure function: linear/log/equalSize(visible-only)/eraEqual.
- computeLayout() accepts initialOffset. columnConfig items carry orientation and fontSize per-column.
- Layered SVG groups: backgroundLayer → blockLayer → picksLayer → gsspLayer.
- ALL_UNITS / UNIT_MAP module-level constants. _initPrefs / _initUnitEdits / _initFromHash module-level IIFEs.
- effectiveUnits = ALL_UNITS with unitEdits overlaid. isUnitVisible() walks ancestor chain.
- transformRef / visibleDomainRef / lateralOffsetRef hold latest values for closures.
- Block text elements carry data-block-w/h/label/user-font-size/font-family/label-orient for applyCounterScale.
- Block rects and label text both carry data-unit-id for hover tooltip.
- Vertical orientation only — horizontal code fully deleted.

Working features: dual zoom modes (lateral offset preserved on mode switch), arrow-key pan, URL share state (base64 hash), minimap (55px canvas, click to navigate), GSSP markers (▶ goldenrod), text wrapping + auto-shrink (5px minimum, never hidden), per-column orientation (levels 0–3 default vertical), per-column font size, bold/italic/underline, time-interval font size rules, import/export unit edits, tooltip with edge clamping, scroll sync (corrected math), equalSize scale (visible-only units), four scale types, picks column, data editor, filter tree, export tab, localStorage persistence.

Known issues: Picks rounding epsilon fix unverified in browser. Minimap canvas height may read 0 on first paint.

Priority: Browser-verify all new features. Then: highlight block on hover, adaptive tick spacing, named zoom shortcuts, double-click zoom.

------------------------------------------------------------------------
