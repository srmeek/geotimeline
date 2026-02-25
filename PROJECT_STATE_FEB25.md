# Time Scale Generator --- PROJECT_STATE.md

------------------------------------------------------------------------

# 1. Project Overview

The Time Scale Generator is a D3-based React application for rendering
geologic time scales using a canonical time grid and a fully
layout-driven column engine.

The system supports:

-   Vertical and horizontal orientations
-   A single canonical linear age scale
-   Multiple hierarchical time-unit columns (Period, Epoch, etc.)
-   A dedicated Time column (visual representation of the grid)
-   Fully resizable columns
-   Layout-driven geometry
-   Transform-based zoom (temporary model)
-   Git-based architectural checkpointing

The system is no longer structured as a traditional D3 chart.\
It is a **time-based layout engine with pluggable columns**.

------------------------------------------------------------------------

# 2. Core Architectural Principles

## 2.1 Canonical Time Scale (Structural Backbone)

There is exactly **one authoritative D3 scale**:

    d3.scaleLinear()

### Properties

-   Domain: \[ICS_MIN_AGE, ICS_MAX_AGE\]
-   Derived from geologicTime.json
-   No hardcoded age constants
-   Orientation-aware range:
    -   Vertical → \[0, height\]
    -   Horizontal → \[width, 0\]
-   Shared across all renderers
-   Never recreated per column
-   Never duplicated

This scale is invisible and structural.\
All vertical (or primary-axis) geometry must come from it.

------------------------------------------------------------------------

## 2.2 Orientation Model

Supported orientations:

-   "vertical"
-   "horizontal"

Orientation affects:

-   Primary time direction
-   Scale range mapping
-   Coordinate interpretation inside renderers

Orientation does NOT affect:

-   Domain
-   Geological boundaries
-   Layout structure
-   Column ordering

Time always flows through the canonical scale.

------------------------------------------------------------------------

## 2.3 Layout-Driven Architecture

All horizontal geometry is owned by:

    computeLayout(columns, columnWidths)

### Layout Responsibilities

-   Column ordering
-   Column widths
-   X positioning
-   Layout stacking
-   Resize handle positioning

### Layout Output

Each column receives:

    {
      x,
      y,
      width,
      height,
      column
    }

Renderers must not compute horizontal offsets.

------------------------------------------------------------------------

## 2.4 Separation of Concerns

### Layout Layer

-   Owns all horizontal positioning
-   Owns stacking order
-   Owns column width model
-   No time logic

### Renderer Layer

-   Draw only inside assigned rectangle
-   Use provided canonical scale
-   Respect orientation
-   No layout math
-   No global positioning
-   No manual offsets
-   No hardcoded geological constants

------------------------------------------------------------------------

# 3. Column Model

Columns are declared declaratively:

    const columns = [
      { id: "time", type: "time" },
      ...hierarchyColumns
    ];

Each column:

-   Is first-class
-   Is resizable
-   Has width defined in columnWidths
-   Receives geometry from layout
-   Is rendered by type

------------------------------------------------------------------------

## 3.1 Current Column Types

### "time"

Visual representation of the canonical time grid.

Responsibilities:

-   Render tick labels (Ma)
-   Render background + border
-   Respect orientation
-   Use canonical scale

The Time column does NOT own the scale.

------------------------------------------------------------------------

### "block"

Hierarchical time-unit columns (Period, Epoch, etc.).

Responsibilities:

-   Render rectangles using scale(start/end)
-   Render labels
-   Respect orientation
-   Fully layout-driven horizontally

Blocks snap entirely to canonical time grid.

------------------------------------------------------------------------

# 4. Resize System

All columns are resizable.

-   Resize handles derived from layout
-   Updating a width updates columnWidths
-   No special-case columns
-   No fixed-width assumptions

Architectural rule:

Every column added in the future must be resizable.

------------------------------------------------------------------------

# 5. Rendering Order (Layering Rules)

Rendering stack must remain:

1.  Background
2.  Hierarchy block columns
3.  Time column elements (ticks/labels)
4.  Future auxiliary columns (e.g., Picks)
5.  Headers (future)

Z-order must be centrally controlled.

------------------------------------------------------------------------

# 6. Zoom Model (Current State)

Current implementation:

    zoomLayer.attr("transform", event.transform);

This is transform-based zoom.

Effects:

-   Geometry scales visually
-   Domain does not change
-   Text scales visually

Planned future:

-   Domain-based zoom
-   Text remains constant size
-   Canonical scale domain mutates

Transform-based zoom is temporary and must not be relied upon
structurally.

------------------------------------------------------------------------

# 7. System Invariants (Must Not Be Broken)

These are architectural constraints:

1.  There is exactly ONE canonical scale.
2.  Vertical geometry always comes from scale.
3.  Horizontal geometry always comes from computeLayout.
4.  No column computes horizontal offsets manually.
5.  No hardcoded geological boundaries.
6.  No hardcoded age limits.
7.  All columns are resizable.
8.  Time grid is invisible and structural.
9.  Orientation affects coordinate interpretation only.

Any violation of these is architectural regression.

------------------------------------------------------------------------

# 8. Next Planned Feature: Picks Column

Target structure:

    [ Time ]
    [ Hierarchy Columns ]
    [ Picks ]

Requirements:

-   Fully layout-driven
-   Resizable
-   Driven by highest visible hierarchy level
-   Snaps to canonical scale
-   Renders boundary ticks, numeric labels, optional grid lines
-   No layout hacks
-   No hardcoding
-   No independent scale

------------------------------------------------------------------------

# 9. Future Architectural Roadmap (Ordered)

1.  Add Picks column
2.  Make Picks dynamic to highest visible hierarchy
3.  Add grid line extension from Picks
4.  Refine Time column tick density
5.  Convert zoom to domain-based model
6.  Add clipping for text overflow
7.  Introduce column header row system
8.  Add pluggable data column system
9.  Introduce value axes for data columns

------------------------------------------------------------------------

# 10. Long-Term Vision

The Time Scale Generator is evolving into:

A time-based layout engine with pluggable, resizable columns driven by a
canonical geologic time grid.

It is not a static chart.

All future features must respect:

-   Canonical time authority
-   Layout ownership of horizontal space
-   Renderer isolation
-   Orientation symmetry
-   Git-based stability checkpoints

------------------------------------------------------------------------

# 11. Current Stability Status

Stable:

-   Canonical time scale
-   Layout-driven horizontal geometry
-   Time column
-   Block rendering alignment
-   Resizable columns
-   Orientation toggle
-   Git reversion process

In Progress:

-   Column header system
-   Domain-based zoom migration

Not Started:

-   Picks column
-   Data columns
-   User-uploaded datasets
-   Interactive grid toggling

------------------------------------------------------------------------

End of Document.
