# PROJECT_STATE.md

*Last Updated: 2026-03-24*

------------------------------------------------------------------------

# Current State Summary

Major architectural expansion since the Feb 25 stable baseline. The
single-`useEffect` rendering pipeline remains intact. On top of it we
have added dual zoom modes, four time scale types, a data editor
sidebar, a filter tree, display settings, and a scroll-sync layer.

------------------------------------------------------------------------

# Architecture Overview

## Rendering Pipeline

-   Single `useEffect` owns all SVG construction (clear → rebuild).
-   Second `useEffect` owns zoom/pan event binding, tears down cleanly.
-   Third `useEffect` re-applies counter-scale after each render
    (transform mode only).
-   Two more `useEffect`s manage scrollbar ↔ zoom state sync.
-   `buildScale()` is a pure function called inside the render effect —
    returns one of four scale implementations.
-   `computeLayout()` accepts an `initialOffset` parameter so columns
    start after the `MARGIN` header zone.
-   Layered SVG groups: `backgroundLayer` → `blockLayer` → `picksLayer`.

## Data Layer

-   `ALL_UNITS` and `UNIT_MAP` are module-level constants (built once,
    not re-derived on every render).
-   `effectiveUnits` = `ALL_UNITS` with `unitEdits` overlaid — used
    everywhere instead of raw data.
-   `isUnitVisible(unitId, hiddenUnits)` walks the ancestor chain so
    hiding a parent implicitly hides children.
-   `dynamicMinAge` / `dynamicMaxAge` are derived from currently visible
    units, not hardcoded ICS bounds.

------------------------------------------------------------------------

# Feature Status

## ✅ Dual Zoom Modes

### Transform Mode (default)
-   D3 `zoom` applies a matrix transform to `zoomLayer <g>`.
-   Counter-scale keeps text and strokes constant screen size.
-   Ctrl+wheel or drag to pan/zoom.
-   `transformRef` keeps latest transform without triggering re-render.

### Dynamic Mode
-   No matrix transform — `visibleDomain` state drives `buildScale()`
    on every render.
-   Wheel zoom updates `visibleDomain` and resets D3 internal transform
    to identity after each event.
-   Mouse drag pans axially (clamps to data extent, preserves span) and
    laterally (`lateralOffset` state + ref).
-   Switching modes converts between transform↔domain representations
    so the view position is preserved.

## ✅ Time Scale Types (`buildScale()`)

-   **Linear** — standard `d3.scaleLinear`.
-   **Log** — `ln(age+1)` mapped through a linear scale; has `.ticks()`
    returning geologically sensible candidates.
-   **Equal Size** — each unit at `equalSizeLevel` gets equal pixel
    height, regardless of time span. Configurable level via dropdown.
-   **Era Equal** — four hard-coded eras (Cenozoic / Mesozoic /
    Paleozoic / Precambrian) each get one quarter of the height.

## ✅ Scrollbar Sync

-   A `scrollContainerRef` div wraps the SVG with `overflow: scroll`.
-   A spacer div inside it sets the scrollable extent (`scrollableSize`
    state — computed from zoom level / visible domain span × viewport).
-   SVG + headers + resize handles are pinned `position: sticky` inside
    the spacer so they stay viewport-fixed while the scrollbar thumb is
    draggable.
-   Scroll events update zoom state; zoom state updates scroll position
    — protected by `isScrollSyncing` ref to prevent loops.

## ✅ Column Headers

-   Div-based sticky header bar (40px = `MARGIN`) at top (vertical) or
    left (horizontal).
-   Positioned using `col.start * k + tx` to track zoom and lateral pan.
-   Auto-hides overflow text.

## ✅ Resize Handles

-   DOM `<div>` elements (not SVG) overlaid on the sticky wrapper.
-   Delta divided by zoom scale factor `k` so dragging feels linear at
    all zoom levels.
-   Double-click calls `autoFitColumnWidth()` — uses a canvas 2D
    context to measure the widest text at the current font, then adds
    padding.

## ✅ Time Column

-   Major/minor tick system.
-   Tick labels formatted via `formatTickLabel()` respecting Ga/Ma/ka
    unit selection and appropriate decimal places.
-   Background rect + ticks rendered into `backgroundLayer`.

## ⚠️ Picks Column — Active Bugs (next session)

-   Auto mode: deepest visible level with coverage.
-   Manual mode: ceiling level with fallback to shallower levels.
-   Present-day boundary (0 Ma) always included.
-   `boundaryAges` is now `[{age, uncertainty}]` — PicksRenderer
    destructures `{ age, uncertainty }` on each entry.
-   Uncertainty text appended to label as ` ±value` when
    `showUncertainty` is true and uncertainty is non-null.
-   Default sigFigs changed from 3 → 4.
-   `formatAge` now strips trailing zeros via
    `String(parseFloat(toFixed(...)))`.

**BUG 1 — Rounding is incorrect.**
Something is wrong with how ages are being rounded/displayed. Not yet
diagnosed. Likely candidates: `parseFloat` floating-point edge cases,
`toFixed` rounding behaviour, or the sigFigs formula interacting badly
with certain magnitude values.

**BUG 2 — Font size changes when sigFigs is changed.**
Changing the significant figures dropdown causes an unexpected change in
the rendered font size inside the picks column. Likely cause: the
counter-scale `useEffect` (which adjusts `font-size` on all `[data-base-font-size]`
elements after each render) is running and applying an incorrect scale
factor. The render effect re-fires when `picksSigFigs` changes (it's in
the dependency array), rebuilds the SVG, then the counter-scale effect
re-applies — worth checking whether the `k` value and `data-base-font-size`
attributes are being set and re-read correctly after the rebuild.

## ✅ Filter Tab

-   Recursive tree of all non-Stage units with checkboxes.
-   Expand/collapse per node (▸/▾).
-   Ancestor-hidden nodes shown at 0.4 opacity and disabled.
-   "Show All" reset button.
-   Hiding units resets zoom to identity / full domain.

## ✅ Data Editor Sidebar (Data Tab)

-   Toggle open/close from ribbon.
-   700px sidebar with scrollable table.
-   Columns: Name, Full Name, Rank, Start (Ma), End (Ma), Parent, Color.
-   Search by name/id; filter by rank; sortable columns (click header).
-   Inline cell editing: click → text input → Enter/Tab/Blur to commit,
    Escape to cancel.
-   Color column uses `<input type="color">` picker.
-   Edited cells highlighted yellow; edited rows highlighted.
-   "Reset All Edits" button with count shown in ribbon.
-   Edits stored in `unitEdits` state — session only, no persistence.

## ✅ Display Tab

-   Font size slider (6–16px).
-   Font family picker (Arial, Times New Roman, Courier New, Georgia,
    Verdana).
-   Label orientation: horizontal / vertical (rotated -90°).
-   Scale type selector; "Equal Size" shows level dropdown.

## ✅ View Tab

-   Orientation toggle (vertical / horizontal).
-   Zoom mode radio (Transform / Dynamic).
-   Reset Zoom button.
-   Time unit radio (Ga / Ma / ka).

## ✅ Columns Tab

-   Checkboxes to show/hide hierarchy columns (Super-Eon → Stage).

## ⚠️ Export Tab

-   Placeholder only — no functionality implemented.

------------------------------------------------------------------------

# Known Issues / Uncertain Behaviour

1.  **Scroll sync math in transform mode** — the `scrollTop ↔ ty`
    conversion formula is non-trivial and may be imperfect at extreme
    zoom levels or after lateral pan.

2.  **Counter-scale in dynamic mode** — text and stroke counter-scale is
    applied by the separate `useEffect` after each render, but dynamic
    mode doesn't use a matrix transform so font sizes are always 1:1
    (never shrink with zoom). This is correct behaviour for dynamic mode
    but worth confirming is intentional.

3.  **equalSize scale + hidden units** — `buildScale("equalSize")` uses
    `allUnits` (which is `effectiveUnits` = full dataset), not the
    filtered-visible subset. Hiding units may not affect the slot
    distribution as expected.

4.  **Data editor edits are session-only** — `unitEdits` lives in React
    state. Refreshing the page loses all edits. No import/export of
    edits.

5.  **Lateral offset resets on mode switch** — switching zoom mode
    resets lateral offset to 0. If the user has scrolled the chart
    sideways in dynamic mode, that position is lost.

6.  **`dynamicMaxAge` / `dynamicMinAge` flicker** — these are derived
    from `effectiveUnits` filtered by `hiddenUnits`. If the user hides
    all units at the oldest extent, the scale domain shrinks, and the
    `useEffect` resets zoom. This is expected but may surprise users.

------------------------------------------------------------------------

# Known Data Considerations

-   Data file is based on the **ICS 2024/12 chart** — current as of
    project start.
-   **Unnamed placeholder units** exist in the Cambrian (Stages 2, 3, 4,
    10) and Quaternary (Upper Pleistocene). The renderer must handle null
    or missing `displayName` without errors.
-   **Subseries/Subepoch** rank is formally ratified in the Quaternary
    and Neogene but is not yet represented in the level 0–6 column
    system. A level may need to be added to accommodate it correctly.
-   **ICS color standards** should be verified against the current 2024/12
    chart before display or export features are finalized.
-   A **machine-readable API data source** exists at
    stratigraphy.org/chartdata and should be evaluated when live data
    updating becomes a priority.

------------------------------------------------------------------------

# Architecture Lessons (Carry Forward)

1.  Rendering pipeline must remain single-source-of-truth.
2.  Zoom mode switching must convert state representations — not reset.
3.  Resize handles must not trigger SVG teardown (they are DOM divs now).
4.  DOM resize handles divide delta by `k` — essential at non-1 zoom.
5.  `isScrollSyncing` ref prevents scroll↔zoom feedback loops.
6.  `transformRef` / `visibleDomainRef` / `lateralOffsetRef` hold latest
    values for closures without causing stale-closure bugs.
7.  Structural changes must be introduced in minimal deltas.

------------------------------------------------------------------------

# Next Session Plan

## Priority 1 — Export Tab
-   SVG download (current view as-is).
-   PNG rasterisation option.
-   Consider whether to export the full timeline or the current viewport
    only.

## Priority 2 — Data Editor Persistence
-   JSON export/import of `unitEdits`.
-   Or: persist to `localStorage` automatically.

## Priority 3 — Scroll Sync Audit
-   Verify scroll ↔ zoom math is correct in both modes at edge cases
    (extreme zoom, near-zero visible domain, horizontal orientation).

## Priority 4 — Dynamic Mode Counter-Scale
-   Decide whether dynamic mode should also keep text/strokes at
    constant screen size (requires scaling font sizes and stroke widths
    by `fullSpan / visSpan` factor).

## Priority 5 — equalSize + Hidden Units
-   Pass visible-only units to `buildScale("equalSize")` so hidden units
    are excluded from slot allocation.

------------------------------------------------------------------------

# Startup Prompt For Next Session

Paste this at the start of the next chat:

------------------------------------------------------------------------

"Resume from current working state (2026-03-24). Single-useEffect
rendering pipeline intact. Dual zoom modes (transform / dynamic) both
working. Four scale types (linear, log, equalSize, eraEqual) implemented.
Data editor sidebar functional. Filter tree with hide/show working.
Scroll sync layer in place. Export tab is an empty placeholder — that
is the next thing to implement. Maintain architecture and avoid
splitting the render useEffect."

------------------------------------------------------------------------
