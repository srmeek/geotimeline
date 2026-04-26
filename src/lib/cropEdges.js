import { UNIT_MAP } from "./units.js";

/**
 * Pre-compute effective age extents for all visible units, cascading
 * from finest level to coarsest so parents inherit their children's
 * already-cropped extents rather than raw data extents.
 *
 * Crop decisions are scoped to direct children at the next visible column
 * level — a parent with all column-level children visible never crops,
 * regardless of hidden grandchildren.
 *
 * Returns Map<unitId, { effectiveStart, effectiveEnd, waveTop, waveBottom }>
 */
export function buildEffectiveExtents(allUnits, visibleSet, visLevels) {
  const extents = new Map();

  // Process finest level first so children's extents are ready when parents run.
  const visibleUnits = allUnits
    .filter(u => visibleSet.has(u.id) && u.start !== null)
    .sort((a, b) => b.levelOrder - a.levelOrder);

  for (const unit of visibleUnits) {
    const unitEnd = unit.end ?? 0;

    // Walk down visLevels to find the first level that has actual direct
    // column-children of this unit. A unit may have no children at the
    // immediate next level (e.g. Jurassic has no Sub-Period children —
    // Early/Middle/Late Jurassic are at Epoch level) so we skip empty levels.
    let directChildren = [];
    let foundLevel = null;
    for (const lv of visLevels) {
      if (lv <= unit.levelOrder) continue;
      const candidates = allUnits.filter(u => {
        if (u.levelOrder !== lv || u.start === null) return false;
        let pid = u.parent;
        while (pid) {
          const p = UNIT_MAP[pid];
          if (!p) break;
          if (visLevels.includes(p.levelOrder)) return p.id === unit.id;
          pid = p.parent ?? null;
        }
        return false;
      });
      if (candidates.length > 0) {
        directChildren = candidates;
        foundLevel = lv;
        break;
      }
    }

    // If no children found at any visible level below, this unit is a leaf — no crop
    if (foundLevel === null) {
      extents.set(unit.id, {
        effectiveStart: unit.start,
        effectiveEnd:   unitEnd,
        waveTop:    false,
        waveBottom: false,
      });
      continue;
    }

    const visibleChildren = directChildren.filter(u => visibleSet.has(u.id));

    // All direct children visible (or none exist) — no crop needed
    if (visibleChildren.length === directChildren.length) {
      extents.set(unit.id, {
        effectiveStart: unit.start,
        effectiveEnd:   unitEnd,
        waveTop:    false,
        waveBottom: false,
      });
      continue;
    }

    // All direct children hidden — visibleSet should have excluded this unit,
    // but guard anyway by skipping
    if (visibleChildren.length === 0) {
      continue;
    }

    // Some children hidden — crop to union of visible children's effective extents
    let descMaxAge = -Infinity;
    let descMinAge =  Infinity;
    for (const child of visibleChildren) {
      const ext = extents.get(child.id);
      const eStart = ext ? ext.effectiveStart : child.start;
      const eEnd   = ext ? ext.effectiveEnd   : (child.end ?? 0);
      if (eStart > descMaxAge) descMaxAge = eStart;
      if (eEnd   < descMinAge) descMinAge = eEnd;
    }

    // Check whether a visible sibling at the same level covers each edge.
    // If so, suppress the wave — the adjacent block fills the boundary visually.
    // Note: same-level siblings are processed in arbitrary order within this
    // sort pass, so extents.get(sib.id) may not be computed yet; we fall back
    // to the sibling's raw start/end, which is a conservative estimate and
    // won't cause false crops, only potentially miss suppressing a wave.
    const sameLevelVisible = allUnits.filter(u =>
      u.id !== unit.id &&
      u.levelOrder === unit.levelOrder &&
      u.start !== null &&
      visibleSet.has(u.id)
    );

    const siblingCoversOldEdge = sameLevelVisible.some(sib => {
      const ext = extents.get(sib.id);
      const sibStart = ext ? ext.effectiveStart : sib.start;
      return sibStart >= descMaxAge;
    });

    const siblingCoversYoungEdge = sameLevelVisible.some(sib => {
      const ext = extents.get(sib.id);
      const sibEnd = ext ? ext.effectiveEnd : (sib.end ?? 0);
      return sibEnd <= descMinAge;
    });

    const waveBottom = !siblingCoversOldEdge && descMaxAge < unit.start;
    const effectiveStart = waveBottom ? descMaxAge : unit.start;
    const waveTop = !siblingCoversYoungEdge && descMinAge > unitEnd;
    const effectiveEnd = waveTop ? descMinAge : unitEnd;

    extents.set(unit.id, { effectiveStart, effectiveEnd, waveTop, waveBottom });
  }

  return extents;
}
