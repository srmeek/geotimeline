// Module-level canvas for text measurement
const _mc = document.createElement("canvas");
const _mctx = _mc.getContext("2d");

/**
 * Find the largest font size (≤ maxSize, ≥ minSize) at which the given words
 * fit inside screenW × screenH pixels, wrapping as needed.
 * Returns { lines: string[], fitSize: number }.
 */
export function computeFitAndWrap(words, screenW, screenH, fontFamily, maxSize, minSize = 5) {
  if (!words.length) return { lines: [""], fitSize: minSize };
  const padW = 6, padH = 4;
  const avW = Math.max(1, screenW - padW * 2);
  const avH = Math.max(1, screenH - padH * 2);

  for (let size = Math.min(maxSize, Math.floor(avH / 1.2)); size >= minSize; size--) {
    _mctx.font = `${size}px ${fontFamily}`;

    // Greedy word-wrap
    const lines = [];
    let cur = words[0];
    for (let i = 1; i < words.length; i++) {
      const test = cur + " " + words[i];
      if (_mctx.measureText(test).width <= avW) {
        cur = test;
      } else {
        lines.push(cur);
        cur = words[i];
      }
    }
    lines.push(cur);

    // Reject if any line overflows width
    if (lines.some(l => _mctx.measureText(l).width > avW)) continue;

    // Reject if total line stack overflows height
    if (lines.length * size * 1.2 > avH) continue;

    return { lines, fitSize: size };
  }

  // Fallback: minSize, wrap anyway (may overflow)
  _mctx.font = `${minSize}px ${fontFamily}`;
  const lines = [];
  let cur = words[0];
  for (let i = 1; i < words.length; i++) {
    const test = cur + " " + words[i];
    if (_mctx.measureText(test).width <= avW) {
      cur = test;
    } else {
      lines.push(cur);
      cur = words[i];
    }
  }
  lines.push(cur);
  return { lines, fitSize: minSize };
}

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
  contrastText = true,
  currentK = 1,
  fontBold = false,
  fontItalic = false,
  fontUnderline = false,
}) {
  blocks.forEach(block => {
    // ── rect ──────────────────────────────────────────────────────────────
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
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

    // ── label ─────────────────────────────────────────────────────────────
    const labelText = (block.label || "").trim();
    const words = labelText.split(/\s+/).filter(Boolean);
    if (!words.length) return;

    // Use block-level overrides if present
    const blockOrient = block.labelOrientation ?? labelOrientation;
    const blockFontSize = block.fontSize ?? fontSize;

    // Screen-space dimensions for fitting
    const screenW = block.width  * currentK;
    const screenH = block.height * currentK;

    // Resolve "auto" → align with the longer axis
    const resolvedOrient = blockOrient === "auto"
      ? (screenW >= screenH ? "horizontal" : "vertical")
      : blockOrient;

    // For vertical text the label runs along block.height, so swap fit axes
    const [fitW, fitH] = resolvedOrient === "vertical"
      ? [screenH, screenW]
      : [screenW, screenH];

    // Vertical orientation: treat whole label as one line (no line-break mid-rotation)
    const fitWords = resolvedOrient === "vertical" ? [words.join(" ")] : words;

    const { lines, fitSize } = computeFitAndWrap(fitWords, fitW, fitH, fontFamily, blockFontSize, 5);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");

    // font-size in zoom-layer coords; data-base-font-size = desired screen size
    label.setAttribute("font-size",          String(fitSize / currentK));
    label.setAttribute("data-base-font-size", String(fitSize));

    // Attributes read by applyCounterScale for dynamic re-fit on zoom
    label.setAttribute("data-block-w",       String(block.width));
    label.setAttribute("data-block-h",       String(block.height));
    label.setAttribute("data-label",          labelText);
    label.setAttribute("data-user-font-size", String(blockFontSize));
    label.setAttribute("data-font-family",    fontFamily);
    // Store "auto" so applyCounterScale can re-resolve per zoom level
    label.setAttribute("data-label-orient",   blockOrient);

    label.setAttribute("font-family", fontFamily);
    label.setAttribute("fill", contrastText ? contrastColor(block.fill) : "black");
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dominant-baseline", "middle");

    if (fontBold) label.setAttribute("font-weight", "bold");
    if (fontItalic) label.setAttribute("font-style", "italic");
    if (fontUnderline) label.setAttribute("text-decoration", "underline");

    if (block.unitId) label.setAttribute("data-unit-id", block.unitId);

    if (resolvedOrient === "vertical") {
      label.setAttribute("x", block.labelX);
      label.setAttribute("y", block.labelY);
      label.setAttribute("transform", `rotate(-90, ${block.labelX}, ${block.labelY})`);
      label.textContent = lines[0] || "";
    } else {
      label.setAttribute("x", block.labelX);
      label.setAttribute("y", block.labelY);

      // Tspans: center the line block vertically at labelY
      const lineHZL  = fitSize * 1.2 / currentK;
      const startDyZL = -(lines.length - 1) / 2 * lineHZL;

      lines.forEach((line, i) => {
        const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
        tspan.setAttribute("x",  String(block.labelX));
        tspan.setAttribute("dy", String(i === 0 ? startDyZL : lineHZL));
        tspan.textContent = line;
        label.appendChild(tspan);
      });
    }

    svg.appendChild(label);
  });
}
