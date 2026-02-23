export function renderBlocks({
  svg,
  levelUnits,
  allUnits,
  scale,
  orientation,
  level,
  visibleLevels,
  columnWidths
}) {

  const unitMap = Object.fromEntries(allUnits.map(u => [u.id, u]));

  // Build ordered horizontal column list from visibleLevels
  const orderedColumns = visibleLevels.map(lvl => ({
    level: lvl,
    width: columnWidths[lvl]
  }));

  levelUnits.forEach(unit => {

    const currentIndex = visibleLevels.indexOf(level);
    if (currentIndex === -1) return;

    let spanStartIndex = currentIndex;
    let spanEndIndex = currentIndex;

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

    if (!hasVisibleParent) spanStartIndex = 0;

    // ---- Downward span ----
    for (let i = currentIndex + 1; i < visibleLevels.length; i++) {

      const nextLevel = visibleLevels[i];

      const hasChildAtLevel = allUnits.some(u =>
        u.parent === unit.id &&
        u.levelOrder === nextLevel
      );

      if (hasChildAtLevel) {
        spanEndIndex = i - 1;
        break;
      }

      spanEndIndex = i;
    }

    // ==============================
    // Horizontal layout (layout-based)
    // ==============================

    // Start after Time column
    let spanOffset = columnWidths.time ?? 0;

    // Add widths of hierarchy columns before span start
    for (let i = 0; i < spanStartIndex; i++) {
      spanOffset += orderedColumns[i].width;
    }

    // Calculate total span width
    let spanWidth = 0;
    for (let i = spanStartIndex; i <= spanEndIndex; i++) {
      spanWidth += orderedColumns[i].width;
    }

    // ==============================
    // Vertical layout (time scale)
    // ==============================

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