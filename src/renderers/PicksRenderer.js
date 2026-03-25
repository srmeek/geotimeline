function formatAge(age, sigFigs) {
  if (age === 0) return "0";
  // Add small epsilon before floor to prevent log10 floating-point underflow
  // (e.g. Math.log10(1000) = 2.9999... in some engines → would floor to 2)
  const magnitude = Math.floor(Math.log10(Math.abs(age)) + 1e-10);
  // decimals floors at 0: never coarser than 1 Ma (integer) precision
  const decimals = Math.max(0, sigFigs - 1 - magnitude);
  // parseFloat strips trailing zeros (e.g. "23.00" → "23", "1.800" → "1.8")
  return String(parseFloat(age.toFixed(decimals)));
}

export function renderPicks({
  svg,
  column,
  boundaryAges,   // [{age, uncertainty}]
  scale,
  orientation,
  width,
  height,
  margin = 0,
  showUncertainty = false,
  picksSigFigs = 3
}) {
  // ===== Right border only =====

  const border2 = document.createElementNS("http://www.w3.org/2000/svg", "line");

  if (orientation === "vertical") {
    border2.setAttribute("x1", column.end);
    border2.setAttribute("x2", column.end);
    border2.setAttribute("y1", margin);
    border2.setAttribute("y2", height - margin);
  } else {
    border2.setAttribute("y1", column.end);
    border2.setAttribute("y2", column.end);
    border2.setAttribute("x1", margin);
    border2.setAttribute("x2", width - margin);
  }

  border2.setAttribute("stroke", "black");
  border2.setAttribute("stroke-width", "0.5");
  border2.setAttribute("data-base-stroke", "0.5");

  svg.appendChild(border2);

  // ===== Boundary Lines + Labels =====

  boundaryAges.forEach(({ age, uncertainty }) => {

    const pos = scale(age);

    // ---- Label ----
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");

    label.setAttribute("font-size", "10");
    label.setAttribute("data-base-font-size", "10");

    const ageText = formatAge(age, picksSigFigs);
    const uncText = (showUncertainty && uncertainty !== null)
      ? ` \u00B1${uncertainty}`
      : "";
    label.textContent = ageText + uncText;

    svg.appendChild(label); // temporarily append to measure
    const textWidth = label.getBBox().width;
    svg.removeChild(label);

    const labelMargin = 6;
    const labelPadding = textWidth + 8;

    // ---- Tick ----
    const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");

    if (orientation === "vertical") {

      const tickEndX = column.end - labelPadding;

      tick.setAttribute("x1", column.start);
      tick.setAttribute("x2", tickEndX);
      tick.setAttribute("y1", pos);
      tick.setAttribute("y2", pos);

      label.setAttribute("x", column.end - labelMargin);
      label.setAttribute("y", pos);
      label.setAttribute("dominant-baseline", "middle");
      label.setAttribute("text-anchor", "end");

    } else {

      const tickEndY = column.end - labelPadding;

      tick.setAttribute("y1", column.start);
      tick.setAttribute("y2", tickEndY);
      tick.setAttribute("x1", pos);
      tick.setAttribute("x2", pos);

      label.setAttribute("x", pos);
      label.setAttribute("y", column.end - labelMargin);
      label.setAttribute("text-anchor", "middle");
    }

    tick.setAttribute("stroke", "black");
    tick.setAttribute("stroke-width", 1);
    tick.setAttribute("data-base-stroke", "1");

    svg.appendChild(tick);
    svg.appendChild(label);
  });

}
