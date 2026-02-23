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

Location: data/timeScale.json

{ "periods": \[ { "name": "Cambrian", "top": 485, "base": 541, "color":
"#6baed6" } \] }

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
