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
    6: 80
  });

  const [currentTransform, setCurrentTransform] = useState(d3.zoomIdentity);

  const visibleLevels = columnConfig
    .filter(col => col.visible)
    .map(col => col.level)
    .sort((a, b) => a - b);

  const hierarchyColumns = visibleLevels.map(level => ({
    id: level,
    type: "hierarchy",
    level
  }));

  const columns = [
    { id: "time", type: "time" },
    ...hierarchyColumns
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

   // ===== TIME COLUMN =====
const timeColumn = layout.find(col => col.id === "time");

// Background
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

zoomLayer.node().appendChild(timeBackground);

// Tick labels
scale.ticks(12).forEach(age => {

  const pos = scale(age);

  const text = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "text"
  );

  if (orientation === "vertical") {
    text.setAttribute("x", timeColumn.end - 6);
    text.setAttribute("y", pos + 4);
    text.setAttribute("text-anchor", "end");
  } else {
    text.setAttribute("x", pos);
    text.setAttribute("y", timeColumn.end - 6);
    text.setAttribute("text-anchor", "middle");
  }

  text.setAttribute("font-size", "10");
  text.textContent = age.toFixed(0) + " Ma";

  zoomLayer.node().appendChild(text);
});
    // ===== BLOCKS =====
    visibleLevels.forEach(level => {

      const levelUnits = allUnits
        .filter(u => u.levelOrder === level)
        .filter(u => u.start !== null)
        .map(u => ({
          ...u,
          end: u.end === null ? 0 : u.end
        }));

      renderBlocks({
        svg: zoomLayer.node(),
        levelUnits,
        allUnits,
        scale,
        orientation,
        level,
        visibleLevels,
        columnWidths,
        axisColumnWidth: timeColumn.end
      });

    });

    const zoom = d3.zoom()
      .scaleExtent([0.1, 100])
      .on("zoom", (event) => {
        zoomLayer.attr("transform", event.transform);
        setCurrentTransform(event.transform);
      });

    svg.call(zoom);

  }, [orientation, columnConfig, columnWidths, currentTransform]);

  return (
    <div style={{
      width: "100vw",
      height: "100vh",
      display: "flex",
      flexDirection: "column",
      position: "relative"
    }}>

      {/* Ribbon Tabs */}
      <div style={{
        display: "flex",
        borderBottom: "1px solid #ccc",
        background: "#f0f0f0"
      }}>
        {["Layout", "Display", "Data", "Export"].map(tab => (
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
      </div>

      {/* Visualization Area */}
      <div style={{ flex: 1, position: "relative" }}>

        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          style={{ background: "#f5f5f5", cursor: "grab" }}
        />

        {/* Resize Handles */}
        {layout.map(col => {

          const k = currentTransform.k || 1;
          const tx = currentTransform.x || 0;

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

          return null;
        })}

      </div>
    </div>
  );
}

export default App;