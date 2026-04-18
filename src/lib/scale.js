import * as d3 from "d3";

export function formatTickLabel(age, tickStep, timeUnit) {
  if (timeUnit === "Ga") {
    const ga = age / 1000;
    const gaStep = tickStep / 1000;
    const decimals = gaStep >= 0.1 ? 1 : gaStep >= 0.01 ? 2 : gaStep >= 0.001 ? 3 : 4;
    return ga.toFixed(decimals) + " Ga";
  }
  if (timeUnit === "ka") {
    const ka = age * 1000;
    const kaStep = tickStep * 1000;
    const decimals = kaStep >= 1 ? 0 : kaStep >= 0.1 ? 1 : kaStep >= 0.01 ? 2 : 3;
    return ka.toFixed(decimals) + " ka";
  }
  const decimals = tickStep >= 1 ? 0 : tickStep >= 0.1 ? 1 : tickStep >= 0.01 ? 2 : 3;
  return age.toFixed(decimals) + " Ma";
}

// Hardcoded fallback — used when unit data is missing or incomplete.
// Matches ICS 2024/12 Phanerozoic era boundaries + Hadean oldest bound.
const ERA_EQUAL_FALLBACK = [
  { start: 66,       end: 0 },
  { start: 251.902,  end: 66 },
  { start: 538.8,    end: 251.902 },
  { start: 4567.30,  end: 538.8 },
];

// Derive the 4 eraEqual bands from unit data: 3 Phanerozoic Eras + Precambrian.
// Precambrian spans from the oldest Phanerozoic Era's start back to the oldest Eon's start.
export function deriveEraEqualBands(allUnits) {
  if (!allUnits || allUnits.length === 0) return ERA_EQUAL_FALLBACK;

  const phanerozoicEras = allUnits
    .filter(u => u.rankTime === "Era" && u.parent === "Phanerozoic" && u.start != null && u.end != null)
    .sort((a, b) => a.start - b.start); // youngest first

  if (phanerozoicEras.length === 0) return ERA_EQUAL_FALLBACK;

  const oldestPhanerozoicStart = phanerozoicEras[phanerozoicEras.length - 1].start;
  const preEons = allUnits.filter(u => u.rankTime === "Eon" && u.id !== "Phanerozoic" && u.start != null);
  const precambrianStart = preEons.length > 0
    ? Math.max(...preEons.map(u => u.start))
    : ERA_EQUAL_FALLBACK[3].start;

  return [
    ...phanerozoicEras.map(e => ({ start: e.start, end: e.end })),
    { start: precambrianStart, end: oldestPhanerozoicStart },
  ];
}

export function computeLayout(columns, columnWidths, initialOffset = 0) {
  let offset = initialOffset;
  return columns.map(col => {
    const width = columnWidths[col.id] ?? columnWidths[col.level] ?? 80;
    const start = offset;
    const end = start + width;
    offset = end;
    return { ...col, start, width, end };
  });
}

export function buildScale(scaleType, domain, range, allUnits, equalSizeLevel) {
  if (scaleType === "linear") {
    return d3.scaleLinear().domain(domain).range(range);
  }

  if (scaleType === "log") {
    const logMin = Math.log(domain[0] + 1);
    const logMax = Math.log(domain[1] + 1);
    const linearScale = d3.scaleLinear().domain([logMin, logMax]).range(range);
    const fn = age => linearScale(Math.log(age + 1));
    fn.invert = pixel => {
      const logVal = linearScale.invert(pixel);
      return Math.exp(logVal) - 1;
    };
    fn.ticks = () => {
      const result = [];
      if (domain[0] <= 0) result.push(0);
      for (let mag = -4; mag <= 4; mag++) {
        for (const mult of [1, 2, 5]) {
          const v = mult * Math.pow(10, mag);
          if (v > 0 && v >= domain[0] && v <= domain[1]) result.push(v);
        }
      }
      return result.sort((a, b) => a - b);
    };
    return fn;
  }

  if (scaleType === "equalSize") {
    const byId = {};
    (allUnits || []).forEach(u => { byId[u.id] = u; });
    const byParent = {};
    (allUnits || []).forEach(u => {
      const pk = u.parent != null ? u.parent : "__root__";
      if (!byParent[pk]) byParent[pk] = [];
      byParent[pk].push(u);
    });

    function collectSlots(parentKey) {
      const pk = parentKey != null ? parentKey : "__root__";
      const children = (byParent[pk] || []).filter(u => u.start !== null);
      if (children.length === 0) {
        if (parentKey != null) {
          const u = byId[parentKey];
          return (u && u.start !== null) ? [u] : [];
        }
        return [];
      }
      return children.flatMap(u => {
        if (u.levelOrder >= equalSizeLevel) return [u];
        return collectSlots(u.id);
      });
    }

    const displayUnits = collectSlots(null)
      .map(u => ({ ...u, end: u.end === null ? 0 : u.end }))
      .sort((a, b) => a.start - b.start);

    if (displayUnits.length === 0) return d3.scaleLinear().domain(domain).range(range);

    const n = displayUnits.length;
    const rangeSize = Math.abs(range[1] - range[0]);
    const unitHeight = rangeSize / n;

    const fn = age => {
      for (let i = 0; i < n; i++) {
        const u = displayUnits[i];
        if (age >= u.end && age <= u.start) {
          const fraction = (age - u.end) / (u.start - u.end);
          return range[0] + (i + fraction) * unitHeight;
        }
      }
      if (age < displayUnits[n - 1].end) return range[1];
      return range[0];
    };
    fn.invert = pixel => {
      const relPos = (pixel - range[0]) / (range[1] - range[0]);
      const unitIndex = Math.min(Math.floor(relPos * n), n - 1);
      const unitFraction = (relPos * n) - unitIndex;
      if (unitIndex < 0) return domain[0];
      if (unitIndex >= n) return domain[1];
      const u = displayUnits[unitIndex];
      return u.end + unitFraction * (u.start - u.end);
    };
    fn.ticks = () => displayUnits.map(u => u.start).filter(a => a >= domain[0] && a <= domain[1]);
    return fn;
  }

  if (scaleType === "eraEqual") {
    // Derive the 4 equal-height bands from current unit data so editing
    // Phanerozoic era start dates (or the oldest Eon) re-layouts correctly.
    // Structure: 3 Phanerozoic Eras + 1 catch-all "Precambrian" band.
    const eras = deriveEraEqualBands(allUnits);
    const rangeSize = Math.abs(range[1] - range[0]);
    const eraHeight = rangeSize / eras.length;

    const fn = age => {
      for (let i = 0; i < eras.length; i++) {
        const era = eras[i];
        if (age >= era.end && age <= era.start) {
          const fraction = (age - era.end) / (era.start - era.end);
          return range[0] + (i + fraction) * eraHeight;
        }
      }
      if (age < eras[0].end) return range[0];
      return range[1];
    };
    fn.invert = pixel => {
      const relPos = (pixel - range[0]) / (range[1] - range[0]);
      const eraIndex = Math.min(Math.floor(relPos * eras.length), eras.length - 1);
      const eraFraction = (relPos * eras.length) - eraIndex;
      if (eraIndex < 0) return domain[0];
      const era = eras[eraIndex];
      return era.end + eraFraction * (era.start - era.end);
    };
    fn.ticks = (count = 40) => {
      const result = new Set();
      const perEra = Math.max(3, Math.floor(count / eras.length));
      eras.forEach(era => {
        const lo = Math.max(domain[0], era.end);
        const hi = Math.min(domain[1], era.start);
        if (lo >= hi) return;
        if (era.start >= domain[0] && era.start <= domain[1]) result.add(era.start);
        if (era.end   >= domain[0] && era.end   <= domain[1]) result.add(era.end);
        d3.scaleLinear().domain([lo, hi]).ticks(perEra)
          .forEach(t => { if (t >= domain[0] && t <= domain[1]) result.add(t); });
      });
      if (domain[0] <= 0) result.add(0);
      return [...result].sort((a, b) => a - b);
    };
    return fn;
  }

  return d3.scaleLinear().domain(domain).range(range);
}

/**
 * Shared "view scale" builder. Used by both drawFrame (live) and buildSVGForExport
 * so the two cannot drift.
 *
 * For equalSize/eraEqual: returns a virtual-canvas scale where the full domain
 * is laid out across a virtual height, then offset so that vMin lands at eM and
 * vMax lands at viewH. virtualH is derived from the g-space span (the fraction
 * of the full canvas the view occupies), not the age span — age ≠ pixel for
 * non-linear scales, so using age-span over-fills or under-fills the viewport.
 * For linear/log: returns the simple positional scale over [eM, viewH].
 *
 * Returns { scale, fullScale, pixelOffset }.
 * - `scale`: age → pixel in the currently visible viewport.
 * - `fullScale`: present only for equalSize/eraEqual; age → virtual pixel
 *   in the expanded canvas. Used for zoom focal-age math.
 * - `pixelOffset`: fullScale(vMin); zero for linear/log.
 */
export function buildViewScale({
  scaleType, vMin, vMax, fullMin, fullMax, eM, viewH, units, equalSizeLevel,
}) {
  if (scaleType === "equalSize" || scaleType === "eraEqual") {
    const viewportH = Math.max(1, viewH - eM);
    // Use a unit-interval parametrization to compute g-span (the fraction of the
    // full canvas the view occupies). virtualH * gSpan must equal viewportH so
    // that [vMin, vMax] actually fills [eM, viewH].
    const g = buildScale(scaleType, [fullMin, fullMax], [0, 1], units, equalSizeLevel);
    const gSpan = Math.max(g(vMax) - g(vMin), 1e-9);
    const virtualH = viewportH / gSpan;
    const fullScale = buildScale(scaleType, [fullMin, fullMax], [0, virtualH], units, equalSizeLevel);
    const pixelOffset = fullScale(vMin);
    const scale = age => fullScale(age) - pixelOffset + eM;
    scale.invert = px => fullScale.invert(px - eM + pixelOffset);
    return { scale, fullScale, pixelOffset, virtualH };
  }
  const scale = buildScale(scaleType, [vMin, vMax], [eM, viewH], units, equalSizeLevel);
  return { scale, fullScale: null, pixelOffset: 0, virtualH: viewH - eM };
}

/**
 * Compute the new [vMin, vMax] after a zoom gesture, anchored so that
 * `focalAge` stays at the cursor's pixel position on screen — for ANY scale
 * type, including the non-linear equalSize/eraEqual scales.
 *
 * Strategy: work in "g-space" — the unit-interval parametrization of the
 * current scale. g(age) ∈ [0, 1] is the fraction of the full canvas at which
 * `age` appears. For linear, g(age) = (age - fullMin) / fullSpan. For log
 * and equalSize/eraEqual, g is non-linear but still monotonic. Pixel
 * fractions are linear in g under buildViewScale, so anchoring in g-space
 * guarantees the focal age stays under the cursor for any scale type.
 *
 * zoomFactor is interpreted as a *visual* zoom (the inverse of how much the
 * canvas appears magnified). 0.5 = zoom in (content 2× larger). For linear
 * this matches age-span scaling; for non-linear it correctly reflects what
 * the user sees.
 *
 * Returns [newMin, newMax] clamped to [fullMin, fullMax].
 */
export function computeZoomedDomain({
  scaleType, vMin, vMax, fullMin, fullMax,
  eM, viewH, units, equalSizeLevel,
  cursorY, zoomFactor,
}) {
  const viewportPx = Math.max(1, viewH - eM);
  const clampedCursor = Math.max(eM, Math.min(viewH, cursorY));
  const pxFrac = (clampedCursor - eM) / viewportPx;

  // Build a unit-interval parametrization of the full domain. g(age) ∈ [0, 1].
  // The scale is built with range [0, 1] over [fullMin, fullMax] — this is
  // independent of the current view and can be used for any (vMin, vMax).
  const g = buildScale(scaleType, [fullMin, fullMax], [0, 1], units, equalSizeLevel);

  // Focal age: the age currently under the cursor, via the current view scale.
  const { scale: curScale } = buildViewScale({
    scaleType, vMin, vMax, fullMin, fullMax, eM, viewH, units, equalSizeLevel,
  });
  const focalAge = curScale.invert(clampedCursor);

  // Current view occupies [g(vMin), g(vMax)] in g-space. Zoom shrinks/expands that span.
  const gMin = g(vMin);
  const gMax = g(vMax);
  const gSpan = Math.max(gMax - gMin, 1e-12);
  const gFocal = g(focalAge);

  // New g-span. Clamp to [tiny, 1]; span > 1 clips to full domain.
  let newGSpan = gSpan * zoomFactor;
  if (newGSpan > 1) newGSpan = 1;
  if (newGSpan < 1e-9) newGSpan = 1e-9;

  // Anchor in g-space: focal stays at pxFrac of the new view.
  let newGMin = gFocal - pxFrac * newGSpan;
  let newGMax = newGMin + newGSpan;

  // Clamp to [0, 1] preserving span.
  if (newGMin < 0) { newGMin = 0; newGMax = newGMin + newGSpan; }
  if (newGMax > 1) { newGMax = 1; newGMin = newGMax - newGSpan; }
  if (newGMin < 0) newGMin = 0;
  if (newGMax > 1) newGMax = 1;

  // Map back to ages.
  let newVMin = g.invert(newGMin);
  let newVMax = g.invert(newGMax);
  if (newVMin < fullMin) newVMin = fullMin;
  if (newVMax > fullMax) newVMax = fullMax;
  if (newVMin >= newVMax) { newVMin = fullMin; newVMax = fullMax; }
  return [newVMin, newVMax];
}

/**
 * Clamp a new [min, max] to [fullMin, fullMax] while preserving span.
 * If span > fullSpan, returns [fullMin, fullMax].
 */
export function clampDomain(newMin, newMax, fullMin, fullMax) {
  const span     = newMax - newMin;
  const fullSpan = fullMax - fullMin;
  if (span >= fullSpan) return [fullMin, fullMax];
  if (newMin < fullMin) { newMin = fullMin; newMax = newMin + span; }
  if (newMax > fullMax) { newMax = fullMax; newMin = newMax - span; }
  return [newMin, newMax];
}
