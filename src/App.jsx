import { renderPicks } from "./renderers/PicksRenderer";
import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";

import { renderBlocks } from "./renderers/BlockRenderer";
import {
  computeLayout,
  formatTickLabel,
  makeScale,
} from "./lib/scale.js";
import { ALL_UNITS, UNIT_MAP, isUnitVisible } from "./lib/units.js";
import TimelineCanvas from "./components/TimelineCanvas.jsx";
import { buildEffectiveExtents } from "./lib/cropEdges.js";
import CustomScrollbar from "./components/CustomScrollbar.jsx";

const ICS_MIN_AGE = 0;
const ICS_MAX_AGE = 4567.30;
const MARGIN = 14;       // px horizontal offset applied to column positions
const RESET_PADDING_FRACTION = 0.05;       // 5% pixel-fraction gap at top and bottom on reset
const ZOOM_OUT_PADDING_FACTOR = 0.10;      // 10% zoom-out/pan headroom beyond data extent

function computeResetView({
  dynamicMinAge, dynamicMaxAge, layout, viewportWidth,
  scaleType, effectiveUnits, equalSizeLevel, eM, viewH,
}) {
  const totalColumnsWidth = layout[layout.length - 1]?.end ?? 0;
  const centeredLateral = Math.max(0, (viewportWidth - totalColumnsWidth) / 2);

  // Build a temporary scale mapping the full data extent to the drawing area,
  // then invert padded pixel positions to find the padded age bounds.
  // This produces a visible pixel gap for every scale type (not just linear).
  const drawingH = Math.max(1, viewH - eM);
  const padPx = RESET_PADDING_FRACTION * drawingH;
  const padTopY = eM - padPx;
  const padBotY = viewH + padPx;

  const { toAge } = makeScale({
    scaleType,
    vMin: dynamicMinAge, vMax: dynamicMaxAge,
    fullMin: dynamicMinAge, fullMax: dynamicMaxAge,
    eM, viewH,
    units: effectiveUnits, equalSizeLevel,
  });

  const paddedMinRaw = toAge(padTopY);
  const paddedMaxRaw = toAge(padBotY);

  // Safety clamp: keep reset view inside the navigable range.
  const span = dynamicMaxAge - dynamicMinAge;
  const clampMin = dynamicMinAge - span * 0.10;
  const clampMax = dynamicMaxAge + span * 0.10;
  const paddedMin = Math.max(clampMin, paddedMinRaw);
  const paddedMax = Math.min(clampMax, paddedMaxRaw);

  return { paddedMin, paddedMax, centeredLateral };
}

const _initPrefs = (() => {
  try { return JSON.parse(localStorage.getItem("gt_prefs")) || {}; } catch { return {}; }
})();
const _initUnitEdits = (() => {
  try { return JSON.parse(localStorage.getItem("gt_unitEdits")) || {}; } catch { return {}; }
})();

/**
 * Render (or re-render) time-axis ticks into `layer` (a bare SVG g element).
 * `tickDomain` is the VISIBLE age range in Ma — determines tick density.
 * `scale`       is the full positioning scale (maps Ma → SVG y-coord).
 */
function renderTimeAxisTicks({ layer, scale, tickDomain, timeColumn, eM, svgH, timeUnit, fontSize, fontFamily }) {
  while (layer.firstChild) layer.removeChild(layer.firstChild);

  const [visMin, visMax] = tickDomain;

  // Always generate evenly-spaced ticks from a linear domain.
  // Non-linear scales (log, equalSize) position the ticks differently on screen,
  // but we still want the labels to fall at round age values, not geologic boundaries.
  const tickValues = d3.scaleLinear().domain([visMin, visMax]).ticks(40);
  if (!tickValues.length) return;

  const tickSpan = visMax - visMin;
  const tickStep = tickValues.length > 1
    ? Math.abs(tickValues[1] - tickValues[0])
    : Math.max(0.001, tickSpan / 20);

  // Aim for roughly one label per 2.5 line-heights of space
  const targetLabels = Math.max(4, Math.floor((svgH - 2 * eM) / (fontSize * 2.5)));
  const majorEvery   = Math.max(1, Math.round(tickValues.length / targetLabels));

  // Labeled major ticks — every majorEvery-th item from tickValues
  const majorTicks = tickValues.filter((_, i) => i % majorEvery === 0);

  // Minor ticks — 4 subdivisions (1/5 intervals) between each pair of majors
  const minorTicks = [];
  for (let i = 0; i < majorTicks.length - 1; i++) {
    const a = majorTicks[i], b = majorTicks[i + 1];
    const step = (b - a) / 5;
    for (let j = 1; j < 5; j++) {
      const age = a + j * step;
      if (age >= visMin && age <= visMax) minorTicks.push(age);
    }
  }

  // Draw minor ticks first (shorter, no label)
  minorTicks.forEach(age => {
    const pos = scale(age);
    if (pos < eM - 2 || pos > svgH - eM + 2) return;
    const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
    tick.setAttribute("x1", timeColumn.end - 5);
    tick.setAttribute("x2", timeColumn.end);
    tick.setAttribute("y1", pos);
    tick.setAttribute("y2", pos);
    tick.setAttribute("stroke", "black");
    tick.setAttribute("stroke-width", "0.7");
    tick.setAttribute("data-base-stroke", "0.7");
    layer.appendChild(tick);
  });

  // Draw major ticks with labels
  let lastLabelY = -Infinity;
  majorTicks.forEach(age => {
    const pos = scale(age);
    if (pos < eM - 2 || pos > svgH - eM + 2) return;

    const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
    tick.setAttribute("x1", timeColumn.end - 12);
    tick.setAttribute("x2", timeColumn.end);
    tick.setAttribute("y1", pos);
    tick.setAttribute("y2", pos);
    tick.setAttribute("stroke", "black");
    tick.setAttribute("stroke-width", "1");
    tick.setAttribute("data-base-stroke", "1");
    layer.appendChild(tick);

    if (pos - lastLabelY >= fontSize * 1.2) {
      lastLabelY = pos;
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("dominant-baseline", "middle");
      label.setAttribute("x", timeColumn.end - 16);
      label.setAttribute("y", pos);
      label.setAttribute("text-anchor", "end");
      label.setAttribute("font-size", fontSize);
      label.setAttribute("data-base-font-size", String(fontSize));
      label.setAttribute("font-family", fontFamily);
      label.textContent = formatTickLabel(age, tickStep, timeUnit);
      layer.appendChild(label);
    }
  });
}

function App() {
  const scrollContainerRef = useRef(null);
  const importEditsRef = useRef(null);
  const effectiveMarginRef = useRef(14);
  const canvasRef = useRef(null);
  const rafHandleRef = useRef(null);
  const hitBoxesRef = useRef([]); // populated each frame, queried on mousemove
  const [headerHeight, setHeaderHeight] = useState(() => _initPrefs.headerHeight ?? 48);
  const [headerFontSize, setHeaderFontSize] = useState(() => _initPrefs.headerFontSize ?? 13);
  // Top margin tracks header height; bottom margin is fixed so the footer never moves.
  // Ref is read by the rAF draw loop and event handlers; mirror it from state every render.
  effectiveMarginRef.current = headerHeight + 8;
  const BOTTOM_MARGIN = 8;

  const [leftPanelOpen, setLeftPanelOpen] = useState(() => _initPrefs.leftPanelOpen ?? true);
  const [settingsOpen, setSettingsOpen] = useState(() => _initPrefs.settingsOpen ?? false);
  const [leftColumnsCollapsed, setLeftColumnsCollapsed] = useState(() => _initPrefs.leftColumnsCollapsed ?? false);
  const [leftFilterCollapsed, setLeftFilterCollapsed] = useState(() => _initPrefs.leftFilterCollapsed ?? false);
  const [settingsTab, setSettingsTab] = useState("display");
  const [unitSearch, setUnitSearch] = useState("");

  const _defaultColumnConfig = [
    { level: 0, label: "Super-Eon", labelStrat: "Super-Eonothem", visible: true, orientation: null, fontSize: null },
    { level: 1, label: "Eon",       labelStrat: "Eonothem",       visible: true, orientation: null, fontSize: null },
    { level: 2, label: "Era",       labelStrat: "Erathem",        visible: true, orientation: null, fontSize: null },
    { level: 3, label: "Period",    labelStrat: "System",         visible: true, orientation: null, fontSize: null },
    { level: 4, label: "Subperiod", labelStrat: "Subsystem",      visible: true, orientation: null, fontSize: null },
    { level: 5,   label: "Epoch",    labelStrat: "Series",         visible: true, orientation: null, fontSize: null },
    { level: 5.5, label: "Subepoch",labelStrat: "Subseries",      visible: false, orientation: null, fontSize: null },
    { level: 6,   label: "Age",     labelStrat: "Stage",          visible: false, orientation: null, fontSize: null }
  ];
  const [columnConfig, setColumnConfig] = useState(() => {
    const saved = _initPrefs.columnConfig;
    if (!saved) return _defaultColumnConfig;
    // Migrate saved prefs that pre-date the Subepoch level
    if (!saved.some(c => c.level === 5.5)) {
      const injected = [...saved];
      const ageIdx = injected.findIndex(c => c.level === 6);
      injected.splice(ageIdx, 0, { level: 5.5, label: "Subepoch", labelStrat: "Subseries", visible: true, orientation: null, fontSize: null });
      return injected.map(c => ({ orientation: null, fontSize: null, ...c }));
    }
    return saved.map(c => ({ orientation: null, fontSize: null, ...c }));
  });

  const [columnWidths, setColumnWidths] = useState(() => {
    const saved = _initPrefs.columnWidths;
    const defaults = { time: 80, 0: 80, 1: 80, 2: 80, 3: 80, 4: 80, 5: 80, 5.5: 80, 6: 80, picks: 60 };
    return saved ? { 5.5: 80, ...saved } : defaults;
  });

  const [timeUnit, setTimeUnit] = useState(() => _initPrefs.timeUnit ?? "Ma"); // "Ga" | "Ma" | "ka"

  const [visibleDomain, setVisibleDomain] = useState([ICS_MIN_AGE, ICS_MAX_AGE]);
  const visibleDomainRef = useRef([ICS_MIN_AGE, ICS_MAX_AGE]);
  // lateralOffset: horizontal (x-axis) translation, for panning perpendicular to the time axis
  const [lateralOffset, setLateralOffset] = useState(0);
  const lateralOffsetRef = useRef(0);

  const [hiddenUnits, setHiddenUnits] = useState(
    () => new Set(_initPrefs.hiddenUnits ?? [])
  );
  const [expandedNodes, setExpandedNodes] = useState(() => new Set());
  const [showDataEditor, setShowDataEditor] = useState(false);
  const [unitEdits, setUnitEdits] = useState(() => _initUnitEdits); // { [id]: { field: value, ... } }
  const [editorSearch, setEditorSearch] = useState("");
  const [editorRankFilter, setEditorRankFilter] = useState("all");
  const [editorSortCol, setEditorSortCol] = useState("start");
  const [editorSortDir, setEditorSortDir] = useState("desc");
  const [editingCell, setEditingCell] = useState(null); // { id, field } | null
  const [editingValue, setEditingValue] = useState("");
  const [editorWidth, setEditorWidth] = useState(820);

  // Apply any user edits on top of the base unit data.
  // Memoized: rebuilding this on every render reallocates 100+ objects and
  // busts downstream referential equality (drawFrame deps, picks filter, etc).
  const effectiveUnits = useMemo(() => ALL_UNITS.map(u => ({
    ...u,
    ...(unitEdits[u.id] || {})
  })), [unitEdits]);

  // Dynamic time extent — shrinks when units are hidden.
  // Memoized: reduces over ~100 units on every keystroke otherwise.
  const { dynamicMinAge, dynamicMaxAge } = useMemo(() => {
    const visLevels = columnConfig.filter(col => col.visible).map(col => col.level);
    const visible = effectiveUnits.filter(u =>
      u.start !== null &&
      isUnitVisible(u.id, hiddenUnits) &&
      visLevels.includes(u.levelOrder)
    );
    if (visible.length === 0) return { dynamicMinAge: ICS_MIN_AGE, dynamicMaxAge: ICS_MAX_AGE };
    let minAge = Infinity, maxAge = -Infinity;
    const visibleSetForCrop = new Set(visible.map(u => u.id));
    const cropExtents = buildEffectiveExtents(effectiveUnits, visibleSetForCrop, visLevels.slice().sort((a, b) => a - b));
    for (const u of visible) {
      const ext = cropExtents.get(u.id);
      const eStart = ext ? ext.effectiveStart : u.start;
      const eEnd   = ext ? ext.effectiveEnd   : (u.end ?? 0);
      if (eStart > maxAge) maxAge = eStart;
      if (eEnd   < minAge) minAge = eEnd;
    }
    return { dynamicMinAge: minAge, dynamicMaxAge: maxAge };
  }, [effectiveUnits, hiddenUnits, columnConfig]);

  // Refs so zoom/pan closures always see the latest dynamic bounds.
  // Read by event handlers and the rAF loop; mirrored from state every render.
  const dynamicMinAgeRef = useRef(ICS_MIN_AGE);
  const dynamicMaxAgeRef = useRef(ICS_MAX_AGE);
  dynamicMinAgeRef.current = dynamicMinAge;
  dynamicMaxAgeRef.current = dynamicMaxAge;

  // Pan/zoom-out clamping extent — 10% headroom beyond the true data bounds.
  const clampMinAge = dynamicMinAge - (dynamicMaxAge - dynamicMinAge) * ZOOM_OUT_PADDING_FACTOR;
  const clampMaxAge = dynamicMaxAge + (dynamicMaxAge - dynamicMinAge) * ZOOM_OUT_PADDING_FACTOR;
  const clampMinAgeRef = useRef(clampMinAge);
  const clampMaxAgeRef = useRef(clampMaxAge);
  clampMinAgeRef.current = clampMinAge;
  clampMaxAgeRef.current = clampMaxAge;

  const hasInitializedView = useRef(false);

  function handleResetZoom() {
    const { paddedMin, paddedMax, centeredLateral } = computeResetView({
      dynamicMinAge, dynamicMaxAge, layout,
      viewportWidth: scrollContainerRef.current?.clientWidth ?? 0,
      scaleType, effectiveUnits, equalSizeLevel,
      eM: effectiveMarginRef.current,
      viewH: scrollContainerRef.current?.clientHeight ?? 800,
    });
    visibleDomainRef.current = [paddedMin, paddedMax];
    setVisibleDomain([paddedMin, paddedMax]);
    lateralOffsetRef.current = centeredLateral;
    setLateralOffset(centeredLateral);
  }

  // ── SVG export: build an offscreen SVG matching the current canvas view ──
  function buildSVGForExport() {
    const viewH   = scrollContainerRef.current?.clientHeight || 800;
    const eM      = effectiveMarginRef.current;
    const [vMin, vMax] = visibleDomainRef.current;
    const lateral = lateralOffsetRef.current;

    const visLevels = columnConfig.filter(c => c.visible).map(c => c.level).sort((a, b) => a - b);
    const cols = [
      { id: "time", type: "time" },
      ...visLevels.map(lv => ({ id: lv, type: "hierarchy", level: lv })),
      { id: "picks", type: "picks" },
    ];
    const exportLayout = computeLayout(cols, effectiveColumnWidths, MARGIN);
    const rightEdge = (exportLayout[exportLayout.length - 1]?.end ?? 400) + 40; // +40 for GSSP markers
    const totalWidth = rightEdge + Math.abs(lateral);

    const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgEl.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svgEl.setAttribute("width",  String(Math.round(totalWidth)));
    svgEl.setAttribute("height", String(Math.round(viewH)));

    const allUnits   = effectiveUnits;
    const visibleSet = new Set(allUnits.filter(u => u.start !== null && isUnitVisible(u.id, hiddenUnits)).map(u => u.id));
    const svgCropExtents = buildEffectiveExtents(allUnits, visibleSet, visLevels);
    const scaleUnits = scaleType === "equalSize"
      ? effectiveUnits.filter(u => isUnitVisible(u.id, hiddenUnits))
      : allUnits;

    const { toY: scale } = makeScale({
      scaleType,
      vMin, vMax,
      fullMin: dynamicMinAge, fullMax: dynamicMaxAge,
      eM, viewH: viewH - BOTTOM_MARGIN,
      units: scaleUnits, equalSizeLevel,
    });

    const svgD3 = d3.select(svgEl);
    const zoomLayer     = svgD3.append("g").attr("transform", `translate(${lateral},0)`);
    const backgroundLayer = zoomLayer.append("g");
    const blockLayer      = zoomLayer.append("g");
    const picksLayer      = zoomLayer.append("g");
    const gsspLayer       = zoomLayer.append("g");

    // White background
    svgD3.insert("rect", ":first-child")
      .attr("width", totalWidth).attr("height", viewH).attr("fill", "white");

    // Time column
    const timeColumn = exportLayout.find(col => col.id === "time");
    if (timeColumn) {
      const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      bg.setAttribute("x",      timeColumn.start);
      bg.setAttribute("y",      eM);
      bg.setAttribute("width",  timeColumn.width);
      bg.setAttribute("height", viewH - eM - BOTTOM_MARGIN);
      bg.setAttribute("fill",   "white");
      backgroundLayer.node().appendChild(bg);

      const tickGroup = backgroundLayer.append("g").node();
      renderTimeAxisTicks({ layer: tickGroup, scale, tickDomain: [vMin, vMax],
        timeColumn, eM, svgH: viewH, timeUnit, fontSize, fontFamily });
    }

    // Blocks
    const unitMap = UNIT_MAP;
    const resolvedBlocks = [];

    visLevels.forEach(level => {
      const currentIndex = visLevels.indexOf(level);
      const levelUnits = allUnits
        .filter(u => u.levelOrder === level && u.start !== null && isUnitVisible(u.id, hiddenUnits))
        .map(u => ({ ...u, end: u.end ?? 0 }));

      levelUnits.forEach(unit => {
        let spanStartIndex = currentIndex;
        let hasVisibleParent = false;
        let parentId = unit.parent;
        while (parentId) {
          const parent = unitMap[parentId];
          if (parent && visLevels.includes(parent.levelOrder)) { hasVisibleParent = true; break; }
          parentId = parent?.parent;
        }
        if (!hasVisibleParent) spanStartIndex = 0;

        let spanEndIndex = currentIndex;
        for (let i = currentIndex + 1; i < visLevels.length; i++) {
          const nextLevel = visLevels[i];
          const hasDesc = allUnits.some(u => {
            if (u.levelOrder !== nextLevel || !isUnitVisible(u.id, hiddenUnits)) return false;
            let pid = u.parent;
            while (pid) { if (pid === unit.id) return true; pid = unitMap[pid]?.parent; }
            return false;
          });
          if (hasDesc) { spanEndIndex = i - 1; break; }
          spanEndIndex = i;
        }

        const spanColumns = exportLayout.filter(col =>
          col.id !== "time" && col.id !== "picks" &&
          visLevels.indexOf(col.id) >= spanStartIndex &&
          visLevels.indexOf(col.id) <= spanEndIndex
        );
        if (spanColumns.length === 0) return;

        const colBandStart = spanColumns[0].start;
        const colBandWidth = spanColumns[spanColumns.length - 1].end - colBandStart;
        const orientBandStart = !hasVisibleParent
          ? (exportLayout.find(c => c.id !== "time" && c.id !== "picks")?.start ?? colBandStart)
          : colBandStart;
        const orientWidth = spanColumns[spanColumns.length - 1].end - orientBandStart;

        const ext = svgCropExtents.get(unit.id);
        const effectiveStart = ext ? ext.effectiveStart : unit.start;
        const effectiveEnd   = ext ? ext.effectiveEnd   : (unit.end ?? 0);
        const waveTop        = ext ? ext.waveTop        : false;
        const waveBottom     = ext ? ext.waveBottom     : false;
        const pos1 = scale(effectiveStart);
        const pos2 = scale(effectiveEnd);
        const blockY = Math.min(pos1, pos2);
        const blockHeight = Math.abs(pos2 - pos1);
        if (blockY > viewH || blockY + blockHeight < 0) return;

        const colConf = columnConfig.find(c => c.level === unit.levelOrder);
        const matchingRule = fontRules.find(r =>
          unit.start <= r.maxAge && (unit.end ?? 0) >= r.minAge
        );
        const blockFontSize = matchingRule?.fontSize ?? colConf?.fontSize ?? fontSize;

        resolvedBlocks.push({
          unitId: unit.id,
          x: colBandStart, y: blockY,
          width: colBandWidth, orientWidth, height: blockHeight,
          fill: unit.icsColor || "#ccc",
          label: (() => {
            const ts = unit.displayName, st = unit.displayNameStratigraphic;
            if (labelMode === "stratigraphic") return st || ts;
            if (labelMode === "both" && st) return `${ts} / ${st}`;
            return ts;
          })(),
          labelX: colBandStart + colBandWidth / 2,
          labelY: blockY + blockHeight / 2,
          labelOrientation: colConf?.orientation ?? "auto",
          fontSize: blockFontSize,
          ageStart: unit.start, ageEnd: unit.end ?? 0,
          waveTop, waveBottom,
        });
      });
    });

    renderBlocks({ svg: blockLayer.node(), blocks: resolvedBlocks,
      fontSize, fontFamily, labelOrientation, contrastText, currentK: 1,
      fontBold, fontItalic, fontUnderline });

    // Picks
    const picksColumn = exportLayout.find(col => col.id === "picks");
    if (picksColumn) {
      let boundaryAges = [];
      let candidateLevels = [];
      if (picksMode === "auto") {
        candidateLevels = [...visLevels];
      } else if (picksMode === "adaptive") {
        const minPxGap = fontSize * 1.6;
        let adaptLevel = null;
        for (const level of [...visLevels].sort((a, b) => b - a)) {
          const positions = allUnits
            .filter(u => u.levelOrder === level && u.start !== null && isUnitVisible(u.id, hiddenUnits))
            .filter(u => u.start >= vMin && u.start <= vMax)
            .map(u => scale(u.start)).filter(p => isFinite(p)).sort((a, b) => a - b);
          if (!positions.length) continue;
          if (positions.length === 1) { adaptLevel = level; break; }
          let minGap = Infinity;
          for (let i = 1; i < positions.length; i++) minGap = Math.min(minGap, positions[i] - positions[i - 1]);
          if (minGap >= minPxGap) { adaptLevel = level; break; }
        }
        if (adaptLevel === null) adaptLevel = [...visLevels].sort((a, b) => a - b)[0];
        candidateLevels = adaptLevel !== null ? [adaptLevel] : [];
      } else if (picksMode === "manual" && manualPicksLevel !== null) {
        candidateLevels = visLevels.filter(lvl => lvl <= manualPicksLevel);
      }

      if (candidateLevels.length) {
        const boundaryMap = new Map();
        [...candidateLevels].sort((a, b) => b - a).forEach(level => {
          allUnits
            .filter(u => u.levelOrder === level && u.start !== null && isUnitVisible(u.id, hiddenUnits))
            .forEach(u => {
              if (!boundaryMap.has(u.start))
                boundaryMap.set(u.start, { uncertainty: u.startUncertainty ?? null, approximate: u.startApproximate ?? false });
            });
        });
        const coveredStarts = new Set(boundaryMap.keys());
        candidateLevels.forEach(level => {
          allUnits
            .filter(u =>
              u.levelOrder === level &&
              u.start !== null &&
              isUnitVisible(u.id, hiddenUnits)
            )
            .forEach(u => {
              const topAge = u.end ?? 0;
              if (!coveredStarts.has(topAge) && !boundaryMap.has(topAge)) {
                boundaryMap.set(topAge, { uncertainty: null, approximate: false });
              }
            });
        });
        boundaryMap.forEach(({ uncertainty, approximate }, age) => boundaryAges.push({ age, uncertainty, approximate }));
      }
      if (!boundaryAges.some(b => b.age === dynamicMinAge)) boundaryAges.push({ age: dynamicMinAge, uncertainty: null, approximate: false });
      const _seen = new Set();
      boundaryAges = boundaryAges.filter(b => { if (_seen.has(b.age)) return false; _seen.add(b.age); return true; })
        .sort((a, b) => b.age - a.age);

      if (boundaryAges.length) {
        renderPicks({ svg: picksLayer.node(), column: picksColumn, boundaryAges, scale,
          showUncertainty, picksSigFigs, fontSize });
      }
    }

    // GSSP / GSSA markers
    if (showGSSP && picksColumn) {
      const markerX = picksColumn.end + 4;
      allUnits
        .filter(u => u.ratifiedGSSP && u.start !== null && isUnitVisible(u.id, hiddenUnits))
        .forEach(unit => {
          const yPos = scale(unit.start);
          if (yPos < eM - 2 || yPos > viewH - BOTTOM_MARGIN + 2) return;
          const m = document.createElementNS("http://www.w3.org/2000/svg", "text");
          m.setAttribute("x", markerX); m.setAttribute("y", yPos);
          m.setAttribute("font-size", "8"); m.setAttribute("fill", "#DAA520");
          m.setAttribute("dominant-baseline", "middle"); m.textContent = "▶";
          gsspLayer.node().appendChild(m);
        });
      allUnits
        .filter(u => u.ratifiedGSSA && u.start !== null && isUnitVisible(u.id, hiddenUnits))
        .forEach(unit => {
          const yPos = scale(unit.start);
          if (yPos < eM - 2 || yPos > viewH - BOTTOM_MARGIN + 2) return;
          const m = document.createElementNS("http://www.w3.org/2000/svg", "text");
          m.setAttribute("x", markerX + 12); m.setAttribute("y", yPos);
          m.setAttribute("font-size", "8"); m.setAttribute("fill", "#4169E1");
          m.setAttribute("dominant-baseline", "middle"); m.textContent = "⏱";
          gsspLayer.node().appendChild(m);
        });
    }

    return svgEl;
  }

  function handleExportSVG() {
    const svgEl = buildSVGForExport();
    if (!svgEl) return;
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svgEl);
    const blob = new Blob([svgStr], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "geotimeline.svg";
    a.click();
    URL.revokeObjectURL(url);
  }

  // Crops the live canvas to viewport height and calls back with a PNG blob.
  function buildCanvasPNGBlob(callback) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr    = window.devicePixelRatio || 1;
    const clientW = Math.round(canvas.clientWidth);
    const viewH   = scrollContainerRef.current?.clientHeight || Math.round(canvas.clientHeight);
    const offscreen = document.createElement("canvas");
    offscreen.width  = clientW;
    offscreen.height = viewH;
    const ctx = offscreen.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, clientW, viewH);
    // Copy only the rendered viewport area from the (possibly tall) backing store
    ctx.drawImage(canvas, 0, 0, clientW * dpr, viewH * dpr, 0, 0, clientW, viewH);
    offscreen.toBlob(callback, "image/png");
  }

  function handleExportPNG() {
    buildCanvasPNGBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "geotimeline.png";
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  function handleCopyPNG() {
    buildCanvasPNGBlob(blob => {
      navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob })
      ]).catch(err => alert("Clipboard copy failed: " + err.message));
    });
  }

  function handleExportEdits() {
    const json = JSON.stringify(unitEdits, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "geotimeline-edits.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportEdits(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
          alert("Invalid edits file.");
          return;
        }
        setUnitEdits(prev => ({ ...prev, ...parsed }));
      } catch { alert("Failed to parse edits file."); }
      if (importEditsRef.current) importEditsRef.current.value = "";
    };
    reader.readAsText(file);
  }

  // Reset view whenever the set of hidden units changes
  useEffect(() => {
    const { paddedMin, paddedMax, centeredLateral } = computeResetView({
      dynamicMinAge, dynamicMaxAge, layout,
      viewportWidth: scrollContainerRef.current?.clientWidth ?? 0,
      scaleType, effectiveUnits, equalSizeLevel,
      eM: effectiveMarginRef.current,
      viewH: scrollContainerRef.current?.clientHeight ?? 800,
    });
    visibleDomainRef.current = [paddedMin, paddedMax];
    setVisibleDomain([paddedMin, paddedMax]);
    lateralOffsetRef.current = centeredLateral;
    setLateralOffset(centeredLateral);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenUnits, columnConfig]);

  const [picksMode, setPicksMode] = useState(() => _initPrefs.picksMode ?? "auto");
// "auto" | "adaptive" | "manual"

  const [manualPicksLevel, setManualPicksLevel] = useState(() => _initPrefs.manualPicksLevel ?? null);
  const [showUncertainty, setShowUncertainty] = useState(() => _initPrefs.showUncertainty ?? false);
  const [picksSigFigs, setPicksSigFigs] = useState(() => _initPrefs.picksSigFigs ?? 4);

  const [labelMode, setLabelMode] = useState(() => _initPrefs.labelMode ?? "timescale"); // "timescale" | "stratigraphic"
  const [contrastText, setContrastText] = useState(() => _initPrefs.contrastText ?? true);
  const [fontSize, setFontSize] = useState(() => _initPrefs.fontSize ?? 10);
  const [fontFamily, setFontFamily] = useState(() => _initPrefs.fontFamily ?? "Arial, sans-serif");
  const [labelOrientation, setLabelOrientation] = useState(() => _initPrefs.labelOrientation ?? "horizontal"); // "horizontal" | "vertical"
  const [fontBold, setFontBold] = useState(() => _initPrefs.fontBold ?? false);
  const [fontItalic, setFontItalic] = useState(() => _initPrefs.fontItalic ?? false);
  const [fontUnderline, setFontUnderline] = useState(() => _initPrefs.fontUnderline ?? false);
  const [showGSSP, setShowGSSP] = useState(() => _initPrefs.showGSSP ?? false);
  const [fontRules, setFontRules] = useState(() => _initPrefs.fontRules ?? []);
  // Each fontRule: { id: string, minAge: number, maxAge: number, fontSize: number }

  const [scaleType, setScaleType] = useState(() => _initPrefs.scaleType ?? "linear"); // "linear" | "log" | "equalSize" | "eraEqual"
  const [equalSizeLevel, setEqualSizeLevel] = useState(() => _initPrefs.equalSizeLevel ?? 3);

  const [hoverUnit, setHoverUnit] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const visibleLevels = useMemo(
    () => columnConfig.filter(col => col.visible).map(col => col.level).sort((a, b) => a - b),
    [columnConfig],
  );

  const columns = useMemo(() => [
    { id: "time", type: "time" },
    ...visibleLevels.map(level => ({ id: level, type: "hierarchy", level })),
    { id: "picks", type: "picks" },
  ], [visibleLevels]);

  // Auto-expand picks column so labels never clip into adjacent columns.
  // Memoized: creates a canvas + measures text each run, only re-compute when inputs change.
  const _picksMinWidth = useMemo(() => {
    const mc = document.createElement("canvas");
    const mctx = mc.getContext("2d");
    mctx.font = `${fontSize}px ${fontFamily}`;
    let maxW = 0;
    const fmt = age => {
      if (age === 0) return "0";
      const mag = Math.floor(Math.log10(Math.abs(age)) + 1e-10);
      return String(parseFloat(age.toFixed(Math.max(0, picksSigFigs - 1 - mag))));
    };
    const span = dynamicMaxAge - dynamicMinAge;
    for (let i = 0; i <= 8; i++) {
      const age = dynamicMinAge + (span * i) / 8;
      if (age <= 0) continue;
      const prefix = showUncertainty ? "\u007E" : "";
      const w = mctx.measureText(prefix + fmt(age) + (showUncertainty ? " \u00B1999" : "")).width;
      if (w > maxW) maxW = w;
    }
    // rightMargin(4) + tickLabelGap(12) + leftTick(16)
    return Math.ceil(maxW) + 32;
  }, [fontSize, fontFamily, picksSigFigs, dynamicMaxAge, dynamicMinAge, showUncertainty]);
  const effectiveColumnWidths = useMemo(() => ({
    ...columnWidths,
    picks: Math.max(columnWidths.picks ?? 60, _picksMinWidth),
  }), [columnWidths, _picksMinWidth]);

  const layout = useMemo(
    () => computeLayout(columns, effectiveColumnWidths, MARGIN),
    [columns, effectiveColumnWidths],
  );

  // One-time mount effect: center columns and add bottom padding once layout is known.
  // Must be declared AFTER layout (dep array is evaluated eagerly during render).
  useEffect(() => {
    if (hasInitializedView.current) return;
    hasInitializedView.current = true;
    const { paddedMin, paddedMax, centeredLateral } = computeResetView({
      dynamicMinAge, dynamicMaxAge, layout,
      viewportWidth: scrollContainerRef.current?.clientWidth ?? 0,
      scaleType, effectiveUnits, equalSizeLevel,
      eM: effectiveMarginRef.current,
      viewH: scrollContainerRef.current?.clientHeight ?? 800,
    });
    visibleDomainRef.current = [paddedMin, paddedMax];
    setVisibleDomain([paddedMin, paddedMax]);
    lateralOffsetRef.current = centeredLateral;
    setLateralOffset(centeredLateral);
  }, [layout]); // eslint-disable-line react-hooks/exhaustive-deps

  function autoFitColumnWidth(col) {
    const PAD = 16;
    if (labelOrientation === "vertical") {
      // Rotated text: column dimension = line height ≈ fontSize
      return Math.max(20, fontSize + PAD);
    }
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.font = `${fontSize}px ${fontFamily}`;
    let maxW = 0;
    const measure = str => { const w = ctx.measureText(str).width; if (w > maxW) maxW = w; };

    if (typeof col.id === "number") {
      effectiveUnits
        .filter(u => u.levelOrder === col.id && u.start !== null && isUnitVisible(u.id, hiddenUnits))
        .forEach(u => measure(u.displayName));
    } else if (col.id === "time") {
      const span = dynamicMaxAge - dynamicMinAge;
      const tickStep = span > 0 ? span / 20 : 1;
      for (let i = 0; i <= 6; i++)
        measure(formatTickLabel(dynamicMinAge + (span * i) / 6, tickStep, timeUnit));
    } else if (col.id === "picks") {
      const fmt = age => {
        if (age === 0) return "0";
        const mag = Math.floor(Math.log10(Math.abs(age)));
        return String(parseFloat(age.toFixed(Math.max(0, picksSigFigs - 1 - mag))));
      };
      const span = dynamicMaxAge - dynamicMinAge;
      for (let i = 0; i <= 6; i++)
        measure(fmt(dynamicMinAge + (span * i) / 6));
    }
    return Math.max(20, maxW + PAD);
  }

  function getColDisplayName(col) {
    if (col.id === "time") return "Time";
    if (col.id === "picks") return "Picks (Ma)";
    const cc = columnConfig.find(c => c.level === col.id);
    if (!cc) return String(col.id);
    if (labelMode === "stratigraphic") return cc.labelStrat;
    if (labelMode === "both") return `${cc.label} / ${cc.labelStrat}`;
    return cc.label;
  }

  // Persist UI preferences
  useEffect(() => {
    const prefs = {
      timeUnit, columnConfig, columnWidths,
      labelMode, contrastText, fontSize, fontFamily, labelOrientation,
      fontBold, fontItalic, fontUnderline, showGSSP, fontRules,
      scaleType, equalSizeLevel,
      picksMode, manualPicksLevel, showUncertainty, picksSigFigs,
      hiddenUnits: [...hiddenUnits],
      headerHeight, headerFontSize,
      leftPanelOpen, settingsOpen,
      leftColumnsCollapsed, leftFilterCollapsed,
    };
    localStorage.setItem("gt_prefs", JSON.stringify(prefs));
  }, [timeUnit, columnConfig, columnWidths, labelMode, contrastText, fontSize, fontFamily, labelOrientation, fontBold, fontItalic, fontUnderline, showGSSP, fontRules, scaleType, equalSizeLevel, picksMode, manualPicksLevel, showUncertainty, picksSigFigs, hiddenUnits, headerHeight, headerFontSize, leftPanelOpen, settingsOpen, leftColumnsCollapsed, leftFilterCollapsed]);

  useEffect(() => {
    localStorage.setItem("gt_unitEdits", JSON.stringify(unitEdits));
  }, [unitEdits]);

  // Prevent browser page-zoom (Ctrl+scroll) everywhere on the page.
  // The SVG listener only fires when the cursor is directly over the SVG;
  // this covers the toolbar, panels, scrollbar, and any other area.
  useEffect(() => {
    const preventBrowserZoom = (e) => { if (e.ctrlKey) e.preventDefault(); };
    window.addEventListener("wheel", preventBrowserZoom, { passive: false });
    return () => window.removeEventListener("wheel", preventBrowserZoom);
  }, []);

  // Recursive tree renderer — shows all non-stage units with toggle checkboxes
  function renderUnitTree(parentId, depth) {
    const children = effectiveUnits
      .filter(u => u.parent === parentId && u.start !== null)
      .sort((a, b) => b.start - a.start);
    if (children.length === 0) return null;
    return children.map(unit => {
      const hasChildren = effectiveUnits.some(u => u.parent === unit.id);
      const isHidden = hiddenUnits.has(unit.id);
      const ancestorHidden = !isHidden && !isUnitVisible(unit.id, hiddenUnits);
      const isExpanded = expandedNodes.has(unit.id);
      return (
        <div key={unit.id}>
          <div style={{ display: "flex", alignItems: "center", paddingLeft: depth * 14, paddingTop: 2, paddingBottom: 2, opacity: ancestorHidden ? 0.4 : 1 }}>
            <span
              onClick={() => {
                if (!hasChildren) return;
                setExpandedNodes(prev => {
                  const next = new Set(prev);
                  if (next.has(unit.id)) next.delete(unit.id); else next.add(unit.id);
                  return next;
                });
              }}
              style={{ width: 14, cursor: hasChildren ? "pointer" : "default", userSelect: "none", display: "inline-block", flexShrink: 0 }}
            >
              {hasChildren ? (isExpanded ? "▾" : "▸") : ""}
            </span>
            <input
              type="checkbox"
              checked={!isHidden}
              disabled={ancestorHidden}
              onChange={() => {
                setHiddenUnits(prev => {
                  const next = new Set(prev);
                  if (next.has(unit.id)) next.delete(unit.id); else next.add(unit.id);
                  return next;
                });
              }}
              style={{ margin: "0 5px 0 0", flexShrink: 0 }}
            />
            <span style={{ fontSize: 11, textDecoration: isHidden ? "line-through" : "none", color: isHidden ? "var(--gt-text-disabled)" : "var(--gt-text-primary)", whiteSpace: "nowrap" }}>
              {unit.displayName}
            </span>
          </div>
          {isExpanded && renderUnitTree(unit.id, depth + 1)}
        </div>
      );
    });
  }

  return (
    <div style={{
      width: "100vw",
      height: "100vh",
      display: "flex",
      flexDirection: "column",
      position: "relative",
      background: "white"
    }}>

      {/* Zone 1: Toolbar */}
      <div className="gt-toolbar">
        <button
          className={`gt-icon-btn${leftPanelOpen ? " gt-icon-btn--active" : ""}`}
          onClick={() => setLeftPanelOpen(v => !v)}
          title="Toggle panel"
        >☰</button>
        <div className="gt-toolbar-sep" />
        <span className="gt-wordmark">GeoTimeline</span>

        <button className="gt-btn" onClick={handleResetZoom}>Reset</button>

        <div style={{ width: 8 }} />

        <div className="gt-segment">
          {["Ga","Ma","ka"].map(u => (
            <button key={u}
              className={`gt-segment__btn${timeUnit === u ? " gt-segment__btn--active" : ""}`}
              onClick={() => setTimeUnit(u)}
            >{u}</button>
          ))}
        </div>

        <div style={{ width: 6 }} />

        <div className="gt-segment">
          {[["linear","Linear"],["log","Log"],["equalSize","Equal"],["eraEqual","Era"]].map(([val,lbl]) => (
            <button key={val}
              className={`gt-segment__btn${scaleType === val ? " gt-segment__btn--active" : ""}`}
              onClick={() => setScaleType(val)}
            >{lbl}</button>
          ))}
        </div>

        {scaleType === "equalSize" && (
          <select
            value={equalSizeLevel}
            onChange={e => setEqualSizeLevel(Number(e.target.value))}
            className="gt-select gt-select--sm"
            style={{ marginLeft: 4 }}
          >
            {columnConfig.map(col => (
              <option key={col.level} value={col.level}>{col.label}</option>
            ))}
          </select>
        )}

        <div style={{ flex: 1 }} />

        <button
          className={`gt-btn gt-btn--toggle${showGSSP ? " gt-btn--active" : ""}`}
          onClick={() => setShowGSSP(v => !v)}
          title="GSSP markers"
        >GSSP</button>

        <button
          className={`gt-btn gt-btn--toggle${settingsOpen ? " gt-btn--active" : ""}`}
          onClick={() => setSettingsOpen(v => !v)}
          title="Settings"
        >Settings</button>

        <button
          className={`gt-btn gt-btn--toggle${showDataEditor ? " gt-btn--active" : ""}`}
          onClick={() => setShowDataEditor(v => !v)}
          title="Data editor"
        >Editor</button>
      </div>

      {/* Zone 1: Status strip */}
      <div className="gt-status-strip">
        <span className="gt-status-value">
          {timeUnit === "Ga"
            ? `${(visibleDomain[0]/1000).toFixed(3)}–${(visibleDomain[1]/1000).toFixed(3)} Ga`
            : timeUnit === "ka"
            ? `${(visibleDomain[0]*1000).toFixed(0)}–${(visibleDomain[1]*1000).toFixed(0)} ka`
            : `${visibleDomain[0].toFixed(2)}–${visibleDomain[1].toFixed(2)} Ma`}
        </span>
        <div className="gt-status-sep" />
        <span>{columnConfig.filter(c => c.visible).length} columns visible</span>
        {hiddenUnits.size > 0 && (
          <>
            <div className="gt-status-sep" />
            <span>{hiddenUnits.size} units hidden</span>
          </>
        )}
      </div>


      {/* Main area: left panel + visualization + settings panel */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

      {/* Zone 2: Left Panel */}
      {leftPanelOpen && (
        <div className="gt-left-panel">

          {/* Columns section */}
          <div className="gt-section">
            <button className="gt-section-header" onClick={() => setLeftColumnsCollapsed(v => !v)}>
              <span className={`gt-chevron${leftColumnsCollapsed ? "" : " gt-chevron--open"}`}>▸</span>
              Columns
            </button>
            {!leftColumnsCollapsed && (
              <div className="gt-section-content gt-scroll">
                {columnConfig.map((col, index) => (
                  <div key={col.level} className="gt-col-row">
                    <input
                      type="checkbox"
                      checked={col.visible}
                      onChange={() => setColumnConfig(columnConfig.map((c, i) => i === index ? { ...c, visible: !c.visible } : c))}
                    />
                    <span style={{ flex: 1, fontSize: 11 }}>{col.label}</span>
                    <select
                      value={col.orientation ?? "auto"}
                      onChange={e => {
                        const val = e.target.value === "auto" ? null : e.target.value;
                        setColumnConfig(columnConfig.map((c, i) => i === index ? { ...c, orientation: val } : c));
                      }}
                      className="gt-select gt-select--sm"
                    >
                      <option value="auto">Auto</option>
                      <option value="horizontal">Horiz</option>
                      <option value="vertical">Vert</option>
                    </select>
                    <input
                      type="number"
                      min={5} max={32}
                      value={col.fontSize ?? ""}
                      placeholder={String(fontSize)}
                      onChange={e => {
                        const val = e.target.value === "" ? null : Number(e.target.value);
                        setColumnConfig(columnConfig.map((c, i) => i === index ? { ...c, fontSize: val } : c));
                      }}
                      className="gt-input"
                      style={{ width: 36 }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Filter section */}
          <div className="gt-section" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <button className="gt-section-header" onClick={() => setLeftFilterCollapsed(v => !v)}>
              <span className={`gt-chevron${leftFilterCollapsed ? "" : " gt-chevron--open"}`}>▸</span>
              Filter
              {hiddenUnits.size > 0 && (
                <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--gt-text-tertiary)", fontWeight: 400, letterSpacing: 0 }}>
                  {hiddenUnits.size} hidden
                </span>
              )}
            </button>
            {!leftFilterCollapsed && (
              <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
                <div style={{ padding: "6px 10px 4px", flexShrink: 0 }}>
                  <input
                    placeholder="Search units…"
                    value={unitSearch}
                    onChange={e => setUnitSearch(e.target.value)}
                    className="gt-input"
                    style={{ width: "100%" }}
                  />
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: "2px 8px 8px" }} className="gt-scroll">
                  {unitSearch
                    ? effectiveUnits
                        .filter(u => u.start !== null && u.displayName.toLowerCase().includes(unitSearch.toLowerCase()))
                        .sort((a, b) => b.start - a.start)
                        .map(unit => {
                          const isHidden = hiddenUnits.has(unit.id);
                          const ancestorHidden = !isHidden && !isUnitVisible(unit.id, hiddenUnits);
                          return (
                            <div key={unit.id} style={{ display: "flex", alignItems: "center", paddingTop: 2, paddingBottom: 2, opacity: ancestorHidden ? 0.4 : 1 }}>
                              <input
                                type="checkbox"
                                checked={!isHidden}
                                disabled={ancestorHidden}
                                onChange={() => setHiddenUnits(prev => { const next = new Set(prev); if (next.has(unit.id)) next.delete(unit.id); else next.add(unit.id); return next; })}
                                style={{ margin: "0 5px 0 0", flexShrink: 0 }}
                              />
                              <span style={{ fontSize: 11, textDecoration: isHidden ? "line-through" : "none", color: isHidden ? "var(--gt-text-disabled)" : "var(--gt-text-primary)" }}>
                                {unit.displayName}
                              </span>
                            </div>
                          );
                        })
                    : renderUnitTree(null, 0)
                  }
                </div>
                {hiddenUnits.size > 0 && (
                  <div style={{ padding: "0 10px 10px", flexShrink: 0 }}>
                    <button className="gt-btn" style={{ width: "100%", justifyContent: "center" }} onClick={() => setHiddenUnits(new Set())}>Show All</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Visualization Area — viewport-sized container; dynamic canvas owns scrolling */}
      <div
        ref={scrollContainerRef}
        style={{
          flex: 1,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <TimelineCanvas
          canvasRef={canvasRef}
          hitBoxesRef={hitBoxesRef}
          rafHandleRef={rafHandleRef}
          visibleDomainRef={visibleDomainRef}
          lateralOffsetRef={lateralOffsetRef}
          dynamicMinAgeRef={dynamicMinAgeRef}
          dynamicMaxAgeRef={dynamicMaxAgeRef}
          clampMinAgeRef={clampMinAgeRef}
          clampMaxAgeRef={clampMaxAgeRef}
          effectiveMarginRef={effectiveMarginRef}
          scrollContainerRef={scrollContainerRef}
          effectiveUnits={effectiveUnits}
          hiddenUnits={hiddenUnits}
          columnConfig={columnConfig}
          effectiveColumnWidths={effectiveColumnWidths}
          scaleType={scaleType}
          equalSizeLevel={equalSizeLevel}
          fontSize={fontSize}
          fontFamily={fontFamily}
          labelOrientation={labelOrientation}
          contrastText={contrastText}
          fontBold={fontBold}
          fontItalic={fontItalic}
          fontRules={fontRules}
          labelMode={labelMode}
          picksMode={picksMode}
          manualPicksLevel={manualPicksLevel}
          showUncertainty={showUncertainty}
          picksSigFigs={picksSigFigs}
          timeUnit={timeUnit}
          showGSSP={showGSSP}
          setVisibleDomain={setVisibleDomain}
          setLateralOffset={setLateralOffset}
          setHoverUnit={setHoverUnit}
          setTooltipPos={setTooltipPos}
        />

        <CustomScrollbar
          visibleDomain={visibleDomain}
          fullMin={dynamicMinAge}
          fullMax={dynamicMaxAge}
          clampMin={clampMinAge}
          clampMax={clampMaxAge}
          onScroll={(newMin, newMax) => {
            visibleDomainRef.current = [newMin, newMax];
            setVisibleDomain([newMin, newMax]);
          }}
          visibleDomainRef={visibleDomainRef}
        />

        {/* Column Headers */}
        {(() => {
          const tx = lateralOffset;
          const _hc = document.createElement("canvas");
          const _hctx = _hc.getContext("2d");
          _hctx.font = `${fontBold ? "bold " : ""}${fontItalic ? "italic " : ""}${headerFontSize}px ${fontFamily}`;
          return (
            <div className="gt-col-header-row" style={{ height: headerHeight }}>
              {layout.map((col, i) => {
                const colW = col.width;
                const name = getColDisplayName(col);
                const textW = _hctx.measureText(name).width;
                const isVertical = colW < textW + 16;
                return (
                  <div key={col.id} style={{
                    position: "absolute",
                    left: col.start + tx,
                    width: colW,
                    top: 0,
                    height: headerHeight,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: headerFontSize,
                    fontFamily,
                    fontWeight: fontBold ? "bold" : "normal",
                    fontStyle: fontItalic ? "italic" : "normal",
                    textDecoration: fontUnderline ? "underline" : "none",
                    overflow: "hidden",
                    borderLeft: i === 0 ? "1px solid var(--gt-border-subtle)" : "none",
                    borderRight: "1px solid var(--gt-border-subtle)",
                    boxSizing: "border-box",
                    pointerEvents: "none",
                  }}>
                    <span style={isVertical ? {
                      writingMode: "vertical-rl",
                      transform: "rotate(180deg)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                    } : {
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      maxWidth: "100%",
                      padding: "0 4px",
                    }}>
                      {name}
                    </span>
                  </div>
                );
              })}
              {/* Resize handle */}
              <div
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: 6,
                  cursor: "ns-resize",
                  zIndex: 20,
                }}
                onMouseDown={e => {
                  e.preventDefault();
                  const startY = e.clientY;
                  const startH = headerHeight;
                  const onMove = mv => {
                    const newH = Math.max(24, startH + mv.clientY - startY);
                    effectiveMarginRef.current = newH + 8;
                    setHeaderHeight(newH);
                  };
                  const onUp = () => {
                    window.removeEventListener("mousemove", onMove);
                    window.removeEventListener("mouseup", onUp);
                  };
                  window.addEventListener("mousemove", onMove);
                  window.addEventListener("mouseup", onUp);
                }}
              />
            </div>
          );
        })()}

        {/* Resize Handles */}
        {layout.map(col => {
          const tx = lateralOffset;
          const handleX = col.end + tx;
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
                zIndex: 15,
                pointerEvents: "auto"
              }}
              onDoubleClick={(e) => {
                e.preventDefault();
                setColumnWidths(prev => ({ ...prev, [col.id]: autoFitColumnWidth(col) }));
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                const startX = e.clientX;
                const startWidth = col.width;
                const onMouseMove = (moveEvent) => {
                  const delta = moveEvent.clientX - startX;
                  const newWidth = Math.max(20, startWidth + delta);
                  setColumnWidths(prev => ({ ...prev, [col.id]: newWidth }));
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

      {/* Data Editor Sidebar */}
      {showDataEditor && (() => {
        const EDITOR_COLS = [
          { key: "displayName",       label: "Name",        width: 100 },
          { key: "fullName",          label: "Full Name",   width: 140 },
          { key: "rankTime",          label: "Rank",        width: 80, readonly: true },
          { key: "start",             label: "Start (Ma)",  width: 70  },
          { key: "startUncertainty",  label: "±",           width: 50  },
          { key: "end",               label: "End (Ma)",    width: 70  },
          { key: "endUncertainty",    label: "±",           width: 50  },
          { key: "parent",            label: "Parent",      width: 100 },
          { key: "icsColor",          label: "Color",       width: 45  },
          { key: "ratifiedGSSP",      label: "Boundary",    width: 60, readonly: true },
          { key: "shortCode",         label: "Code",        width: 45, readonly: true },
        ];

        const allRanks = [...new Set(ALL_UNITS.map(u => u.rankTime))].sort();

        let rows = effectiveUnits;
        if (editorSearch) {
          const q = editorSearch.toLowerCase();
          rows = rows.filter(u =>
            u.displayName.toLowerCase().includes(q) ||
            u.fullName.toLowerCase().includes(q) ||
            u.id.toLowerCase().includes(q)
          );
        }
        if (editorRankFilter !== "all") {
          rows = rows.filter(u => u.rankTime === editorRankFilter);
        }
        rows = [...rows].sort((a, b) => {
          let va = a[editorSortCol] ?? (editorSortDir === "asc" ? Infinity : -Infinity);
          let vb = b[editorSortCol] ?? (editorSortDir === "asc" ? Infinity : -Infinity);
          if (typeof va === "string") va = va.toLowerCase();
          if (typeof vb === "string") vb = vb.toLowerCase();
          if (va < vb) return editorSortDir === "asc" ? -1 : 1;
          if (va > vb) return editorSortDir === "asc" ? 1 : -1;
          return 0;
        });

        const startEdit = (id, field, currentVal) => {
          setEditingCell({ id, field });
          setEditingValue(currentVal === null || currentVal === undefined ? "" : String(currentVal));
        };

        const commitEdit = () => {
          if (!editingCell) return;
          const { id, field } = editingCell;
          let value = editingValue;
          if (field === "start")             value = parseFloat(editingValue) || 0;
          if (field === "end")               value = editingValue.trim() === "" ? null : parseFloat(editingValue);
          if (field === "startUncertainty")  value = editingValue.trim() === "" ? null : parseFloat(editingValue);
          if (field === "endUncertainty")    value = editingValue.trim() === "" ? null : parseFloat(editingValue);
          if (field === "levelOrder")        value = parseInt(editingValue) || 0;
          setUnitEdits(prev => ({ ...prev, [id]: { ...(prev[id] || {}), [field]: value } }));
          setEditingCell(null);
        };

        const thStyle = () => ({
          padding: "4px 6px",
          textAlign: "left",
          fontSize: 11,
          fontWeight: 600,
          background: "var(--gt-bg-panel)",
          borderBottom: "1px solid var(--gt-border)",
          cursor: "pointer",
          userSelect: "none",
          whiteSpace: "nowrap",
          position: "sticky",
          top: 0,
          zIndex: 1,
          color: "var(--gt-text-secondary)",
        });

        const tdStyle = (edited) => ({
          padding: "2px 6px",
          fontSize: 11,
          borderBottom: "1px solid var(--gt-border-subtle)",
          cursor: "text",
          whiteSpace: "nowrap",
          maxWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          background: edited ? "var(--gt-warning-bg)" : "var(--gt-bg-card)",
        });

        return (
          <div style={{
            width: editorWidth,
            flexShrink: 0,
            borderLeft: "1px solid var(--gt-border-subtle)",
            display: "flex",
            flexDirection: "column",
            background: "var(--gt-bg-card)",
            overflow: "hidden",
            position: "relative",
          }}>
            {/* Resize handle */}
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: 6,
                height: "100%",
                cursor: "ew-resize",
                zIndex: 20,
              }}
              onMouseDown={e => {
                e.preventDefault();
                const startX = e.clientX;
                const startWidth = editorWidth;
                const onMouseMove = mv => {
                  const newWidth = Math.max(300, startWidth - (mv.clientX - startX));
                  setEditorWidth(newWidth);
                };
                const onMouseUp = () => {
                  window.removeEventListener("mousemove", onMouseMove);
                  window.removeEventListener("mouseup", onMouseUp);
                };
                window.addEventListener("mousemove", onMouseMove);
                window.addEventListener("mouseup", onMouseUp);
              }}
            />
            {/* Sidebar header */}
            <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--gt-border-subtle)", background: "var(--gt-bg-panel)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 13, marginRight: 4 }}>Data Editor</strong>
              <input
                placeholder="Search name / id…"
                value={editorSearch}
                onChange={e => setEditorSearch(e.target.value)}
                className="gt-input"
                style={{ width: 150 }}
              />
              <select
                value={editorRankFilter}
                onChange={e => setEditorRankFilter(e.target.value)}
                className="gt-select gt-select--sm"
              >
                <option value="all">All Ranks</option>
                {allRanks.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <span style={{ fontSize: 11, color: "var(--gt-text-secondary)", marginLeft: "auto" }}>{rows.length} units</span>
              <button
                onClick={() => setShowDataEditor(false)}
                className="gt-btn-close"
              >✕</button>
            </div>

            {/* Table */}
            <div style={{ overflowY: "auto", flex: 1 }} className="gt-scroll">
              <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
                <colgroup>
                  {EDITOR_COLS.map(c => <col key={c.key} style={{ width: c.width }} />)}
                </colgroup>
                <thead>
                  <tr>
                    {EDITOR_COLS.map(col => (
                      <th
                        key={col.key}
                        style={thStyle(col.key)}
                        onClick={() => {
                          if (editorSortCol === col.key) setEditorSortDir(d => d === "asc" ? "desc" : "asc");
                          else { setEditorSortCol(col.key); setEditorSortDir("asc"); }
                        }}
                      >
                        {col.label}{editorSortCol === col.key ? (editorSortDir === "asc" ? " ↑" : " ↓") : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(unit => {
                    const edited = unitEdits[unit.id] || {};
                    return (
                      <tr key={unit.id} style={{ background: Object.keys(edited).length > 0 ? "var(--gt-warning-bg)" : "var(--gt-bg-card)" }}>
                        {EDITOR_COLS.map(col => {
                          const isEditing = editingCell?.id === unit.id && editingCell?.field === col.key;
                          const value = unit[col.key];
                          const wasEdited = col.key in edited;

                          if (col.key === "icsColor") {
                            return (
                              <td key={col.key} style={{ ...tdStyle(wasEdited), padding: "1px 4px" }}>
                                <input
                                  type="color"
                                  value={value || "#ffffff"}
                                  onChange={e => setUnitEdits(prev => ({
                                    ...prev,
                                    [unit.id]: { ...(prev[unit.id] || {}), icsColor: e.target.value }
                                  }))}
                                  style={{ width: 30, height: 20, padding: 0, border: "none", cursor: "pointer" }}
                                />
                              </td>
                            );
                          }

                          if (col.key === "ratifiedGSSP") {
                            const gssp = unit.ratifiedGSSP;
                            const gssa = unit.ratifiedGSSA;
                            const label = gssp ? "✓ GSSP" : gssa ? "GSSA" : "—";
                            const color = gssp ? "#2a7a2a" : gssa ? "#888" : "#bbb";
                            return (
                              <td key={col.key} style={{ ...tdStyle(false), color, fontSize: 10 }}>
                                {label}
                              </td>
                            );
                          }

                          if (col.readonly) {
                            return (
                              <td key={col.key} style={{ ...tdStyle(false), color: "#555" }}
                                title={value === null || value === undefined ? "" : String(value)}>
                                {value === null || value === undefined ? <span style={{ color: "#bbb" }}>—</span> : String(value)}
                              </td>
                            );
                          }

                          if (isEditing) {
                            return (
                              <td key={col.key} style={{ padding: "1px 2px" }}>
                                <input
                                  autoFocus
                                  value={editingValue}
                                  onChange={e => setEditingValue(e.target.value)}
                                  onBlur={commitEdit}
                                  onKeyDown={e => {
                                    if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
                                    if (e.key === "Escape") setEditingCell(null);
                                    if (e.key === "Tab") { commitEdit(); }
                                  }}
                                  className="gt-input"
                                  style={{ width: "100%", boxSizing: "border-box" }}
                                />
                              </td>
                            );
                          }

                          return (
                            <td
                              key={col.key}
                              style={tdStyle(wasEdited)}
                              title={value === null || value === undefined ? "" : String(value)}
                              onClick={() => startEdit(unit.id, col.key, value)}
                            >
                              {value === null || value === undefined ? <span style={{ color: "#bbb" }}>—</span> : String(value)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* Zone 3: Right Settings Panel */}
      {settingsOpen && (
        <div className="gt-right-panel">
          {/* Tab bar */}
          <div className="gt-tab-bar">
            {["display","picks","export"].map(tab => (
              <button
                key={tab}
                className={`gt-tab${settingsTab === tab ? " gt-tab--active" : ""}`}
                onClick={() => setSettingsTab(tab)}
              >{tab.charAt(0).toUpperCase() + tab.slice(1)}</button>
            ))}
          </div>

          {/* Tab content */}
          <div className="gt-tab-content gt-scroll">
            {settingsTab === "display" && (
              <>
                {/* Card: Column Headers */}
                <div className="gt-card">
                  <div className="gt-card__header">Column Headers</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div className="gt-slider-row">
                      <span>Height</span>
                      <input type="range" min="24" max="80" value={headerHeight} onChange={e => setHeaderHeight(Number(e.target.value))} className="gt-range" />
                      <span className="gt-slider-val">{headerHeight}px</span>
                    </div>
                    <div className="gt-slider-row">
                      <span>Font size</span>
                      <input type="range" min="8" max="22" value={headerFontSize} onChange={e => setHeaderFontSize(Number(e.target.value))} className="gt-range" />
                      <span className="gt-slider-val">{headerFontSize}px</span>
                    </div>
                  </div>
                </div>

                {/* Card: Block Text */}
                <div className="gt-card">
                  <div className="gt-card__header">Block Text</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div className="gt-slider-row">
                      <span>Size</span>
                      <input type="range" min="6" max="16" value={fontSize} onChange={e => setFontSize(Number(e.target.value))} className="gt-range" />
                      <span className="gt-slider-val">{fontSize}px</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: "var(--gt-text-secondary)", fontSize: 11, minWidth: 52 }}>Family</span>
                      <select value={fontFamily} onChange={e => setFontFamily(e.target.value)} className="gt-select" style={{ flex: 1 }}>
                        <option value="Arial, sans-serif">Arial</option>
                        <option value="'Times New Roman', serif">Times New Roman</option>
                        <option value="'Courier New', monospace">Courier New</option>
                        <option value="Georgia, serif">Georgia</option>
                        <option value="Verdana, sans-serif">Verdana</option>
                      </select>
                    </div>
                    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                      <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
                        <input type="checkbox" checked={fontBold} onChange={e => setFontBold(e.target.checked)} /> Bold
                      </label>
                      <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
                        <input type="checkbox" checked={fontItalic} onChange={e => setFontItalic(e.target.checked)} /> Italic
                      </label>
                      <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
                        <input type="checkbox" checked={fontUnderline} onChange={e => setFontUnderline(e.target.checked)} /> Underline
                      </label>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: "var(--gt-text-secondary)", fontSize: 11, minWidth: 52 }}>Orient.</span>
                      <div className="gt-segment" style={{ flex: 1 }}>
                        {["horizontal","vertical"].map(o => (
                          <button key={o}
                            className={`gt-segment__btn${labelOrientation === o ? " gt-segment__btn--active" : ""}`}
                            onClick={() => setLabelOrientation(o)}
                            style={{ flex: 1 }}
                          >{o.charAt(0).toUpperCase() + o.slice(1)}</button>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: "var(--gt-text-secondary)", fontSize: 11, minWidth: 52 }}>Naming</span>
                      <div className="gt-segment" style={{ flex: 1 }}>
                        {[["timescale","Time"],["stratigraphic","Strat"],["both","Both"]].map(([v,l]) => (
                          <button key={v}
                            className={`gt-segment__btn${labelMode === v ? " gt-segment__btn--active" : ""}`}
                            onClick={() => setLabelMode(v)}
                            style={{ flex: 1 }}
                          >{l}</button>
                        ))}
                      </div>
                    </div>
                    <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
                      <input type="checkbox" checked={contrastText} onChange={e => setContrastText(e.target.checked)} />
                      Auto contrast
                    </label>
                  </div>
                </div>

                {/* Card: Markers */}
                <div className="gt-card">
                  <div className="gt-card__header">Markers</div>
                  <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
                    <input type="checkbox" checked={showGSSP} onChange={e => setShowGSSP(e.target.checked)} />
                    Show GSSP / GSSA markers
                  </label>
                </div>

                {/* Card: Font Rules */}
                <div className="gt-card">
                  <div className="gt-card__header">Font Rules</div>
                  {fontRules.length === 0 ? (
                    <p style={{ fontSize: 11, color: "var(--gt-text-tertiary)", margin: 0, padding: "8px 0", lineHeight: 1.5 }}>
                      No font rules. Add one to override block text size in a given age range.
                    </p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 6 }}>
                      {fontRules.map(rule => (
                        <div key={rule.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <input type="number" value={rule.minAge} onChange={e => setFontRules(fontRules.map(r => r.id === rule.id ? { ...r, minAge: Number(e.target.value) } : r))} className="gt-input" style={{ width: 54 }} placeholder="Min" />
                          <span style={{ color: "var(--gt-text-tertiary)" }}>–</span>
                          <input type="number" value={rule.maxAge} onChange={e => setFontRules(fontRules.map(r => r.id === rule.id ? { ...r, maxAge: Number(e.target.value) } : r))} className="gt-input" style={{ width: 54 }} placeholder="Max" />
                          <span style={{ color: "var(--gt-text-tertiary)", fontSize: 11 }}>Ma</span>
                          <input type="number" value={rule.fontSize} onChange={e => setFontRules(fontRules.map(r => r.id === rule.id ? { ...r, fontSize: Number(e.target.value) } : r))} className="gt-input" style={{ width: 42 }} min={5} max={32} />
                          <button onClick={() => setFontRules(fontRules.filter(r => r.id !== rule.id))} className="gt-btn-close">✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => setFontRules([...fontRules, { id: String(Date.now()), minAge: 0, maxAge: 66, fontSize: fontSize }])}
                    className="gt-btn"
                    style={{ alignSelf: "flex-start" }}
                  >+ Add Rule</button>
                </div>

                {/* Card: Equal-Size Level (conditional) */}
                {scaleType === "equalSize" && (
                  <div className="gt-card">
                    <div className="gt-card__header">Equal-Size Level</div>
                    <select value={equalSizeLevel} onChange={e => setEqualSizeLevel(Number(e.target.value))} className="gt-select" style={{ width: "100%" }}>
                      {columnConfig.map(col => (
                        <option key={col.level} value={col.level}>{col.label}</option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            )}

            {settingsTab === "picks" && (
              <>
                {/* Card: Boundary Mode */}
                <div className="gt-card">
                  <div className="gt-card__header">Boundary Mode</div>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {[
                      ["auto", "Auto", "deepest visible unit"],
                      ["adaptive", "Adaptive", "zoom-aware rank"],
                      ["manual", "Manual", "choose rank level"],
                    ].map(([val, label, sub]) => (
                      <label key={val} style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 10,
                        padding: "6px 4px",
                        borderRadius: "var(--gt-radius-sm)",
                        cursor: "pointer",
                        background: picksMode === val ? "var(--gt-bg-hover)" : "transparent",
                      }}>
                        <input type="radio" name="picksMode" value={val} checked={picksMode === val} onChange={() => setPicksMode(val)} style={{ marginTop: 2, flexShrink: 0 }} />
                        <div>
                          <div style={{ fontSize: 11, fontWeight: picksMode === val ? 500 : 400 }}>{label}</div>
                          <div style={{ fontSize: 10, color: "var(--gt-text-tertiary)", marginTop: 1 }}>{sub}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                  {picksMode === "manual" && (
                    <select
                      value={manualPicksLevel ?? ""}
                      onChange={e => setManualPicksLevel(e.target.value === "" ? null : Number(e.target.value))}
                      className="gt-select"
                      style={{ marginTop: 6, marginLeft: 28, width: "calc(100% - 28px)" }}
                    >
                      <option value="">Select Level</option>
                      {columnConfig.map(col => (
                        <option key={col.level} value={col.level}>{col.label}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Card: Display */}
                <div className="gt-card">
                  <div className="gt-card__header">Display</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
                      <input type="checkbox" checked={showUncertainty} onChange={e => setShowUncertainty(e.target.checked)} />
                      Show uncertainty (±)
                    </label>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: "var(--gt-text-secondary)", fontSize: 11, flex: 1 }}>Significant figures</span>
                      <select value={picksSigFigs} onChange={e => setPicksSigFigs(Number(e.target.value))} className="gt-select gt-select--sm">
                        {[3,4,5,6].map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              </>
            )}

            {settingsTab === "export" && (
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div className="gt-card__header" style={{ marginBottom: 8 }}>Export Image</div>
                <button onClick={handleExportSVG} className="gt-btn" style={{ width: "100%", justifyContent: "center", marginBottom: 6 }}>Download SVG</button>
                <button onClick={handleExportPNG} className="gt-btn" style={{ width: "100%", justifyContent: "center", marginBottom: 6 }}>Download PNG</button>
                <button onClick={handleCopyPNG} className="gt-btn" style={{ width: "100%", justifyContent: "center" }}>Copy PNG to Clipboard</button>

                <div style={{ height: 1, background: "var(--gt-border-subtle)", margin: "12px 0" }} />

                <div className="gt-card__header" style={{ marginBottom: 8 }}>Data Edits</div>
                <button onClick={handleExportEdits} className="gt-btn" style={{ width: "100%", justifyContent: "center", marginBottom: 6 }}>Export Edits</button>
                <button onClick={() => importEditsRef.current?.click()} className="gt-btn" style={{ width: "100%", justifyContent: "center" }}>Import Edits</button>
                <input ref={importEditsRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={handleImportEdits} />
                {Object.keys(unitEdits).length > 0 && (
                  <button onClick={() => setUnitEdits({})} className="gt-btn gt-btn--danger" style={{ width: "100%", justifyContent: "center", marginTop: 6 }}>
                    Reset All Edits ({Object.keys(unitEdits).length})
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      </div>

      {/* Hover tooltip */}
      {hoverUnit && (() => {
        const TOOLTIP_W = 280;
        const TOOLTIP_H = 110;
        const tipLeft = tooltipPos.x + 14 + TOOLTIP_W > window.innerWidth
          ? tooltipPos.x - 14 - TOOLTIP_W
          : tooltipPos.x + 14;
        const tipTop = tooltipPos.y + 14 + TOOLTIP_H > window.innerHeight
          ? tooltipPos.y - 14 - TOOLTIP_H
          : tooltipPos.y + 14;
        return (
          <div className="gt-tooltip" style={{ left: tipLeft, top: tipTop }}>
            <div className="gt-tooltip__name">{hoverUnit.displayName}</div>
            {hoverUnit.displayNameStratigraphic &&
              hoverUnit.displayNameStratigraphic !== hoverUnit.displayName && (
              <div className="gt-tooltip__strat">{hoverUnit.displayNameStratigraphic}</div>
            )}
            <div className="gt-tooltip__rank">{hoverUnit.rankTime}</div>
            {hoverUnit.start !== null && (
              <div className="gt-tooltip__age">{hoverUnit.end ?? 0}–{hoverUnit.start} Ma</div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

export default App;