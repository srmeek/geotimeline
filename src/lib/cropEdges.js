import { UNIT_MAP } from "./units.js";

// Returns { effectiveStart, effectiveEnd, waveTop, waveBottom }
// Pure function — no side effects, no React/DOM/canvas dependencies.
export function computeCropEdges(unit, allUnits, visibleSet) {
  const unitEnd   = unit.end ?? 0;
  const unitStart = unit.start;

  const visibleDescendants = allUnits.filter(u => {
    if (!visibleSet.has(u.id)) return false;
    if (u.id === unit.id) return false;
    let pid = u.parent;
    while (pid) {
      if (pid === unit.id) return true;
      pid = UNIT_MAP[pid]?.parent;
    }
    return false;
  });

  if (visibleDescendants.length === 0) {
    return { effectiveStart: unitStart, effectiveEnd: unitEnd, waveTop: false, waveBottom: false };
  }

  const descMaxAge = Math.max(...visibleDescendants.map(u => u.start));
  const descMinAge = Math.min(...visibleDescendants.map(u => u.end ?? 0));

  let waveBottom = false;
  let effectiveStart = unitStart;
  if (descMaxAge < unitStart) {
    const gapOccupied = allUnits.some(u =>
      u.id !== unit.id &&
      visibleSet.has(u.id) &&
      u.start > descMaxAge &&
      (u.end ?? 0) < unitStart
    );
    if (!gapOccupied) { waveBottom = true; effectiveStart = descMaxAge; }
  }

  let waveTop = false;
  let effectiveEnd = unitEnd;
  if (descMinAge > unitEnd) {
    const gapOccupied = allUnits.some(u =>
      u.id !== unit.id &&
      visibleSet.has(u.id) &&
      (u.end ?? 0) < descMinAge &&
      u.start > unitEnd
    );
    if (!gapOccupied) { waveTop = true; effectiveEnd = descMinAge; }
  }

  return { effectiveStart, effectiveEnd, waveTop, waveBottom };
}
