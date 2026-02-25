export function renderPicks({
  svg,
  column,
  boundaryAges,
  scale,
  orientation,
  width,
  height
}) {

  // ===== Background (no full border) =====

const background = document.createElementNS(
  "http://www.w3.org/2000/svg",
  "rect"
);

if (orientation === "vertical") {
  background.setAttribute("x", column.start);
  background.setAttribute("y", 0);
  background.setAttribute("width", column.width);
  background.setAttribute("height", height);
} else {
  background.setAttribute("x", 0);
  background.setAttribute("y", column.start);
  background.setAttribute("width", width);
  background.setAttribute("height", column.width);
}

background.setAttribute("fill", "white");
background.setAttribute("stroke", "none");

svg.appendChild(background);

// Draw vertical borders only (or horizontal in horizontal mode)

const border1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
const border2 = document.createElementNS("http://www.w3.org/2000/svg", "line");

if (orientation === "vertical") {

  border1.setAttribute("x1", column.start);
  border1.setAttribute("x2", column.start);
  border1.setAttribute("y1", 0);
  border1.setAttribute("y2", height);

  border2.setAttribute("x1", column.end);
  border2.setAttribute("x2", column.end);
  border2.setAttribute("y1", 0);
  border2.setAttribute("y2", height);

} else {

  border1.setAttribute("y1", column.start);
  border1.setAttribute("y2", column.start);
  border1.setAttribute("x1", 0);
  border1.setAttribute("x2", width);

  border2.setAttribute("y1", column.end);
  border2.setAttribute("y2", column.end);
  border2.setAttribute("x1", 0);
  border2.setAttribute("x2", width);
}

border1.setAttribute("stroke", "black");
border2.setAttribute("stroke", "black");
border1.setAttribute("stroke-width", "0.5");
border2.setAttribute("stroke-width", "0.5");

svg.appendChild(border1);
svg.appendChild(border2);
  // ===== Boundary Lines + Labels =====

  boundaryAges.forEach(age => {

    const pos = scale(age);

// ---- Label ----
const label = document.createElementNS(
  "http://www.w3.org/2000/svg",
  "text"
);

label.setAttribute("font-size", "10");
label.textContent = age.toFixed(0);

// Estimate text width (~6px per character at 10px font)
svg.appendChild(label); // temporarily append to measure

const textWidth = label.getBBox().width;

svg.removeChild(label); // remove so we can position properly

const labelMargin = 6;
const labelPadding = textWidth + 8; // 8px buffer

// ---- Tick ----
const tick = document.createElementNS(
  "http://www.w3.org/2000/svg",
  "line"
);

if (orientation === "vertical") {

  const tickEndX = column.end - labelPadding;

  tick.setAttribute("x1", column.start);
  tick.setAttribute("x2", tickEndX);
  tick.setAttribute("y1", pos);
  tick.setAttribute("y2", pos);

  label.setAttribute("x", column.end - labelMargin);
  label.setAttribute("y", pos + 4);
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

svg.appendChild(tick);
svg.appendChild(label);
  });

}