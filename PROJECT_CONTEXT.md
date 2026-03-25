# GeoTimeline Project Context

## Project Overview

GeoTimeline is a web-based, SVG-driven geologic time visualization tool
designed for teaching and display purposes.

It currently supports:

-   Vertical and horizontal timeline orientation
-   Oldest → youngest (left to right in horizontal mode)
-   Interactive zoom and pan
-   Two zoom modes:
    -   Free zoom (X + Y)
    -   Axis-only zoom (time-axis constrained)
-   Reset zoom functionality
-   Modular rendering architecture
-   Data-driven time period definitions via JSON datapack

------------------------------------------------------------------------

## Technology Stack

-   React
-   D3.js
-   SVG
-   Vite
-   Node.js

------------------------------------------------------------------------

## Current File Structure

src/ App.jsx core/ TimeEngine.js renderers/ AxisRenderer.js
BlockRenderer.js data/ timeScale.json

PROJECT_CONTEXT.md

------------------------------------------------------------------------

## Architecture Principles

1.  Separation of concerns
2.  Orientation-agnostic time engine
3.  Data-driven rendering
4.  SVG-based rendering
5.  Zoom applied via `<g>`{=html} transform wrapper

------------------------------------------------------------------------

## Time Engine

Location: core/TimeEngine.js

Converts geological age → screen position.

Horizontal mode: - Oldest on left - Youngest on right

Vertical mode: - Youngest at top - Oldest at bottom

Returns: - ageToPosition(age) - getAxisPosition()

------------------------------------------------------------------------

## Axis Renderer

Location: renderers/AxisRenderer.js

Responsible for: - Drawing main axis - Drawing tick marks - Drawing age
labels

Ticks are currently fixed at 50 Myr intervals.

------------------------------------------------------------------------

## Block Renderer

Location: renderers/BlockRenderer.js

Responsible for: - Rendering geologic time blocks - Computing rectangle
geometry safely - Supporting both orientations

Block sizing logic:

pos1 = ageToPosition(top) pos2 = ageToPosition(base) start = min(pos1,
pos2) size = abs(pos2 - pos1)

------------------------------------------------------------------------

## Zoom System

Implemented in App.jsx using D3 zoom.

Zoom Modes: - free - axis-only

Reset Zoom applies d3.zoomIdentity.

------------------------------------------------------------------------

## Current Data Schema

Location: src/data/geologicTime.json

Each unit object contains:

```
{
  "id": "Aalenian",
  "fullName": "Aalenian Age",
  "displayName": "Aalenian",
  "rankTime": "Age",
  "rankStrat": "Stage",
  "levelOrder": 5,
  "start": 174.7,
  "startUncertainty": 0.8,
  "end": 170.9,
  "endUncertainty": 0.8,
  "parent": "MiddleJurassic",
  "icsColor": "#9AD9DD",
  "ratifiedGSSP": true,
  "shortCode": "j1",
  "order": 58
}
```

------------------------------------------------------------------------

## Data Source

The project uses the **ICS International Chronostratigraphic Chart
2024/12** as its authoritative data source — the most current version
as of December 2024. The canonical source is stratigraphy.org.

A machine-readable Linked Data version of the full chart is published at
stratigraphy.org/chartdata and should be evaluated as a future live data
source to replace the static JSON file.

The static `chart.txt` in the project root is a snapshot of that Linked
Data export (Turtle/RDF format) used to generate `geologicTime.json` via
`scripts/parse-chart.cjs`.

------------------------------------------------------------------------

## Data Schema — Known Edge Cases

Several units in the ICS chart are officially unnamed and use placeholder
designations. These include:

-   Cambrian Stage 2, Stage 3, Stage 4, Stage 10
-   Upper Pleistocene (informal)

The rendering pipeline must handle units with null or missing
`displayName` values gracefully — without crashing or rendering blank
blocks.

------------------------------------------------------------------------

## Hierarchy Note

The ICS has formally ratified **Subseries/Subepoch** as an intermediate
rank in the Quaternary and Neogene. This sits between Series/Epoch and
Stage/Age in the hierarchy. The current level 0–6 column system may need
an additional level to accommodate this rank correctly in those time
periods.

------------------------------------------------------------------------

## Color Standards

ICS unit colors follow the official scheme established by the Commission
for the Geological Map of the World (CGMW). The `icsColor` field in
`geologicTime.json` was parsed directly from the 2024/12 Linked Data
export and should be accurate. Colors should be re-verified against the
current chart before any display or export features are finalized.

------------------------------------------------------------------------

## Next Planned Expansions

-   Dynamic tick recalculation during zoom
-   SVG export button
-   Fossil range columns
-   Curve plotting
-   Era / epoch hierarchy
-   Evolutionary tree renderer

------------------------------------------------------------------------

End of document.
