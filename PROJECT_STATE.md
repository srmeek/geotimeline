# PROJECT_STATE.md

*Last Updated: 2026-04-05 (session 3)*

------------------------------------------------------------------------

# Current State Summary

Full rendering pipeline stable in vertical orientation. ICS 2024/12 data
(189 units). Dynamic zoom mode default. This session focused on zoom/pan
stability, GSSP/GSSA icon placement, Phanerozoic text orientation, zoom
speed progressivity, and a data fix for the Pridoli/Ludlow boundary.

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
-   Block label text elements carry `data-block-w`, `data-block-dw`,
    `data-block-h`, `data-label`, `data-user-font-size`, `data-font-family`,
    `data-label-orient` attributes.
-   `data-block-w` = orientation width (may include adjacent columns, e.g.
    Super-Eon for Phanerozoic). `data-block-dw` = actual drawn/painted width.
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

## Zoom / Pan Architecture (Dynamic Mode)

-   **Wheel zoom** (`ctrlKey` = true): synchronous — calls
    `setVisibleDomain([newMin, newMax])` and updates `visibleDomainRef.current`
    directly (no RAF batching). Prevents domain lag that caused jumping.
-   **Wheel pan** (`ctrlKey` = false): RAF-batched via `commitDomain()` for
    smooth scroll feel.
-   **Separate deltas**: pan delta = `deltaY * 4` (pixels mode); zoom delta =
    `deltaY * 1`. Previously both used the same 4× multiplier — zoom was 4× too fast.
-   **Progressive zoom speed**: `speedScale = (span/fullSpan)^0.6` compresses
    exponent at high zoom levels so each notch produces a proportionally
    smaller domain change at higher zoom.
-   **Focal age**: `focalAge = refMin + pct * span` where
    `pct = (cursorY - eM) / (h - 2*eM)`. This is exact for linear scale.
    `scale.invert` is NOT used because for equalSize/eraEqual scales the
    invert maps across ALL units (not just visible ones), biasing toward
    the youngest units at the top.
-   **Drag pan**: uses `d3.scaleLinear().domain([refMin,refMax]).range([eM,liveH-eM]).invert(eM-dy)`.
    Computes "what age was at pixel `eM-dy` in the frozen start domain."
    Correct for linear scale; approximate for non-linear.

## Orientation

-   **Vertical only.** Young (0 Ma) at top, old at bottom.
-   Per-column orientation overrides stored in `columnConfig[].orientation`
    (null = auto). `"auto"` = align with the longer axis of each block's
    current screen dimensions; re-evaluated on every zoom event.
-   **Phanerozoic `orientWidth`**: units without a visible parent (e.g.
    Phanerozoic) compute `orientWidth` anchored to the leftmost non-time/picks
    column, so the Super-Eon column width is included in the auto-orientation
    decision for that unit. `data-block-w` stores `orientWidth`,
    `data-block-dw` stores the actual drawn width.

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

**Known data fix this session:**
- **Ludlow `end`**: was `419.62` Ma (Pridoli's end) — corrected to `422.7` Ma
  (Ludfordian's end). This removed Ludlow's erroneous overlap with the Pridoli.
  `endUncertainty` corrected from `1.36` to `1.6` to match Ludfordian.

Parser: `scripts/parse-chart.cjs`. Re-running drops the 11 Subepoch units
and resets 15 re-parented daughter Ages — run post-parser patch after each
parser run.

------------------------------------------------------------------------

# Feature Status

## ✅ Dual Zoom Modes

### Dynamic Mode (default)
-   No matrix transform — `visibleDomain` drives `buildScale()` each render.
-   Wheel zoom (ctrl+scroll) updates `visibleDomain` synchronously.
-   Wheel pan (plain scroll) updates `visibleDomain` via RAF batch.
-   Mouse drag pans axially (time) and laterally (columns).
-   Arrow keys shift `visibleDomain` (up/down) or `lateralOffset` (left/right).
-   Switching modes converts between representations (lateral offset preserved).
-   Zoom speed progressively slows at higher zoom: `speedScale = (span/fullSpan)^0.6`.

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

## ✅ Time Axis Ticks

-   Always uses `d3.scaleLinear().ticks(40)` for regular intervals regardless
    of `scaleType`. Previously non-linear scales returned geological boundaries
    causing uneven tick spacing.

## ✅ Text Wrapping + Auto-Shrink (`BlockRenderer.js`)

-   `computeFitAndWrap(words, screenW, screenH, fontFamily, maxSize, minSize=5)`
    exported from `BlockRenderer.js`; greedy word-wrap + font-size shrink loop.
-   Labels **never hidden** — shrink to 5px minimum instead.
-   Multi-line horizontal labels use `<tspan>` elements centered at `labelY`.
-   Vertical labels: single line, rotated, size fitted to block height.
-   `data-block-w/dw/h/label/user-font-size/font-family/label-orient` stored on
    each text element so `applyCounterScale` can re-wrap on zoom.

## ✅ Auto-Orient Text to Longer Axis (with Phanerozoic fix)

-   Block orientation default is `"auto"` (per-column override: `"horizontal"` |
    `"vertical"`).
-   `"auto"` resolves to horizontal when `orientW >= screenH`, else vertical.
-   `orientW` uses `block.orientWidth` (may include adjacent columns for
    Phanerozoic) for the comparison; text fitting uses `block.width` (drawn).
-   Resolved in both `renderBlocks` (render time) and `applyCounterScale`
    (zoom time) — orientation can flip live as you zoom.

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

## ✅ GSSP / GSSA Markers

-   `showGSSP` toggle in Display tab (default off).
-   **GSSP**: renders `▶` in goldenrod (#DAA520) next to the picks column
    (at `picksColumn.end + 4`). Previously placed next to the time column.
-   **GSSA**: renders `⏱` in royal blue (#4169E1) at `picksColumn.end + 16`.
    New this session.
-   Both use `data-base-font-size="8"` and participate in counter-scale.

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

1.  **Zoom not anchoring to cursor** — Multiple approaches attempted this
    session. Current implementation uses `focalAge = refMin + pct * span`
    (linear interpolation in age-space), which is mathematically correct for
    linear scale. The focal age is preserved in the new domain. Root causes
    explored: RAF batching lag (fixed by making zoom synchronous), stale
    `scaleRef` (reverted — `scale.invert` for equalSize/eraEqual scales maps
    across ALL units, not just visible ones, biasing toward top), linear pan
    hardcoded in drag (was already correct). Zoom centering may still feel
    off at high zoom levels; investigate whether the perceived issue is visual
    jitter from React re-renders rather than math error.

2.  **Picks rounding** — epsilon fix applied to `formatAge`, needs browser verify.

3.  **PNG export with external fonts** — canvas rasterization may not embed
    custom web fonts; system fonts (Arial etc.) are safe.

4.  **Counter-scale in dynamic mode** — font sizes are 1:1 (no matrix transform).
    Intentional; document if ever questioned.

------------------------------------------------------------------------

# Known Data Considerations

-   **ICS 2024/12** data — current as of project start.
-   **Subepoch units**: 11 manually added; re-running parser drops them.
-   **Approximate boundaries**: 18 units with `startApproximate` / `endApproximate`.
-   **Ludlow end corrected**: 419.62 → 422.7 Ma (matched to Ludfordian child).
-   **Pridoli**: epoch (levelOrder 4) with no child ages; correctly spans into
    Epoch and Age columns via `spanColumns` logic. Now displays correctly after
    Ludlow fix.
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
13. For zoom focal age, do NOT use `scale.invert(cursorY)` for equalSize/eraEqual
    scale types — their invert maps across ALL units (not just visible domain),
    causing the focal age to be biased toward the youngest units. Use
    `refMin + pct * span` (linear interpolation in visible age-space) instead.
14. Zoom must be synchronous (`setVisibleDomain` directly, no RAF) so that
    consecutive wheel events each read the correct updated domain from
    `visibleDomainRef.current`.
15. Pan and zoom wheel deltas must be separated: pan uses 4× amplification,
    zoom does not (exponential zoom math is already sensitive).
16. `data-block-w` = orientWidth (for auto-orient decisions, may span adjacent
    columns); `data-block-dw` = drawn width (for text fitting).

------------------------------------------------------------------------

# Next Session Plan

## Priority 1 — Zoom Centering (Continued Investigation)
-   Current math is correct for linear scale. If issue persists, investigate
    whether React batching of `setVisibleDomain` during rapid wheel events
    causes the domain to lag by one call, and consider using `useReducer` or
    `flushSync` for immediate synchronous state commit.
-   Also check: is the issue only on trackpad (smooth scroll sends many small
    events) vs mouse wheel (discrete notches)?

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

GeoTimeline — Resume from 2026-04-05 session 3.
Stack: React 19 + D3 v7 + Vite. SVG-driven geologic timescale visualizer.
ICS 2024/12 data (189 units in src/data/geologicTime.json).
Dynamic zoom mode is default. Subepoch and Age columns hidden by default.

Architecture constraints (never break):
- Single useEffect owns all SVG construction (clear → rebuild). Never split.
- Second useEffect owns zoom/pan event binding (deps: [columnConfig, columnWidths, zoomMode]).
- Third useEffect calls applyCounterScale(k) — must be declared after render effect.
- applyCounterScale is a stable useCallback(fn,[]) in App() scope; re-wraps block labels on zoom using data-block-* DOM attributes and computeFitAndWrap (exported from BlockRenderer.js).
- data-label-orient stores "auto"|"horizontal"|"vertical". "auto" re-resolved from screen dimensions in both renderBlocks and applyCounterScale (rotate transform added/removed dynamically).
- data-block-w = orientWidth (for auto-orient, may include adjacent cols); data-block-dw = drawn width (for text fitting).
- Two more useEffects manage scrollbar ↔ zoom sync. MARGIN=14 (constant, horizontal only). effectiveMarginRef.current = headerHeight+8 (used for scale range and ALL scroll sync math). Read ref at call time — never capture in closures.
- Scroll sync formulas: forward ty = eM*(1-k) - scrollTop*(viewH-2*eM)/viewH; reverse scrollTop = (eM*(1-k)-ty)*viewH/(viewH-2*eM).
- Two localStorage save useEffects (gt_prefs, gt_unitEdits).
- buildScale() pure function: linear/log/equalSize(visible-only)/eraEqual.
- computeLayout() accepts initialOffset=MARGIN (horizontal). columnConfig items carry orientation and fontSize per-column.
- Layered SVG groups: backgroundLayer → blockLayer → picksLayer → gsspLayer.
- ALL_UNITS / UNIT_MAP module-level constants. _initPrefs / _initUnitEdits / _initFromHash module-level IIFEs.
- effectiveUnits = ALL_UNITS with unitEdits overlaid. isUnitVisible() walks ancestor chain.
- transformRef / visibleDomainRef / lateralOffsetRef hold latest values for closures.
- Block text elements carry data-block-w/dw/h/label/user-font-size/font-family/label-orient for applyCounterScale.
- Block rects and label text both carry data-unit-id for hover tooltip.
- Vertical orientation only — horizontal code fully deleted.
- Column header: HTML overlay, position absolute, height=headerHeight (state, default 48, resizable). effectiveMarginRef keeps chart below header at all times.
- Picks column: no right border, auto-expands via _picksMinWidth canvas measurement, tickLabelGap=12.

Zoom/pan (dynamic mode):
- Zoom (ctrlKey+wheel): SYNCHRONOUS — setVisibleDomain + visibleDomainRef.current directly, no RAF.
- Pan (plain wheel): RAF-batched via commitDomain().
- Separate deltas: panDelta = deltaY*4 (pixels), zoomDelta = deltaY*1.
- Progressive zoom speed: speedScale = (span/fullSpan)^0.6.
- Focal age: focalAge = refMin + pct*span (linear interpolation). Do NOT use scale.invert — equalSize/eraEqual invert maps across ALL units, biasing toward top.
- Drag pan: d3.scaleLinear().domain([refMin,refMax]).range([eM,liveH-eM]).invert(eM-dy).

Data notes:
- Ludlow end corrected: 419.62 → 422.7 Ma (endUncertainty 1.36 → 1.6).
- Pridoli (levelOrder 4, no child ages) now shows correctly and spans into Age column via spanColumns.
- GSSP markers (▶ goldenrod) and GSSA markers (⏱ royal blue) both placed at picksColumn.end + offset.

Working features: dual zoom modes, progressive zoom speed, synchronous zoom, arrow-key pan, URL share state (base64 hash), GSSP+GSSA markers (next to picks column), text wrapping + auto-shrink (5px min), auto-orient to longer axis (live on zoom, Phanerozoic uses orientWidth), per-column orientation/font override, bold/italic/underline, time-interval font rules, import/export unit edits, tooltip with edge clamping, scroll sync, four scale types, picks column (auto-width, no right border), data editor, filter tree, export tab, localStorage persistence, resizable column headers, linear time axis ticks.

Known issue: zoom centering on cursor not yet fully resolved. Math is correct for linear scale (focalAge = refMin + pct*span); investigate React batching or trackpad smooth-scroll as next step.

Priority next session: resolve zoom centering, then highlight block on hover, adaptive tick spacing, named zoom shortcuts, double-click zoom.

------------------------------------------------------------------------
