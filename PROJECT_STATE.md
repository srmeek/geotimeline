# PROJECT_STATE.md

*Last Updated: 2026-04-06 (session 5)*

------------------------------------------------------------------------

# Current State Summary

Full rendering pipeline stable in canvas (dynamic) mode. ICS 2024/12 data
(189 units). Dynamic zoom mode default. Canvas migration is complete through
Phase 5. All rendering, export, and interaction features now work in dynamic
mode. SVG/transform mode is preserved as a fallback.

Session 5 focused entirely on fixing zoom and pan interactions across all
scale modes (Linear, Log, Equal Size, Era Equal). Most of the rendering
pipeline bugs are resolved; one pan snap issue on drag release remains.

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
-   `BOTTOM_MARGIN` has been **removed from all drawFrame scale ranges and
    culling guards** (still present in SVG/export path). Scale range is now
    `[eM, viewH]`. Clip region prevents any overdraw below viewH.
-   **DPR reset each frame**: `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` is
    called unconditionally after `ctx.restore()`, before drawing. This ensures
    DPR scaling is never dependent on the save/restore stack.
-   **Clip region**: `ctx.save()` / `ctx.clip()` to `[0, 0, cssW, viewH]`
    wraps each frame. `ctx.restore()` pops it at frame end.
-   **Canvas backing store** sized to `viewH * dpr` (not `cssH * dpr`).
    `cssH = canvas.clientHeight` resolves to the full scrollable extent;
    using `viewH` prevents the backing store from growing to thousands of pixels.

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
    for correct focal age calculation.
-   **Wheel pan** (`ctrlKey` = false): pure pixel arithmetic —
    `shift = panDelta * (span / viewportPx)` where `viewportPx = h - eM`.
    Scale-type-invariant; no `buildScale` call.
-   **Drag pan**: ref-only updates during drag (`visibleDomainRef.current` only,
    no `commitDomain`/`setVisibleDomain`). Single `setVisibleDomain` flush on
    `mouseUp`. `shift = -dy * (span / viewportPx)`.
-   **Scroll suppression during drag**: `isScrollSyncing.current = true` on
    `mouseDown`, deferred `false` via `setTimeout(0)` after `setVisibleDomain`
    on `mouseUp` (to cover the async scroll event from scroll-sync useEffect).
-   **Progressive zoom speed**: `speedScale = (span/fullSpan)^0.2`.
-   **Focal age (linear/log)**: `buildScale().invert(cursorY)` with correct
    `[eM, h]` range.
-   **Focal age (equalSize/eraEqual)**: virtual-canvas invert — builds
    `fullScale` over `[fullMin, fullMax]` → `[0, virtualH]`, applies
    `pixelOffset = fullScale(refMin)`, then
    `focalAge = fullScale.invert(cursorY - eM + pixelOffset)`.

## Equal Size / Era Equal Scale Architecture

Fixed-partition scales — all slots (or all 4 eras) are always laid out
equally across the full virtual height. Zooming is handled by narrowing
`[vMin, vMax]` and translating the virtual canvas, NOT by filtering slots.

-   **drawFrame scale construction**: for `equalSize`/`eraEqual`, builds
    `fullScale` over `[dynamicMinAge, dynamicMaxAge]` → `[0, virtualH]` where
    `virtualH = (viewH - eM) * (fullSpan / visSpan)`. Then:
    `scale = age => fullScale(age) - fullScale(vMin) + eM`.
-   **buildSVGForExport**: same virtual-canvas pattern using `dynamicMinAge`/
    `dynamicMaxAge` component variables.
-   **buildScale itself is stateless w.r.t. zoom** — `domain` param is used
    only for tick filtering, not slot layout.

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

1.  **Drag pan snap/stretch on release** — on `mouseUp`, `setVisibleDomain`
    triggers the scroll-sync `useEffect`, which sets `container.scrollTop`.
    That scroll assignment fires `handleScroll` asynchronously. The
    `isScrollSyncing` guard uses `setTimeout(0)` to defer the reset, but
    this does not reliably cover the async scroll event in all browsers.
    `handleScroll` then overwrites `visibleDomainRef` with a scroll-derived
    value that doesn't match where the drag ended — causing a visible snap.
    **Root cause**: `isScrollSyncing` is set and cleared synchronously inside
    the scroll-sync `useEffect` (`true` → `container.scrollTop =` → `false`),
    so `handleScroll` (which fires from the native scroll event, asynchronously)
    always sees `isScrollSyncing = false`. The `setTimeout(0)` in `onMouseUp`
    doesn't help because the sync `useEffect` has already cleared the flag.
    **Next approach**: Either (a) remove `handleScroll` from dynamic mode
    entirely (scroll events should not drive `visibleDomain` in dynamic mode —
    the scrollbar is decorative/indicator-only), or (b) track `isDragging` as
    a separate ref and check it in `handleScroll`.

2.  **Picks rounding** — epsilon fix applied to `formatAge`; needs browser verify.

3.  **PNG export with external fonts** — canvas rasterization may not embed
    custom web fonts; system fonts (Arial etc.) are safe.

4.  **Scroll sync formula uses symmetric margin** — forward/reverse scroll
    sync formulas still use `2 * eM` (symmetric), but top/bottom margins are
    now asymmetric. Minor inconsistency in transform mode; not visible in
    practice since dynamic mode is the default.

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
13. For zoom focal age on equalSize/eraEqual, use the virtual-canvas invert
    (`fullScale.invert(cursorY - eM + pixelOffset)`). Do NOT use
    `buildScale([vMin,vMax],...).invert()` — that domain is wrong for fixed
    partition scales.
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
19. Wheel/drag pan should use pure pixel arithmetic: `shift = delta * (span /
    viewportPx)`. Calling `buildScale([vMin,vMax],...).invert()` for pan is
    wrong for fixed-partition scales and fragile for log.
20. `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` each frame is the only reliable
    way to apply DPR scaling — `ctx.scale(dpr,dpr)` inside the resize branch
    is lost when `ctx.restore()` pops the stack on subsequent frames.
21. Canvas backing store must be sized to `viewH * dpr`, not `cssH * dpr`.
    `canvas.clientHeight` returns the full scrollable extent (thousands of px
    when zoomed) because the canvas is inside a sticky wrapper in a tall spacer.
22. `isScrollSyncing` set synchronously inside scroll-sync useEffect provides
    no protection against the native `scroll` event, which fires asynchronously
    after `container.scrollTop` is assigned. In dynamic mode, `handleScroll`
    should not drive `visibleDomain` at all — the scrollbar is an indicator.

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

GeoTimeline — Canvas migration complete (Phases 1–5). Zoom/pan interactions
fixed for all scale modes in session 5.
Stack: React 19 + D3 v7 + Vite. Geologic timescale visualizer.
ICS 2024/12 data (189 units in src/data/geologicTime.json).
Dynamic mode (canvas + rAF loop) is the default and primary rendering path.
Transform mode (SVG + D3 zoom) is retained as a fallback.

See PROJECT_STATE.md for full architecture, feature status, and lessons.

Architecture constraints (never break):
- buildScale() and computeLayout() are pure functions.
- buildScale() is stateless w.r.t. zoom — never filter slots by visible domain.
- All React state and refs unchanged — canvas reads from refs in rAF loop.
- No setState during zoom gestures — visibleDomainRef.current only.
- No setState during drag pan — ref-only; single flush on mouseUp.
- Single rAF loop owns all canvas drawing (drawFrame useCallback).
- effectiveMarginRef.current = headerHeight + 8 (TOP margin only).
- BOTTOM_MARGIN = 8 still exists but is NOT used in drawFrame scale ranges
  or culling (removed in session 5). Still used in SVG/export path.
- viewH = scrollContainerRef.current.clientHeight (NOT canvas.clientHeight).
- Canvas backing store sized to viewH*dpr (not cssH*dpr).
- ctx.setTransform(dpr,0,0,dpr,0,0) applied every frame (not only on resize).
- Clip region [0,0,cssW,viewH] set via ctx.save()/ctx.clip() each frame.
- equalSize/eraEqual scale in drawFrame: virtual-canvas pattern —
  fullScale over [fullMin,fullMax]→[0,virtualH], offset by fullScale(vMin).
- Wheel/drag pan: pure pixel arithmetic, no buildScale call.
- hitBoxesRef populated each frame for tooltip hit testing.
- Export: buildSVGForExport() for SVG, buildCanvasPNGBlob() for PNG.
- isScrollSyncing does NOT reliably block handleScroll in dynamic mode.
  Priority fix: remove handleScroll's domain-write in dynamic mode entirely.

Open issue: drag pan snaps/stretches on release (handleScroll overwrites
domain after setVisibleDomain triggers scroll-sync useEffect on mouseUp).
Fix: check isDragging ref in handleScroll, or skip domain write in dynamic mode.

------------------------------------------------------------------------
