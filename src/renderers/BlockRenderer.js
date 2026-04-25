const WAVE_AMP    = 7;
const WAVE_PERIOD = 16;

function svgWavePath(x, y, width, amp, period) {
  const half = period / 2;
  let cx = x, flip = 1, d = "";
  while (cx < x + width) {
    const ex = Math.min(cx + half, x + width);
    d += `Q${(cx + ex) / 2},${y - amp * flip} ${ex},${y} `;
    cx = ex; flip = -flip;
  }
  return d;
}

function svgWavePathRTL(x, y, width, amp, period) {
  const half = period / 2;
  let cx = x + width, flip = 1, d = "";
  while (cx > x) {
    const ex = Math.max(cx - half, x);
    d += `Q${(cx + ex) / 2},${y - amp * flip} ${ex},${y} `;
    cx = ex; flip = -flip;
  }
  return d;
}

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
    // ── rect / wave block ─────────────────────────────────────────────────
    const bx = block.x, by = block.y, bw = block.width, bh = block.height;

    if (block.waveTop || block.waveBottom) {
      // White background
      const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      bg.setAttribute("x", bx); bg.setAttribute("y", by);
      bg.setAttribute("width", bw); bg.setAttribute("height", bh);
      bg.setAttribute("fill", "white");
      if (block.unitId) bg.setAttribute("data-unit-id", block.unitId);
      svg.appendChild(bg);

      // Colored fill path bounded by wave edges
      let fillD = "";
      if (block.waveTop) {
        fillD += `M${bx},${by} ` + svgWavePath(bx, by, bw, WAVE_AMP, WAVE_PERIOD);
      } else {
        fillD += `M${bx},${by} L${bx + bw},${by} `;
      }
      fillD += `L${bx + bw},${by + bh} `;
      if (block.waveBottom) {
        fillD += svgWavePathRTL(bx, by + bh, bw, WAVE_AMP, WAVE_PERIOD);
      } else {
        fillD += `L${bx},${by + bh} `;
      }
      fillD += "Z";
      const fillPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      fillPath.setAttribute("d", fillD);
      fillPath.setAttribute("fill", block.fill);
      svg.appendChild(fillPath);

      // Straight borders on non-waved edges
      const addLine = (x1, y1, x2, y2) => {
        const ln = document.createElementNS("http://www.w3.org/2000/svg", "line");
        ln.setAttribute("x1", x1); ln.setAttribute("y1", y1);
        ln.setAttribute("x2", x2); ln.setAttribute("y2", y2);
        ln.setAttribute("stroke", "rgba(0,0,0,0.4)");
        ln.setAttribute("stroke-width", "0.5");
        svg.appendChild(ln);
      };
      addLine(bx, by, bx, by + bh);
      addLine(bx + bw, by, bx + bw, by + bh);
      if (!block.waveTop)    addLine(bx, by, bx + bw, by);
      if (!block.waveBottom) addLine(bx, by + bh, bx + bw, by + bh);

      // Wavy dashed stroke on waved edges
      const addWaveStroke = (d) => {
        const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        p.setAttribute("d", d);
        p.setAttribute("fill", "none");
        p.setAttribute("stroke", "rgba(0,0,0,0.55)");
        p.setAttribute("stroke-width", "1.5");
        p.setAttribute("stroke-linecap", "round");
        p.setAttribute("stroke-dasharray", "6,4");
        svg.appendChild(p);
      };
      if (block.waveTop)    addWaveStroke(`M${bx},${by} `    + svgWavePath(bx, by,    bw, WAVE_AMP, WAVE_PERIOD));
      if (block.waveBottom) addWaveStroke(`M${bx},${by + bh} ` + svgWavePath(bx, by + bh, bw, WAVE_AMP, WAVE_PERIOD));
    } else {
      // ── standard rect ──
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", bx);
      rect.setAttribute("y", by);
      rect.setAttribute("width", bw);
      rect.setAttribute("height", bh);
      rect.setAttribute("fill", block.fill);
      rect.setAttribute("stroke", "black");
      rect.setAttribute("stroke-width", 0.5);
      rect.setAttribute("data-base-stroke", "0.5");
      if (block.unitId) rect.setAttribute("data-unit-id", block.unitId);
      svg.appendChild(rect);
    }

    // ── label ─────────────────────────────────────────────────────────────
    const labelText = (block.label || "").trim();
    const words = labelText.split(/\s+/).filter(Boolean);
    if (!words.length) return;

    // Use block-level overrides if present
    const blockOrient = block.labelOrientation ?? labelOrientation;
    const blockFontSize = block.fontSize ?? fontSize;

    // Screen-space dimensions for fitting.
    // orientWidth may be wider than width (e.g. Phanerozoic includes Super-Eon column).
    const orientW = (block.orientWidth ?? block.width) * currentK;
    const screenW = block.width  * currentK;
    const screenH = block.height * currentK;

    // Resolve "auto" → align with the longer axis, using orientW so that blocks
    // without a visible parent (e.g. Phanerozoic) account for adjacent columns.
    const resolvedOrient = blockOrient === "auto"
      ? (orientW >= screenH ? "horizontal" : "vertical")
      : blockOrient;

    // For vertical text the label runs along block.height, so swap fit axes.
    // Fit width uses the actual drawn width (screenW), not the wider orientW,
    // so text stays within the block's own painted area.
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

    // Attributes read by applyCounterScale for dynamic re-fit on zoom.
    // data-block-w  = orientation width (may include adjacent columns, e.g. Super-Eon for Phanerozoic)
    // data-block-dw = drawn width (actual painted block — used for text fitting, not orientation)
    label.setAttribute("data-block-w",       String(block.orientWidth ?? block.width));
    label.setAttribute("data-block-dw",      String(block.width));
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
