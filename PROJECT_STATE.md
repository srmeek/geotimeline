# PROJECT_STATE.md

*Last Updated: 2026-04-04 (~ approximate markers, picks font size fix)*

------------------------------------------------------------------------

# Current State Summary

Full rendering pipeline stable in vertical orientation. Horizontal
orientation code fully removed. Data layer is ICS 2024/12 (178 units)
plus 11 manually-added Subepoch units (189 total). Dual zoom modes, four
scale types, data editor with resizable sidebar, filter tree, scroll
sync — all working. Picks column shows ~ prefix on approximate boundaries
when showUncertainty is on. Picks font size now tracks the global font
size slider and zoom counter-scale. One Picks bug fix (rounding epsilon)
remains applied but unverified in browser.

------------------------------------------------------------------------

# Architecture Overview

## Rendering Pipeline

-   Single `useEffect` owns all SVG construction (clear → rebuild).
-   Second `useEffect` owns zoom/pan event binding, tears down cleanly.
-   Third `useEffect` re-applies counter-scale after each render
    — **must be declared after the render effect** so React runs it
    second (declaration order = execution order).
-   Two more `useEffect`s manage scrollbar ↔ zoom state sync.
-   Two more `useEffect`s persist preferences to localStorage.
-   `buildScale()` is a pure function called inside the render effect —
    returns one of four scale implementations.
-   `computeLayout()` accepts an `initialOffset` parameter so columns
    start after the `MARGIN` header zone.
-   Layered SVG groups: `backgroundLayer` → `blockLayer` → `picksLayer`.

## Data Layer

-   `ALL_UNITS` and `UNIT_MAP` are module-level constants (built once,
    not re-derived on every render).
-   `_initPrefs` and `_initUnitEdits` are module-level IIFEs that parse
    `localStorage` once on load and seed the lazy `useState` initializers.
-   `effectiveUnits` = `ALL_UNITS` with `unitEdits` overlaid — used
    everywhere instead of raw data.
-   `isUnitVisible(unitId, hiddenUnits)` walks the ancestor chain so
    hiding a parent implicitly hides children.
-   `dynamicMinAge` / `dynamicMaxAge` derived from currently visible
    units, not hardcoded ICS bounds.

## Orientation Notes

-   **Vertical only.** Young (0 Ma) at top, old at bottom. Scale range
    `[MARGIN, height−MARGIN]`. Columns laid out left→right.
-   Block building uses `colBandStart`/`colBandWidth`/`blockY`.
-   Horizontal orientation has been fully deleted — no state, no branches,
    no dead code remaining.

------------------------------------------------------------------------

# Data File

`src/data/geologicTime.json` regenerated from ICS 2024/12 Linked Data
export (`chart.txt`, Turtle/RDF format) using `scripts/parse-chart.cjs`.
A second source file, `scripts/xlabels-en.ttl` (from ICS chart GitHub
repo), provides context-annotated English labels.

**178 units** parsed from ICS 2024/12, plus 11 manually-added Subepoch
units = **189 total** in `geologicTime.json`.

**Fields per unit:**

| Field                      | Coverage    | Notes                                                           |
|----------------------------|-------------|-----------------------------------------------------------------|
| `startUncertainty`         | 104 / 178   | null for Cenozoic and Precambrian units                         |
| `startApproximate`         | 18 / 178    | `true` = `skos:note "uncertain"` on start boundary in chart.txt |
| `endUncertainty`           | 102 / 178   | same pattern as startUncertainty                                |
| `endApproximate`           | 18 / 178    | `true` = `skos:note "uncertain"` on end boundary in chart.txt   |
| `ratifiedGSSP`             | 130 / 178   | `true` = has ratified GSSP, `false` = does not                  |
| `ratifiedGSSA`             | 19 / 178    | `true` = has ratified GSSA, `false` = does not                  |
| `shortCode`                | 178 / 178   | CGMW short codes (e.g. `j1`, `PH`)                             |
| `order`                    | 178 / 178   | ICS chart display order                                         |
| `displayNameStratigraphic` | 15 / 178    | Only set when stratigraphic name differs from timescale         |

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
-   Header labels respect the active **Naming** mode.

## ✅ Resize Handles (columns)

-   DOM `<div>` elements overlaid on the sticky wrapper.
-   Delta divided by zoom scale factor `k`.
-   Double-click calls `autoFitColumnWidth()`.

## ✅ Time Column

-   Major/minor tick system.
-   Labels via `formatTickLabel()` respecting Ga/Ma/ka unit selection.

## ✅ Naming Mode (Timescale / Stratigraphic / Both)

-   Three-way toggle in Display tab.
-   Applies to both block labels and column headers simultaneously.

## ✅ Auto Text Contrast

-   `BlockRenderer.js` uses NTSC luminance formula to choose black or
    white label text based on block fill color.
-   Toggle checkbox in Display tab (on by default).

## ✅ Label Suppression on Sub-Threshold Blocks

-   `BlockRenderer.js` skips rendering the label text when `block.height`
    is less than `fontSize × 1.5`.

## ✅ Tooltip on Block Hover

-   `hoverUnit` and `tooltipPos` state in App.
-   Block rects carry a `data-unit-id` attribute (set in `BlockRenderer.js`).
-   `onMouseMove` on the SVG element reads `e.target.getAttribute("data-unit-id")`,
    looks up the unit in `effectiveUnits`, and sets hover state.
-   `onMouseLeave` clears `hoverUnit`.
-   Floating `position: fixed` dark tooltip shows: display name,
    stratigraphic name (if distinct), rank, and age range in Ma.

## ✅ Export Tab

-   **Download SVG** — `XMLSerializer` → SVG blob → `<a>` click.
-   **Download PNG** — SVG blob → `Image` → `canvas` → PNG blob → `<a>` click.
-   **Copy PNG to Clipboard** — PNG blob → `navigator.clipboard.write(ClipboardItem)`.

## ✅ localStorage Persistence

-   Module-level `_initPrefs` IIFE parses `gt_prefs` key once on load.
-   Module-level `_initUnitEdits` IIFE parses `gt_unitEdits` key once on load.
-   All UI preferences use lazy `useState(() => _initPrefs.x ?? default)`.
-   `hiddenUnits` (Set) serialized as array in `gt_prefs`.
-   Preferences saved: timeUnit, columnConfig, columnWidths, labelMode,
    contrastText, fontSize, fontFamily, labelOrientation, scaleType,
    equalSizeLevel, picksMode, manualPicksLevel, showUncertainty,
    picksSigFigs, hiddenUnits.
-   `unitEdits` saved separately to `gt_unitEdits`.
-   Two dedicated save `useEffect`s (after the counter-scale effect).

## ✅ Picks Column

-   Auto mode: deepest visible level with coverage.
-   Manual mode: ceiling level with fallback.
-   Present-day (0 Ma) always included.
-   `showUncertainty` appends ` ±value` to label when true and uncertainty is non-null.
-   `showUncertainty` prepends `~` to label when true and `approximate` is true.
-   `approximate` field sourced from `startApproximate` in `geologicTime.json`
    (derived from `skos:note "uncertain"` in ICS chart.txt boundary blocks).
-   `boundaryAges` entries carry `{ age, uncertainty, approximate }`.
-   Font size tracks the global `fontSize` state — passed to `renderPicks()` and
    stored in `data-base-font-size` so zoom counter-scale applies correctly.
-   Default sigFigs: **4**.
-   `formatAge` strips trailing zeros via `String(parseFloat(...))`.
-   Epsilon guard: `Math.floor(Math.log10(Math.abs(age)) + 1e-10)`.

### ⚠️ BUG — Rounding display (fix applied, verify in browser)
`+ 1e-10` epsilon prevents floating-point floor errors (e.g.
`log10(1000) = 2.9999...`). Verify age labels correct at all sigFig settings.

## ✅ Filter Tab

-   Recursive tree with expand/collapse, checkboxes, ancestor-aware
    disabling, "Show All" reset.

## ✅ Data Editor Sidebar (Data Tab)

-   Resizable sidebar, sortable columns, inline editing, color picker.
-   Edited cells/rows highlighted yellow.
-   Edits now persisted to `localStorage` (`gt_unitEdits` key).

## ✅ Display Tab

-   Font size slider, font family picker, label orientation.
-   Auto text contrast toggle. Naming mode. Scale type selector.

## ✅ View Tab

-   Zoom mode, reset zoom, time unit (Ga/Ma/ka).

## ✅ Columns Tab

-   Show/hide hierarchy columns (Super-Eon → Age).

------------------------------------------------------------------------

# Known Issues / Uncertain Behaviour

1.  **Picks rounding** — epsilon fix applied to `formatAge`, needs browser
    verification at all sigFig settings.

2.  **Scroll sync math in transform mode (vertical)** — `scrollTop ↔ ty`
    conversion may be imperfect at extreme zoom levels or after lateral
    pan.

3.  **Counter-scale in dynamic mode** — font sizes are always 1:1 in
    dynamic mode (no matrix transform). Confirm this is intentional.

4.  **equalSize scale + hidden units** — `buildScale("equalSize")` uses
    `effectiveUnits` (full dataset). Hiding units may not affect slot
    distribution as expected.

5.  **Lateral offset resets on mode switch** — sideways pan position
    lost when switching zoom modes.

6.  **Tooltip near screen edges** — tooltip positioned at cursor + 14px;
    no edge detection to flip it when near the right/bottom edge.

7.  **PNG export with external fonts** — canvas rasterization may not
    embed custom web fonts; system fonts (Arial etc.) are safe.

------------------------------------------------------------------------

# Known Data Considerations

-   Data file is based on **ICS 2024/12** — current as of project start.
-   **Unnamed placeholder units** exist: Cambrian Stages 2, 3, 4, 10 and
    Upper Pleistocene. Displayed via xlabels-en.ttl labels.
-   **Subepoch/Subseries** rank now implemented (level 5.5) with 11
    units across Holocene, Pleistocene, Pliocene, and Miocene. Units
    were added manually (not in `chart.txt`). Colors inherit from parent
    epochs. `parse-chart.cjs` updated to handle `Subepoch` rank if it
    appears in future ICS data. **Important:** re-running the parser
    drops the 11 Subepoch units and resets the 15 re-parented daughter
    Ages — must run the post-parser patch script after each parser run.
-   **Approximate boundaries** (`startApproximate` / `endApproximate`)
    derived from `skos:note "uncertain"` within `time:hasBeginning` /
    `time:hasEnd` blocks in `chart.txt`. 18 units affected. These fields
    are `false` on manually-added Subepoch units.
-   **ICS colors** should be verified against current chart before
    export features are finalized.
-   **Live API** at stratigraphy.org/chartdata — evaluate when live
    data updating becomes a priority.
-   **ICS chart GitHub repo** cloned at
    `C:\Users\scott.meek\Documents\ics-chart`.

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
10. **Variable shadowing in block loop** — renamed inner variables to
    `colBandStart`/`colBandWidth`/`blockY` to avoid shadowing outer
    SVG `width`/`height`.
11. **Module-level IIFE for localStorage init** — parse once at import
    time into `_initPrefs` / `_initUnitEdits`; feed into lazy `useState`
    initializers. Avoids repeated JSON.parse on every state declaration.
12. **`data-unit-id` on SVG rects** — enables O(1) hover lookup via
    `e.target.getAttribute` without attaching per-element event listeners.
13. **Horizontal orientation removal** — delete all orientation state,
    ternaries, if/else branches, and renderer params. Do not hide or stub;
    delete completely. Vertical values are hardcoded where ternaries were.

------------------------------------------------------------------------

# Display & UX Review — Improvement Suggestions

## Toolbar / Ribbon

-   **Group related controls.** View and Columns are both "what you see"
    controls; Display and Picks are both "how labels look."
-   **Add keyboard shortcuts** — Ctrl+Z for reset zoom, R for rotate.
-   **Tab labels are doing too much** — "Display" tab handles 5 concerns.

## Navigation / Zoom

-   **Zoom status indicator** — show current visible span ("Viewing
    541–0 Ma") in a small strip.
-   **Named zoom shortcuts** — buttons/dropdown to jump to Phanerozoic,
    Cenozoic, Mesozoic, Paleozoic, Precambrian.
-   **Double-click to zoom in** on a block — currently disabled.
-   **Minimap** — thin strip showing full timeline with viewport rect.
-   **Pan momentum / inertia** — coast to a stop after drag release.

## Block Labels

-   **Truncate with ellipsis** — SVG text doesn't clip automatically.
    Use `textLength`/`lengthAdjust` or manual truncation.
-   **Multi-line labels** — break long names onto two lines for tall
    blocks with narrow columns.

## Time Axis

-   **Adaptive tick spacing** — intervals should shift to 1 Ma or 0.1 Ma
    when zoomed into the Cenozoic.
-   **Age uncertainty bands** — translucent bands at epoch boundaries.
-   **Dual-axis option** — Ma on one side, Ga on the other.

## Color & Visual Design

-   **Highlight on hover** — brighten or outline a block on mouseover
    for feedback alongside the tooltip.
-   **Direct color picker on block click** — clicking a block opens the
    color picker for that unit.
-   **Adjustable outline weight** — slider 0–2px.
-   **Color-blind safe palette** option.

## Data Editor

-   **Export / import edits** — "Download edits as JSON" + "Load edits
    from JSON" for sharing/backup beyond localStorage.
-   **Undo/redo per cell** — currently only "Reset All."
-   **Age input validation** — add inline validation highlighting.

## Export

-   **Print stylesheet** — `@media print` to remove ribbon and render
    full timeline at defined page size.
-   **Tooltip near edge detection** — flip tooltip position when cursor
    is near right/bottom edge of viewport.

------------------------------------------------------------------------

# Next Session Plan

## Priority 1 — Browser-verify Picks Rounding Fix
-   Confirm `formatAge` rounding is correct at all sigFig settings.
-   Confirm `~` prefix appears correctly for approximate boundaries when
    showUncertainty is on.

## Priority 2 — Tooltip Edge Detection
-   Flip tooltip left/above when cursor is near right/bottom edge.
-   Add GSSP/GSSA status and shortCode to tooltip content.

## Priority 3 — Highlight Block on Hover
-   On `hoverUnit` change, brighten the hovered block rect (lighter fill
    or thicker stroke) for visual feedback. Track by `data-unit-id` and
    mutate directly — no re-render needed.

## Priority 4 — Adaptive Tick Spacing
-   Pass dynamic `tickStep` back through `formatTickLabel` so intervals
    auto-adjust as zoom level changes (e.g. switch to 1 Ma / 0.1 Ma
    when zoomed into the Cenozoic).

## Priority 5 — Named Zoom Shortcuts
-   Dropdown or buttons in View tab: jump to full extent, Phanerozoic,
    Cenozoic, Mesozoic, Paleozoic, Precambrian.

## Priority 6 — equalSize + Hidden Units
-   Pass visible-only units to `buildScale("equalSize")`.

## Priority 7 — Scroll Sync Audit
-   Verify vertical transform mode `scrollTop ↔ ty` math at edge cases.

## Priority 8 — Data Editor JSON Export/Import
-   "Download edits as JSON" and "Load edits from JSON" buttons.

------------------------------------------------------------------------

# Startup Prompt For Next Session

Paste this at the start of the next chat:

------------------------------------------------------------------------

GeoTimeline — Resume from 2026-04-04 state.
Stack: React 19 + D3 v7 + Vite. SVG-driven geologic timescale visualizer based on ICS 2024/12 data (189 units in src/data/geologicTime.json: 178 parsed + 11 manually-added Subepoch units).
Architecture — do not break these:

Single useEffect owns all SVG construction (clear → rebuild). Do not split it.
Second useEffect owns zoom/pan event binding. Third re-applies counter-scale after render (must be declared after render effect — React runs effects in declaration order).
Two more useEffects manage scrollbar ↔ zoom sync. isScrollSyncing ref prevents feedback loops.
Two localStorage save useEffects (gt_prefs and gt_unitEdits keys) run after the counter-scale effect.
buildScale() is a pure function returning one of four scale implementations (linear, log, equalSize, eraEqual).
computeLayout() accepts initialOffset so columns start after the MARGIN header zone. Uses ?? 80 fallback for missing level keys.
Layered SVG groups: backgroundLayer → blockLayer → picksLayer.
ALL_UNITS / UNIT_MAP are module-level constants, not re-derived on render.
_initPrefs / _initUnitEdits are module-level IIFEs that parse localStorage once; all useState calls use lazy initializers seeded from them.
effectiveUnits = ALL_UNITS with unitEdits overlaid — used everywhere.
isUnitVisible(unitId, hiddenUnits) walks ancestor chain so hiding a parent implicitly hides children.
transformRef / visibleDomainRef / lateralOffsetRef hold latest values for closures (no stale-closure bugs).
Block rects carry data-unit-id attributes for hover lookup.
Orientation is vertical only — horizontal code fully deleted, no branches remain.
Structural changes must be introduced in minimal deltas.

Data notes:
- 11 Subepoch units (Early/Middle/Late for Holocene, Pleistocene, Pliocene, Miocene) added manually — not in chart.txt. Re-running parse-chart.cjs drops them and resets the 15 re-parented daughter Ages; a post-parser patch step is required.
- startApproximate / endApproximate fields on all units (sourced from skos:note "uncertain" in chart.txt boundary blocks). 18 units have approximate boundaries.
- boundaryAges entries carry { age, uncertainty, approximate }. PicksRenderer prepends ~ when showUncertainty && approximate.
- Picks font size tracks global fontSize state and data-base-font-size for zoom counter-scale.

Working features: Vertical orientation only. Dual zoom modes (transform / dynamic) with mode-switching that converts state representations without resetting. Four scale types. Scrollbar sync. Column resize handles (delta divided by zoom k). Sticky div-based column headers. Naming mode (Timescale / Stratigraphic / Both). Auto text contrast (NTSC luminance). Picks column with auto/manual mode, uncertainty (±) display, approximate (~) display, sigFigs, font size tracking. Data editor sidebar (resizable, sortable, inline color picker). Filter tree (recursive, ancestor-aware). localStorage persistence for all UI preferences and unitEdits (with migration for new level 5.5 Subepoch column). Block hover tooltip (floating div, dark background, shows name/rank/age). Label suppression on sub-threshold blocks (block.height < fontSize × 1.5). Export tab (SVG download, PNG download, copy PNG to clipboard). Subepoch/Subseries rank (level 5.5, 11 units) with re-parented daughter Ages.

Known issues:
Picks rounding — epsilon fix applied to formatAge, needs browser verify.
Scroll sync math in vertical transform mode may be imperfect at extremes.
buildScale("equalSize") uses full dataset, not visible-only units.
Lateral offset resets on zoom mode switch.
Tooltip has no edge detection (may clip near right/bottom of viewport).

Priority order for this session:
Browser-verify the Picks rounding fix and ~ approximate display.
Tooltip edge detection + add GSSP/GSSA/shortCode to tooltip.
Highlight block on hover (mutate rect stroke/fill directly via data-unit-id).
Adaptive tick spacing.
Named zoom shortcuts (View tab).

------------------------------------------------------------------------
