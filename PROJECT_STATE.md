# PROJECT_STATE.md

*Last Updated: 2026-03-25*

------------------------------------------------------------------------

# Current State Summary

Full rendering pipeline stable. Data layer updated from ICS 2024/12.
Dual zoom modes, four scale types, data editor with resizable sidebar,
filter tree, scroll sync — all working. Two Picks column bugs are active
(rounding display, font size on sigFigs change — fixes applied this
session, needs browser verification). Three new features added this
session: GSSP/GSSA schema split, dual timescale/stratigraphic naming
with three-way toggle, and auto contrast text color on blocks.

------------------------------------------------------------------------

# Architecture Overview

## Rendering Pipeline

-   Single `useEffect` owns all SVG construction (clear → rebuild).
-   Second `useEffect` owns zoom/pan event binding, tears down cleanly.
-   Third `useEffect` re-applies counter-scale after each render
    — **must be declared after the render effect** so React runs it
    second (declaration order = execution order).
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

# Data File

`src/data/geologicTime.json` was regenerated from the official ICS
2024/12 Linked Data export (`chart.txt`, Turtle/RDF format) using
`scripts/parse-chart.cjs`. A second source file, `scripts/xlabels-en.ttl`
(copied from the ICS chart GitHub repo), provides context-annotated
English labels.

**178 units** parsed from ICS 2024/12.

**Fields per unit:**

| Field                      | Coverage    | Notes                                                   |
|----------------------------|-------------|---------------------------------------------------------|
| `startUncertainty`         | 104 / 178   | null for Cenozoic and Precambrian units                 |
| `endUncertainty`           | 102 / 178   | same pattern                                            |
| `ratifiedGSSP`             | 130 / 178   | `true` = has ratified GSSP, `false` = does not          |
| `ratifiedGSSA`             | 19 / 178    | `true` = has ratified GSSA, `false` = does not          |
| `shortCode`                | 178 / 178   | CGMW short codes (e.g. `j1`, `PH`)                     |
| `order`                    | 178 / 178   | ICS chart display order                                 |
| `displayNameStratigraphic` | 15 / 178    | Only set when stratigraphic name differs from timescale |

**Dual-label units** (15 total, e.g. "Early Cretaceous" / "Lower
Cretaceous") — timescale form in `displayName`, stratigraphic form in
`displayNameStratigraphic`.

Parser lives at `scripts/parse-chart.cjs` — re-runnable against any
future chart.txt update. Also reads `scripts/xlabels-en.ttl`; normalize
CRLF → LF before block splitting (done in parser).

ICS chart GitHub repo cloned at `C:\Users\scott.meek\Documents\ics-chart`
for reference. Contains 26-language label data and older isc2020.ttl.

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
-   **Log** — `ln(age+1)` mapped through a linear scale.
-   **Equal Size** — each unit at `equalSizeLevel` gets equal pixel
    height. Configurable level via dropdown.
-   **Era Equal** — four hard-coded eras each get one quarter of the
    height.

## ✅ Scrollbar Sync

-   `scrollContainerRef` div wraps the SVG with `overflow: scroll`.
-   Spacer div sets scrollable extent (`scrollableSize` state).
-   SVG + headers + resize handles pinned `position: sticky`.
-   `isScrollSyncing` ref prevents scroll↔zoom feedback loops.

## ✅ Column Headers

-   Div-based sticky header bar (40px = `MARGIN`).
-   Positioned using `col.start * k + tx` to track zoom and lateral pan.
-   Header labels respect the active **Naming** mode (see below).

## ✅ Resize Handles (columns)

-   DOM `<div>` elements overlaid on the sticky wrapper.
-   Delta divided by zoom scale factor `k`.
-   Double-click calls `autoFitColumnWidth()`.

## ✅ Time Column

-   Major/minor tick system.
-   Labels via `formatTickLabel()` respecting Ga/Ma/ka unit selection.

## ✅ Naming Mode (Timescale / Stratigraphic / Both)

-   Three-way toggle in Display tab: **Timescale**, **Stratigraphic**,
    **Both**.
-   Applies to both block labels and column headers simultaneously.
-   `columnConfig` stores both `label` (timescale) and `labelStrat`
    (stratigraphic) per level.
-   Only 15 units have distinct stratigraphic block labels; all others
    display identically in all modes.
-   "Both" mode renders "Early Cretaceous / Lower Cretaceous" etc.

## ✅ Auto Text Contrast

-   `BlockRenderer.js` uses NTSC luminance formula to choose black or
    white label text based on block fill color.
-   Toggle checkbox in Display tab: **Auto text contrast** (on by default).

## ⚠️ Picks Column — 2 Active Bugs (fixes applied, needs browser verify)

### What is implemented
-   Auto mode: deepest visible level with coverage.
-   Manual mode: ceiling level with fallback.
-   Present-day (0 Ma) always included.
-   `boundaryAges` is `[{age, uncertainty}]` — PicksRenderer
    destructures each entry.
-   `showUncertainty` appends ` ±value` to the label text when true
    and uncertainty is non-null.
-   Default sigFigs: **4**.
-   `formatAge` strips trailing zeros:
    `String(parseFloat(age.toFixed(decimals)))`.
-   Floor rule: `decimals = max(0, sigFigs−1−magnitude)` — never
    coarser than 1 Ma (integer) precision.
-   Epsilon guard on `Math.log10` floor to prevent floating-point
    magnitude miscalculation.

### BUG 1 — Rounding display (fix applied, verify in browser)
Applied `+ 1e-10` epsilon to `Math.log10` in `formatAge` to prevent
floating-point floor errors (e.g. `log10(1000) = 2.9999...`). Verify
that age labels now display correctly at all sigFig settings.

### BUG 2 — Font size shifts when sigFigs is changed (fix applied, verify in browser)
Root cause: counter-scale `useEffect` was declared **before** the render
`useEffect`. React runs effects in declaration order, so counter-scale
was firing on the old DOM before the render rebuilt it, leaving new
elements unscaled. Fixed by moving the counter-scale effect to be
declared after the render effect.

## ✅ Filter Tab

-   Recursive tree with expand/collapse, checkboxes, ancestor-aware
    disabling, "Show All" reset.

## ✅ Data Editor Sidebar (Data Tab)

-   **Resizable** — drag handle on the left edge; `editorWidth` state
    (default 820px, min 300px).
-   Columns: Name, Full Name, Rank (read-only), Start, ±Start (editable),
    End, ±End (editable), Parent, Color, Boundary (read-only), Code (read-only).
-   **Boundary** column shows "✓ GSSP" (green), "GSSA" (gray), or "—"
    by reading both `ratifiedGSSP` and `ratifiedGSSA` boolean fields.
-   Search, rank filter, sortable headers, inline editing, color picker.
-   Edited cells/rows highlighted yellow.
-   `commitEdit` parses `startUncertainty` / `endUncertainty` as nullable
    floats.
-   Edits stored in `unitEdits` state — **session-only, no persistence**.

## ✅ Display Tab

-   Font size slider, font family picker, label orientation.
-   Auto text contrast toggle.
-   Naming mode: Timescale / Stratigraphic / Both.
-   Scale type selector (Linear, Log, Equal Size, Era Equal).

## ✅ View Tab

-   Orientation, zoom mode, reset zoom, time unit (Ga/Ma/ka).

## ✅ Columns Tab

-   Show/hide hierarchy columns (Super-Eon → Age).

## ⚠️ Export Tab

-   Placeholder — no functionality implemented.

------------------------------------------------------------------------

# Known Issues / Uncertain Behaviour

1.  **Picks rounding & font size** — fixes applied this session, needs
    browser verification before closing.

2.  **Scroll sync math in transform mode** — `scrollTop ↔ ty`
    conversion may be imperfect at extreme zoom levels or after lateral
    pan.

3.  **Counter-scale in dynamic mode** — font sizes are always 1:1 in
    dynamic mode (no matrix transform). Confirm this is intentional.

4.  **equalSize scale + hidden units** — `buildScale("equalSize")` uses
    `effectiveUnits` (full dataset). Hiding units may not affect slot
    distribution as expected.

5.  **Data editor edits are session-only** — no persistence across page
    reloads.

6.  **Lateral offset resets on mode switch** — sideways pan position
    lost when switching zoom modes.

------------------------------------------------------------------------

# Known Data Considerations

-   Data file is based on **ICS 2024/12** — current as of project start.
-   **Unnamed placeholder units** exist: Cambrian Stages 2, 3, 4, 10 and
    Upper Pleistocene. Now display as "Cambrian Stage 2" etc. from
    xlabels-en.ttl. Renderer handles missing `displayName` gracefully.
-   **Subseries/Subepoch** rank (Quaternary/Neogene) not yet in the
    level 0–6 column system.
-   **ICS colors** should be verified against current chart before
    export features are finalized.
-   **Live API** at stratigraphy.org/chartdata — evaluate when live
    data updating becomes a priority.
-   **ICS chart GitHub repo** cloned at
    `C:\Users\scott.meek\Documents\ics-chart` — contains 26-language
    label data (`source/multilang/chart-prefLabels.ttl`), English
    definitions, and older `isc2020.ttl`.

------------------------------------------------------------------------

# Architecture Lessons (Carry Forward)

1.  Rendering pipeline must remain single-source-of-truth.
2.  Zoom mode switching must convert state representations — not reset.
3.  Resize handles must not trigger SVG teardown (they are DOM divs).
4.  DOM resize handles divide delta by `k` — essential at non-1 zoom.
5.  `isScrollSyncing` ref prevents scroll↔zoom feedback loops.
6.  `transformRef` / `visibleDomainRef` / `lateralOffsetRef` hold latest
    values for closures without stale-closure bugs.
7.  Structural changes must be introduced in minimal deltas.
8.  Counter-scale `useEffect` must be declared **after** the render
    `useEffect` — React executes effects in declaration order.
9.  `xlabels-en.ttl` must have CRLF normalized to LF before block
    splitting (`replace(/\r\n/g, "\n")`).

------------------------------------------------------------------------

# Next Session Plan

## Priority 1 — Verify Picks Bug Fixes
-   Confirm in browser that rounding is correct at all sigFig settings.
-   Confirm font size no longer shifts when sigFigs dropdown changes.

## Priority 2 — Tooltip / Info Panel on Block Hover
-   Show unit metadata on hover: full name, age range with uncertainty,
    GSSP/GSSA status, short code, stratigraphic name if different.
-   Two implementation options:
    -   SVG `<title>` appended to each block `<rect>` — browser-native
        tooltip, zero extra state, but styling is browser-controlled.
    -   Floating `<div>` driven by `mousemove` on the SVG — full style
        control, requires a `hoverUnit` state and pointer-events on rects.
-   Floating div is preferred for consistent cross-browser appearance.

## Priority 3 — Export Tab
-   SVG download of current view.
-   PNG rasterisation option.

## Priority 4 — Data Editor Persistence
-   JSON export/import of `unitEdits`, or auto-persist to `localStorage`.

## Priority 5 — Scroll Sync Audit
-   Verify math at edge cases (extreme zoom, horizontal orientation).

## Priority 6 — Dynamic Mode Counter-Scale
-   Decide whether dynamic mode should scale text/strokes with zoom.

## Priority 7 — equalSize + Hidden Units
-   Pass visible-only units to `buildScale("equalSize")`.

------------------------------------------------------------------------

# Startup Prompt For Next Session

Paste this at the start of the next chat:

------------------------------------------------------------------------

"Resume from 2026-03-25 state. Single-useEffect rendering pipeline
intact. Dual zoom modes, four scale types, data editor with resizable
sidebar, filter tree, scroll sync — all stable. geologicTime.json
regenerated from ICS 2024/12 with 178 units; fields include
startUncertainty, endUncertainty, ratifiedGSSP (bool), ratifiedGSSA
(bool), shortCode, order, displayNameStratigraphic (15 units).
xlabels-en.ttl added to scripts/ for dual-label parsing. Three-way
naming toggle (Timescale / Stratigraphic / Both) applies to block labels
and column headers. Auto text contrast (NTSC luminance) added to
BlockRenderer with toggle. Counter-scale useEffect bug fixed (now
declared after render effect). Picks column has two active bug fixes
applied (rounding epsilon, counter-scale order) — verify in browser
first. Next priority: verify picks fixes, then implement tooltips on
block hover (floating div preferred over SVG title), then Export tab.
Do not split the render useEffect."

------------------------------------------------------------------------
