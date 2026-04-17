# PROJECT_STATE.md

*Last Updated: 2026-04-17 (session 6)*

------------------------------------------------------------------------

# Current State Summary

Full rendering pipeline stable in canvas (dynamic) mode. ICS 2024/12 data
(189 units). Dynamic zoom mode default. Canvas migration is complete through
Phase 5. All rendering, export, and interaction features now work in dynamic
mode. SVG/transform mode is preserved as a fallback.

Session 6 refactored zoom math into a unit-tested pure-function library
(`src/lib/scale.js`, 17 vitest cases) and fixed three correctness bugs plus
a canvas-stretch-on-pan layout bug. Next up: extract `TimelineCanvas`
component (Phase 3), then dirty-flag rAF (Phase 4), then memoization pass
(Phase 5).

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
-   **`src/lib/scale.js`** — pure-function math library:
    `buildScale`, `buildViewScale`, `computeZoomedDomain`, `clampDomain`,
    `computeLayout`, `formatTickLabel`. No React/DOM deps. 17 vitest cases
    in `src/lib/__tests__/scale.test.js` cover round-trip invariants,
    focal-point-under-cursor invariant, clamp edge cases, and layout geometry.
-   `buildViewScale` is the single source of truth for the "view scale" used
    by both `drawFrame` and `buildSVGForExport` — guarantees live/export parity.
-   `computeZoomedDomain` performs focal-point zoom anchoring in **g-space**
    (a unit-interval parametrization of each scale type). Pixel fractions are
    linear in g under `buildViewScale`, so one formula works for all scale types.
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

## Canvas CSS vs Backing-Store Sizing (session 6 fix)

-   **Bug**: Sticky wrapper had `height: 100%`, which resolved to the spacer's
    `scrollableSize` (e.g. 8000px when zoomed 10×). The canvas inside inherited
    100% of that. But `drawFrame` sized the backing store to `viewH * dpr`
    (~800 × dpr). Browser stretched the viewH-tall backing store to fill the
    scrollableSize-tall CSS box → **all canvas content vertically stretched
    by factor k at any zoom level** (visible most clearly when panning stops).
    DOM overlays (tooltip, SVG ticks) were unaffected, confirming the stretch
    is a canvas-CSS/backing mismatch, not a math error.
-   **Fix**: New `viewportH` state, tracked via a `ResizeObserver` on
    `scrollContainerRef`. Sticky wrapper now uses `height: viewportH || "100%"`
    so its CSS height equals the scroll container's viewport, matching the
    backing store. Canvas CSS = viewportH = backing store / dpr → no stretch.

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

-   **Wheel zoom** (`ctrlKey` = true): synchronous — calls
    `computeZoomedDomain({scaleType, vMin, vMax, fullMin, fullMax, eM, viewH,
    units, equalSizeLevel, cursorY, zoomFactor})` from `lib/scale.js`. Works
    uniformly for linear, log, equalSize, eraEqual (see g-space below).
-   **Wheel pan** (`ctrlKey` = false): pure pixel arithmetic —
    `shift = panDelta * (span / viewportPx)` where `viewportPx = h - eM`.
    Scale-type-invariant; no `buildScale` call.
-   **Drag pan**: ref-only updates during drag (`visibleDomainRef.current` only,
    no `commitDomain`/`setVisibleDomain`). Single `setVisibleDomain` flush on
    `mouseUp`.
-   **handleScroll guard**: `if (zoomMode !== "transform") return;` — dynamic
    mode's scrollbar is one-way indicator only. `visibleDomain` drives scroll
    position; scroll events never write back. Replaces the old `setTimeout(0)`
    workaround for `isScrollSyncing` race.
-   **Progressive zoom speed**: `speedScale = (span/fullSpan)^0.2`.
-   **Focal age — g-space anchoring**: `computeZoomedDomain` builds a unit-
    interval parametrization `g(age) ∈ [0,1]` via `buildScale(scaleType,
    [fullMin,fullMax], [0,1], ...)`. Pixel fractions are linear in g under
    `buildViewScale`, so anchoring `newGMin = gFocal - pxFrac · newGSpan`
    guarantees the focal age stays under the cursor for ANY scale type.
    Age bounds are recovered via `g.invert`. Replaces the old age-fraction
    math which drifted for equalSize/eraEqual.

## Equal Size / Era Equal Scale Architecture

Fixed-partition scales — all slots (or all 4 eras) are always laid out
equally across the full virtual height. Zooming is handled by narrowing
`[vMin, vMax]` and translating the virtual canvas, NOT by filtering slots.

-   **`buildViewScale`** (in `lib/scale.js`) is the single source of truth.
    Both `drawFrame` and `buildSVGForExport` call it — live/export cannot drift.
-   For equalSize/eraEqual, `buildViewScale` builds `fullScale` over
    `[fullMin, fullMax]` → `[0, virtualH]` where
    **`virtualH = viewportH / gSpan`** and `gSpan = g(vMax) - g(vMin)` via a
    unit-interval parametrization. Then
    `scale = age => fullScale(age) - fullScale(vMin) + eM`.
-   **Prior bug (fixed session 6)**: `virtualH = viewportH · (fullSpan / visSpan)`
    used **age** span, which is not pixel span for non-linear scales. It
    over/under-filled the viewport; the error was partly masked by a
    compensating zoom-math error that also used age-fractions. Using g-span
    fixes both.
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

1.  **Drag pan snap on release** — RESOLVED (session 6). Root cause was
    `handleScroll` writing back into `visibleDomain` in dynamic mode.
    Fix: early-return in `handleScroll` when `zoomMode !== "transform"`.
    Scrollbar is now strictly one-way (decorative indicator).
    `setTimeout(0)` workaround removed.

2.  **Canvas vertical stretch on pan/zoom** — RESOLVED (session 6). Root
    cause was sticky wrapper `height: 100%` resolving to spacer's
    `scrollableSize` while backing store was `viewH * dpr`. Fix: track
    `viewportH` via ResizeObserver and apply to sticky wrapper height.

3.  **Picks rounding** — epsilon fix applied to `formatAge`; needs browser verify.

4.  **PNG export with external fonts** — canvas rasterization may not embed
    custom web fonts; system fonts (Arial etc.) are safe.

5.  **Scroll sync formula uses symmetric margin** — forward/reverse scroll
    sync formulas still use `2 * eM` (symmetric), but top/bottom margins are
    now asymmetric. Minor inconsistency in transform mode; not visible in
    practice since dynamic mode is the default.

6.  **eraEqual uses hardcoded era boundaries** — `buildScale` for eraEqual
    hardcodes the four era start/end ages. Editing a Cenozoic start date
    in the data editor will not re-layout eraEqual. Low priority; flag
    next time eraEqual is touched.

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
23. Pure math belongs in `src/lib/` with vitest coverage, not inline in
    components. 17 tests now cover `buildScale` round-trip, `buildViewScale`
    viewport mapping, zoom focal-point invariant, `clampDomain`, `computeLayout`.
    Pre-commit hook at `.git/hooks/pre-commit` runs `npm test`.
24. Focal-point zoom generalizes cleanly via **g-space**: parametrize every
    scale type into a unit interval `g(age) ∈ [0,1]`, then anchor in g-space
    where pixel-fraction == g-fraction for all scale types. One formula
    (`newGMin = gFocal - pxFrac · newGSpan`) works for linear/log/equalSize/
    eraEqual. Adding a 5th scale type means implementing `g`/`g.invert` only.
25. `buildViewScale`'s `virtualH` for non-linear scales MUST be derived from
    g-span (`viewportH / gSpan`), not age-span. Using `fullSpan/visSpan`
    over/under-fills the viewport for equalSize/eraEqual.
26. Canvas CSS height must match backing-store height / dpr. If the canvas's
    CSS parent is a sticky wrapper with `height: 100%` inside a spacer that's
    `scrollableSize` tall, canvas CSS = scrollableSize while backing store =
    `viewH * dpr` → browser stretches content vertically by factor
    `scrollableSize / viewH`. Size the sticky wrapper to viewport height
    (via ResizeObserver on the scroll container), not 100% of the spacer.

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

GeoTimeline — Canvas migration complete (Phases 1–5). Session 6 extracted
zoom math into `src/lib/scale.js` (unit-tested, 17 vitest cases) and fixed
three correctness bugs + a canvas-stretch layout bug.
Stack: React 19 + D3 v7 + Vite + Vitest. Geologic timescale visualizer.
ICS 2024/12 data (189 units in src/data/geologicTime.json).
Dynamic mode (canvas + rAF loop) is the default and primary rendering path.
Transform mode (SVG + D3 zoom) is retained as a fallback.

See PROJECT_STATE.md for full architecture, feature status, and lessons.

Architecture constraints (never break):
- Pure math lives in src/lib/scale.js (buildScale, buildViewScale,
  computeZoomedDomain, clampDomain, computeLayout, formatTickLabel).
  Tested in src/lib/__tests__/scale.test.js. Pre-commit hook runs npm test.
- buildScale() is stateless w.r.t. zoom — never filter slots by visible domain.
- buildViewScale() is the single view-scale source for drawFrame AND
  buildSVGForExport — export must not drift from live.
- computeZoomedDomain() anchors in g-space (unit-interval parametrization)
  — one formula for all scale types. Do NOT reintroduce age-fraction math.
- buildViewScale virtualH for non-linear scales = viewportH / gSpan,
  NOT viewportH * (fullSpan/visSpan). Age-span is not pixel-span.
- All React state and refs unchanged — canvas reads from refs in rAF loop.
- No setState during zoom gestures — visibleDomainRef.current only.
- No setState during drag pan — ref-only; single flush on mouseUp.
- Single rAF loop owns all canvas drawing (drawFrame useCallback).
- effectiveMarginRef.current = headerHeight + 8 (TOP margin only).
- BOTTOM_MARGIN = 8 still exists but is NOT used in drawFrame scale ranges
  or culling (removed in session 5). Still used in SVG/export path.
- viewH = scrollContainerRef.current.clientHeight (NOT canvas.clientHeight).
- Canvas backing store sized to viewH*dpr (not cssH*dpr).
- Sticky canvas wrapper height MUST match viewportH (tracked via
  ResizeObserver), NOT 100% of the spacer — otherwise canvas content
  stretches vertically by scrollableSize/viewH.
- ctx.setTransform(dpr,0,0,dpr,0,0) applied every frame (not only on resize).
- Clip region [0,0,cssW,viewH] set via ctx.save()/ctx.clip() each frame.
- Wheel/drag pan: pure pixel arithmetic, no buildScale call.
- handleScroll returns early when zoomMode !== "transform". Scrollbar in
  dynamic mode is one-way indicator; never writes back to visibleDomain.
- hitBoxesRef populated each frame for tooltip hit testing.
- Export: buildSVGForExport() for SVG, buildCanvasPNGBlob() for PNG.

Next up: Phase 3 (extract TimelineCanvas component), Phase 4 (dirty-flag
rAF + precompute block geometry), Phase 5 (memoize effectiveUnits,
_picksMinWidth, _hc, fullScale).

------------------------------------------------------------------------
