import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";

import { renderAxis } from "./renderers/AxisRenderer";
import { renderBlocks } from "./renderers/BlockRenderer";
import geologicTime from "./data/geologicTime.json";

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
    0: 80,
    1: 80,
    2: 80,
    3: 80,
    4: 80,
    5: 80,
    6: 80
  });

  const [currentTransform, setCurrentTransform] = useState(d3.zoomIdentity);

  useEffect(() => {

    const svgElement = svgRef.current;
    while (svgElement.firstChild) {
      svgElement.removeChild(svgElement.firstChild);
    }

    const width = svgElement.clientWidth;
    const height = svgElement.clientHeight;

    const topAge = 0;
    const baseAge = 4600;

    const svg = d3.select(svgElement);
    const zoomLayer = svg.append("g");
    zoomLayer.attr("transform", currentTransform);

    const scale = d3.scaleLinear()
      .domain([topAge, baseAge])
      .range(
        orientation === "vertical"
          ? [0, height]
          : [width, 0]
      );

    const axisColumnWidth = 100;

    const allUnits = geologicTime.units.map(u => {
      let adjustedLevel = u.levelOrder;
      if (u.rankTime === "Sub-Period") adjustedLevel = 4;
      if (u.rankTime === "Epoch") adjustedLevel = 5;
      if (u.rankTime === "Age") adjustedLevel = 6;
      return { ...u, levelOrder: adjustedLevel };
    });

    renderAxis({
      svg: zoomLayer.node(),
      scale,
      orientation,
      width,
      height
    });

    const visibleLevels = columnConfig
      .filter(col => col.visible)
      .map(col => col.level)
      .sort((a, b) => a - b);

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
        axisColumnWidth
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

  const visibleLevels = columnConfig
    .filter(col => col.visible)
    .map(col => col.level)
    .sort((a, b) => a - b);

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

        {activeTab !== "Layout" && (
          <div>Controls for {activeTab} will go here.</div>
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
        {visibleLevels.map((level, index) => {

          const axisWidth = 100;

          let accumulated = 0;
          for (let i = 0; i < index; i++) {
            accumulated += columnWidths[visibleLevels[i]];
          }

          const edgePosition = axisWidth + accumulated + columnWidths[level];

          const k = currentTransform.k || 1;
          const tx = currentTransform.x || 0;
          const ty = currentTransform.y || 0;

          if (orientation === "vertical") {

            const handleX = (edgePosition * k) + tx;

            return (
              <div
                key={level}
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
                  const startWidth = columnWidths[level];

                  const onMouseMove = (moveEvent) => {
                    const delta = (moveEvent.clientX - startX) / k;
                    const newWidth = Math.max(20, startWidth + delta);
                    setColumnWidths(prev => ({
                      ...prev,
                      [level]: newWidth
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

          } else {

            const handleY = (edgePosition * k) + ty;

            return (
              <div
                key={level}
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
                  const startHeight = columnWidths[level];

                  const onMouseMove = (moveEvent) => {
                    const delta = (moveEvent.clientY - startY) / k;
                    const newHeight = Math.max(20, startHeight + delta);
                    setColumnWidths(prev => ({
                      ...prev,
                      [level]: newHeight
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

        })}

      </div>

    </div>
  );
}

export default App;