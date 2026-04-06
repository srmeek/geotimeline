# PROJECT_STATE.md

*Last Updated: 2026-04-05 (session 3)*

------------------------------------------------------------------------

# Current State Summary

Full rendering pipeline stable in vertical orientation. ICS 2024/12 data
(189 units). Dynamic zoom mode default. This session focused on zoom/pan
stability, GSSP/GSSA icon placement, Phanerozoic text orientation, zoom
speed progressivity, and a data fix for the Pridoli/Ludlow boundary.
A canvas-based rendering architecture has been decided upon to replace the SVG rendering pipeline, enabling 60fps zoom performance.

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

# Architectural Decision — Canvas Migration

## Decision
Replace the SVG-based rendering pipeline with an HTML5 Canvas rendering pipeline to achieve 60fps zoom performance. The screen will render to a `<canvas>` element via a `requestAnimationFrame` loop. SVG export will be preserved as a separate on-demand rendering pass.

## Motivation
Dynamic mode rebuilds the entire SVG DOM on every zoom event (~189 units × multiple elements each), taking 20–50ms per frame. This makes smooth 60fps zoom physically impossible regardless of JavaScript optimizations. Canvas redraws the same content in 2–5ms, well within the 16ms frame budget.

## What stays unchanged
- All React state (visibleDomain, columnWidths, columnConfig, hiddenUnits, etc.)
- All refs (visibleDomainRef, effectiveMarginRef, lateralOffsetRef, etc.)
- `buildScale()` — pure JS, no DOM involvement, unchanged
- `computeLayout()` — pure JS, unchanged
- All UI panels, sidebar, settings tabs, data editor
- HTML overlay elements (column headers, resize handles, tooltip)
- URL hash state sync, localStorage persistence
- All zoom/pan math (focal age, clamp, pan delta, etc.)

## What changes
- SVG element → `<canvas>` element
- Single render `useEffect` (SVG teardown/rebuild) → `requestAnimationFrame` loop reading refs directly
- `applyCounterScale` system → deleted entirely (canvas redraws from scratch each frame, no counter-scale needed)
- `setVisibleDomain` during zoom gestures → deleted (rAF loop reads `visibleDomainRef.current` directly, no React re-render during gesture)
- `flushSync` → deleted
- `BlockRenderer.js` SVG rendering → canvas drawing functions
- `PicksRenderer.js` SVG rendering → canvas drawing functions
- SVG export → separate on-demand `renderToSVG()` pass using existing SVG construction logic

## Zoom architecture after migration
```js
// On every wheel event — this is the entire zoom handler:
visibleDomainRef.current = [newMin, newMax];
// rAF loop picks it up next frame. No setState. No re-render.
```

The rAF loop runs continuously:
```js
requestAnimationFrame(() => {
  const scale = buildScale(visibleDomainRef.current, ...);
  const layout = computeLayout(...);
  drawFrame(ctx, scale, layout, stateRefs);
});
```

## Migration phases

### Phase 1 — Canvas foundation + working zoom (current priority)
- Replace `<svg>` with `<canvas>` in the JSX
- Wire up `requestAnimationFrame` loop
- Port block rectangle drawing (colors, borders) — no text yet
- Port zoom/pan wheel handler to write refs only, no setState during gesture
- Verify 60fps zoom with correct focal point before proceeding

### Phase 2 — Text rendering
- Port `computeFitAndWrap` to canvas (`ctx.measureText`, `ctx.fillText`)
- Auto-orient text (horizontal vs vertical) based on block dimensions
- Per-column font size overrides, bold/italic
- Font rules (time-interval overrides)

### Phase 3 — Picks column + time axis
- Port picks column drawing (tick marks, labels, uncertainty)
- Port time axis (major/minor ticks, dynamic spacing)
- Adaptive tick spacing (now trivial — just redraw each frame)

### Phase 4 — Overlays and finishing
- GSSP/GSSA markers
- Tooltip hit testing (maintain bounding box list per frame)
- Contrast text logic
- High-DPI canvas setup (`devicePixelRatio` scaling)

### Phase 5 — SVG export
- `renderToSVG(visibleDomain, layout, state)` function — constructs an offscreen SVG programmatically
- Matches canvas output exactly
- PNG export via `canvas.toBlob()` (already works)
- Option to export current view or full extent

## Architecture lessons (carry forward into canvas migration)
1. `buildScale()` and `computeLayout()` are pure — pass their output into draw functions, never call them inside draw functions with side effects.
2. All zoom/pan state lives in refs during gestures, React state only for settled view.
3. `effectiveMarginRef` must be read at draw time, not captured in closures.
4. Hit testing: maintain `hitBoxes = []` array, populated each frame by draw functions, queried on `mousemove`.
5. High-DPI: set `canvas.width = clientWidth * devicePixelRatio`, `ctx.scale(dpr, dpr)` once after resize.
6. The rAF loop must be cancelled on component unmount.
7. React state changes (settings, column widths, etc.) are picked up automatically each frame — no special handling needed.

## Known issues carried forward (to fix during migration)
1. Zoom focal point drift — will be resolved naturally by Phase 1 (no setState during gesture).
2. Non-linear scale focal point mismatch — Phase 1 allows using `buildScale().invert()` correctly since the scale is rebuilt every frame anyway.
3. Picks rounding — carry forward to Phase 3.
4. PNG export with external fonts — carry forward to Phase 5.

------------------------------------------------------------------------

# Startup Prompt For Next Session

Paste this at the start of the next chat:

------------------------------------------------------------------------

GeoTimeline — Canvas migration, Phase 1.
Stack: React 19 + D3 v7 + Vite. SVG-driven geologic timescale visualizer being migrated to Canvas rendering for 60fps zoom.
ICS 2024/12 data (189 units in src/data/geologicTime.json).

Goal for this session: Replace SVG rendering with a Canvas + requestAnimationFrame pipeline. Get block rectangles drawing correctly with fluid 60fps zoom before adding text or other detail.

See PROJECT_STATE.md — "Architectural Decision — Canvas Migration" for full plan, what changes, what stays the same, and phase breakdown.

Architecture constraints (never break):
- buildScale() and computeLayout() are pure functions — keep them that way.
- All React state and refs are unchanged — canvas reads from refs directly in the rAF loop.
- No setState during zoom gestures — visibleDomainRef.current only.
- Single rAF loop owns all canvas drawing. Never split.
- effectiveMarginRef.current = headerHeight + 8 — read at draw time.
- HTML overlays (column headers, resize handles, tooltip) stay as-is.

------------------------------------------------------------------------
