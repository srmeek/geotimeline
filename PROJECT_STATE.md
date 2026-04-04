# PROJECT_STATE.md

*Last Updated: 2026-04-04 (session 2)*

------------------------------------------------------------------------

# Current State Summary

Full rendering pipeline stable in vertical orientation. ICS 2024/12 data
(189 units). Dynamic zoom mode now default. This session added: auto-orient
block text to longer axis (live on zoom), resizable/styled column header row,
picks column improvements (no right border, auto-width, tick gap), removed
minimap, Subepoch and Age columns hidden by default, dynamic header height
that pushes chart content down automatically.

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
-   `buildScale()` is a pure function returning one of four scale impls.
-   `computeLayout()` accepts `initialOffset` (horizontal pixel offset,
    equals `MARGIN` constant = 14px).
-   Layered SVG groups inside zoomLayer: `backgroundLayer` → `blockLayer`
    → `picksLayer` → `gsspLayer`.

## Counter-Scale

-   `applyCounterScale(k)` is a stable `useCallback(fn, [])` defined in
    App() scope, closed over `svgRef` only.
-   Block label text elements carry `data-block-w`, `data-block-h`,
    `data-label`, `data-user-font-size`, `data-font-family`,
    `data-label-orient` attributes.
-   `data-label-orient` stores `"auto"` | `"horizontal"` | `"vertical"`.
    `"auto"` is resolved at render time AND at zoom time from current
    screen dimensions (wider → horizontal, taller → vertical).
-   On zoom, `applyCounterScale` re-runs `computeFitAndWrap` for each
    block label, re-resolves `"auto"` orientation, updates tspans,
    font-size, and rotate transform in-place.
-   Non-block text (tick labels, picks, GSSP markers) use the standard
    `data-base-font-size / k` path.

## Data Layer

-   `ALL_UNITS` and `UNIT_MAP` are module-level constants (built once).
-   `_initPrefs`, `_initUnitEdits`, `_initFromHash` are module-level IIFEs
    that parse `localStorage` / URL hash once on load.
-   `effectiveUnits` = `ALL_UNITS` with `unitEdits` overlaid — used everywhere.
-   `isUnitVisible(unitId, hiddenUnits)` walks ancestor chain.
-   `dynamicMinAge` / `dynamicMaxAge` derived from visible units.

## Header / Margin Architecture

-   `MARGIN = 14` — small fixed gap used only as horizontal layout offset
    and bottom SVG breathing room.
-   `effectiveMarginRef.current = headerHeight + 8` — updated every render
    in the component body. Used by: scale range (`[eM, height-eM]`),
    scroll sync forward/reverse formulas, zoom-mode conversion math.
-   All scroll sync closures read `effectiveMarginRef.current` at event
    time to avoid stale values.
-   Column header bar is an HTML overlay (`position: absolute, top: 0,
    height: headerHeight`). SVG fills 100% of sticky wrapper behind it.
    Content starts at `y = headerHeight + 8` inside SVG so nothing is
    hidden behind the header.

## Orientation

-   **Vertical only.** Young (0 Ma) at top, old at bottom.
-   Per-column orientation overrides stored in `columnConfig[].orientation`
    (null = auto). `"auto"` = align with the longer axis of each block's
    current screen dimensions; re-evaluated on every zoom event.

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

### Dynamic Mode (default)
-   No matrix transform — `visibleDomain` drives `buildScale()` each render.
-   Wheel zoom updates `visibleDomain`. Mouse drag pans axially and laterally.
-   Arrow keys shift `visibleDomain` (up/down) or `lateralOffset` (left/right).
-   Switching modes converts between representations (lateral offset preserved).

### Transform Mode
-   D3 zoom applies a matrix transform to zoomLayer `<g>`.
-   Counter-scale keeps text and strokes constant screen size.
-   Ctrl+wheel or drag to pan/zoom. Arrow keys pan 10% of viewport.

## ✅ Scroll Sync

-   Forward formula: `ty = eM*(1-k) - scrollTop*(viewH-2*eM)/viewH`
-   Reverse formula: `scrollTop = (eM*(1-k) - ty)*viewH/(viewH-2*eM)`
-   `eM = effectiveMarginRef.current = headerHeight + 8` (dynamic).
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

## ✅ Auto-Orient Text to Longer Axis

-   Block orientation default is `"auto"` (per-column override: `"horizontal"` |
    `"vertical"`).
-   `"auto"` resolves to horizontal when `screenW >= screenH`, else vertical.
-   Resolved in both `renderBlocks` (render time) and `applyCounterScale`
    (zoom time) — orientation can flip live as you zoom.
-   `data-label-orient = "auto"` stored in DOM so zoom handler re-resolves.
-   `rotate(-90)` transform added/removed as orientation flips.

## ✅ Per-Column Orientation and Font Size

-   `columnConfig[].orientation`: null (auto) | "horizontal" | "vertical"
-   `columnConfig[].fontSize`: null (use global) | number
-   Columns tab shows orientation dropdown and font size input per column.

## ✅ Column Header Row

-   **Resizable height**: drag the bottom edge of the header bar. State:
    `headerHeight` (default 48px, min 24px). Persisted to localStorage.
-   **Chart slides**: `effectiveMarginRef` = `headerHeight + 8`; render and
    scroll sync always use this, so the chart content always sits 8px below
    the header regardless of its height.
-   **Auto-rotate text**: when a column is too narrow for horizontal label,
    text switches to `writing-mode: vertical-rl`. Flips back when wide enough.
-   **Font controls**: header respects global `fontFamily`, `fontBold`,
    `fontItalic`, `fontUnderline`. Separate `headerFontSize` state (default
    13px, range 8–22px) in Display tab. Persisted.
-   **Column dividers**: `1px solid #ccc` on both left of first column and
    right of every column.

## ✅ Font Style (Bold / Italic / Underline)

-   `fontBold`, `fontItalic`, `fontUnderline` state; persisted to localStorage.
-   Applied as SVG attributes on all block label text elements.
-   Also applied to column header text.
-   Display tab checkboxes.

## ✅ Time-Interval Font Size Rules

-   `fontRules`: `[{ id, minAge, maxAge, fontSize }]`; persisted.
-   Block fontSize resolved: matching rule → colConf.fontSize → global fontSize.
-   Display tab UI: list of rules with age range + size inputs, add/remove.

## ✅ GSSP Markers

-   `showGSSP` toggle in Display tab (default off).
-   Renders `▶` in goldenrod (#DAA520) at each `ratifiedGSSP === true` boundary.
-   `data-base-font-size="8"` — participates in counter-scale automatically.

## ✅ Picks Column

-   Header label: "Picks (Ma)".
-   No right border (removed).
-   Auto-expands width: `_picksMinWidth` computed each render from canvas
    measurement of representative labels (accounts for sigFigs + uncertainty
    prefix/suffix). `effectiveColumnWidths.picks = max(stored, _picksMinWidth)`.
-   Tick-to-label gap: `rightMargin=4`, `tickLabelGap=12` (~double space).
-   Auto/manual boundary mode, uncertainty (±), approximate (~), sigFigs.
-   `formatAge` epsilon guard: `Math.floor(Math.log10(Math.abs(age)) + 1e-10)`.

## ✅ Tooltip on Block Hover (with edge clamping)

-   Tooltip flips left/above when within 260×90px of viewport right/bottom edge.
-   Block label `<text>` elements also carry `data-unit-id` (tooltip persists
    when cursor is over the label text, not just the rect).

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

## ✅ Export Tab

SVG download, PNG download, copy PNG to clipboard.

## ✅ localStorage Persistence

All UI preferences in `gt_prefs`; unit edits in `gt_unitEdits`.
Prefs include: timeUnit, columnConfig (with orientation/fontSize), columnWidths,
labelMode, contrastText, fontSize, fontFamily, labelOrientation, scaleType,
equalSizeLevel, picksMode, manualPicksLevel, showUncertainty, picksSigFigs,
hiddenUnits, showGSSP, fontBold, fontItalic, fontUnderline, fontRules,
headerHeight, headerFontSize.

## ✅ Filter Tab

Recursive tree, expand/collapse, ancestor-aware disabling, Show All reset.

## ✅ Data Editor Sidebar

Resizable, sortable, inline editing, color picker, yellow highlight for edits.

------------------------------------------------------------------------

# Known Issues

1.  **Picks rounding** — epsilon fix applied to `formatAge`, needs browser verify.
2.  **PNG export with external fonts** — canvas rasterization may not embed
    custom web fonts; system fonts (Arial etc.) are safe.
3.  **Counter-scale in dynamic mode** — font sizes are 1:1 (no matrix transform).
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
11. `effectiveMarginRef` must be read at call time in all scroll/zoom closures —
    do not capture `headerHeight` directly in long-lived closures.
12. `data-label-orient = "auto"` stored in DOM; `applyCounterScale` re-resolves
    orientation from current screen dimensions on each zoom event.

------------------------------------------------------------------------

# Next Session Plan

## Priority 1 — Highlight Block on Hover
-   Brighten/outline hovered block rect via `data-unit-id` (direct DOM mutation,
    no re-render needed).

## Priority 2 — Adaptive Tick Spacing
-   Tick intervals auto-adjust as zoom level changes (e.g. 1 Ma / 0.1 Ma
    when zoomed into the Cenozoic).

## Priority 3 — Named Zoom Shortcuts
-   Dropdown in View tab to jump to full extent, Phanerozoic, Cenozoic,
    Mesozoic, Paleozoic, Precambrian.

## Priority 4 — Double-Click Zoom
-   Double-click a block to zoom in to its age range.

------------------------------------------------------------------------

# Startup Prompt For Next Session

Paste this at the start of the next chat:

------------------------------------------------------------------------

GeoTimeline — Resume from 2026-04-04 session 2.
Stack: React 19 + D3 v7 + Vite. SVG-driven geologic timescale visualizer.
ICS 2024/12 data (189 units in src/data/geologicTime.json).
Dynamic zoom mode is default. Subepoch and Age columns hidden by default.

Architecture constraints (never break):
- Single useEffect owns all SVG construction (clear → rebuild). Never split.
- Second useEffect owns zoom/pan event binding.
- Third useEffect calls applyCounterScale(k) — must be declared after render effect.
- applyCounterScale is a stable useCallback(fn,[]) in App() scope; re-wraps block labels on zoom using data-block-* DOM attributes and computeFitAndWrap (exported from BlockRenderer.js).
- data-label-orient stores "auto"|"horizontal"|"vertical". "auto" is re-resolved from screen dimensions in both renderBlocks and applyCounterScale (rotate transform added/removed dynamically).
- Two more useEffects manage scrollbar ↔ zoom sync. MARGIN=14 (constant, horizontal only). effectiveMarginRef.current = headerHeight+8 (used for scale range and ALL scroll sync math). Read ref at call time — never capture in closures.
- Scroll sync formulas: forward ty = eM*(1-k) - scrollTop*(viewH-2*eM)/viewH; reverse scrollTop = (eM*(1-k)-ty)*viewH/(viewH-2*eM).
- Two localStorage save useEffects (gt_prefs, gt_unitEdits).
- buildScale() pure function: linear/log/equalSize(visible-only)/eraEqual.
- computeLayout() accepts initialOffset=MARGIN (horizontal). columnConfig items carry orientation and fontSize per-column.
- Layered SVG groups: backgroundLayer → blockLayer → picksLayer → gsspLayer.
- ALL_UNITS / UNIT_MAP module-level constants. _initPrefs / _initUnitEdits / _initFromHash module-level IIFEs.
- effectiveUnits = ALL_UNITS with unitEdits overlaid. isUnitVisible() walks ancestor chain.
- transformRef / visibleDomainRef / lateralOffsetRef hold latest values for closures.
- Block text elements carry data-block-w/h/label/user-font-size/font-family/label-orient for applyCounterScale.
- Block rects and label text both carry data-unit-id for hover tooltip.
- Vertical orientation only — horizontal code fully deleted.
- Column header: HTML overlay, position absolute, height=headerHeight (state, default 48, resizable). effectiveMarginRef keeps chart below header at all times.
- Picks column: no right border, auto-expands via _picksMinWidth canvas measurement, tickLabelGap=12.

Working features: dual zoom modes (dynamic default, lateral offset preserved on mode switch), arrow-key pan, URL share state (base64 hash), GSSP markers (▶ goldenrod), text wrapping + auto-shrink (5px minimum, never hidden), auto-orient to longer axis (live on zoom), per-column orientation override, per-column font size, bold/italic/underline, time-interval font size rules, import/export unit edits, tooltip with edge clamping, scroll sync, equalSize scale (visible-only units), four scale types, picks column (auto-width, no right border, double-space tick gap), data editor, filter tree, export tab, localStorage persistence, resizable styled column headers (auto-rotate text, font controls, column dividers).

Priority: Highlight block on hover, adaptive tick spacing, named zoom shortcuts, double-click zoom.

------------------------------------------------------------------------
