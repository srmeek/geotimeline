import { renderPicks } from "./renderers/PicksRenderer";
import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";

import { renderBlocks } from "./renderers/BlockRenderer";
import geologicTime from "./data/geologicTime.json";

function computeLayout(columns, columnWidths) {
  let offset = 0;

  return columns.map(col => {
    const width = columnWidths[col.id] ?? columnWidths[col.level];
    const start = offset;
    const end = start + width;
    offset = end;

    return { ...col, start, width, end };
  });
}

function App() {
  const svgRef = useRef(null);

  const [orientation, setOrientation] = useState("vertical");
  const [activeTab, setActiveTab] = useState("Layout");

  const [columnConfig, setColumnConfig] = useState([
    { level: 0, label: "Super-Eon", visible: true },
    { level: 1, label: "Eon", visible: true },
    { level: 2, label: "Era", visible: true },
    { level: 3, label: "Period", visible: true },
    { level: 4, label: "Subperiod", visible: true },
    { level: 5, label: "Epoch", visible: true },
    { level: 6, label: "Stage", visible: true }
  ]);

  const [columnWidths, setColumnWidths] = useState({
    time: 80,
    0: 80,
    1: 80,
    2: 80,
    3: 80,
    4: 80,
    5: 80,
    6: 80,
    picks: 60
  });

  const [currentTransform, setCurrentTransform] = useState(d3.zoomIdentity);

  const [picksMode, setPicksMode] = useState("auto"); 
// "auto" | "manual"

  const [manualPicksLevel, setManualPicksLevel] = useState(null);

  const visibleLevels = columnConfig
    .filter(col => col.visible)
    .map(col => col.level)
    .sort((a, b) => a - b);

    let picksLevel;

if (picksMode === "auto") {
  picksLevel = visibleLevels.length
    ? Math.max(...visibleLevels)
    : null;
} else {
  picksLevel = manualPicksLevel;
}

  const hierarchyColumns = visibleLevels.map(level => ({
    id: level,
    type: "hierarchy",
    level
  }));

  const columns = [
  { id: "time", type: "time" },
  ...hierarchyColumns,
  { id: "picks", type: "picks" }
];

  const layout = computeLayout(columns, columnWidths);

  useEffect(() => {

    const svgElement = svgRef.current;
    while (svgElement.firstChild) {
      svgElement.removeChild(svgElement.firstChild);
    }

    const width = svgElement.clientWidth;
    const height = svgElement.clientHeight;

    const svg = d3.select(svgElement);
    const zoomLayer = svg.append("g");
    zoomLayer.attr("transform", currentTransform);

// ===== Rendering Layers =====
const backgroundLayer = zoomLayer.append("g");
const blockLayer = zoomLayer.append("g");
const picksLayer = zoomLayer.append("g");

    // Invisible canonical time scale (data-driven)
const ICS_MIN_AGE = 0;

const ICS_MAX_AGE = Math.max(
  ...geologicTime.units
    .filter(u => u.start !== null)
    .map(u => u.start)
);

const scale = d3.scaleLinear()
  .domain([ICS_MIN_AGE, ICS_MAX_AGE])
  .range(
    orientation === "vertical"
      ? [0, height]
      : [width, 0]
  );

    const allUnits = geologicTime.units.map(u => {
      let adjustedLevel = u.levelOrder;
      if (u.rankTime === "Sub-Period") adjustedLevel = 4;
      if (u.rankTime === "Epoch") adjustedLevel = 5;
      if (u.rankTime === "Age") adjustedLevel = 6;
      return { ...u, levelOrder: adjustedLevel };
    });

// ===== PICKS BOUNDARY RESOLUTION =====

let boundaryAges = [];

if ((picksMode === "auto" && visibleLevels.length) ||
    (picksMode === "manual" && manualPicksLevel !== null)) {

  // Determine which levels to consider

  let candidateLevels;

  if (picksMode === "auto") {
    candidateLevels = [...visibleLevels];
  } else {
    // Manual: start at selected level and include all higher levels for fallback
    candidateLevels = visibleLevels.filter(
      lvl => lvl <= manualPicksLevel
    );
  }

  // Sort deepest → shallowest
  const sortedLevels = [...candidateLevels].sort((a, b) => b - a);

  const boundaryMap = new Map();

  sortedLevels.forEach(level => {

    const unitsAtLevel = allUnits
      .filter(u => u.levelOrder === level)
      .filter(u => u.start !== null);

    unitsAtLevel.forEach(unit => {

      if (!boundaryMap.has(unit.start)) {
        boundaryMap.set(unit.start, []);
      }

      boundaryMap.get(unit.start).push(level);

    });

  });

  // Keep deepest available level for each boundary
  boundaryMap.forEach((levels, age) => {

    const deepestLevel = Math.max(...levels);

    boundaryAges.push(age);

  });

}

// Always include present day (0 Ma)
if (!boundaryAges.includes(0)) {
  boundaryAges.push(0);
}

boundaryAges = [...new Set(boundaryAges)]
  .sort((a, b) => b - a);

// ===== TIME COLUMN =====

const timeColumn = layout.find(col => col.id === "time");

const timeBackground = document.createElementNS(
  "http://www.w3.org/2000/svg",
  "rect"
);

if (orientation === "vertical") {
  timeBackground.setAttribute("x", timeColumn.start);
  timeBackground.setAttribute("y", 0);
  timeBackground.setAttribute("width", timeColumn.width);
  timeBackground.setAttribute("height", height);
} else {
  timeBackground.setAttribute("x", 0);
  timeBackground.setAttribute("y", timeColumn.start);
  timeBackground.setAttribute("width", width);
  timeBackground.setAttribute("height", timeColumn.width);
}

timeBackground.setAttribute("fill", "white");
timeBackground.setAttribute("stroke", "black");
timeBackground.setAttribute("stroke-width", "0.5");

backgroundLayer.node().appendChild(timeBackground);

// Tick labels
// ===== Time Axis Ticks =====

const tickValues = scale.ticks(40); // dense ticks
const majorEvery = 5;

tickValues.forEach((age, index) => {

  const pos = scale(age);

  const isMajor = index % majorEvery === 0;

  const tick = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "line"
  );

  const minorLength = 6;
  const majorLength = 12;

  if (orientation === "vertical") {

    const tickLength = isMajor ? majorLength : minorLength;

    tick.setAttribute("x1", timeColumn.end - tickLength);
    tick.setAttribute("x2", timeColumn.end);
    tick.setAttribute("y1", pos);
    tick.setAttribute("y2", pos);

  } else {

    const tickLength = isMajor ? majorLength : minorLength;

    tick.setAttribute("y1", timeColumn.end - tickLength);
    tick.setAttribute("y2", timeColumn.end);
    tick.setAttribute("x1", pos);
    tick.setAttribute("x2", pos);

  }

  tick.setAttribute("stroke", "black");
  tick.setAttribute("stroke-width", 1);

  backgroundLayer.node().appendChild(tick);

  // Label only major ticks
  if (isMajor) {

    const label = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "text"
    );

    if (orientation === "vertical") {
      label.setAttribute("x", timeColumn.end - majorLength - 4);
      label.setAttribute("y", pos + 4);
      label.setAttribute("text-anchor", "end");
    } else {
      label.setAttribute("x", pos);
      label.setAttribute("y", timeColumn.end - majorLength - 4);
      label.setAttribute("text-anchor", "middle");
    }

    label.setAttribute("font-size", "10");
    label.textContent = age.toFixed(0) + " Ma";

    backgroundLayer.node().appendChild(label);
  }

});

// ===== BLOCKS =====

const unitMap = Object.fromEntries(allUnits.map(u => [u.id, u]));

let resolvedBlocks = [];

visibleLevels.forEach(level => {

  const currentIndex = visibleLevels.indexOf(level);
  if (currentIndex === -1) return;

  const levelUnits = allUnits
    .filter(u => u.levelOrder === level)
    .filter(u => u.start !== null)
    .map(u => ({
      ...u,
      end: u.end === null ? 0 : u.end
    }));

  levelUnits.forEach(unit => {

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

    // ===== Horizontal geometry from layout =====

    const spanColumns = layout
      .filter(col =>
        col.id !== "time" &&
        visibleLevels.indexOf(col.id) >= spanStartIndex &&
        visibleLevels.indexOf(col.id) <= spanEndIndex
      );

    if (spanColumns.length === 0) return;

    const x = spanColumns[0].start;
    const width =
      spanColumns[spanColumns.length - 1].end - spanColumns[0].start;

    // ===== Vertical geometry from scale =====

    const pos1 = scale(unit.start);
    const pos2 = scale(unit.end);

    const y = orientation === "vertical"
      ? Math.min(pos1, pos2)
      : x;

    const height = orientation === "vertical"
      ? Math.abs(pos2 - pos1)
      : width;

    const blockWidth = orientation === "vertical"
      ? width
      : Math.abs(pos2 - pos1);

    const blockHeight = orientation === "vertical"
      ? Math.abs(pos2 - pos1)
      : width;

    resolvedBlocks.push({
      x: orientation === "vertical" ? x : Math.min(pos1, pos2),
      y: orientation === "vertical" ? y : x,
      width: blockWidth,
      height: blockHeight,
      fill: unit.icsColor || "#ccc",
      label: unit.displayName,
      labelX: orientation === "vertical"
        ? x + width / 2
        : Math.min(pos1, pos2) + Math.abs(pos2 - pos1) / 2,
      labelY: orientation === "vertical"
        ? y + Math.abs(pos2 - pos1) / 2
        : x + width / 2
    });

  });

});

renderBlocks({
  svg: blockLayer.node(),
  blocks: resolvedBlocks,
  orientation
});

// ===== PICKS =====

const picksColumn = layout.find(col => col.id === "picks");

if (picksColumn && boundaryAges.length) {
  renderPicks({
    svg: picksLayer.node(),
    column: picksColumn,
    boundaryAges,
    scale,
    orientation,
    width,
    height
  });
}

    const zoom = d3.zoom()
      .scaleExtent([0.1, 100])
      .on("zoom", (event) => {
        zoomLayer.attr("transform", event.transform);
        setCurrentTransform(event.transform);
      });

    svg.call(zoom);

  }, [orientation, columnConfig, columnWidths, currentTransform, picksMode, manualPicksLevel]);

  return (
    <div style={{
      width: "100vw",
      height: "100vh",
      display: "flex",
      flexDirection: "column",
      position: "relative",
      background: "white"
    }}>

      {/* Ribbon Tabs */}
      <div style={{
        display: "flex",
        borderBottom: "1px solid #ccc",
        background: "#f0f0f0"
      }}>
        {["Layout", "Picks","Display", "Data", "Export"].map(tab => (
          <div
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "10px 20px",
              cursor: "pointer",
              background: activeTab === tab ? "#ffffff" : "#f0f0f0",
              borderBottom: activeTab === tab ? "3px solid #333" : "none"
            }}
          >
            {tab}
          </div>
        ))}
      </div>

      {/* Ribbon Content */}
      <div style={{
        padding: "10px",
        borderBottom: "1px solid #ccc",
        background: "#ffffff"
      }}>
        {activeTab === "Layout" && (
          <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>
            <button onClick={() =>
              setOrientation(o =>
                o === "vertical" ? "horizontal" : "vertical"
              )
            }>
              Orientation
            </button>

            {columnConfig.map((col, index) => (
              <label key={col.level} style={{ marginRight: 10 }}>
                <input
                  type="checkbox"
                  checked={col.visible}
                  onChange={() => {
                    const updated = [...columnConfig];
                    updated[index].visible = !updated[index].visible;
                    setColumnConfig(updated);
                  }}
                />
                {col.label}
              </label>
            ))}
          </div>
        )}

        {activeTab === "Picks" && (
  <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>

    <div>
      <strong>Boundary Mode:</strong>
    </div>

    <label>
      <input
        type="radio"
        name="picksMode"
        value="auto"
        checked={picksMode === "auto"}
        onChange={() => setPicksMode("auto")}
      />
      Auto (Deepest Visible Coverage)
    </label>

    <label>
      <input
        type="radio"
        name="picksMode"
        value="manual"
        checked={picksMode === "manual"}
        onChange={() => setPicksMode("manual")}
      />
      Manual
    </label>

    {picksMode === "manual" && (
      <select
        value={manualPicksLevel ?? ""}
        onChange={(e) =>
          setManualPicksLevel(
            e.target.value === "" ? null : Number(e.target.value)
          )
        }
      >
        <option value="">Select Level</option>
        {columnConfig.map(col => (
          <option key={col.level} value={col.level}>
            {col.label}
          </option>
        ))}
      </select>
    )}

  </div>
)}
      </div>

      {/* Visualization Area */}
      <div style={{ flex: 1, position: "relative" }}>

        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          style={{ background: "white", cursor: "grab" }}
        />

        {/* Resize Handles */}
        {layout.map(col => {

  const k = currentTransform.k || 1;
  const tx = currentTransform.x || 0;
  const ty = currentTransform.y || 0;

  if (orientation === "vertical") {

    const handleX = (col.end * k) + tx;

    return (
      <div
        key={col.id}
        style={{
          position: "absolute",
          left: handleX - 3,
          top: 0,
          width: 6,
          height: "100%",
          cursor: "ew-resize",
          zIndex: 15
        }}
        onMouseDown={(e) => {
          e.preventDefault();
          const startX = e.clientX;
          const startWidth = col.width;

          const onMouseMove = (moveEvent) => {
            const delta = (moveEvent.clientX - startX) / k;
            const newWidth = Math.max(20, startWidth + delta);

            setColumnWidths(prev => ({
              ...prev,
              [col.id]: newWidth
            }));
          };

          const onMouseUp = () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
          };

          window.addEventListener("mousemove", onMouseMove);
          window.addEventListener("mouseup", onMouseUp);
        }}
      />
    );
  }

  // ✅ Horizontal orientation
  const handleY = (col.end * k) + ty;

  return (
    <div
      key={col.id}
      style={{
        position: "absolute",
        top: handleY - 3,
        left: 0,
        height: 6,
        width: "100%",
        cursor: "ns-resize",
        zIndex: 15
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        const startY = e.clientY;
        const startHeight = col.width; // same width value reused

        const onMouseMove = (moveEvent) => {
          const delta = (moveEvent.clientY - startY) / k;
          const newHeight = Math.max(20, startHeight + delta);

          setColumnWidths(prev => ({
            ...prev,
            [col.id]: newHeight
          }));
        };

        const onMouseUp = () => {
          window.removeEventListener("mousemove", onMouseMove);
          window.removeEventListener("mouseup", onMouseUp);
        };

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
      }}
    />
  );

})}

      </div>
    </div>
  );
}

export default App;