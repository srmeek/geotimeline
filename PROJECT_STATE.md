# PROJECT_STATE.md

*Last Updated: 2026-04-06 (session 4)*

------------------------------------------------------------------------

# Current State Summary

Full rendering pipeline stable in canvas (dynamic) mode. ICS 2024/12 data
(189 units). Dynamic zoom mode default. Canvas migration is complete through
Phase 5. All rendering, export, and interaction features now work in dynamic
mode. SVG/transform mode is preserved as a fallback.

------------------------------------------------------------------------

# Architecture Overview

## Rendering Pipeline

-   **Dynamic mode (default)**: `requestAnimationFrame` loop calls `drawFrame`
    (a `useCallback`) every frame. Reads all state from refs — no React
    re-render during gestures.
-   **Transform mode (fallback)**: Single `useEffect` owns all SVG construction
    (clear → rebuild). Second `useEffect` owns zoom/pan event binding, tears
    down cleanly. Third `useEffect` re-applies counter-scale after each render.
-   Two more `useEffect`s manage scrollbar ↔ zoom state sync.
-   Two more `useEffect`s persist preferences to `localStorage`.
-   `buildScale()` is a pure function returning one of four scale impls.
-   `computeLayout()` accepts `initialOffset` (horizontal pixel offset,
    equals `MARGIN` constant = 14px).
-   Layered SVG groups (transform mode): `backgroundLayer` → `blockLayer`
    → `picksLayer` → `gsspLayer`.

## Canvas drawFrame Architecture

-   `drawFrame` is a `useCallback` that schedules itself via `requestAnimationFrame`.
-   Reads refs directly: `visibleDomainRef`, `effectiveMarginRef`,
    `lateralOffsetRef`, `scrollContainerRef` (for viewport height).
-   Render order: white background → hierarchy blocks → time axis → picks
    → GSSP/GSSA markers.
-   Accumulates `hitBoxes = []` per frame; written to `hitBoxesRef.current`
    at frame end for mousemove hit testing.
-   `BOTTOM_MARGIN = 8` — fixed constant for the bottom of the scale range.
    Declared in the component body so drawFrame and event handlers share it.

## Viewport Height Fix

-   **Bug**: `canvas.clientHeight` returned the full scrollable extent
    (e.g. 5000px when zoomed) because the canvas is inside a sticky wrapper
    inside a tall spacer div. Scale was mapping [vMin, vMax] across 5000px
    but only the top ~800px (the viewport) was visible.
-   **Fix**: `viewH = scrollContainerRef.current?.clientHeight ?? cssH` is
    used for all drawing. `canvas.clientHeight` (cssH) is kept only for
    resizing the backing store.
-   **Same fix applied to wheel and pan handlers**: `h` and `liveH` also
    read from `scrollContainerRef` so focal-age pct, agePerPx, and pan
    refScale all use viewport pixels, not full canvas pixels.

## Counter-Scale (Transform Mode Only)

-   `applyCounterScale(k)` is a stable `useCallback(fn, [])` defined in
    App() scope, closed over `svgRef` only.
-   Block label text elements carry `data-block-w`, `data-block-dw`,
    `data-block-h`, `data-label`, `data-user-font-size`, `data-font-family`,
    `data-label-orient` attributes.
-   Not used in dynamic mode — canvas redraws from scratch each frame.

## Data Layer

-   `ALL_UNITS` and `UNIT_MAP` are module-level constants (built once).
-   `_initPrefs`, `_initUnitEdits`, `_initFromHash` are module-level IIFEs
    that parse `localStorage` / URL hash once on load.
-   `effectiveUnits` = `ALL_UNITS` with `unitEdits` overlaid — used everywhere.
-   `isUnitVisible(unitId, hiddenUnits)` walks ancestor chain.
-   `dynamicMinAge` / `dynamicMaxAge` derived from visible units.

## Header / Margin Architecture

-   `MARGIN = 14` — small fixed gap used only as horizontal layout offset.
-   `effectiveMarginRef.current = headerHeight + 8` — **top margin only**.
    Updated every render in the component body.
-   `BOTTOM_MARGIN = 8` — fixed bottom margin constant, independent of
    header height. Declared in the component body alongside effectiveMarginRef.
-   Scale range: `[eM, viewH - BOTTOM_MARGIN]`. Previously used `[eM, viewH - eM]`
    which caused the bottom of the scale to shift when header height changed.
-   All scroll sync closures read `effectiveMarginRef.current` at event time.

## Zoom / Pan Architecture (Dynamic Mode)

-   **Wheel zoom** (`ctrlKey` = true): synchronous — updates `visibleDomainRef`
    directly (no RAF batching). `h = scrollContainerRef.current.clientHeight`
    for correct pct / focal age calculation.
-   **Wheel pan** (`ctrlKey` = false): RAF-batched via `commitDomain()`.
    `agePerPx = span / (h - eM - BOTTOM_MARGIN)` using viewport height.
-   **Drag pan**: `refScale.range([eM, liveH - BOTTOM_MARGIN])` using viewport
    height. Computes "what age was at pixel `eM - dy`."
-   **Progressive zoom speed**: `speedScale = (span/fullSpan)^0.2`.
-   **Focal age**: `focalAge = refMin + pct * span` where
    `pct = (cursorY - eM) / (h - eM - BOTTOM_MARGIN)`.

## Hit Testing (Tooltip)

-   `hitBoxesRef = useRef([])` — populated each frame by drawFrame with
    `{ id, x, y, w, h }` for every visible block.
-   Canvas `onMouseMove` searches `hitBoxesRef.current` for the hit block,
    sets `hoverUnit` and `tooltipPos` state.
-   Tooltip JSX is shared between dynamic and transform modes.

## Export Architecture

-   **PNG (dynamic mode)**: `buildCanvasPNGBlob(callback)` — creates an
    offscreen canvas cropped to viewport height, uses `drawImage` with
    explicit source rect to copy only the rendered area from the tall
    backing store. CSS pixel resolution output.
-   **PNG (transform mode)**: `renderSVGtoPNGBlob` — SVG → Image → canvas
    → blob (unchanged).
-   **SVG (dynamic mode)**: `buildSVGForExport()` — constructs a self-contained
    offscreen SVG from current view state. Runs the full pipeline:
    `renderTimeAxisTicks`, `renderBlocks`, `renderPicks`, GSSP/GSSA markers.
    Uses `visibleDomainRef` / `effectiveMarginRef` / `lateralOffsetRef` /
    `scrollContainerRef` at call time. Sets explicit `width`/`height` attrs.
-   **SVG (transform mode)**: serializes the live SVG element (unchanged).

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

**Known data fix (session 3):**
- **Ludlow `end`**: was `419.62` Ma (Pridoli's end) — corrected to `422.7` Ma.
  `endUncertainty` corrected from `1.36` to `1.6` to match Ludfordian.

Parser: `scripts/parse-chart.cjs`. Re-running drops the 11 Subepoch units
and resets 15 re-parented daughter Ages — run post-parser patch after each
parser run.

------------------------------------------------------------------------

# Feature Status

## ✅ Canvas Rendering Pipeline (Dynamic Mode)

### Phase 1 — Foundation
-   `<canvas>` element with rAF loop, backing store resized to `cssH * dpr`.
-   Block rectangles with colors and borders.
-   Jitter-free zoom: `visibleDomainRef` written directly during gestures;
    React state updated only after gesture settles.

### Phase 2 — Block Text Labels
-   `computeFitAndWrap` ported to canvas (`ctx.measureText`, `ctx.fillText`).
-   Auto-orient (horizontal vs vertical) based on block screen dimensions.
-   Per-column font size overrides; bold/italic; font rules (time-interval).
-   Contrast text logic (NTSC luma formula).

### Phase 3 — Picks Column + Time Axis
-   Time axis: major/minor ticks, adaptive density, label formatting.
-   Picks: auto/adaptive/manual modes, uncertainty (±), approximate (~),
    sigFigs, auto-expands column width.
-   Viewport height fix: `viewH = scrollContainerRef.current.clientHeight`
    used for scale range and all culling. Same fix in wheel/pan handlers.
-   Bottom margin fix: `BOTTOM_MARGIN = 8` constant keeps footer position
    fixed regardless of header height.

### Phase 4 — GSSP/GSSA Markers + Tooltip Hit Testing
-   GSSP: gold `▶` at `picksColumn.end + lateral + 4`, 8px font.
-   GSSA: blue `⏱` at `+12` offset.
-   Both respect `showGSSP` toggle and culling bounds.
-   `hitBoxesRef` populated each frame; canvas `onMouseMove` does hit
    testing and fires shared tooltip JSX.

### Phase 5 — Export
-   **SVG**: `buildSVGForExport()` constructs offscreen SVG from current
    view state using full rendering pipeline. Matches canvas output.
-   **PNG / Copy**: `buildCanvasPNGBlob()` crops backing store to viewport
    height. No SVG round-trip needed.

## ✅ Dual Zoom Modes

### Dynamic Mode (default)
-   No matrix transform — `visibleDomain` drives `buildScale()` each frame.
-   Wheel zoom (ctrl+scroll) updates domain synchronously.
-   Wheel pan (plain scroll) updates domain via RAF batch.
-   Mouse drag pans axially (time) and laterally (columns).
-   Arrow keys shift domain (up/down) or lateralOffset (left/right).
-   Switching modes converts between representations.
-   Progressive zoom speed: `speedScale = (span/fullSpan)^0.2`.

### Transform Mode
-   D3 zoom applies matrix transform to zoomLayer `<g>`.
-   Counter-scale keeps text and strokes constant screen size.
-   Ctrl+wheel or drag to pan/zoom. Arrow keys pan 10% of viewport.

## ✅ Scroll Sync

-   Forward formula: `ty = eM*(1-k) - scrollTop*(viewH-2*eM)/viewH`
-   Reverse formula: `scrollTop = (eM*(1-k) - ty)*viewH/(viewH-2*eM)`
-   `eM = effectiveMarginRef.current = headerHeight + 8` (top margin).

## ✅ Time Scale Types

Linear, Log, Equal Size (visible-only units), Era Equal.

## ✅ Time Axis Ticks

-   Always uses `d3.scaleLinear().ticks(40)` for regular intervals.
-   Adaptive major/minor tick density based on viewport height.

## ✅ Text Wrapping + Auto-Shrink (`BlockRenderer.js`)

-   `computeFitAndWrap` exported from `BlockRenderer.js`; used in both
    SVG (counter-scale) and canvas (drawFrame) paths.
-   Labels never hidden — shrink to 5px minimum.

## ✅ Auto-Orient Text, Per-Column Font Size, Font Rules

-   Per-column orientation: null (auto) | "horizontal" | "vertical".
-   Per-column fontSize; global font rules by age range.
-   `"auto"` resolves from current block screen dimensions each frame.

## ✅ Column Header Row

-   Resizable height (drag or slider, min 24px, default 48px).
-   `effectiveMarginRef = headerHeight + 8` — top margin only.
-   `BOTTOM_MARGIN = 8` — fixed bottom margin.
-   Auto-rotate text, separate font size control, persisted.

## ✅ GSSP / GSSA Markers

-   `showGSSP` toggle (toolbar button + Display tab).
-   **GSSP**: gold `▶` next to picks column.
-   **GSSA**: blue `⏱` at `+12` offset from GSSP.
-   Rendered in both canvas (drawFrame) and SVG export (buildSVGForExport).

## ✅ Picks Column

-   Auto/adaptive/manual boundary mode, uncertainty (±), approximate (~).
-   Auto-expands width; sigFigs control.

## ✅ Tooltip on Block Hover

-   Canvas mode: per-frame hitBoxes → mousemove hit test → shared tooltip JSX.
-   SVG mode: `data-unit-id` on rect/text elements → mousemove → same JSX.
-   Flips left/above near viewport edges (260×90px clearance).

## ✅ Export Tab

-   **Download SVG**: offscreen SVG in dynamic mode; serialized live SVG in
    transform mode.
-   **Download PNG**: cropped canvas blob in dynamic mode; SVG→canvas in
    transform mode.
-   **Copy PNG to Clipboard**: same routing as Download PNG.

## ✅ URL Share State

-   Base64 JSON in `window.location.hash`. Debounced `replaceState` (300ms).
-   Encodes: `zoomMode`, `currentTransform`, `visibleDomain`, `lateralOffset`,
    `hiddenUnits`.

## ✅ Keyboard Navigation

-   Arrow Up/Down: pan 10% of visible span. Arrow Left/Right: pan laterally.
-   Ctrl+=/+/-: zoom in/out.

## ✅ Import / Export Unit Edits, Data Editor Sidebar

## ✅ localStorage Persistence

All UI preferences in `gt_prefs`; unit edits in `gt_unitEdits`.

## ✅ Filter Tab, Left Panel, Settings Panel

------------------------------------------------------------------------

# Known Issues

1.  **Zoom not anchoring to cursor** — `focalAge = refMin + pct * span`
    (linear interpolation in age-space). Mathematically correct for linear
    scale; approximate for equalSize/eraEqual. May feel slightly off at
    high zoom on non-linear scales.

2.  **Picks rounding** — epsilon fix applied to `formatAge`; needs browser verify.

3.  **PNG export with external fonts** — canvas rasterization may not embed
    custom web fonts; system fonts (Arial etc.) are safe.

4.  **Scroll sync formula uses symmetric margin** — forward/reverse scroll
    sync formulas still use `2 * eM` (symmetric), but scale range now uses
    `eM + BOTTOM_MARGIN`. Minor inconsistency in transform mode scroll sync;
    not visible in practice since dynamic mode is the default.

------------------------------------------------------------------------

# Known Data Considerations

-   **ICS 2024/12** data — current as of project start.
-   **Subepoch units**: 11 manually added; re-running parser drops them.
-   **Ludlow end corrected**: 419.62 → 422.7 Ma.
-   ICS chart GitHub repo cloned at `C:\Users\scott.meek\Documents\ics-chart`.

------------------------------------------------------------------------

# Architecture Lessons (Carry Forward)

1.  Single render useEffect — never split (transform mode).
2.  Zoom mode switching must convert state, not reset.
3.  `isScrollSyncing` ref prevents scroll↔zoom feedback loops.
4.  `transformRef` / `visibleDomainRef` / `lateralOffsetRef` / `hitBoxesRef`
    prevent stale closures.
5.  Counter-scale useEffect declared **after** render useEffect.
6.  `applyCounterScale` must be a stable reference (useCallback(fn,[])).
7.  `data-block-*` attributes on text elements decouple render-time layout
    from zoom-time re-layout (transform mode only).
8.  Block label text and rect both need `data-unit-id` for SVG tooltip.
9.  `computeFitAndWrap` is module-level in BlockRenderer.js — shared by
    both SVG counter-scale and canvas drawFrame.
10. `effectiveMarginRef` must be read at call time in all closures.
11. `canvas.clientHeight` returns the full scrollable height (not viewport)
    when the canvas is inside a sticky wrapper in a tall spacer div. Always
    read viewport height from `scrollContainerRef.current.clientHeight`.
12. Separate top and bottom margins: `eM = headerHeight + 8` (top only);
    `BOTTOM_MARGIN = 8` (fixed). Using `eM` for both causes footer drift
    when header height changes.
13. For zoom focal age, use `refMin + pct * span` — do NOT use
    `scale.invert(cursorY)` for equalSize/eraEqual scale types.
14. Zoom must be synchronous (no RAF) so consecutive wheel events each
    read the correct updated domain.
15. Pan and zoom wheel deltas must be separated (pan uses 4× amplification).
16. `data-block-w` = orientWidth; `data-block-dw` = drawn width.
17. Canvas PNG export: use `drawImage` with explicit source rect to crop
    the tall backing store to viewport height. `toBlob()` on the full
    canvas would export 5000px of mostly-empty pixels.
18. SVG export from canvas state: `buildSVGForExport()` reads refs at
    call time — same pattern as drawFrame. Must set explicit `width`/
    `height` SVG attributes for clean serialization.

------------------------------------------------------------------------

# Architectural Decision — Canvas Migration

## Status: Complete (Phases 1–5)

All phases of the canvas migration are implemented. The SVG rendering
pipeline is retained for transform mode only.

## Migration phases

### Phase 1 ✅ — Canvas foundation + working zoom
### Phase 2 ✅ — Block text labels
### Phase 3 ✅ — Picks column + time axis
### Phase 4 ✅ — GSSP/GSSA markers + tooltip hit testing
### Phase 5 ✅ — Export (SVG via buildSVGForExport, PNG via buildCanvasPNGBlob)

------------------------------------------------------------------------

# Startup Prompt For Next Session

Paste this at the start of the next chat:

------------------------------------------------------------------------

GeoTimeline — Canvas migration complete (Phases 1–5).
Stack: React 19 + D3 v7 + Vite. Geologic timescale visualizer.
ICS 2024/12 data (189 units in src/data/geologicTime.json).
Dynamic mode (canvas + rAF loop) is the default and primary rendering path.
Transform mode (SVG + D3 zoom) is retained as a fallback.

See PROJECT_STATE.md for full architecture, feature status, and lessons.

Architecture constraints (never break):
- buildScale() and computeLayout() are pure functions.
- All React state and refs unchanged — canvas reads from refs in rAF loop.
- No setState during zoom gestures — visibleDomainRef.current only.
- Single rAF loop owns all canvas drawing (drawFrame useCallback).
- effectiveMarginRef.current = headerHeight + 8 (TOP margin only).
- BOTTOM_MARGIN = 8 — fixed bottom margin constant in component body.
- viewH = scrollContainerRef.current.clientHeight (NOT canvas.clientHeight).
- hitBoxesRef populated each frame for tooltip hit testing.
- Export: buildSVGForExport() for SVG, buildCanvasPNGBlob() for PNG.

------------------------------------------------------------------------
