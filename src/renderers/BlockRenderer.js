// NTSC luminance formula — returns "black" or "white" for readable label contrast
function contrastColor(hex) {
  if (!hex || hex.length < 7) return "black";
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.65 ? "black" : "white";
}

export function renderBlocks({
  svg,
  blocks,
  fontSize = 10,
  fontFamily = "Arial, sans-serif",
  labelOrientation = "horizontal",
  contrastText = true
}) {

  blocks.forEach(block => {

    const rect = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "rect"
    );

    rect.setAttribute("x", block.x);
    rect.setAttribute("y", block.y);
    rect.setAttribute("width", block.width);
    rect.setAttribute("height", block.height);

    rect.setAttribute("fill", block.fill);
    rect.setAttribute("stroke", "black");
    rect.setAttribute("stroke-width", 0.5);
    rect.setAttribute("data-base-stroke", "0.5");
    if (block.unitId) rect.setAttribute("data-unit-id", block.unitId);

    svg.appendChild(rect);

    // Skip label when the time-axis pixel size is below threshold
    if (block.height < fontSize * 1.5) return;

    const label = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "text"
    );

    label.setAttribute("font-size", fontSize);
    label.setAttribute("data-base-font-size", fontSize);
    label.setAttribute("font-family", fontFamily);
    label.setAttribute("fill", contrastText ? contrastColor(block.fill) : "black");
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dominant-baseline", "middle");

    if (labelOrientation === "vertical") {
      label.setAttribute("x", block.labelX);
      label.setAttribute("y", block.labelY);
      label.setAttribute("transform",
        `rotate(-90, ${block.labelX}, ${block.labelY})`);
    } else {
      label.setAttribute("x", block.labelX);
      label.setAttribute("y", block.labelY);
    }

    label.textContent = block.label;

    svg.appendChild(label);
  });

}
