// src/core/layout.js

export function computeColumnLayout(visibleLevels, columnWidths, axisColumnWidth) {
  const layout = [];

  let runningOffset = axisColumnWidth;

  visibleLevels.forEach(level => {
    const width = columnWidths[level];

    layout.push({
      level,
      start: runningOffset,
      width,
      end: runningOffset + width
    });

    runningOffset += width;
  });

  return layout;
}