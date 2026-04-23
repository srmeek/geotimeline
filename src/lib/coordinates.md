# Pixel Coordinate Conventions

## Viewport Coordinates

All pixel values at the scale.js API boundary are in VIEWPORT
COORDINATES. The viewport is the visible drawing area: from the bottom
of the column header row to the bottom of the scroll container.

- y = 0 is the top of the canvas element (same y as the top of the header)
- y = eM is the top of the drawing area (just below the header row)
- y = viewH is the bottom of the drawing area (bottom of scroll container)
- eM = effectiveMarginRef.current = headerHeight + 8
- viewH = scrollContainerRef.current.clientHeight

## makeScale Contract

For a scale built with parameters (vMin, vMax, fullMin, fullMax, eM, viewH):

- toY(age) returns a y coordinate in viewport coordinates
- When age === vMin, toY(age) === eM (top of drawing area)
- When age === vMax, toY(age) === viewH (bottom of drawing area)
- toAge(y) is the inverse: toAge(toY(age)) === age (within floating-point tolerance)
- toAge(y) for y outside [eM, viewH] extrapolates linearly in g-space

## Internal Representations

Internally, scale.js may use "g-space" (unit interval [0,1]) or
"virtual canvas" coordinates for non-linear scales. These are
IMPLEMENTATION DETAILS and never appear at the API boundary. Callers
receive only toY / toAge.

## Lateral Offset

Horizontal pan (lateralOffset) is NOT part of the scale. It is applied
by the renderer as a horizontal translation to column positions. The
scale only handles the vertical (time) axis.
