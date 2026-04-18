// Module-level canvas for text measurement — avoids SVG getBBox / forced reflow
const _mc = document.createElement("canvas");
const _mctx = _mc.getContext("2d");

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
  boundaryAges,   // [{age, uncertainty, approximate}]
  scale,
  showUncertainty = false,
  picksSigFigs = 3,
  fontSize = 10
}) {
  // ===== Boundary Lines + Labels =====

  // Process youngest → oldest (top → bottom on screen) so 0 Ma is always on top.
  const sorted = [...boundaryAges].sort((a, b) => a.age - b.age); // youngest first

  sorted.forEach(({ age, uncertainty, approximate }) => {

    const pos = scale(age);

    // ---- Label ----
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");

    label.setAttribute("font-size", fontSize);
    label.setAttribute("data-base-font-size", fontSize);

    const approxText = (showUncertainty && approximate) ? "\u007E" : "";
    const ageText = formatAge(age, picksSigFigs);
    const uncText = (showUncertainty && uncertainty !== null)
      ? ` \u00B1${uncertainty}`
      : "";
    label.textContent = approxText + ageText + uncText;

    // Measure with canvas to avoid SVG layout reflow on every pick
    _mctx.font = `${fontSize}px sans-serif`;
    const textWidth = _mctx.measureText(label.textContent).width;

    const rightMargin = 4;
    const tickLabelGap = 12;  // ~double space at 10px font
    const labelPadding = textWidth + tickLabelGap + rightMargin;

    // ---- Tick ----
    const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");

    tick.setAttribute("x1", column.start);
    tick.setAttribute("x2", column.end - labelPadding);
    tick.setAttribute("y1", pos);
    tick.setAttribute("y2", pos);

    tick.setAttribute("stroke", "black");
    tick.setAttribute("stroke-width", 1);
    tick.setAttribute("data-base-stroke", "1");

    svg.appendChild(tick);

    label.setAttribute("x", column.end - rightMargin);
    label.setAttribute("y", pos);
    label.setAttribute("dominant-baseline", "middle");
    label.setAttribute("text-anchor", "end");
    svg.appendChild(label);
  });

}
