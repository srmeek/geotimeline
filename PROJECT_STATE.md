# PROJECT_STATE.md

*Last Updated: 2026-04-24 (session 15b)*

------------------------------------------------------------------------

# Current State Summary

Canvas (dynamic) is now the **only** rendering pipeline. ICS 2024/12 data
(189 units). Single-mode renderer with `makeScale` everywhere. Custom
scrollbar, initial centering, and zoom-out headroom added in Session 10;
two blank-screen bugs fixed in Session 11; scrollbar live-update and
zoom-out headroom wired correctly in Session 12. Reset padding moved to
viewport-pixel-fraction space in Session 13.

**Session 15 — Fixed-lattice span-based ticks for pan stability.**
All changes are in `src/components/TimelineCanvas.jsx` (`drawFrame`, time axis block).

- **Replaced D3-based tick generation with span-based fixed-lattice ticks**: removed
  `d3.scaleLinear().domain([vMin, vMax]).ticks(40)` and the `majorEvery` derivation.
  Tick positions are now multiples of a "nice" step size derived from the visible span,
  so the same lattice of age values is always used — panning slides the visible window
  over the fixed lattice rather than reshuffling label positions every frame.
- **Nice step snapping**: raw step `= span / targetLabels` is snapped to the nearest
  1, 2, 2.5, or 5 times a power of 10 (`niceStep`). Labels change only at zoom
  transitions, not during pan.
- **Minor ticks**: `niceStep / 5` (4 subdivisions), skipping positions coinciding with
  major ticks via a floating-point proximity check.
- **`d3` import removed**: `TimelineCanvas.jsx` no longer imports D3 at all.
- Session 14 unit-bound culling (`unitTopY`/`unitBottomY`) and all rendering loops
  are unchanged.

Lint: 0 errors / 0 warnings. Tests: 44/44.

**Session 14 — Time axis tick clamping to unit bounds.**
All changes are in `src/components/TimelineCanvas.jsx` (`drawFrame`, time axis block).

- **Ticks now hard-clipped to the unit pixel range**: computed
  `unitTopY = scale(dynamicMinAgeRef.current)` and
  `unitBottomY = scale(dynamicMaxAgeRef.current)` immediately after
  `tickValues` generation. Both the minor-tick and major-tick `forEach`
  cull guards were replaced with
  `if (pos < unitTopY - 0.5 || pos > unitBottomY + 0.5) return;`
  (0.5 px tolerance avoids floating-point culling at exact boundaries).
- **Applies everywhere**: reset padding gaps, pan/zoom positions, all
  four scale types (linear, log, equalSize, eraEqual), and when units
  are hidden (dynamicMinAge/MaxAge update via useMemo over hiddenUnits).
- **Tick spacing unchanged**: `tickValues` domain is still `[vMin, vMax]`
  so tick density tracks the visible age range; only rendering is clamped.

Lint: 0 errors / 0 warnings. Tests: 44/44.

**Session 13 — Viewport-fraction reset padding.**
All changes are in `src/App.jsx` (`computeResetView`) and `eslint.config.js`.

- **Reset padding is now scale-aware**: previously `computeResetView` added
  `2% * span` to the age domain, which produced no visible pixel gap on
  non-linear scales (log, equalSize, eraEqual) because the scale clamps
  out-of-bounds ages to `range[1]`. The new approach builds a temporary
  `makeScale` over the full data extent, then inverts padded pixel positions
  (`eM ± 5% drawingH` and `viewH ± 5% drawingH`) through `toAge` to find
  the padded age bounds. This produces a 5% pixel-fraction gap at top and
  bottom for every scale type.
- **Padding applies only at reset**: during pan/zoom the drawing area fills
  completely. Reset (button, hidden-units change, initial mount) re-applies
  the 5% padding.
- **Constant renamed**: `RESET_DOMAIN_PADDING_FACTOR = 0.02` →
  `RESET_PADDING_FRACTION = 0.05`. All three call sites updated with the
  new `scaleType`, `effectiveUnits`, `equalSizeLevel`, `eM`, `viewH`
  parameters.
- **Safety clamp added**: the padded bounds are clamped to ±10% of data
  span so extreme scale types can never push the reset view beyond the
  navigable range.
- **ESLint ignore for `.claude/` worktrees**: stale worktree files from
  prior agent runs were being linted. Added `.claude` to `globalIgnores`
  in `eslint.config.js`.
- Known issue A1 (bottom padding missing on non-linear modes) — **RESOLVED**.

Lint: 0 errors / 0 warnings. Tests: 44/44.

**Session 12 — Scrollbar live-update + zoom-out headroom.**
All changes are in `src/components/TimelineCanvas.jsx` event handlers.

- **Bug 1 — Scrollbar thumb stale during gestures**: ctrl+wheel zoom
  and drag-pan both wrote directly to `visibleDomainRef.current` without
  calling `setVisibleDomain`. `CustomScrollbar` reads `visibleDomain`
  from React state (a prop), so its thumb was stale until gesture release
  (drag) or forever (zoom). Fixed by routing both paths through the
  existing `commitDomain` helper (rAF-debounced `setVisibleDomain`). The
  `onMouseUp` handler now also cancels any pending `commitDomain` rAF and
  flushes synchronously on release, so there is no delayed final frame.

- **Bug 2 — Zoom-out capped at true data extent**: The ctrl+wheel branch
  passed `dynamicMinAgeRef` / `dynamicMaxAgeRef` as `fullMin`/`fullMax`
  to `zoomToFocal`, so g-space was parametrized over the true data
  extent and `gSpan = 1` was reached at exactly that boundary. The
  `clampMinAgeRef` / `clampMaxAgeRef` refs (10% headroom) were already
  used for pan clamping but not zoom. Fixed by passing the clamp refs
  as `fullMin`/`fullMax` to `zoomToFocal` — g-space now spans the padded
  extent, zoom-out stops at the same boundary as pan, and focal anchoring
  remains correct. `drawFrame`'s `makeScale` call is unchanged (still
  uses `dynamicMinAgeRef` for true-extent tick math).

Lint: 0 errors / 0 warnings. Tests: 44/44.

**Session 11 — Blank screen bug fixes.**
Two bugs introduced in Session 10 caused the app to render nothing:

1. **`layout` temporal dead zone (TDZ)**: The mount `useEffect(..., [layout])`
   was declared at line ~232, but `const layout = useMemo(...)` was at
   line ~639. React evaluates the dependency array immediately during
   render — hitting the TDZ and throwing
   `ReferenceError: Cannot access 'layout' before initialization`.
   **Fix**: moved the `hasInitializedView` effect to after the `layout`
   useMemo declaration. Rule: `useEffect`s whose dependency arrays
   reference a `const` must be declared after that `const`.

2. **`equalSize` out-of-bounds fallback**: `buildScale` for `equalSize`
   returned `range[0]` (young/top = 0) for ages older than all display
   units (i.e. `age > displayUnits[n-1].start`). When Session 10's
   `computeResetView` set `vMax = dynamicMaxAge + 2% span` (slightly
   beyond `fullMax`), `g(vMax) = 0 = g(vMin)`, so `gSpan ≈ 1e-9`,
   `virtualH ≈ 10^12`, and all drawing happened at astronomical
   y-positions — blank canvas. **Fix**: added
   `if (age > displayUnits[n - 1].start) return range[1]` before
   the existing fallback in `src/lib/scale.js`. eraEqual was unaffected
   (its fallback already returned `range[1]` for old ages). Linear was
   unaffected (D3 extrapolates). Only triggered when
   `scaleType = "equalSize"` was saved in localStorage and `vMax >
   fullMax` on the initial view.

Lint: 0 errors / 0 warnings. Tests: 44/44.

**Session 10 — Custom scrollbar + UX improvements.**
- `src/components/CustomScrollbar.jsx` — pure React component, ~110 lines.
  Absolutely positioned on the right edge. Thumb height ∝ visible span /
  clamp span; drag → `onScroll(newMin, newMax)` → `setVisibleDomain`.
  Track height tracked via ResizeObserver (no ref reads during render —
  avoids `react-hooks/refs` errors). Click above/below thumb pages 90% of
  visible span.
- Initial centering: `computeResetView` helper computes a padded domain
  (`dynamicMaxAge + 2% span`) and horizontally-centered `lateralOffset`
  (based on `scrollContainerRef.current.clientWidth`). Applied once on
  mount (guarded by `hasInitializedView` ref) and on every reset.
- Zoom-out headroom: `clampMinAge`/`clampMaxAge` = 10% beyond the data
  extent. All `clampDomain` calls in TimelineCanvas pan/zoom handlers now
  use these refs instead of `dynamicMinAgeRef`/`dynamicMaxAgeRef`. The
  `makeScale`/`zoomToFocal` `fullMin`/`fullMax` remain anchored to the
  true data extent.
- Header drag live update: `onMove` handler now updates both
  `effectiveMarginRef.current` (immediate rAF effect) and
  `setHeaderHeight` (React re-render) synchronously. The dirty-flag
  snapshot now includes `eM` so header resizes trigger a frame.
- Lint: 0 errors / 0 warnings. Tests: 44/44.

**Session 9 — Transform mode removal + scrollbar removal.** Permanently
deleted the SVG/D3-zoom transform pipeline. Dynamic canvas is the sole
renderer. Migrated `buildSVGForExport` to `makeScale`. Deleted
`buildViewScale` and `computeZoomedDomain` from `src/lib/scale.js`'s
public API (`buildViewScale` survives as an internal helper used by
`makeScale` and `zoomToFocal`). Removed the native scrollbar entirely
(`overflow: hidden` on the scroll container) — a custom scrollbar
replacement comes in Session 10. App.jsx shrank from 2471 → 1592 lines.
Tests: 44 cases (down from 54 — pruned the 10 cases covering removed
APIs). Lint: 0 errors / 0 warnings.

What was removed in Session 9:
- Dual zoom modes (`zoomMode` state, `handleSwitchZoomMode`, toggle UI).
- D3 zoom binding effect, `zoomBehaviorRef`, `transformRef`,
  `currentTransform` state.
- Counter-scale system (`applyCounterScale`, third useEffect, all
  `data-block-*` attributes from SVG render path).
- Scroll sync system (`handleScroll`, `isScrollSyncing` ref,
  `scrollableSize` state, `viewportH` state + ResizeObserver, native
  scrollbar, sticky wrapper, scrollable spacer).
- SVG live element (`svgRef`, `<svg>` JSX, `renderSVGtoPNGBlob`).
- URL hash transform sync (`_hashTransform`, hash debounce ref,
  `_initFromHash` import). `hiddenUnits` now only restored from
  `localStorage` via `_initPrefs`, not from the URL hash.
- `useCallback` import — no longer needed anywhere.

**Session 8 — makeScale unification.** Introduced
`makeScale({...}) → { toY, toAge }` as the canonical scale interface.
`toY(age)` maps to a y coordinate in viewport coordinates
(`[eM, viewH]`); `toAge` is its inverse. Works uniformly for linear,
log, equalSize, and eraEqual — g-space and virtual-canvas offsets are
implementation details hidden behind the interface. The coordinate
contract is authoritative in [src/lib/coordinates.md](src/lib/coordinates.md).

Session 7 extracted `TimelineCanvas` (~624 lines) from App.jsx, added a
closure-scoped dirty-flag so `drawFrame` skips redraws when nothing
changed, memoized derived state, cleaned the lint baseline, and fixed
known issue #6 (eraEqual boundaries derive from current unit data via
`deriveEraEqualBands`).

------------------------------------------------------------------------

# Architecture Overview

## Rendering Pipeline

-   **Canvas (sole renderer)**: lives in
    `src/components/TimelineCanvas.jsx`. `requestAnimationFrame` loop
    calls an inline `drawFrame` closure every frame. Reads all state
    from refs and props — no React re-render during gestures.
    `TimelineCanvas` is a passive component; all state still lives in
    `App.jsx` and is passed down.
-   `App.jsx` no longer owns any SVG/D3 zoom code, no
    `useEffect`s for scrollbar sync, counter-scale, or D3 zoom binding.
    Two `useEffect`s remain: persisting `gt_prefs` and `gt_unitEdits`
    to `localStorage`, plus a hidden-units reset effect.
-   **`src/lib/scale.js`** — pure-function math library:
    `makeScale` (canonical interface — returns `{ toY, toAge }` in
    viewport coords), `zoomToFocal` (cursor-anchored zoom),
    `buildScale` (still exported for tick generation), `clampDomain`,
    `computeLayout`, `deriveEraEqualBands`, `formatTickLabel`.
    `buildViewScale` is an **internal helper** (not exported) used by
    `makeScale` and `zoomToFocal`. No React/DOM deps. **44 vitest
    cases** in `src/lib/__tests__/scale.test.js` cover round-trip
    invariants, clamp edge cases, layout geometry, eraEqual band
    derivation, the `makeScale` coordinate contract (5 invariants × 4
    scale types), and `zoomToFocal` zoom invariants (3 × 4).
-   **`src/lib/coordinates.md`** — authoritative pixel coordinate
    conventions. All `scale.js` API boundary values are in *viewport
    coordinates* (`y=eM` at top of drawing area, `y=viewH` at bottom).
    g-space and virtual-canvas offsets are implementation details hidden
    behind `makeScale`.
-   `computeLayout()` accepts `initialOffset` (horizontal pixel offset,
    equals `MARGIN` constant = 14px).

## Canvas drawFrame Architecture

-   `drawFrame` is an inline closure inside a `useEffect` in `TimelineCanvas.jsx`.
    **Not** a `useCallback` — React Compiler would flag ref-typed
    props as potentially-reactive and force `preserve-manual-memoization` to
    break the memo. A sibling `tick()` closure in the same effect handles
    rAF self-scheduling.
-   **Dirty-flag skip**: `drawFrame` keeps a closure-scoped
    `last = { vMin, vMax, lateral, cssW, viewH, eM }` snapshot. If nothing
    has changed since the previous frame, the draw is skipped. The `eM`
    field was added in Session 10 so header-height changes (which update
    `effectiveMarginRef.current`) trigger a redraw without re-creating the
    effect. Effect re-creation on any prop change resets `last` → forces
    a redraw.
-   Reads refs directly: `visibleDomainRef`, `effectiveMarginRef`,
    `lateralOffsetRef`, `scrollContainerRef` (for viewport height).
-   Render order: white background → hierarchy blocks → time axis → picks
    → GSSP/GSSA markers.
-   Accumulates `hitBoxes = []` per frame; written to `hitBoxesRef.current`
    at frame end for mousemove hit testing.
-   `BOTTOM_MARGIN` is **removed from drawFrame scale ranges and
    culling guards** (still present in SVG export). Scale range is
    `[eM, viewH]`. Clip region prevents any overdraw below viewH.
-   **DPR reset each frame**: `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` is
    called unconditionally after `ctx.restore()`, before drawing. This ensures
    DPR scaling is never dependent on the save/restore stack.
-   **Clip region**: `ctx.save()` / `ctx.clip()` to `[0, 0, cssW, viewH]`
    wraps each frame. `ctx.restore()` pops it at frame end.
-   **Canvas backing store** sized to `viewH * dpr`. With the scrollbar
    removed, `cssH = canvas.clientHeight` now equals the scroll
    container's viewport height — but the code still reads viewH from
    `scrollContainerRef.current.clientHeight` for clarity and to keep
    Session 10's custom-scrollbar work decoupled.

## Scroll Container + Custom Scrollbar

-   Single flat container (`overflow: hidden`) wraps `TimelineCanvas`
    and `CustomScrollbar` — no sticky wrapper, no scrollable spacer,
    no native scrollbar.
-   `scrollContainerRef` still exists; its `clientHeight` is the
    authoritative `viewH` source for the canvas math.
-   `src/components/CustomScrollbar.jsx` — pure React component.
    Absolutely positioned on the right edge (12px wide, `z-index: 20`).
    Thumb height ∝ `visSpan / clampSpan`, minimum 20px so it stays
    grabbable at max zoom. Track height tracked via `ResizeObserver`
    (state, not a ref read during render). Drag updates
    `visibleDomainRef.current` synchronously via the `onScroll` callback.
    Clicking the track above/below the thumb pages 90% of visible span.
    No wheel handler — wheel events handled by TimelineCanvas already.

## Data Layer

-   `ALL_UNITS`, `UNIT_MAP`, `isUnitVisible` live in `src/lib/units.js`.
    Module-level constants built once from `geologicTime.json`.
-   `_initPrefs`, `_initUnitEdits` are module-level IIFEs in `App.jsx`
    that parse `localStorage` once on load.
-   `effectiveUnits` (in `App.jsx`) = `ALL_UNITS` with `unitEdits` overlaid —
    memoized via `useMemo([unitEdits])`. Used everywhere.
-   `isUnitVisible(unitId, hiddenUnits)` walks ancestor chain.
-   `dynamicMinAge` / `dynamicMaxAge` memoized together via `useMemo` over
    `[effectiveUnits, hiddenUnits]`.

## Header / Margin Architecture

-   `MARGIN = 14` — small fixed gap used only as horizontal layout offset.
-   `effectiveMarginRef.current = headerHeight + 8` — **top margin only**.
    Updated every render in the component body.
-   `BOTTOM_MARGIN = 8` — fixed bottom margin constant, independent of
    header height. Declared in the component body alongside effectiveMarginRef.
-   Scale range: `[eM, viewH - BOTTOM_MARGIN]` in SVG export;
    `[eM, viewH]` in canvas drawFrame. Previously used `[eM, viewH - eM]`
    which caused the bottom of the scale to shift when header height changed.

## Zoom / Pan Architecture

-   **Wheel zoom** (`ctrlKey` = true): synchronous — calls
    `zoomToFocal({scaleType, vMin, vMax, fullMin, fullMax, eM, viewH,
    units, equalSizeLevel, cursorY, zoomFactor})` from `lib/scale.js`. Works
    uniformly for linear, log, equalSize, eraEqual (see g-space below).
    `fullMin/fullMax` remain anchored to true data extent (`dynamicMinAge/
    dynamicMaxAge`) — not the clamp extent.
-   **Wheel pan** (`ctrlKey` = false): pure pixel arithmetic —
    `shift = panDelta * (span / viewportPx)` where `viewportPx = h - eM`.
    Clamped to `[clampMinAge, clampMaxAge]` (10% headroom beyond data).
-   **Drag pan**: ref-only updates during drag. Clamped to
    `[clampMinAge, clampMaxAge]`. Single `setVisibleDomain` flush on `mouseUp`.
-   **Arrow key pan**: clamped to `[clampMinAge, clampMaxAge]`.
-   **Keyboard zoom** (ctrl+/−): clamped to `[clampMinAge, clampMaxAge]`.
-   **Progressive zoom speed**: `speedScale = (span/fullSpan)^0.2`.
-   **Focal age — g-space anchoring**: `zoomToFocal` builds a unit-
    interval parametrization `g(age) ∈ [0,1]` via `buildScale(scaleType,
    [fullMin,fullMax], [0,1], ...)`. Pixel fractions are linear in g under
    the internal `buildViewScale`, so anchoring `newGMin = gFocal -
    pxFrac · newGSpan` guarantees the focal age stays under the cursor
    for ANY scale type. Age bounds are recovered via `g.invert`.
-   **Clamp vs data extent**: `clampMinAgeRef`/`clampMaxAgeRef` = 10%
    headroom beyond `dynamicMinAge`/`dynamicMaxAge`. All pan/keyboard-zoom
    `clampDomain` calls use the clamp refs. `makeScale` and `zoomToFocal`
    always receive the true data extent. Keep them separate.

## Equal Size / Era Equal Scale Architecture

Fixed-partition scales — all slots (or all 4 eras) are always laid out
equally across the full virtual height. Zooming is handled by narrowing
`[vMin, vMax]` and translating the virtual canvas, NOT by filtering slots.

-   **`makeScale`** (in `lib/scale.js`) is the only public entry point;
    it wraps the internal `buildViewScale` helper. Both `drawFrame` and
    `buildSVGForExport` call `makeScale` — live/export cannot drift.
-   For equalSize/eraEqual, `buildViewScale` builds `fullScale` over
    `[fullMin, fullMax]` → `[0, virtualH]` where
    **`virtualH = viewportH / gSpan`** and `gSpan = g(vMax) - g(vMin)` via a
    unit-interval parametrization. Then
    `scale = age => fullScale(age) - fullScale(vMin) + eM`.
-   **buildScale itself is stateless w.r.t. zoom** — `domain` param is used
    only for tick filtering, not slot layout.

## Hit Testing (Tooltip)

-   `hitBoxesRef = useRef([])` — populated each frame by drawFrame with
    `{ id, x, y, w, h }` for every visible block.
-   Canvas `onMouseMove` searches `hitBoxesRef.current` for the hit block,
    sets `hoverUnit` and `tooltipPos` state.

## Export Architecture

-   **PNG**: `buildCanvasPNGBlob(callback)` — creates an offscreen
    canvas cropped to viewport height, uses `drawImage` with explicit
    source rect to copy only the rendered area from the backing store.
-   **SVG**: `buildSVGForExport()` — constructs a self-contained
    offscreen SVG from current view state. Runs the full pipeline:
    `renderTimeAxisTicks`, `renderBlocks`, `renderPicks`, GSSP/GSSA markers.
    Uses `makeScale` for the y-mapping (same canonical interface as the
    canvas). Reads `visibleDomainRef` / `effectiveMarginRef` /
    `lateralOffsetRef` / `scrollContainerRef` at call time. Sets explicit
    `width`/`height` attrs.

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

## ✅ Canvas Rendering Pipeline

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
-   **SVG**: `buildSVGForExport()` constructs offscreen SVG using
    `makeScale` for the y-mapping. Matches canvas output.
-   **PNG / Copy**: `buildCanvasPNGBlob()` crops backing store to viewport
    height. No SVG round-trip.

## ✅ Time Scale Types

Linear, Log, Equal Size (visible-only units), Era Equal.

## ✅ Time Axis Ticks

-   Fixed-lattice ticks: step snapped to 1, 2, 2.5, or 5 × 10^n from span.
-   Panning slides the view over the fixed lattice — no reshuffling during pan.
-   Zoom transitions cleanly change the step size.
-   4 minor subdivisions between major ticks (minorStep = niceStep / 5).
-   Session 14 unit-bound culling still in effect.
-   Tick density reduced 50%: `targetLabels` divisor changed from `fontSize * 2.5`
    to `fontSize * 5` (doubles the pixel gap required per label).

## ✅ Text Wrapping + Auto-Shrink (`BlockRenderer.js`)

-   `computeFitAndWrap` exported from `BlockRenderer.js`; used by
    `drawFrame` and `buildSVGForExport`.
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

-   Per-frame hitBoxes → mousemove hit test → tooltip JSX.
-   Flips left/above near viewport edges (260×90px clearance).

## ✅ Export Tab

-   **Download SVG**: `buildSVGForExport()` offscreen SVG.
-   **Download PNG**: `buildCanvasPNGBlob()` cropped canvas blob.
-   **Copy PNG to Clipboard**: same routing as Download PNG.

## ✅ URL Share State

-   Base64 JSON in `window.location.hash`. Debounced `replaceState` (300ms).
-   Encodes `visibleDomain` and `lateralOffset` (no `zoomMode` / `currentTransform`
    after Session 9). `hiddenUnits` is restored only from `localStorage` /
    `_initPrefs`, not from the hash.

## ✅ Keyboard Navigation

-   Arrow Up/Down: pan 10% of visible span. Arrow Left/Right: pan laterally.
-   Ctrl+=/+/-: zoom in/out.

## ✅ Import / Export Unit Edits, Data Editor Sidebar

## ✅ localStorage Persistence

All UI preferences in `gt_prefs`; unit edits in `gt_unitEdits`.

## ✅ Filter Tab, Left Panel, Settings Panel

## ✅ Custom Scrollbar

-   `src/components/CustomScrollbar.jsx` — pure React, no scroll events.
-   Thumb height proportional to `visSpan / clampSpan` (min 20px).
-   Drag: pans `visibleDomain` synchronously via `onScroll` callback.
-   Track click: pages 90% of visible span up or down.
-   Track height measured via `ResizeObserver` (not ref reads during render).

## ✅ Initial View Centering + Pixel-Fraction Reset Padding

-   `computeResetView` helper computes a 5% pixel-fraction gap at top
    and bottom of the drawing area and a centered `lateralOffset`.
-   Padding is scale-aware: builds a temporary `makeScale` over the
    full data extent, then inverts padded pixel positions through `toAge`
    to find the padded age bounds. Works correctly for linear, log,
    equalSize, and eraEqual.
-   Applied once on mount (guarded by `hasInitializedView` ref).
-   Applied on Reset button and on hidden-units change.
-   Padding is reset-only — during pan/zoom the drawing area fills completely.

## ✅ Zoom-out Headroom

-   `clampMinAge` / `clampMaxAge` = ±10% of data span beyond extent.
-   All pan/keyboard-zoom `clampDomain` calls use these values.
-   `makeScale` / `zoomToFocal` keep the true data extent as `fullMin/fullMax`.

## ✅ Header Drag Live Update

-   `onMove` handler writes `effectiveMarginRef.current` synchronously
    (immediate rAF effect) and calls `setHeaderHeight` (React re-render).
-   Dirty-flag snapshot includes `eM` → each drag event triggers a new frame.

------------------------------------------------------------------------

# Known Issues

1.  **Drag pan snap on release** — RESOLVED (session 6); root cause
    `handleScroll` itself was REMOVED in session 9 along with the
    native scrollbar.

2.  **Canvas vertical stretch on pan/zoom** — RESOLVED (session 6).
    No longer relevant after session 9 removed the sticky wrapper /
    scrollable spacer.

3.  **Picks rounding** — epsilon fix applied to `formatAge`; needs browser verify.

4.  **PNG export with external fonts** — canvas rasterization may not embed
    custom web fonts; system fonts (Arial etc.) are safe.

5.  **eraEqual uses hardcoded era boundaries** — RESOLVED (session 7).
    `buildScale` eraEqual branch calls `deriveEraEqualBands(allUnits)`
    which filters `rankTime === "Era" && parent === "Phanerozoic"` from the
    current unit set and appends a Precambrian band derived from the oldest
    non-Phanerozoic Eon. Falls back to hardcoded ICS 2024/12 values when
    the data is missing or malformed. Covered by 4 vitest cases.

------------------------------------------------------------------------

# Pending Browser Verification (sessions 7–11)

## Session 7 — Phase 3 / dirty-flag / memoizations
-   Dynamic mode renders the timeline at app load (no blank canvas).
-   Wheel zoom (ctrl+scroll), wheel pan, drag pan, arrow-key pan all work.
-   Block hover tooltip fires.
-   Column resize (drag column header right edge) still drives canvas layout.
-   Lateral drag (drag on canvas without clicking a block) pans columns L/R.
-   Export SVG and Export PNG produce sensible output.
-   When idle, CPU drops noticeably (dirty-flag skip).

## Session 7 — eraEqual boundary fix
-   Switch scale type to "Era Equal" — layout matches the previous
    fallback values.
-   Edit a Phanerozoic Era start date in the Data Editor (e.g. Cenozoic
    66 → 70), reselect Era Equal — band reflects new boundary.

## Session 9 — Transform mode removal
-   App still renders correctly with no JS errors after first load.
-   Old hash-encoded URLs (with `zoomMode`/`currentTransform`) load
    without crashing — those keys are ignored, view falls back to defaults.
-   No native scrollbar visible on the timeline pane (`overflow: hidden`).
-   Wheel zoom, wheel pan, drag pan, arrow-key pan, ctrl+= zoom all work
    identically to before.
-   SVG export and PNG export produce the expected output.
-   No console errors mentioning removed refs.

## Session 10 + 11 — Custom scrollbar + UX improvements + blank screen fixes
-   App loads without a blank screen and no console errors (sessions 10 & 11
    fixed two crash-level bugs; verify with all four scale types in localStorage).
-   Thumb appears on right edge, sized proportionally to zoom level.
-   At full zoom-out (full data extent visible), thumb fills the track.
-   Dragging thumb pans the timeline smoothly in real time.
-   Clicking above the thumb pages up; clicking below pages down.
-   After wheel zoom in, thumb shrinks to reflect new visible span.
-   After canvas drag pan or wheel pan, thumb moves to reflect new position.
-   No feedback loops, no snap-back on drag release.
-   On load: columns are centered horizontally in the viewport.
-   On load: small gap between oldest unit (Hadean) and bottom of viewport.
-   Reset button re-centers and re-applies the bottom gap.
-   Hiding a unit triggers a re-center.
-   Wheel zoom out or pan goes slightly beyond the full data extent (into
    the 10% headroom), and snaps back cleanly on next gesture.
-   Dragging the header row's bottom edge resizes continuously.
-   Canvas top margin moves with the drag frame by frame — no jump on release.
-   Switch to "Equal" scale type — timeline renders correctly (verifies the
    equalSize out-of-bounds fix; previously caused blank screen on load).

------------------------------------------------------------------------

# Known Data Considerations

-   **ICS 2024/12** data — current as of project start.
-   **Subepoch units**: 11 manually added; re-running parser drops them.
-   **Ludlow end corrected**: 419.62 → 422.7 Ma.
-   ICS chart GitHub repo cloned at `C:\Users\scott.meek\Documents\ics-chart`.

------------------------------------------------------------------------

# Architecture Lessons (Carry Forward)

These remain load-bearing for the canvas-only renderer:

1.  `effectiveMarginRef` must be read at call time in all closures.
2.  `canvas.clientHeight` could return the full scrollable height when
    the canvas was inside a sticky wrapper in a tall spacer (now
    removed). Always read viewport height from
    `scrollContainerRef.current.clientHeight` — keeps the math
    independent of any future scroll-container restructure.
3.  Separate top and bottom margins: `eM = headerHeight + 8` (top only);
    `BOTTOM_MARGIN = 8` (fixed). Using `eM` for both causes footer drift
    when header height changes.
4.  Zoom must be synchronous (no RAF) so consecutive wheel events each
    read the correct updated domain.
5.  Pan and zoom wheel deltas must be separated (pan uses 4× amplification).
6.  Canvas PNG export: use `drawImage` with explicit source rect to crop
    the backing store. `toBlob()` on the full canvas would export
    mostly-empty pixels.
7.  SVG export: `buildSVGForExport()` reads refs at call time — same
    pattern as drawFrame. Must set explicit `width`/`height` SVG
    attributes for clean serialization.
8.  Wheel/drag pan should use pure pixel arithmetic: `shift = delta * (span /
    viewportPx)`. Calling `buildScale([vMin,vMax],...).invert()` for pan is
    wrong for fixed-partition scales and fragile for log.
9.  `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` each frame is the only reliable
    way to apply DPR scaling — `ctx.scale(dpr,dpr)` inside the resize branch
    is lost when `ctx.restore()` pops the stack on subsequent frames.
10. Canvas backing store sized to `viewH * dpr`. Even though session 9
    removed the sticky wrapper, keep `viewH` sourced from
    `scrollContainerRef` rather than `canvas.clientHeight` so a future
    custom scrollbar in Session 10 can reintroduce a tall content area
    without breaking the math.
11. Pure math belongs in `src/lib/` with vitest coverage, not inline in
    components. 44 tests cover the public scale API. Pre-commit hook at
    `.git/hooks/pre-commit` runs `npm test`.
12. Focal-point zoom generalizes cleanly via **g-space**: parametrize every
    scale type into a unit interval `g(age) ∈ [0,1]`, then anchor in g-space
    where pixel-fraction == g-fraction for all scale types. One formula
    (`newGMin = gFocal - pxFrac · newGSpan`) works for linear/log/equalSize/
    eraEqual. Adding a 5th scale type means implementing `g`/`g.invert` only.
13. The internal `buildViewScale`'s `virtualH` for non-linear scales
    MUST be derived from g-span (`viewportH / gSpan`), not age-span.
    Using `fullSpan/visSpan` over/under-fills the viewport for
    equalSize/eraEqual.
14. React Compiler treats ref-typed props (e.g. `visibleDomainRef`) as
    potentially-reactive. Wrapping `drawFrame` in `useCallback` with those
    props as deps triggers `react-hooks/preserve-manual-memoization`.
    Workaround: inline `drawFrame` as a closure inside the `useEffect`
    that owns the rAF loop; a sibling `tick()` closure handles
    self-scheduling. Do NOT try to hoist `drawFrame` back out.
15. Dirty-flag rAF: keep a closure-scoped `last` snapshot of
    `{vMin, vMax, lateral, cssW, viewH}` inside `drawFrame`. If unchanged,
    `return` early. Effect re-creation on any prop change allocates a
    fresh `last` → forces the next frame to redraw. Don't promote `last`
    to a ref — the effect-recreation reset is the whole point.
16. For fixed-partition scales (eraEqual), derive band boundaries from the
    current unit data via `deriveEraEqualBands(allUnits)`, with a hardcoded
    fallback. Users can edit Phanerozoic Era start/end ages in the data
    editor; hardcoded bands make those edits invisible in the eraEqual view.
17. `makeScale({...}) → { toY, toAge }` is the canonical scale interface.
    `toY`/`toAge` operate in *viewport coordinates* per
    [src/lib/coordinates.md](src/lib/coordinates.md) —
    `toY(vMin) === eM`, `toY(vMax) === viewH`. g-space is an internal
    implementation detail and must never appear at the API boundary.
    All consumers (`drawFrame`, `buildSVGForExport`, wheel/drag pan,
    keyboard zoom) call `makeScale` + `zoomToFocal`. `buildViewScale`
    is no longer exported; treat it as a private helper.
18. `react-hooks/refs` does NOT fire on `ref.current = stateValue`
    written at the top level of the component body when the assignment
    is straightforward "mirror state into a ref" — both
    `effectiveMarginRef.current = headerHeight + 8` and
    `dynamicMin/MaxAgeRef.current = dynamicMin/MaxAge` lint clean
    in current code. Wrapping these in `useEffect` triggers
    `react-hooks/preserve-manual-memoization` errors elsewhere because
    the React Compiler treats the source state as "may be modified
    later". Keep the render-time mirror.
19. Custom scrollbar as a pure function of `visibleDomain` — no
    `scrollTop`, no scroll events, no `isScrollSyncing`. `onScroll`
    directly calls `setVisibleDomain` so no feedback loop is structurally
    possible. The thumb position recomputes on every render from
    `visibleDomain` prop.
20. `clampMinAge`/`clampMaxAge` are the pan/zoom-out clamping extent
    (10% beyond the data bounds). `dynamicMinAge`/`dynamicMaxAge` are the
    true data extent used by `makeScale` and `zoomToFocal`. Keep them
    separate — conflating them would warp the scale math.
21. Dirty-flag snapshot must include `eM` to pick up header-height changes.
    Without it, changing the header height writes `effectiveMarginRef.current`
    synchronously (via the `onMove` handler) but the dirty-flag never
    detects the change and the canvas doesn't update until another event.
22. Custom scrollbar's track height must be measured via `ResizeObserver`
    (stored in state) rather than reading `trackRef.current.clientHeight`
    during render. The `react-hooks/refs` rule forbids ref reads during
    render; derived pixel calculations that transitively depend on a ref
    value are also flagged.
23. `useEffect` dependency arrays are evaluated **immediately during render**,
    not when the effect runs. A `useEffect(..., [layout])` declared before
    `const layout = useMemo(...)` hits the TDZ and throws at runtime even
    though the effect callback itself would access `layout` correctly (after
    render). Always declare effects after all `const`/`useMemo` values they
    reference in their dep array.
24. `buildScale` for `equalSize`: ages older than all display units (beyond
    `displayUnits[n-1].start`) must return `range[1]` (the old/bottom end),
    not `range[0]`. Returning `range[0]` makes `g(vMax) = g(vMin)`,
    collapsing `gSpan` to `≈ 1e-9` and inflating `virtualH` to `≈ 10^12` —
    all drawing lands off-screen. This only triggers when `vMax > fullMax`,
    which Session 10's `computeResetView` (+2% padding) introduced.
25. `commitDomain` (the rAF-debounced `setVisibleDomain` helper) is the
    standard path for all gesture-driven domain updates. Writing directly to
    `visibleDomainRef.current` without a matching `setVisibleDomain` leaves
    React state — and any props derived from it, including the scrollbar's
    `visibleDomain` prop — stale until the next unrelated re-render.
    Only read-only code paths (e.g. the draw loop reading refs) are exempt.
26. `zoomToFocal`'s `fullMin`/`fullMax` define both the g-space
    parametrization and the zoom-out limit. Pass `clampMinAgeRef` /
    `clampMaxAgeRef` to align the zoom-out limit with the pan clamp
    boundary (10% padded headroom). Pass `dynamicMinAgeRef` /
    `dynamicMaxAgeRef` to cap zoom-out at the true data extent. The two
    must never be swapped for `makeScale` — tick generation always uses
    the true extent regardless.
27. Pixel-fraction padding at reset is computed by inverting pixel bounds
    through `makeScale`'s `toAge`. Build a temporary `makeScale` over
    `[dynamicMinAge, dynamicMaxAge]` with those as both `vMin/vMax` and
    `fullMin/fullMax`, then call `toAge(eM - padPx)` and `toAge(viewH + padPx)`.
    This produces a visible pixel gap uniformly across all scale types
    without changing the scale API. Age-domain padding (`vMax + 2% * span`)
    doesn't work for non-linear scales because they clamp out-of-bounds ages
    to `range[1]`, collapsing gSpan and blowing up virtualH.

## Historical (Transform Mode — REMOVED in Session 9)

These guided the SVG/D3 transform pipeline and are preserved here for
context only. They no longer apply:

H1. Single render useEffect — never split (transform mode).
H2. Zoom mode switching must convert state, not reset.
H3. `isScrollSyncing` ref prevented scroll↔zoom feedback loops.
H4. `transformRef` prevented stale closures in transform mode.
H5. Counter-scale useEffect declared **after** render useEffect.
H6. `applyCounterScale` had to be a stable reference (`useCallback(fn,[])`).
H7. `data-block-*` attributes on text elements decoupled render-time
    layout from zoom-time re-layout.
H8. Block label text and rect both needed `data-unit-id` for SVG tooltip.
H9. `handleScroll` returned early when `zoomMode !== "transform"`.
H10. `isScrollSyncing` set synchronously inside scroll-sync useEffect
     gave no protection against the async native `scroll` event.
H11. Sticky canvas wrapper height had to match viewportH (tracked via
     ResizeObserver); using `height: 100%` of the scrollable spacer
     stretched canvas content vertically.
H12. Scroll sync formulas (`ty = eM*(1-k) - scrollTop*(viewH-2*eM)/viewH`)
     used symmetric margin while top/bottom margins were asymmetric —
     a small inconsistency in transform mode.

------------------------------------------------------------------------

# Architectural Decision — Canvas Migration

## Status: Complete (Phases 1–5) + Transform mode removed

All phases of the canvas migration are implemented. The SVG rendering
pipeline (transform mode) was removed entirely in Session 9. Canvas is
now the only renderer.

## Migration phases

### Phase 1 ✅ — Canvas foundation + working zoom
### Phase 2 ✅ — Block text labels
### Phase 3 ✅ — Picks column + time axis
### Phase 4 ✅ — GSSP/GSSA markers + tooltip hit testing
### Phase 5 ✅ — Export (SVG via buildSVGForExport, PNG via buildCanvasPNGBlob)
### Session 9 ✅ — Transform mode REMOVED; canvas is sole renderer

------------------------------------------------------------------------

# Deferred Issues (logged for future sessions)

## D-1 — Non-linear scale behavior during pan/zoom feels disorienting

When panning or zooming in equalSize or eraEqual modes, the visible
layout appears to shift in ways that feel unpredictable. The scale is
always built from the full unit data (not filtered by visible domain),
so this is intrinsic to how discrete-slot scales behave when the viewport
doesn't align with slot boundaries. Needs a design conversation before
any code change. Possible approaches include: snapping the view to slot
boundaries on gesture end, rendering slot boundaries more visibly as
landmarks, or adding a mode that anchors the scale to the full domain
during gestures. Do not attempt to fix without product-level discussion.

## D-2 — Export drift vs live canvas (two issues)

Both in buildSVGForExport in App.jsx:

1. Export passes viewH: viewH - BOTTOM_MARGIN to makeScale, while
   drawFrame passes viewH: viewH. This means export leaves an ~8px
   sliver at the bottom that the live canvas does not. Violates the
   coordinates.md contract that toY(vMax) === viewH.

2. Export passes units: scaleUnits where scaleUnits filters effectiveUnits
   by isUnitVisible for equalSize. Live drawFrame passes units: allUnits
   unfiltered. For equalSize with hidden units, export and live produce
   different layouts.

Fix requires deciding which behavior is correct (likely live's behavior
is authoritative per coordinates.md) and aligning both. Deferred until
export features are being refined.

## D-3 — Data Editor edits and eraEqual band widths

Previous testing showed that editing Phanerozoic Era start ages in the
Data Editor can cause visual glitches in eraEqual mode (Paleocene
covering Precambrian in one observed case). deriveEraEqualBands correctly
reflects the edit in band structure, but the virtual-canvas pixel math
may have a boundary condition not covered by current tests. Add tests
for: edited era boundaries that don't match child unit ages, edited Eon
boundaries, eraEqual with missing Phanerozoic eras.

## D-4 — Scrollbar thumb UX during drag pan ✅ RESOLVED (Session 12)

Both drag-pan and ctrl+wheel zoom now route through `commitDomain`,
which calls `setVisibleDomain` via rAF every frame. Thumb updates live
during all gestures. `onMouseUp` cancels any pending rAF and flushes
synchronously on release.

------------------------------------------------------------------------

# Startup Prompt For Next Session

Paste this at the start of the next chat:

------------------------------------------------------------------------

GeoTimeline — Canvas-only renderer. Sessions 10–13 added custom scrollbar,
initial view centering, zoom-out headroom, scrollbar live-update fixes (S12),
and scale-aware reset padding (S13). Session 14 clamped ticks to unit bounds.
Session 15 replaced D3-based tick generation with span-based fixed-lattice ticks
(pan-stable, no reshuffling during pan; D3 import removed from TimelineCanvas.jsx).
App.jsx ~1650 lines. Test count 44 / 44. Lint 0 / 0.

Stack: React 19 + D3 v7 + Vite + Vitest. Geologic timescale visualizer.
ICS 2024/12 data (189 units in src/data/geologicTime.json).

**Sessions 7–13 changes are NOT browser-verified** — user was remote.
See the "Pending Browser Verification" section in PROJECT_STATE.md for
the full checklist. Prompt the user to run through it before starting
new work.

See PROJECT_STATE.md for full architecture, feature status, and lessons.

Architecture constraints (never break):
- Canvas (TimelineCanvas.jsx) is the only renderer. No transform mode,
  no `<svg>` live element, no `svgRef`, no `zoomBehaviorRef`, no
  `applyCounterScale`, no `handleScroll`. Do NOT reintroduce them.
- Pure math lives in src/lib/scale.js. Public API: `makeScale`
  (canonical), `zoomToFocal`, `buildScale` (tick generation only),
  `clampDomain`, `computeLayout`, `deriveEraEqualBands`,
  `formatTickLabel`. `buildViewScale` is INTERNAL. 44 vitest cases.
  Pre-commit hook runs npm test.
- `makeScale` always receives `fullMin/fullMax = dynamicMinAgeRef/dynamicMaxAgeRef`
  (true data extent) — tick generation and scale behavior anchor to real data.
- `zoomToFocal` receives `fullMin/fullMax = clampMinAgeRef/clampMaxAgeRef`
  (padded extent) — this sets the zoom-out limit to match pan's clamp boundary.
  Keep these two distinctions. Never pass clamp refs to `makeScale`; never
  pass dynamic refs to the `zoomToFocal` call in the wheel handler.
- `clampDomain` calls in TimelineCanvas pan handlers use `clampMinAgeRef`/
  `clampMaxAgeRef`. `makeScale`/`zoomToFocal` use `dynamicMinAgeRef`/
  `dynamicMaxAgeRef`. Never swap these.
- Coordinate contract (src/lib/coordinates.md): `makeScale` returns
  `{ toY, toAge }` in viewport coords — `toY(vMin) === eM`,
  `toY(vMax) === viewH`. g-space is internal.
- Data constants (`ALL_UNITS`, `UNIT_MAP`, `isUnitVisible`) live in
  src/lib/units.js, NOT inline in App.jsx.
- Canvas rendering in src/components/TimelineCanvas.jsx — passive
  component; all state in App.jsx, passed as props.
- drawFrame is an inline closure inside a useEffect in TimelineCanvas.jsx;
  NOT a useCallback. React Compiler flags ref-typed props. Sibling
  `tick()` closure self-schedules via rAF.
- drawFrame dirty-flag snapshot: `{ last vMin/vMax/lateral/cssW/viewH/eM }`.
  Skip redraws when unchanged. Effect re-creation resets the snapshot —
  don't hoist `last` to a ref.
- buildScale() is stateless w.r.t. zoom — never filter slots by visible domain.
- buildScale eraEqual branch MUST use `deriveEraEqualBands(allUnits)`;
  never re-inline hardcoded era boundaries.
- `zoomToFocal` anchors in g-space — one formula for all scale types.
- No setState during zoom gestures — visibleDomainRef.current only.
- No setState during drag pan — ref-only; single flush on mouseUp.
- effectiveMarginRef.current = headerHeight + 8 (TOP margin only).
  The header drag `onMove` handler must write BOTH the ref (for immediate
  rAF effect) AND call setHeaderHeight (for React re-render). Mirror it at
  the top level of the component body — do NOT wrap in useEffect.
- BOTTOM_MARGIN = 8 not used in drawFrame; used in SVG export path.
- viewH = scrollContainerRef.current.clientHeight (NOT canvas.clientHeight).
- Canvas backing store sized to viewH*dpr.
- ctx.setTransform(dpr,0,0,dpr,0,0) applied every frame (not only on resize).
- Clip region [0,0,cssW,viewH] via ctx.save()/ctx.clip() each frame.
- Wheel/drag pan: pure pixel arithmetic, no buildScale call.
- hitBoxesRef populated each frame for tooltip hit testing.
- Export: buildSVGForExport() for SVG, buildCanvasPNGBlob() for PNG.
- Scroll container is `overflow: hidden`. CustomScrollbar is absolutely
  positioned on right edge — no scrollTop, no scroll events, no feedback
  loop. Track height tracked via ResizeObserver (not ref reads during render).
- URL hash encodes only `visibleDomain` and `lateralOffset`. `hiddenUnits`
  restored from localStorage only.
- `computeResetView({ dynamicMinAge, dynamicMaxAge, layout, viewportWidth,
  scaleType, effectiveUnits, equalSizeLevel, eM, viewH })` computes a 5%
  pixel-fraction gap at top and bottom (scale-aware via `makeScale`/`toAge`)
  and a centered `lateralOffset`. Call it in: mount effect (guarded by
  `hasInitializedView`), `handleResetZoom`, and the hidden-units reset effect.
  `RESET_PADDING_FRACTION = 0.05`; `RESET_DOMAIN_PADDING_FACTOR` is removed.

Lint baseline: 0 errors / 0 warnings. Keep it that way.

------------------------------------------------------------------------
