import { UNIT_MAP } from "./units.js";

/**
 * Pre-compute effective age extents for all visible units, cascading
 * from finest level to coarsest so parents inherit their children's
 * already-cropped extents rather than raw data extents.
 *
 * Returns Map<unitId, { effectiveStart, effectiveEnd, waveTop, waveBottom }>
 */
export function buildEffectiveExtents(allUnits, visibleSet) {
  const extents = new Map();

  // Process finest level first (largest levelOrder) so parents can
  // look up children's effective extents when they are processed.
  const visibleUnits = allUnits
    .filter(u => visibleSet.has(u.id) && u.start !== null)
    .sort((a, b) => b.levelOrder - a.levelOrder);

  for (const unit of visibleUnits) {
    const unitEnd = unit.end ?? 0;

    // Find visible descendants and use their effective extents if
    // already computed (they will be, since we process finest first).
    let descMaxAge = -Infinity;
    let descMinAge =  Infinity;
    let hasVisibleDesc = false;

    for (const u of allUnits) {
      if (!visibleSet.has(u.id) || u.id === unit.id) continue;
      let pid = u.parent;
      let isDesc = false;
      while (pid) {
        if (pid === unit.id) { isDesc = true; break; }
        pid = UNIT_MAP[pid]?.parent ?? null;
      }
      if (!isDesc) continue;
      hasVisibleDesc = true;
      const ext = extents.get(u.id);
      const eStart = ext ? ext.effectiveStart : u.start;
      const eEnd   = ext ? ext.effectiveEnd   : (u.end ?? 0);
      if (eStart > descMaxAge) descMaxAge = eStart;
      if (eEnd   < descMinAge) descMinAge = eEnd;
    }

    if (!hasVisibleDesc) {
      extents.set(unit.id, {
        effectiveStart: unit.start,
        effectiveEnd:   unitEnd,
        waveTop:    false,
        waveBottom: false,
      });
      continue;
    }

    // Older edge: crop if descendants don't reach unit.start AND
    // no other visible unit fills the gap.
    let waveBottom = false;
    let effectiveStart = unit.start;
    if (descMaxAge < unit.start) {
      const gapOccupied = allUnits.some(u =>
        u.id !== unit.id &&
        visibleSet.has(u.id) &&
        u.start > descMaxAge &&
        (u.end ?? 0) < unit.start
      );
      if (!gapOccupied) {
        waveBottom = true;
        effectiveStart = descMaxAge;
      }
    }

    // Younger edge: crop if descendants don't reach unit.end AND
    // no other visible unit fills the gap.
    let waveTop = false;
    let effectiveEnd = unitEnd;
    if (descMinAge > unitEnd) {
      const gapOccupied = allUnits.some(u =>
        u.id !== unit.id &&
        visibleSet.has(u.id) &&
        (u.end ?? 0) < descMinAge &&
        u.start > unitEnd
      );
      if (!gapOccupied) {
        waveTop = true;
        effectiveEnd = descMinAge;
      }
    }

    extents.set(unit.id, { effectiveStart, effectiveEnd, waveTop, waveBottom });
  }

  return extents;
}
