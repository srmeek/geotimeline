export function renderBlocks({
  svg,
  levelUnits,
  allUnits,
  scale,
  orientation,
  level,
  visibleLevels,
  columnWidths,
  axisColumnWidth
}) {

  const unitMap = Object.fromEntries(allUnits.map(u => [u.id, u]));

  levelUnits.forEach(unit => {

    const currentIndex = visibleLevels.indexOf(level);
    if (currentIndex === -1) return;

    let spanStart = currentIndex;
    let spanEnd = currentIndex;

    // ---- Upward span ----
    let parentId = unit.parent;
    let hasVisibleParent = false;

    while (parentId) {
      const parent = unitMap[parentId];
      if (parent && visibleLevels.includes(parent.levelOrder)) {
        hasVisibleParent = true;
        break;
      }
      parentId = parent?.parent;
    }

    if (!hasVisibleParent) spanStart = 0;

    // ---- Downward span (stop at first visible level with children) ----
for (let i = currentIndex + 1; i < visibleLevels.length; i++) {

  const nextLevel = visibleLevels[i];

  const hasChildAtLevel = allUnits.some(u =>
    u.parent === unit.id &&
    u.levelOrder === nextLevel
  );

  if (hasChildAtLevel) {
    // Stop before this level
    spanEnd = i - 1;
    break;
  }

  // If no child at this level, allow spanning into it
  spanEnd = i;
}


    let spanOffset = axisColumnWidth;
    for (let i = 0; i < spanStart; i++) {
      spanOffset += columnWidths[visibleLevels[i]];
    }

    let spanWidth = 0;
    for (let i = spanStart; i <= spanEnd; i++) {
      spanWidth += columnWidths[visibleLevels[i]];
    }

    const pos1 = scale(unit.start);
    const pos2 = scale(unit.end);
    const start = Math.min(pos1, pos2);
    const size = Math.abs(pos2 - pos1);

    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");

    if (orientation === "vertical") {
      rect.setAttribute("x", spanOffset);
      rect.setAttribute("y", start);
      rect.setAttribute("width", spanWidth);
      rect.setAttribute("height", size);
    } else {
      rect.setAttribute("x", start);
      rect.setAttribute("y", spanOffset);
      rect.setAttribute("width", size);
      rect.setAttribute("height", spanWidth);
    }

    rect.setAttribute("fill", unit.icsColor || "#ccc");
    rect.setAttribute("stroke", "black");
    rect.setAttribute("stroke-width", 0.5);
    svg.appendChild(rect);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");

    if (orientation === "vertical") {
      label.setAttribute("x", spanOffset + spanWidth / 2);
      label.setAttribute("y", start + size / 2);
    } else {
      label.setAttribute("x", start + size / 2);
      label.setAttribute("y", spanOffset + spanWidth / 2);
    }

    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dominant-baseline", "middle");
    label.setAttribute("font-size", "10");
    label.textContent = unit.displayName;

    svg.appendChild(label);
  });
}
