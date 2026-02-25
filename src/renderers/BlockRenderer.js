export function renderBlocks({
  svg,
  blocks,
  orientation
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

    svg.appendChild(rect);

    const label = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "text"
    );

    label.setAttribute("x", block.labelX);
    label.setAttribute("y", block.labelY);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dominant-baseline", "middle");
    label.setAttribute("font-size", "10");

    label.textContent = block.label;

    svg.appendChild(label);
  });

}