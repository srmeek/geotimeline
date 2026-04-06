import { renderPicks } from "./renderers/PicksRenderer";
import { useCallback, useEffect, useRef, useState } from "react";
import * as d3 from "d3";

import { renderBlocks, computeFitAndWrap } from "./renderers/BlockRenderer";
import geologicTime from "./data/geologicTime.json";

const ICS_MIN_AGE = 0;
const ICS_MAX_AGE = 4567.30;
const MARGIN = 14;       // px of blank space above/below the timeline inside the SVG

// ===== Static unit data (adjusted levels, built once) =====
const ALL_UNITS = geologicTime.units.map(u => {
  let adjustedLevel = u.levelOrder;
  if (u.rankTime === "Sub-Period") adjustedLevel = 4;
  if (u.rankTime === "Epoch")      adjustedLevel = 5;
  if (u.rankTime === "Subepoch")   adjustedLevel = 5.5;
  if (u.rankTime === "Age")        adjustedLevel = 6;
  return { ...u, levelOrder: adjustedLevel };
});
const UNIT_MAP = Object.fromEntries(ALL_UNITS.map(u => [u.id, u]));

const _initPrefs = (() => {
  try { return JSON.parse(localStorage.getItem("gt_prefs")) || {}; } catch { return {}; }
})();
const _initUnitEdits = (() => {
  try { return JSON.parse(localStorage.getItem("gt_unitEdits")) || {}; } catch { return {}; }
})();

const _initFromHash = (() => {
  try {
    const h = window.location.hash.slice(1);
    if (!h) return null;
    return JSON.parse(atob(h));
  } catch { return null; }
})();

// Returns true if unit (by id) is not hidden by hiddenUnits or any ancestor
function isUnitVisible(unitId, hiddenUnits) {
  if (hiddenUnits.has(unitId)) return false;
  let pid = UNIT_MAP[unitId]?.parent;
  while (pid) {
    if (hiddenUnits.has(pid)) return false;
    pid = UNIT_MAP[pid]?.parent;
  }
  return true;
}

function formatTickLabel(age, tickStep, timeUnit) {
  if (timeUnit === "Ga") {
    const ga = age / 1000;
    const gaStep = tickStep / 1000;
    const decimals = gaStep >= 0.1 ? 1 : gaStep >= 0.01 ? 2 : gaStep >= 0.001 ? 3 : 4;
    return ga.toFixed(decimals) + " Ga";
  }
  if (timeUnit === "ka") {
    const ka = age * 1000;
    const kaStep = tickStep * 1000;
    const decimals = kaStep >= 1 ? 0 : kaStep >= 0.1 ? 1 : kaStep >= 0.01 ? 2 : 3;
    return ka.toFixed(decimals) + " ka";
  }
  // Ma
  const decimals = tickStep >= 1 ? 0 : tickStep >= 0.1 ? 1 : tickStep >= 0.01 ? 2 : 3;
  return age.toFixed(decimals) + " Ma";
}

function computeLayout(columns, columnWidths, initialOffset = 0) {
  let offset = initialOffset;

  return columns.map(col => {
    const width = columnWidths[col.id] ?? columnWidths[col.level] ?? 80;
    const start = offset;
    const end = start + width;
    offset = end;

    return { ...col, start, width, end };
  });
}

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

function buildScale(scaleType, domain, range, allUnits, equalSizeLevel) {
  if (scaleType === "linear") {
    return d3.scaleLinear().domain(domain).range(range);
  }

  if (scaleType === "log") {
    const logMin = Math.log(domain[0] + 1);
    const logMax = Math.log(domain[1] + 1);
    const linearScale = d3.scaleLinear().domain([logMin, logMax]).range(range);
    const fn = age => linearScale(Math.log(age + 1));
    fn.invert = pixel => {
      const logVal = linearScale.invert(pixel);
      return Math.exp(logVal) - 1;
    };
    fn.ticks = () => {
      const result = [];
      if (domain[0] <= 0) result.push(0);
      for (let mag = -4; mag <= 4; mag++) {
        for (const mult of [1, 2, 5]) {
          const v = mult * Math.pow(10, mag);
          if (v > 0 && v >= domain[0] && v <= domain[1]) result.push(v);
        }
      }
      return result.sort((a, b) => a - b);
    };
    return fn;
  }

  if (scaleType === "equalSize") {
    // Build lookups
    const byId = {};
    (allUnits || []).forEach(u => { byId[u.id] = u; });

    const byParent = {};
    (allUnits || []).forEach(u => {
      const pk = u.parent != null ? u.parent : "__root__";
      if (!byParent[pk]) byParent[pk] = [];
      byParent[pk].push(u);
    });

    // Recursively collect display slots:
    // - Units at or finer than equalSizeLevel → include as a single slot
    // - Units coarser than equalSizeLevel → recurse into children
    // - Coarser units with no children at all → include as a single slot (dead end)
    function collectSlots(parentKey) {
      const pk = parentKey != null ? parentKey : "__root__";
      const children = (byParent[pk] || []).filter(u => u.start !== null);
      if (children.length === 0) {
        if (parentKey != null) {
          const u = byId[parentKey];
          return (u && u.start !== null) ? [u] : [];
        }
        return [];
      }
      return children.flatMap(u => {
        if (u.levelOrder >= equalSizeLevel) return [u];
        return collectSlots(u.id);
      });
    }

    const displayUnits = collectSlots(null)
      .map(u => ({ ...u, end: u.end === null ? 0 : u.end }))
      .sort((a, b) => a.start - b.start); // youngest first → range[0] (top)

    if (displayUnits.length === 0) return d3.scaleLinear().domain(domain).range(range);

    const n = displayUnits.length;
    const rangeSize = Math.abs(range[1] - range[0]);
    const unitHeight = rangeSize / n;

    const fn = age => {
      for (let i = 0; i < n; i++) {
        const u = displayUnits[i];
        if (age >= u.end && age <= u.start) {
          const fraction = (age - u.end) / (u.start - u.end);
          return range[0] + (i + fraction) * unitHeight;
        }
      }
      if (age < displayUnits[n - 1].end) return range[1];
      return range[0];
    };
    fn.invert = pixel => {
      const relPos = (pixel - range[0]) / (range[1] - range[0]);
      const unitIndex = Math.min(Math.floor(relPos * n), n - 1);
      const unitFraction = (relPos * n) - unitIndex;
      if (unitIndex < 0) return domain[0];
      if (unitIndex >= n) return domain[1];
      const u = displayUnits[unitIndex];
      return u.end + unitFraction * (u.start - u.end);
    };
    fn.ticks = () => displayUnits.map(u => u.start).filter(a => a >= domain[0] && a <= domain[1]);
    return fn;
  }

  if (scaleType === "eraEqual") {
    const eras = [
      { name: "Cenozoic",     start: 66,       end: 0 },
      { name: "Mesozoic",     start: 251.902,  end: 66 },
      { name: "Paleozoic",    start: 538.8,    end: 251.902 },
      { name: "Precambrian",  start: 4567.30,  end: 538.8 }
    ];
    const rangeSize = Math.abs(range[1] - range[0]);
    const eraHeight = rangeSize / 4;

    const fn = age => {
      for (let i = 0; i < eras.length; i++) {
        const era = eras[i];
        if (age >= era.end && age <= era.start) {
          const fraction = (age - era.end) / (era.start - era.end);
          return range[0] + (i + fraction) * eraHeight;
        }
      }
      if (age < eras[0].end) return range[0];
      return range[1];
    };
    fn.invert = pixel => {
      const relPos = (pixel - range[0]) / (range[1] - range[0]);
      const eraIndex = Math.min(Math.floor(relPos * 4), 3);
      const eraFraction = (relPos * 4) - eraIndex;
      if (eraIndex < 0) return 0;
      const era = eras[eraIndex];
      return era.end + eraFraction * (era.start - era.end);
    };
    fn.ticks = (count = 40) => {
      const result = new Set();
      const perEra = Math.max(3, Math.floor(count / eras.length));
      eras.forEach(era => {
        const lo = Math.max(domain[0], era.end);
        const hi = Math.min(domain[1], era.start);
        if (lo >= hi) return;
        if (era.start >= domain[0] && era.start <= domain[1]) result.add(era.start);
        if (era.end   >= domain[0] && era.end   <= domain[1]) result.add(era.end);
        d3.scaleLinear().domain([lo, hi]).ticks(perEra)
          .forEach(t => { if (t >= domain[0] && t <= domain[1]) result.add(t); });
      });
      if (domain[0] <= 0) result.add(0);
      return [...result].sort((a, b) => a - b);
    };
    return fn;
  }

  return d3.scaleLinear().domain(domain).range(range);
}

function App() {
  const svgRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const isScrollSyncing = useRef(false);
  const importEditsRef = useRef(null);
  const effectiveMarginRef = useRef(14);
  const hashDebounceRef = useRef(null);
  const timeAxisContextRef = useRef(null);
  const canvasRef = useRef(null);
  const rafHandleRef = useRef(null);
  const hitBoxesRef = useRef([]); // populated each frame, queried on mousemove
  const [scrollableSize, setScrollableSize] = useState(800);
  const [headerHeight, setHeaderHeight] = useState(() => _initPrefs.headerHeight ?? 48);
  const [headerFontSize, setHeaderFontSize] = useState(() => _initPrefs.headerFontSize ?? 13);
  // Top margin tracks header height; bottom margin is fixed so the footer never moves.
  effectiveMarginRef.current = headerHeight + 8;
  const BOTTOM_MARGIN = 8;

  const [leftPanelOpen, setLeftPanelOpen] = useState(() => _initPrefs.leftPanelOpen ?? true);
  const [settingsOpen, setSettingsOpen] = useState(() => _initPrefs.settingsOpen ?? false);
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

  const _hashTransform = (() => {
    const h = _initFromHash?.currentTransform;
    if (!h) return d3.zoomIdentity;
    return d3.zoomIdentity.translate(h.x ?? 0, h.y ?? 0).scale(h.k ?? 1);
  })();
  const [currentTransform, setCurrentTransform] = useState(_hashTransform);
  const transformRef = useRef(_hashTransform);

  const [zoomMode, setZoomMode] = useState(_initFromHash?.zoomMode ?? "dynamic"); // "transform" | "dynamic"
  const [visibleDomain, setVisibleDomain] = useState(_initFromHash?.visibleDomain ?? [ICS_MIN_AGE, ICS_MAX_AGE]);
  const visibleDomainRef = useRef(_initFromHash?.visibleDomain ?? [ICS_MIN_AGE, ICS_MAX_AGE]);
  const zoomBehaviorRef = useRef(null);
  // lateralOffset: horizontal (x-axis) translation in dynamic mode, for panning perpendicular to the time axis
  const [lateralOffset, setLateralOffset] = useState(_initFromHash?.lateralOffset ?? 0);
  const lateralOffsetRef = useRef(_initFromHash?.lateralOffset ?? 0);

  const [hiddenUnits, setHiddenUnits] = useState(
    () => new Set(_initFromHash?.hiddenUnits ?? _initPrefs.hiddenUnits ?? [])
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

  // Apply any user edits on top of the base unit data
  const effectiveUnits = ALL_UNITS.map(u => ({
    ...u,
    ...(unitEdits[u.id] || {})
  }));

  // Dynamic time extent — shrinks when units are hidden
  const visibleForDomain = effectiveUnits.filter(u => u.start !== null && isUnitVisible(u.id, hiddenUnits));
  const dynamicMaxAge = visibleForDomain.length > 0
    ? Math.max(...visibleForDomain.map(u => u.start))
    : ICS_MAX_AGE;
  const dynamicMinAge = visibleForDomain.length > 0
    ? Math.min(...visibleForDomain.map(u => u.end ?? 0))
    : ICS_MIN_AGE;

  // Refs so zoom/pan closures always see the latest dynamic bounds
  const dynamicMinAgeRef = useRef(ICS_MIN_AGE);
  const dynamicMaxAgeRef = useRef(ICS_MAX_AGE);
  dynamicMinAgeRef.current = dynamicMinAge;
  dynamicMaxAgeRef.current = dynamicMaxAge;

  function handleSwitchZoomMode(newMode) {
    if (newMode === zoomMode) return;
    const svgElement = svgRef.current;
    if (!svgElement) { setZoomMode(newMode); return; }
    const h = svgElement.clientHeight;

    const eM = effectiveMarginRef.current;
    if (newMode === "transform") {
      // Convert current visibleDomain → equivalent D3 transform
      const [domMin, domMax] = visibleDomainRef.current;
      const fullScale = d3.scaleLinear()
        .domain([dynamicMinAge, dynamicMaxAge])
        .range([eM, h - eM]);
      const p1 = fullScale(domMin);
      const p2 = fullScale(domMax);
      const k  = (h - 2 * eM) / (p2 - p1);
      const ty = eM - p1 * k;
      const newTransform = d3.zoomIdentity.translate(lateralOffsetRef.current, ty).scale(k);
      transformRef.current = newTransform;
      setCurrentTransform(newTransform);
    } else {
      // Convert current transform → equivalent visibleDomain
      const { k, y: ty } = transformRef.current;
      const fullScale = d3.scaleLinear()
        .domain([dynamicMinAge, dynamicMaxAge])
        .range([eM, h - eM]);
      const newMin = fullScale.invert((eM - ty) / k);
      const newMax = fullScale.invert((h - eM - ty) / k);
      const clampedMin = Math.max(dynamicMinAge, Math.min(dynamicMaxAge, newMin));
      const clampedMax = Math.max(dynamicMinAge, Math.min(dynamicMaxAge, newMax));
      if (clampedMin < clampedMax) {
        visibleDomainRef.current = [clampedMin, clampedMax];
        setVisibleDomain([clampedMin, clampedMax]);
      }
      // Resize handles are positioned in document coords in dynamic mode (no transform applied)
      const preservedLateral = transformRef.current.x || 0;
      setCurrentTransform(d3.zoomIdentity);
      lateralOffsetRef.current = preservedLateral;
      setLateralOffset(preservedLateral);
    }
    setZoomMode(newMode);
  }

  function handleResetZoom() {
    if (zoomMode === "dynamic") {
      visibleDomainRef.current = [dynamicMinAge, dynamicMaxAge];
      setVisibleDomain([dynamicMinAge, dynamicMaxAge]);
      lateralOffsetRef.current = 0;
      setLateralOffset(0);
    } else {
      const svg = d3.select(svgRef.current);
      if (zoomBehaviorRef.current) {
        svg.call(zoomBehaviorRef.current.transform, d3.zoomIdentity);
      }
    }
  }

  // ── SVG export (dynamic mode): build an offscreen SVG matching the current canvas view ──
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
    const scaleUnits = scaleType === "equalSize"
      ? effectiveUnits.filter(u => isUnitVisible(u.id, hiddenUnits))
      : allUnits;

    const scale = buildScale(scaleType, [vMin, vMax], [eM, viewH - BOTTOM_MARGIN], scaleUnits, equalSizeLevel);

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

        const pos1 = scale(unit.start);
        const pos2 = scale(unit.end);
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
        boundaryMap.forEach(({ uncertainty, approximate }, age) => boundaryAges.push({ age, uncertainty, approximate }));
      }
      if (!boundaryAges.some(b => b.age === 0)) boundaryAges.push({ age: 0, uncertainty: null, approximate: false });
      const _seen = new Set();
      boundaryAges = boundaryAges.filter(b => { if (_seen.has(b.age)) return false; _seen.add(b.age); return true; })
        .sort((a, b) => b.age - a.age);

      if (boundaryAges.length) {
        renderPicks({ svg: picksLayer.node(), column: picksColumn, boundaryAges, scale,
          height: viewH, margin: BOTTOM_MARGIN, showUncertainty, picksSigFigs, fontSize });
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
    const svgEl = zoomMode === "dynamic" ? buildSVGForExport() : svgRef.current;
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

  function renderSVGtoPNGBlob(callback) {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const width = svgEl.clientWidth;
    const height = svgEl.clientHeight;
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svgEl);
    const blob = new Blob([svgStr], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(callback, "image/png");
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  function handleExportPNG() {
    if (zoomMode === "dynamic") {
      buildCanvasPNGBlob(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "geotimeline.png";
        a.click();
        URL.revokeObjectURL(url);
      });
    } else {
      renderSVGtoPNGBlob(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "geotimeline.png";
        a.click();
        URL.revokeObjectURL(url);
      });
    }
  }

  function handleCopyPNG() {
    const doExport = zoomMode === "dynamic" ? buildCanvasPNGBlob : renderSVGtoPNGBlob;
    doExport(blob => {
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
    if (zoomMode === "dynamic") {
      visibleDomainRef.current = [dynamicMinAge, dynamicMaxAge];
      setVisibleDomain([dynamicMinAge, dynamicMaxAge]);
      lateralOffsetRef.current = 0;
      setLateralOffset(0);
    } else {
      transformRef.current = d3.zoomIdentity;
      setCurrentTransform(d3.zoomIdentity);
      if (zoomBehaviorRef.current && svgRef.current) {
        d3.select(svgRef.current).call(zoomBehaviorRef.current.transform, d3.zoomIdentity);
      }
    }
  }, [hiddenUnits]); // eslint-disable-line react-hooks/exhaustive-deps

  // URL hash state sync (debounced)
  useEffect(() => {
    if (hashDebounceRef.current) clearTimeout(hashDebounceRef.current);
    hashDebounceRef.current = setTimeout(() => {
      const payload = {
        zoomMode,
        visibleDomain: visibleDomainRef.current,
        currentTransform: {
          k: transformRef.current.k,
          x: transformRef.current.x,
          y: transformRef.current.y,
        },
        lateralOffset: lateralOffsetRef.current,
        hiddenUnits: [...hiddenUnits],
      };
      window.history.replaceState(null, "", "#" + btoa(JSON.stringify(payload)));
    }, 300);
  }, [zoomMode, visibleDomain, currentTransform, lateralOffset, hiddenUnits]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleScroll(e) {
    if (isScrollSyncing.current) return;
    const container = e.currentTarget;
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const scrollTop = container.scrollTop;
    const viewH = container.clientHeight;
    const scrollRange = scrollableSize - viewH;
    if (scrollRange <= 0) return;

    if (zoomMode === "transform") {
      const k = transformRef.current.k || 1;
      const eM = effectiveMarginRef.current;
      const newTy = eM * (1 - k) - scrollTop * (viewH - 2 * eM) / viewH;
      const newTransform = d3.zoomIdentity
        .translate(transformRef.current.x || 0, newTy)
        .scale(k);
      isScrollSyncing.current = true;
      transformRef.current = newTransform;
      setCurrentTransform(newTransform);
      d3.select(svgEl).select("g").attr("transform", newTransform);
      if (zoomBehaviorRef.current) {
        d3.select(svgEl).call(zoomBehaviorRef.current.transform, newTransform);
      }
      isScrollSyncing.current = false;
    } else {
      const fullSpan = dynamicMaxAgeRef.current - dynamicMinAgeRef.current;
      const visibleSpan = visibleDomainRef.current[1] - visibleDomainRef.current[0];
      const fraction = scrollTop / scrollRange;
      const newMin = dynamicMinAgeRef.current + fraction * (fullSpan - visibleSpan);
      const newMax = newMin + visibleSpan;
      isScrollSyncing.current = true;
      visibleDomainRef.current = [newMin, newMax];
      setVisibleDomain([newMin, newMax]);
      isScrollSyncing.current = false;
    }
  }

  // Compute scrollableSize based on zoom level / visible domain
  useEffect(() => {
    const containerEl = scrollContainerRef.current;
    if (!containerEl) return;
    const viewSize = containerEl.clientHeight;
    if (viewSize === 0) return;

    let size;
    if (zoomMode === "transform") {
      const k = currentTransform.k || 1;
      size = Math.max(viewSize, viewSize * k);
    } else {
      const fullSpan = dynamicMaxAge - dynamicMinAge;
      const visSpan = Math.max(0.001, visibleDomain[1] - visibleDomain[0]);
      const k = fullSpan / visSpan;
      size = Math.max(viewSize, viewSize * k);
    }
    setScrollableSize(size);
  }, [zoomMode, currentTransform, visibleDomain, dynamicMinAge, dynamicMaxAge]);

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

  // Stable counter-scale function — reads all data from DOM attributes, only closes over svgRef (stable).
  const applyCounterScale = useCallback((k) => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const zoomLayerG = d3.select(svgEl).select("g");

    // ── Rebuild time axis ticks for the current visible domain ──
    // This is the fix for transform mode where the SVG isn't rebuilt on zoom:
    // derive the visible Ma range from the D3 transform and regenerate ticks.
    const ctx = timeAxisContextRef.current;
    if (ctx && ctx.layer) {
      const svgH  = svgEl.clientHeight;
      const eM    = effectiveMarginRef.current;
      const ty    = transformRef.current.y || 0;
      // SVG y-coord visible at the very top / bottom of the viewport
      const rawMin = ctx.scale.invert((0       - ty) / k);
      const rawMax = ctx.scale.invert((svgH    - ty) / k);
      const visMin = Math.max(ctx.scaleDomain[0], isFinite(rawMin) ? rawMin : ctx.scaleDomain[0]);
      const visMax = Math.min(ctx.scaleDomain[1], isFinite(rawMax) ? rawMax : ctx.scaleDomain[1]);
      if (visMax > visMin) {
        renderTimeAxisTicks({
          layer:      ctx.layer,
          scale:      ctx.scale,
          tickDomain: [visMin, visMax],
          timeColumn: ctx.timeColumn,
          eM,
          svgH,
          timeUnit:   ctx.timeUnit,
          fontSize:   ctx.fontSize,
          fontFamily: ctx.fontFamily,
        });
      }
    }

    zoomLayerG.selectAll("text").each(function () {
      const el = this;
      if (el.hasAttribute("data-block-w")) {
        // Block label — recompute fit+wrap for the current zoom level
        const orientW = parseFloat(el.getAttribute("data-block-w"));   // orientation bounding box width
        const drawnW  = parseFloat(el.getAttribute("data-block-dw") || el.getAttribute("data-block-w"));
        const blockH  = parseFloat(el.getAttribute("data-block-h"));
        const userFS  = parseFloat(el.getAttribute("data-user-font-size") || "10");
        const ff      = el.getAttribute("data-font-family") || "Arial, sans-serif";
        const orient  = el.getAttribute("data-label-orient") || "horizontal";
        const rawText = el.getAttribute("data-label") || "";
        const words   = rawText.trim().split(/\s+/).filter(Boolean);
        if (!words.length) return;

        const screenOrientW = orientW * k;
        const screenDrawnW  = drawnW  * k;
        const screenH       = blockH  * k;
        // Resolve "auto" using orientW (wider bounding box) so Phanerozoic considers the Super-Eon column
        const resolvedOrient = orient === "auto"
          ? (screenOrientW >= screenH ? "horizontal" : "vertical")
          : orient;
        // Fit text within the actually painted area (screenDrawnW), not the wider orient box
        const [fitW, fitH] = resolvedOrient === "vertical" ? [screenH, screenDrawnW] : [screenDrawnW, screenH];
        const fitWords = resolvedOrient === "vertical" ? [words.join(" ")] : words;

        const { lines, fitSize } = computeFitAndWrap(fitWords, fitW, fitH, ff, userFS, 5);
        el.setAttribute("font-size",           String(fitSize / k));
        el.setAttribute("data-base-font-size", String(fitSize));

        const cx = el.getAttribute("x") || "0";
        const cy = el.getAttribute("y") || "0";
        if (resolvedOrient === "vertical") {
          el.setAttribute("transform", `rotate(-90, ${cx}, ${cy})`);
          el.textContent = lines[0] || "";
        } else {
          el.removeAttribute("transform");
          while (el.firstChild) el.removeChild(el.firstChild);
          const lineHZL   = fitSize * 1.2 / k;
          const startDyZL = -(lines.length - 1) / 2 * lineHZL;
          lines.forEach((line, i) => {
            const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
            tspan.setAttribute("x",  cx);
            tspan.setAttribute("dy", String(i === 0 ? startDyZL : lineHZL));
            tspan.textContent = line;
            el.appendChild(tspan);
          });
        }
      } else {
        // Standard counter-scale (tick labels, picks, GSSP markers)
        const base = parseFloat(el.getAttribute("data-base-font-size") || "10");
        el.setAttribute("font-size", base / k);
      }
    });

    zoomLayerG.selectAll("[data-base-stroke]").each(function () {
      const base = parseFloat(this.getAttribute("data-base-stroke") || "0.5");
      this.setAttribute("stroke-width", base / k);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [hoverUnit, setHoverUnit] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

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
  ...hierarchyColumns,
  { id: "picks", type: "picks" }
];

  // Auto-expand picks column so labels never clip into adjacent columns
  const _picksMinWidth = (() => {
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
  })();
  const effectiveColumnWidths = {
    ...columnWidths,
    picks: Math.max(columnWidths.picks ?? 60, _picksMinWidth),
  };

  const layout = computeLayout(columns, effectiveColumnWidths, MARGIN);

  // ── Canvas draw function (Phase 2: rectangles + text) ──
  // Must be declared after effectiveColumnWidths and layout are initialized.
  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    // Use the scroll container's client height as the actual viewport height.
    // canvas.clientHeight reflects the full scrollable extent (e.g. 5000px when zoomed),
    // but only the viewport portion is ever visible.
    const viewH = scrollContainerRef.current?.clientHeight ?? cssH;

    // Resize canvas backing store if needed (handles window resize)
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width  = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.scale(dpr, dpr);
    }

    ctx.clearRect(0, 0, cssW, viewH);

    const eM      = effectiveMarginRef.current;
    const [vMin, vMax] = visibleDomainRef.current;
    const lateral = lateralOffsetRef.current;
    const hitBoxes = []; // reset each frame; queried on mousemove for tooltip

    const allUnits   = effectiveUnits;
    const visibleSet = new Set(allUnits.filter(u => u.start !== null && isUnitVisible(u.id, hiddenUnits)).map(u => u.id));

    const visLevels = columnConfig.filter(c => c.visible).map(c => c.level).sort((a, b) => a - b);
    const cols = [
      { id: "time", type: "time" },
      ...visLevels.map(lv => ({ id: lv, type: "hierarchy", level: lv })),
      { id: "picks", type: "picks" },
    ];
    const frameLayout = computeLayout(cols, effectiveColumnWidths, MARGIN);

    const scale = buildScale(scaleType, [vMin, vMax], [eM, viewH - BOTTOM_MARGIN], allUnits, equalSizeLevel);

    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, cssW, viewH);

    // NTSC luma contrast — same formula as BlockRenderer.js
    const contrastColor = (hex) => {
      if (!hex || hex.length < 7) return "black";
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      return luma > 0.65 ? "black" : "white";
    };

    visLevels.forEach(level => {
      const colConf = columnConfig.find(c => c.level === level);
      const levelUnits = allUnits.filter(u =>
        u.levelOrder === level && u.start !== null && visibleSet.has(u.id)
      ).map(u => ({ ...u, end: u.end ?? 0 }));

      levelUnits.forEach(unit => {
        const currentIndex = visLevels.indexOf(level);
        const unitMap = UNIT_MAP;

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
            if (u.levelOrder !== nextLevel) return false;
            if (!visibleSet.has(u.id)) return false;
            let pid = u.parent;
            while (pid) { if (pid === unit.id) return true; pid = unitMap[pid]?.parent; }
            return false;
          });
          if (hasDesc) { spanEndIndex = i - 1; break; }
          spanEndIndex = i;
        }

        const spanColumns = frameLayout.filter(col =>
          col.id !== "time" && col.id !== "picks" &&
          visLevels.indexOf(col.id) >= spanStartIndex &&
          visLevels.indexOf(col.id) <= spanEndIndex
        );
        if (spanColumns.length === 0) return;

        const x = spanColumns[0].start + lateral;
        const w = spanColumns[spanColumns.length - 1].end - spanColumns[0].start;
        const y1 = scale(unit.start);
        const y2 = scale(unit.end);
        const y  = Math.min(y1, y2);
        const h  = Math.abs(y2 - y1);

        if (y > viewH || y + h < 0) return;
        hitBoxes.push({ id: unit.id, x, y, w, h });

        // ── Rectangle ──
        ctx.fillStyle = unit.icsColor || "#cccccc";
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = "rgba(0,0,0,0.4)";
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x, y, w, h);

        // ── Label ──
        const labelText = (() => {
          const ts = unit.displayName;
          const st = unit.displayNameStratigraphic;
          if (labelMode === "stratigraphic") return st || ts;
          if (labelMode === "both" && st) return `${ts} / ${st}`;
          return ts;
        })();
        const words = (labelText || "").trim().split(/\s+/).filter(Boolean);
        if (!words.length) return;

        // Per-column font size, with font rules taking highest priority
        const matchingRule = fontRules.find(r =>
          unit.start !== null && unit.start <= r.maxAge && (unit.end ?? 0) >= r.minAge
        );
        const blockFontSize = matchingRule?.fontSize ?? colConf?.fontSize ?? fontSize;

        // orientWidth: for units without a visible parent (e.g. Phanerozoic),
        // use the full width from leftmost hierarchy column — same logic as SVG pipeline.
        const leftmostHierarchyStart = frameLayout.find(col => col.id !== "time" && col.id !== "picks")?.start ?? x;
        const orientWidth = !hasVisibleParent
          ? (spanColumns[spanColumns.length - 1].end - leftmostHierarchyStart)
          : w;

        // In canvas there's no matrix transform — dimensions are already in CSS pixels.
        const blockOrient = colConf?.orientation ?? "auto";
        const resolvedOrient = blockOrient === "auto"
          ? (orientWidth >= h ? "horizontal" : "vertical")
          : blockOrient;

        const [fitW, fitH] = resolvedOrient === "vertical" ? [h, w] : [w, h];
        const fitWords = resolvedOrient === "vertical" ? [words.join(" ")] : words;

        const { lines, fitSize } = computeFitAndWrap(fitWords, fitW, fitH, fontFamily, blockFontSize, 5);

        const fontPrefix = `${fontBold ? "bold " : ""}${fontItalic ? "italic " : ""}`;
        ctx.font = `${fontPrefix}${fitSize}px ${fontFamily}`;
        ctx.fillStyle = contrastText ? contrastColor(unit.icsColor) : "black";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const cx = x + w / 2;
        const cy = y + h / 2;

        // Clip to block bounds so labels never bleed into adjacent cells
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();

        if (resolvedOrient === "vertical") {
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(-Math.PI / 2);
          ctx.fillText(lines[0] || "", 0, 0);
          ctx.restore();
        } else {
          const lineH = fitSize * 1.2;
          const startY = cy - ((lines.length - 1) / 2) * lineH;
          lines.forEach((line, i) => {
            ctx.fillText(line, cx, startY + i * lineH);
          });
        }

        ctx.restore(); // end clip
      });
    });

    // ── Time axis ──
    const timeColumn = frameLayout.find(col => col.id === "time");
    if (timeColumn) {
      // White background for time column
      ctx.fillStyle = "white";
      ctx.fillRect(timeColumn.start + lateral, eM, timeColumn.width, viewH - eM - BOTTOM_MARGIN);

      const tickValues = d3.scaleLinear().domain([vMin, vMax]).ticks(40);
      if (tickValues.length) {
        const tickSpan = vMax - vMin;
        const tickStep = tickValues.length > 1
          ? Math.abs(tickValues[1] - tickValues[0])
          : Math.max(0.001, tickSpan / 20);

        const targetLabels = Math.max(4, Math.floor((viewH - eM - BOTTOM_MARGIN) / (fontSize * 2.5)));
        const majorEvery   = Math.max(1, Math.round(tickValues.length / targetLabels));
        const majorTicks   = tickValues.filter((_, i) => i % majorEvery === 0);

        // Minor ticks — 4 subdivisions between each pair of majors
        const minorTicks = [];
        for (let i = 0; i < majorTicks.length - 1; i++) {
          const a = majorTicks[i], b = majorTicks[i + 1];
          const step = (b - a) / 5;
          for (let j = 1; j < 5; j++) {
            const age = a + j * step;
            if (age >= vMin && age <= vMax) minorTicks.push(age);
          }
        }

        ctx.strokeStyle = "black";
        ctx.lineWidth = 0.7;
        minorTicks.forEach(age => {
          const pos = scale(age);
          if (pos < eM - 2 || pos > viewH - BOTTOM_MARGIN + 2) return;
          const tx = timeColumn.end + lateral;
          ctx.beginPath();
          ctx.moveTo(tx - 5, pos);
          ctx.lineTo(tx, pos);
          ctx.stroke();
        });

        ctx.font = `${fontSize}px ${fontFamily}`;
        ctx.fillStyle = "black";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        let lastLabelY = -Infinity;
        ctx.lineWidth = 1;
        majorTicks.forEach(age => {
          const pos = scale(age);
          if (pos < eM - 2 || pos > viewH - BOTTOM_MARGIN + 2) return;
          const tx = timeColumn.end + lateral;
          ctx.strokeStyle = "black";
          ctx.beginPath();
          ctx.moveTo(tx - 12, pos);
          ctx.lineTo(tx, pos);
          ctx.stroke();
          if (pos - lastLabelY >= fontSize * 1.2) {
            lastLabelY = pos;
            ctx.fillText(formatTickLabel(age, tickStep, timeUnit), tx - 16, pos);
          }
        });
      }
    }

    // ── Picks column ──
    const picksColumn = frameLayout.find(col => col.id === "picks");
    if (picksColumn && visLevels.length) {
      // Compute boundary ages (same logic as SVG pipeline, simplified for dynamic mode)
      let boundaryAges = [];

      let adaptivePicksLevel = null;
      if (picksMode === "adaptive") {
        const minPxGap = fontSize * 1.6;
        const levelsFineFirst = [...visLevels].sort((a, b) => b - a);
        for (const level of levelsFineFirst) {
          const positions = allUnits
            .filter(u => u.levelOrder === level && u.start !== null && isUnitVisible(u.id, hiddenUnits))
            .filter(u => u.start >= vMin && u.start <= vMax)
            .map(u => scale(u.start))
            .filter(p => isFinite(p))
            .sort((a, b) => a - b);
          if (positions.length === 0) continue;
          if (positions.length === 1) { adaptivePicksLevel = level; break; }
          let minGap = Infinity;
          for (let i = 1; i < positions.length; i++) minGap = Math.min(minGap, positions[i] - positions[i - 1]);
          if (minGap >= minPxGap) { adaptivePicksLevel = level; break; }
        }
        if (adaptivePicksLevel === null) adaptivePicksLevel = [...visLevels].sort((a, b) => a - b)[0];
      }

      let candidateLevels;
      if (picksMode === "auto") {
        candidateLevels = [...visLevels];
      } else if (picksMode === "adaptive") {
        candidateLevels = adaptivePicksLevel !== null ? [adaptivePicksLevel] : [visLevels[0]];
      } else if (picksMode === "manual" && manualPicksLevel !== null) {
        candidateLevels = visLevels.filter(lvl => lvl <= manualPicksLevel);
      } else {
        candidateLevels = [];
      }

      if (candidateLevels.length) {
        const sortedLevels = [...candidateLevels].sort((a, b) => b - a);
        const boundaryMap = new Map();
        sortedLevels.forEach(level => {
          allUnits
            .filter(u => u.levelOrder === level && u.start !== null && isUnitVisible(u.id, hiddenUnits))
            .forEach(unit => {
              if (!boundaryMap.has(unit.start)) {
                boundaryMap.set(unit.start, {
                  uncertainty: unit.startUncertainty ?? null,
                  approximate: unit.startApproximate ?? false,
                });
              }
            });
        });
        boundaryMap.forEach(({ uncertainty, approximate }, age) => {
          boundaryAges.push({ age, uncertainty, approximate });
        });
      }

      if (!boundaryAges.some(b => b.age === 0)) {
        boundaryAges.push({ age: 0, uncertainty: null, approximate: false });
      }
      const _seen = new Set();
      boundaryAges = boundaryAges
        .filter(b => { if (_seen.has(b.age)) return false; _seen.add(b.age); return true; })
        .sort((a, b) => a.age - b.age); // youngest first

      // formatAge inline (same as PicksRenderer.js)
      const formatAge = (age) => {
        if (age === 0) return "0";
        const magnitude = Math.floor(Math.log10(Math.abs(age)) + 1e-10);
        const decimals = Math.max(0, picksSigFigs - 1 - magnitude);
        return String(parseFloat(age.toFixed(decimals)));
      };

      ctx.font = `${fontSize}px ${fontFamily}`;
      ctx.fillStyle = "black";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";

      boundaryAges.forEach(({ age, uncertainty, approximate }) => {
        const pos = scale(age);
        if (pos < eM - 2 || pos > viewH - BOTTOM_MARGIN + 2) return;

        const approxText = (showUncertainty && approximate) ? "\u007E" : "";
        const ageText = formatAge(age);
        const uncText = (showUncertainty && uncertainty !== null) ? ` \u00B1${uncertainty}` : "";
        const labelStr = approxText + ageText + uncText;

        const rightMargin = 4;
        const tickLabelGap = 12;
        const textWidth = ctx.measureText(labelStr).width;
        const labelPadding = textWidth + tickLabelGap + rightMargin;

        ctx.strokeStyle = "black";
        ctx.lineWidth = 1;
        const px = picksColumn.start + lateral;
        const pe = picksColumn.end + lateral;
        ctx.beginPath();
        ctx.moveTo(px, pos);
        ctx.lineTo(pe - labelPadding, pos);
        ctx.stroke();

        ctx.fillText(labelStr, pe - rightMargin, pos);
      });
    }

    // ── GSSP / GSSA markers ──
    if (showGSSP && picksColumn) {
      const markerX = picksColumn.end + lateral + 4;
      ctx.font = `8px ${fontFamily}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";

      // GSSP — gold triangle pointing right
      ctx.fillStyle = "#DAA520";
      allUnits
        .filter(u => u.ratifiedGSSP === true && u.start !== null && isUnitVisible(u.id, hiddenUnits))
        .forEach(unit => {
          const pos = scale(unit.start);
          if (pos < eM - 2 || pos > viewH - BOTTOM_MARGIN + 2) return;
          ctx.fillText("▶", markerX, pos);
        });

      // GSSA — blue clock symbol
      ctx.fillStyle = "#4169E1";
      allUnits
        .filter(u => u.ratifiedGSSA === true && u.start !== null && isUnitVisible(u.id, hiddenUnits))
        .forEach(unit => {
          const pos = scale(unit.start);
          if (pos < eM - 2 || pos > viewH - BOTTOM_MARGIN + 2) return;
          ctx.fillText("⏱", markerX + 12, pos);
        });
    }

    hitBoxesRef.current = hitBoxes;
    rafHandleRef.current = requestAnimationFrame(drawFrame);
  }, [effectiveUnits, hiddenUnits, columnConfig, effectiveColumnWidths, scaleType, equalSizeLevel, fontSize, fontFamily, labelOrientation, contrastText, fontBold, fontItalic, fontRules, labelMode, picksMode, manualPicksLevel, showUncertainty, picksSigFigs, timeUnit, showGSSP]); // eslint-disable-line react-hooks/exhaustive-deps

  // Start the canvas rAF loop; restart when drawFrame identity changes
  useEffect(() => {
    rafHandleRef.current = requestAnimationFrame(drawFrame);
    return () => {
      if (rafHandleRef.current) cancelAnimationFrame(rafHandleRef.current);
    };
  }, [drawFrame]);

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

  // Sync scrollbar thumb to current view position (so zoom/pan updates the bar)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || isScrollSyncing.current) return;

    const viewH = container.clientHeight;
    const scrollRange = Math.max(0, scrollableSize - viewH);
    if (scrollRange <= 0) return;
    let scrollTop;
    if (zoomMode === "transform") {
      const k = currentTransform.k || 1;
      const ty = currentTransform.y || 0;
      const eM = effectiveMarginRef.current;
      scrollTop = Math.max(0, Math.min(scrollRange,
        (eM * (1 - k) - ty) * viewH / (viewH - 2 * eM)
      ));
    } else {
      const fullSpan = dynamicMaxAge - dynamicMinAge;
      const visibleSpan = Math.max(0.001, visibleDomain[1] - visibleDomain[0]);
      if (fullSpan <= visibleSpan) return;
      const fraction = (visibleDomain[0] - dynamicMinAge) / (fullSpan - visibleSpan);
      scrollTop = Math.max(0, Math.min(scrollRange, fraction * scrollRange));
    }
    isScrollSyncing.current = true;
    container.scrollTop = scrollTop;
    isScrollSyncing.current = false;
  }, [zoomMode, currentTransform, visibleDomain, scrollableSize, dynamicMinAge, dynamicMaxAge]);

  useEffect(() => {

    const svgElement = svgRef.current;
    while (svgElement.firstChild) {
      svgElement.removeChild(svgElement.firstChild);
    }

    // Canvas handles rendering in dynamic mode — leave SVG empty so it doesn't cover the canvas.
    if (zoomMode === "dynamic") return;

    const height = svgElement.clientHeight;

    const svg = d3.select(svgElement);
    const zoomLayer = svg.append("g");

    if (zoomMode === "transform") {
      zoomLayer.attr("transform", transformRef.current);
    } else {
      const lo = lateralOffsetRef.current;
      zoomLayer.attr("transform", `translate(${lo}, 0)`);
    }

// ===== Rendering Layers =====
const backgroundLayer = zoomLayer.append("g");
const blockLayer = zoomLayer.append("g");
const picksLayer = zoomLayer.append("g");
const gsspLayer = zoomLayer.append("g");

const scaleDomain = zoomMode === "dynamic" ? visibleDomain : [dynamicMinAge, dynamicMaxAge];

    const allUnits = effectiveUnits;
const scaleUnits = scaleType === "equalSize"
  ? effectiveUnits.filter(u => isUnitVisible(u.id, hiddenUnits))
  : allUnits;

const eM = effectiveMarginRef.current;

const scale = buildScale(
  scaleType,
  scaleDomain,
  [eM, height - eM],
  scaleUnits,
  equalSizeLevel
);

// ===== PICKS BOUNDARY RESOLUTION =====

let boundaryAges = [];

// Adaptive mode: find finest level where adjacent boundaries are >= minPxGap apart
let adaptivePicksLevel = null;
if (picksMode === "adaptive" && visibleLevels.length) {
  // In transform mode the SVG isn't rebuilt on zoom, so derive the currently
  // visible age range from the transform so we only consider on-screen units.
  let adaptVisMin = visibleDomain[0];
  let adaptVisMax = visibleDomain[1];
  if (zoomMode === "transform") {
    const k = transformRef.current.k || 1;
    const ty = transformRef.current.y || 0;
    const rawMin = scale.invert((eM - ty) / k);
    const rawMax = scale.invert((height - eM - ty) / k);
    if (isFinite(rawMin) && isFinite(rawMax) && rawMax > rawMin) {
      adaptVisMin = Math.max(scaleDomain[0], rawMin);
      adaptVisMax = Math.min(scaleDomain[1], rawMax);
    }
  }

  // minPxGap in scale-coordinate pixels (divide by k to convert screen→scale coords)
  const currentK = zoomMode === "transform" ? (transformRef.current.k || 1) : 1;
  const minPxGap = fontSize * 1.6 / currentK;
  const levelsFineFirst = [...visibleLevels].sort((a, b) => b - a);
  for (const level of levelsFineFirst) {
    const positions = allUnits
      .filter(u => u.levelOrder === level && u.start !== null && isUnitVisible(u.id, hiddenUnits))
      .filter(u => u.start >= adaptVisMin && u.start <= adaptVisMax)
      .map(u => scale(u.start))
      .filter(p => isFinite(p))
      .sort((a, b) => a - b);
    if (positions.length === 0) continue;
    if (positions.length === 1) { adaptivePicksLevel = level; break; }
    let minGap = Infinity;
    for (let i = 1; i < positions.length; i++) minGap = Math.min(minGap, positions[i] - positions[i - 1]);
    if (minGap >= minPxGap) { adaptivePicksLevel = level; break; }
  }
  // Fallback to coarsest level if everything is too crowded
  if (adaptivePicksLevel === null) adaptivePicksLevel = [...visibleLevels].sort((a, b) => a - b)[0];
}

if ((picksMode === "auto" && visibleLevels.length) ||
    (picksMode === "manual" && manualPicksLevel !== null) ||
    (picksMode === "adaptive" && visibleLevels.length)) {

  // Determine which levels to consider

  let candidateLevels;

  if (picksMode === "auto") {
    candidateLevels = [...visibleLevels];
  } else if (picksMode === "adaptive") {
    candidateLevels = adaptivePicksLevel !== null ? [adaptivePicksLevel] : [visibleLevels[0]];
  } else {
    // Manual: start at selected level and include all higher levels for fallback
    candidateLevels = visibleLevels.filter(
      lvl => lvl <= manualPicksLevel
    );
  }

  // Sort deepest → shallowest
  const sortedLevels = [...candidateLevels].sort((a, b) => b - a);

  // Map age → { uncertainty, approximate } (deepest-level unit wins; deepest iterated first)
  const boundaryMap = new Map();

  sortedLevels.forEach(level => {

    const unitsAtLevel = allUnits
      .filter(u => u.levelOrder === level)
      .filter(u => u.start !== null)
      .filter(u => isUnitVisible(u.id, hiddenUnits));

    unitsAtLevel.forEach(unit => {

      if (!boundaryMap.has(unit.start)) {
        boundaryMap.set(unit.start, {
          uncertainty: unit.startUncertainty ?? null,
          approximate: unit.startApproximate ?? false,
        });
      }

    });

  });

  boundaryMap.forEach(({ uncertainty, approximate }, age) => {
    boundaryAges.push({ age, uncertainty, approximate });
  });

}

// Always include present day (0 Ma)
if (!boundaryAges.some(b => b.age === 0)) {
  boundaryAges.push({ age: 0, uncertainty: null, approximate: false });
}

// Dedupe by age and sort oldest-first (descending age)
const _seenAges = new Set();
boundaryAges = boundaryAges
  .filter(b => { if (_seenAges.has(b.age)) return false; _seenAges.add(b.age); return true; })
  .sort((a, b) => b.age - a.age);

// ===== TIME COLUMN =====

const timeColumn = layout.find(col => col.id === "time");

const timeBackground = document.createElementNS(
  "http://www.w3.org/2000/svg",
  "rect"
);

timeBackground.setAttribute("x", timeColumn.start);
timeBackground.setAttribute("y", eM);
timeBackground.setAttribute("width", timeColumn.width);
timeBackground.setAttribute("height", height - 2 * eM);

timeBackground.setAttribute("fill", "white");
timeBackground.setAttribute("stroke", "none");

backgroundLayer.node().appendChild(timeBackground);


// ===== Time Axis Ticks =====
// A dedicated group lets applyCounterScale clear+rebuild ticks for transform mode.
const timeAxisGroup = backgroundLayer.append("g").node();

renderTimeAxisTicks({
  layer: timeAxisGroup,
  scale,
  tickDomain: visibleDomain,   // visible range → correct density in both modes
  timeColumn,
  eM,
  svgH: height,
  timeUnit,
  fontSize,
  fontFamily,
});

// Store context so applyCounterScale can rebuild ticks on every zoom event
// (critical for transform mode where the SVG isn't rebuilt on zoom).
timeAxisContextRef.current = {
  layer: timeAxisGroup,
  scale,
  scaleDomain,
  timeColumn,
  eM,
  timeUnit,
  fontSize,
  fontFamily,
};

// ===== BLOCKS =====

const unitMap = UNIT_MAP;

let resolvedBlocks = [];

visibleLevels.forEach(level => {

  const currentIndex = visibleLevels.indexOf(level);
  if (currentIndex === -1) return;

  const levelUnits = allUnits
    .filter(u => u.levelOrder === level)
    .filter(u => u.start !== null)
    .filter(u => isUnitVisible(u.id, hiddenUnits))
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
      const hasDescendantAtLevel = allUnits.some(u => {
        if (u.levelOrder !== nextLevel) return false;
        if (!isUnitVisible(u.id, hiddenUnits)) return false;
        let parentId = u.parent;
        while (parentId) {
          if (parentId === unit.id) return true;
          parentId = unitMap[parentId]?.parent;
        }
        return false;
      });
      if (hasDescendantAtLevel) {
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

    const colBandStart = spanColumns[0].start;
    const colBandWidth =
      spanColumns[spanColumns.length - 1].end - spanColumns[0].start;

    const labelColStart = colBandStart;
    const labelColWidth = colBandWidth;

    // For auto-orientation: units without a visible parent (e.g. Phanerozoic) should
    // include ALL visible hierarchy columns to their left in the bounding-box width so
    // the Super-Eon column contributes to the horizontal extent.  Derive this directly
    // from the layout rather than relying on spanStartIndex.
    const orientBandStart = !hasVisibleParent
      ? (layout.find(col => col.id !== "time" && col.id !== "picks")?.start ?? colBandStart)
      : colBandStart;
    const orientWidth = spanColumns[spanColumns.length - 1].end - orientBandStart;

    // ===== Vertical geometry from scale =====

    const pos1 = scale(unit.start);
    const pos2 = scale(unit.end);

    const blockY = Math.min(pos1, pos2);
    const blockWidth = colBandWidth;
    const blockHeight = Math.abs(pos2 - pos1);

    // Skip blocks entirely outside the viewport — prevents SVG coordinate
    // overflow issues at extreme zoom levels.
    if (Math.min(pos1, pos2) > height || Math.max(pos1, pos2) < 0) return;

    const colConf = columnConfig.find(c => c.level === unit.levelOrder);
    // "auto" = align with longer axis; explicit column config override takes precedence
    const blockOrientation = colConf?.orientation ?? "auto";
    // Per-column font size, with font rules taking highest priority
    const matchingRule = fontRules.find(r =>
      unit.start !== null &&
      unit.start <= r.maxAge &&
      (unit.end ?? 0) >= r.minAge
    );
    const blockFontSize = matchingRule?.fontSize ?? colConf?.fontSize ?? fontSize;

    resolvedBlocks.push({
      unitId: unit.id,
      x: colBandStart,
      y: blockY,
      width: blockWidth,
      orientWidth,
      height: blockHeight,
      fill: unit.icsColor || "#ccc",
      label: (() => {
        const ts = unit.displayName;
        const st = unit.displayNameStratigraphic;
        if (labelMode === "stratigraphic") return st || ts;
        if (labelMode === "both" && st)    return `${ts} / ${st}`;
        return ts;
      })(),
      labelX: labelColStart + labelColWidth / 2,
      labelY: blockY + blockHeight / 2,
      labelOrientation: blockOrientation,
      fontSize: blockFontSize,
      ageStart: unit.start,
      ageEnd: unit.end ?? 0,
    });

  });

});

renderBlocks({
  svg: blockLayer.node(),
  blocks: resolvedBlocks,
  fontSize,
  fontFamily,
  labelOrientation,
  contrastText,
  currentK: zoomMode === "transform" ? (transformRef.current.k || 1) : 1,
  fontBold,
  fontItalic,
  fontUnderline,
});

// ===== PICKS =====

const picksColumn = layout.find(col => col.id === "picks");

if (picksColumn && boundaryAges.length) {
  renderPicks({
    svg: picksLayer.node(),
    column: picksColumn,
    boundaryAges,
    scale,
    height,
    margin: MARGIN,
    showUncertainty,
    picksSigFigs,
    fontSize,
  });
}


// ===== GSSP / GSSA MARKERS =====
if (showGSSP && picksColumn) {
  const markerX = picksColumn.end + 4;

  // GSSP — gold triangle pointing right
  allUnits
    .filter(u => u.ratifiedGSSP === true && u.start !== null && isUnitVisible(u.id, hiddenUnits))
    .forEach(unit => {
      const yPos = scale(unit.start);
      if (yPos < eM - 2 || yPos > height - eM + 2) return;
      const marker = document.createElementNS("http://www.w3.org/2000/svg", "text");
      marker.setAttribute("x", markerX);
      marker.setAttribute("y", yPos);
      marker.setAttribute("font-size", "8");
      marker.setAttribute("data-base-font-size", "8");
      marker.setAttribute("fill", "#DAA520");
      marker.setAttribute("dominant-baseline", "middle");
      marker.textContent = "▶";
      gsspLayer.node().appendChild(marker);
    });

  // GSSA — blue clock symbol
  allUnits
    .filter(u => u.ratifiedGSSA === true && u.start !== null && isUnitVisible(u.id, hiddenUnits))
    .forEach(unit => {
      const yPos = scale(unit.start);
      if (yPos < eM - 2 || yPos > height - eM + 2) return;
      const marker = document.createElementNS("http://www.w3.org/2000/svg", "text");
      marker.setAttribute("x", markerX + 12);
      marker.setAttribute("y", yPos);
      marker.setAttribute("font-size", "8");
      marker.setAttribute("data-base-font-size", "8");
      marker.setAttribute("fill", "#4169E1");
      marker.setAttribute("dominant-baseline", "middle");
      marker.textContent = "⏱";
      gsspLayer.node().appendChild(marker);
    });
}

  }, [columnConfig, columnWidths, picksMode, manualPicksLevel, zoomMode, visibleDomain, timeUnit, lateralOffset, showUncertainty, picksSigFigs, labelMode, contrastText, fontSize, fontFamily, labelOrientation, fontBold, fontItalic, fontUnderline, showGSSP, fontRules, scaleType, equalSizeLevel, hiddenUnits, dynamicMinAge, dynamicMaxAge, unitEdits, headerHeight]);

  // Re-apply counter-scale after the render effect rebuilds the SVG (transform mode only).
  // MUST be declared after the render effect so React runs it second.
  useEffect(() => {
    if (zoomMode !== "transform") return;
    const k = transformRef.current.k;
    if (k === 1) return;
    applyCounterScale(k);
  }, [columnConfig, columnWidths, picksMode, manualPicksLevel, zoomMode, visibleDomain, timeUnit, lateralOffset, showUncertainty, picksSigFigs, labelMode, contrastText, fontSize, fontFamily, labelOrientation, fontBold, fontItalic, fontUnderline, showGSSP, fontRules, scaleType, equalSizeLevel, hiddenUnits, dynamicMinAge, dynamicMaxAge, unitEdits, headerHeight, applyCounterScale]);

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
    };
    localStorage.setItem("gt_prefs", JSON.stringify(prefs));
  }, [timeUnit, columnConfig, columnWidths, labelMode, contrastText, fontSize, fontFamily, labelOrientation, fontBold, fontItalic, fontUnderline, showGSSP, fontRules, scaleType, equalSizeLevel, picksMode, manualPicksLevel, showUncertainty, picksSigFigs, hiddenUnits, headerHeight, headerFontSize, leftPanelOpen, settingsOpen]);

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

  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement) return;
    const svg = d3.select(svgElement);
    const svgWidth = svgElement.clientWidth;
    const svgHeight = svgElement.clientHeight;

    const onContextMenu = (e) => e.preventDefault();
    svgElement.addEventListener("contextmenu", onContextMenu);

    if (zoomMode === "transform") {
      // ===== TRANSFORM MODE: D3 zoom handles pan + wheel =====
      const zoom = d3.zoom()
        .scaleExtent([0.1, 1e8])
        .translateExtent([[-Infinity, -Infinity], [Infinity, Infinity]])
        .filter(event => {
          if (event.type === "dblclick") return false;
          if (event.type === "wheel") return event.ctrlKey;
          return event.button === 0;
        })
        // D3's default wheelDelta multiplies by 10× when ctrlKey is held
        // (intended for trackpad pinch which sends many tiny events).
        // Override to remove that multiplier so a mouse Ctrl+scroll is sane.
        .wheelDelta(event =>
          -event.deltaY * (event.deltaMode === 1 ? 0.025 : event.deltaMode ? 0.5 : 0.001)
        )
        .on("zoom", (event) => {
          transformRef.current = event.transform;
          svg.select("g").attr("transform", event.transform);
          setCurrentTransform(event.transform);
          applyCounterScale(event.transform.k);
        });

      const onKeyDown = (event) => {
        if (event.ctrlKey) {
          const isZoomIn  = event.key === "+" || event.key === "=";
          const isZoomOut = event.key === "-";
          if (!isZoomIn && !isZoomOut) return;
          event.preventDefault();
          svg.call(zoom.scaleBy, isZoomIn ? 1.5 : 1 / 1.5, [svgWidth / 2, svgHeight / 2]);
          return;
        }
        const arrows = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
        if (!arrows.includes(event.key)) return;
        event.preventDefault();
        const { k, x: tx, y: ty } = transformRef.current;
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          const delta = (svgHeight * 0.1) * (event.key === "ArrowUp" ? 1 : -1);
          svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty + delta).scale(k));
        } else {
          const delta = (svgWidth * 0.1) * (event.key === "ArrowLeft" ? 1 : -1);
          svg.call(zoom.transform, d3.zoomIdentity.translate(tx + delta, ty).scale(k));
        }
      };

      svgElement.onmousedown = () => { svgElement.style.cursor = "grabbing"; };
      const onMouseUp = () => { svgElement.style.cursor = "grab"; };

      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("mouseup", onMouseUp);

      zoomBehaviorRef.current = zoom;
      svg.call(zoom);
      svg.call(zoom.transform, transformRef.current);

      // Apply initial counter-scale if already zoomed in
      const initialK = transformRef.current.k;
      if (initialK !== 1) {
        applyCounterScale(initialK);
      }

      return () => {
        svg.on(".zoom", null);
        svgElement.removeEventListener("contextmenu", onContextMenu);
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("mouseup", onMouseUp);
        svgElement.onmousedown = null;
      };

    } else {
      // ===== DYNAMIC MODE: canvas + rAF loop handles rendering; direct wheel/mouse for pan =====
      const canvasEl = canvasRef.current;
      if (!canvasEl) return;

      let rafId = null;
      zoomBehaviorRef.current = null;

      // Helper: clamp a new [min, max] to the allowed domain while preserving span
      function clampDomain(newMin, newMax, span) {
        const fullSpan = dynamicMaxAgeRef.current - dynamicMinAgeRef.current;
        if (span > fullSpan) {
          return [dynamicMinAgeRef.current, dynamicMaxAgeRef.current];
        }
        if (newMin < dynamicMinAgeRef.current) {
          newMin = dynamicMinAgeRef.current;
          newMax = newMin + span;
        }
        if (newMax > dynamicMaxAgeRef.current) {
          newMax = dynamicMaxAgeRef.current;
          newMin = newMax - span;
        }
        return [newMin, newMax];
      }

      function commitDomain(newMin, newMax) {
        if (newMin >= newMax) return;
        visibleDomainRef.current = [newMin, newMax];
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          setVisibleDomain([...visibleDomainRef.current]);
          rafId = null;
        });
      }

      const onWheel = (e) => {
        e.preventDefault();

        const eM   = effectiveMarginRef.current;
        const h    = scrollContainerRef.current?.clientHeight ?? canvasEl.clientHeight;
        const [refMin, refMax] = visibleDomainRef.current;
        const span = refMax - refMin;

        const panDelta  = e.deltaY * (e.deltaMode === 1 ? 100 : e.deltaMode === 2 ? 300 : 4);
        const zoomDelta = e.deltaY * (e.deltaMode === 1 ?  30 : e.deltaMode === 2 ? 300 : 1);

        if (e.ctrlKey) {
          if (rafId) { cancelAnimationFrame(rafId); rafId = null; }

          const cursorY  = (e.offsetY != null) ? e.offsetY : (e.clientY - canvasEl.getBoundingClientRect().top);
          const pct      = Math.max(0, Math.min(1, (cursorY - eM) / (h - eM - BOTTOM_MARGIN)));
          const focalAge = refMin + pct * span;

          const fullSpan   = dynamicMaxAgeRef.current - dynamicMinAgeRef.current;
          const speedScale = Math.pow(span / fullSpan, 0.2);
          const kFactor    = Math.pow(2, zoomDelta * 0.003 * speedScale);
          const newSpan    = Math.min(span * kFactor, fullSpan);

          let newMin = focalAge - pct * newSpan;
          let newMax = focalAge + (1 - pct) * newSpan;

          if (newMin < dynamicMinAgeRef.current) { newMin = dynamicMinAgeRef.current; newMax = newMin + newSpan; }
          if (newMax > dynamicMaxAgeRef.current) { newMax = dynamicMaxAgeRef.current; newMin = newMax - newSpan; }

          if (newMin < newMax) {
            // Write ref only — rAF loop picks it up next frame. No setState. No re-render.
            visibleDomainRef.current = [newMin, newMax];
          }
        } else {
          const agePerPx = span / (h - eM - BOTTOM_MARGIN);
          const shift    = panDelta * agePerPx;
          const [newMin, newMax] = clampDomain(refMin + shift, refMax + shift, span);
          commitDomain(newMin, newMax);
        }
      };

      canvasEl.addEventListener("wheel", onWheel, { passive: false });

      // Pan: track raw mouse displacement from mousedown, apply to frozen start domain
      let pan = null; // { startX, startY, domain, lateral }

      const onMouseDown = (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        pan = {
          startX: e.clientX,
          startY: e.clientY,
          domain: [...visibleDomainRef.current],
          lateral: lateralOffsetRef.current
        };
        canvasEl.style.cursor = "grabbing";
      };

      const onMouseMove = (e) => {
        if (!pan) return;
        const dx = e.clientX - pan.startX;
        const dy = e.clientY - pan.startY;

        // Axial pan (along the time axis)
        const [refMin, refMax] = pan.domain;
        const eM = effectiveMarginRef.current;
        const liveH = scrollContainerRef.current?.clientHeight ?? canvasEl.clientHeight;
        const refScale = d3.scaleLinear()
          .domain([refMin, refMax])
          .range([eM, liveH - BOTTOM_MARGIN]);
        const newMin = refScale.invert(eM - dy);
        const span = refMax - refMin;
        const [clampedMin, clampedMax] = clampDomain(newMin, newMin + span, span);
        if (clampedMin < clampedMax) commitDomain(clampedMin, clampedMax);

        // Lateral pan (perpendicular to time axis)
        const newLateral = pan.lateral + dx;
        lateralOffsetRef.current = newLateral;
        setLateralOffset(newLateral);
      };

      const onMouseUp = () => {
        pan = null;
        canvasEl.style.cursor = "grab";
      };

      const onKeyDown = (event) => {
        if (event.ctrlKey) {
          const isZoomIn  = event.key === "+" || event.key === "=";
          const isZoomOut = event.key === "-";
          if (!isZoomIn && !isZoomOut) return;
          event.preventDefault();
          const [vMin, vMax] = visibleDomainRef.current;
          const span   = vMax - vMin;
          const center = (vMin + vMax) / 2;
          const newSpan = span * (isZoomIn ? 1 / 1.5 : 1.5);
          const [newMin, newMax] = clampDomain(center - newSpan / 2, center + newSpan / 2, newSpan);
          if (newMin < newMax) { visibleDomainRef.current = [newMin, newMax]; setVisibleDomain([newMin, newMax]); }
          return;
        }
        const arrows = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
        if (!arrows.includes(event.key)) return;
        event.preventDefault();
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          const [vMin, vMax] = visibleDomainRef.current;
          const span = vMax - vMin;
          const shift = span * 0.1 * (event.key === "ArrowUp" ? -1 : 1);
          let newMin = vMin + shift;
          let newMax = vMax + shift;
          if (newMin < dynamicMinAgeRef.current) { newMin = dynamicMinAgeRef.current; newMax = newMin + span; }
          if (newMax > dynamicMaxAgeRef.current) { newMax = dynamicMaxAgeRef.current; newMin = Math.max(dynamicMinAgeRef.current, newMax - span); }
          visibleDomainRef.current = [newMin, newMax];
          setVisibleDomain([newMin, newMax]);
        } else {
          const delta = svgWidth * 0.1 * (event.key === "ArrowLeft" ? 1 : -1);
          lateralOffsetRef.current += delta;
          setLateralOffset(lateralOffsetRef.current);
        }
      };

      canvasEl.addEventListener("mousedown", onMouseDown);
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
      window.addEventListener("keydown", onKeyDown);

      return () => {
        if (rafId) cancelAnimationFrame(rafId);
        svgElement.removeEventListener("contextmenu", onContextMenu);
        canvasEl.removeEventListener("wheel", onWheel);
        canvasEl.removeEventListener("mousedown", onMouseDown);
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        window.removeEventListener("keydown", onKeyDown);
      };
    }
  }, [columnConfig, columnWidths, zoomMode]);

  // Recursive tree renderer — shows all non-stage units with toggle checkboxes
  function renderUnitTree(parentId, depth) {
    const children = effectiveUnits
      .filter(u => u.parent === parentId && u.levelOrder < 6 && u.start !== null)
      .sort((a, b) => b.start - a.start);
    if (children.length === 0) return null;
    return children.map(unit => {
      const hasChildren = effectiveUnits.some(u => u.parent === unit.id && u.levelOrder < 6);
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
            <span style={{ fontSize: 11, textDecoration: isHidden ? "line-through" : "none", color: isHidden ? "#999" : "#000", whiteSpace: "nowrap" }}>
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
      <div style={{
        height: 40,
        display: "flex",
        alignItems: "center",
        padding: "0 8px",
        borderBottom: "1px solid #ccc",
        background: "#f8f8f8",
        gap: 8,
        flexShrink: 0,
      }}>
        <button
          onClick={() => setLeftPanelOpen(v => !v)}
          title="Toggle panel"
          style={{ fontSize: 16, padding: "2px 6px", border: "1px solid #ccc", background: leftPanelOpen ? "#ddd" : "#f5f5f5", cursor: "pointer", borderRadius: 3 }}
        >☰</button>

        <button
          onClick={handleResetZoom}
          style={{ fontSize: 11, padding: "2px 8px", border: "1px solid #ccc", background: "#f5f5f5", cursor: "pointer", borderRadius: 3 }}
        >Reset</button>

        <div style={{ display: "flex", border: "1px solid #999", borderRadius: 4, overflow: "hidden" }}>
          {[["dynamic","Dynamic"],["transform","Smooth"]].map(([val,lbl], i) => (
            <button key={val} onClick={() => handleSwitchZoomMode(val)}
              style={{ padding: "2px 8px", fontSize: 11, border: "none", borderRight: i === 0 ? "1px solid #999" : "none", background: zoomMode === val ? "#555" : "#f5f5f5", color: zoomMode === val ? "white" : "#333", cursor: "pointer" }}
            >{lbl}</button>
          ))}
        </div>

        <div style={{ display: "flex", border: "1px solid #999", borderRadius: 4, overflow: "hidden" }}>
          {["Ga","Ma","ka"].map((u, i) => (
            <button key={u} onClick={() => setTimeUnit(u)}
              style={{ padding: "2px 8px", fontSize: 11, border: "none", borderRight: i < 2 ? "1px solid #999" : "none", background: timeUnit === u ? "#555" : "#f5f5f5", color: timeUnit === u ? "white" : "#333", cursor: "pointer" }}
            >{u}</button>
          ))}
        </div>

        <div style={{ display: "flex", border: "1px solid #999", borderRadius: 4, overflow: "hidden" }}>
          {[["linear","Linear"],["log","Log"],["equalSize","Equal"],["eraEqual","Era"]].map(([val,lbl], i, arr) => (
            <button key={val} onClick={() => setScaleType(val)}
              style={{ padding: "2px 8px", fontSize: 11, border: "none", borderRight: i < arr.length - 1 ? "1px solid #999" : "none", background: scaleType === val ? "#555" : "#f5f5f5", color: scaleType === val ? "white" : "#333", cursor: "pointer" }}
            >{lbl}</button>
          ))}
        </div>
        {scaleType === "equalSize" && (
          <select
            value={equalSizeLevel}
            onChange={e => setEqualSizeLevel(Number(e.target.value))}
            style={{ fontSize: 11, padding: "1px 4px" }}
          >
            {columnConfig.map(col => (
              <option key={col.level} value={col.level}>{col.label}</option>
            ))}
          </select>
        )}

        <div style={{ flex: 1 }} />

        <button
          onClick={() => setShowGSSP(v => !v)}
          title="GSSP markers"
          style={{ fontSize: 11, padding: "2px 8px", border: "1px solid #ccc", background: showGSSP ? "#555" : "#f5f5f5", color: showGSSP ? "white" : "#333", cursor: "pointer", borderRadius: 3 }}
        >GSSP</button>

        <button
          onClick={() => setSettingsOpen(v => !v)}
          title="Settings"
          style={{ fontSize: 11, padding: "2px 8px", border: "1px solid #ccc", background: settingsOpen ? "#555" : "#f5f5f5", color: settingsOpen ? "white" : "#333", cursor: "pointer", borderRadius: 3 }}
        >Settings</button>

        <button
          onClick={() => setShowDataEditor(v => !v)}
          title="Data editor"
          style={{ fontSize: 11, padding: "2px 8px", border: "1px solid #ccc", background: showDataEditor ? "#555" : "#f5f5f5", color: showDataEditor ? "white" : "#333", cursor: "pointer", borderRadius: 3 }}
        >⊞ Data</button>
      </div>

      {/* Zone 1: Status strip */}
      <div style={{
        height: 22,
        display: "flex",
        alignItems: "center",
        padding: "0 10px",
        borderBottom: "1px solid #e0e0e0",
        background: "#fafafa",
        fontSize: 11,
        color: "#555",
        flexShrink: 0,
        gap: 16,
      }}>
        <span>
          {timeUnit === "Ga"
            ? `${(visibleDomain[0]/1000).toFixed(3)}–${(visibleDomain[1]/1000).toFixed(3)} Ga`
            : timeUnit === "ka"
            ? `${(visibleDomain[0]*1000).toFixed(0)}–${(visibleDomain[1]*1000).toFixed(0)} ka`
            : `${visibleDomain[0].toFixed(2)}–${visibleDomain[1].toFixed(2)} Ma`}
        </span>
        <span>{columnConfig.filter(c => c.visible).length} columns visible</span>
        {hiddenUnits.size > 0 && <span>{hiddenUnits.size} units hidden</span>}
      </div>


      {/* Main area: left panel + visualization + settings panel */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

      {/* Zone 2: Left Panel */}
      {leftPanelOpen && (
        <div style={{
          width: 220,
          flexShrink: 0,
          borderRight: "1px solid #ccc",
          display: "flex",
          flexDirection: "column",
          background: "#fafafa",
          overflow: "hidden",
        }}>
          {/* Columns section */}
          <div style={{ padding: "6px 10px 4px", borderBottom: "1px solid #ddd", fontWeight: "bold", fontSize: 12 }}>Columns</div>
          <div style={{ padding: "4px 10px 8px", borderBottom: "1px solid #ddd", overflowY: "auto" }}>
            {columnConfig.map((col, index) => (
              <div key={col.level} style={{ display: "flex", alignItems: "center", gap: 4, paddingTop: 3, paddingBottom: 3 }}>
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
                  style={{ fontSize: 10, maxWidth: 68 }}
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
                  style={{ width: 32, fontSize: 10 }}
                />
              </div>
            ))}
          </div>

          {/* Units section */}
          <div style={{ padding: "6px 10px 4px", borderBottom: "1px solid #ddd", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
            <span style={{ fontWeight: "bold", fontSize: 12 }}>Units</span>
            <button onClick={() => setHiddenUnits(new Set())} style={{ fontSize: 10, padding: "1px 6px" }}>Show All</button>
          </div>
          <div style={{ padding: "4px 8px", flexShrink: 0 }}>
            <input
              placeholder="Search units…"
              value={unitSearch}
              onChange={e => setUnitSearch(e.target.value)}
              style={{ width: "100%", fontSize: 11, padding: "2px 6px", border: "1px solid #ccc", boxSizing: "border-box" }}
            />
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "2px 8px 8px" }}>
            {unitSearch
              ? effectiveUnits
                  .filter(u => u.levelOrder < 6 && u.start !== null && u.displayName.toLowerCase().includes(unitSearch.toLowerCase()))
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
                        <span style={{ fontSize: 11, textDecoration: isHidden ? "line-through" : "none", color: isHidden ? "#999" : "#000" }}>
                          {unit.displayName}
                        </span>
                      </div>
                    );
                  })
              : renderUnitTree(null, 0)
            }
          </div>
        </div>
      )}

      {/* Visualization Area — scroll container */}
      <div
        ref={scrollContainerRef}
        style={{
          flex: 1,
          position: "relative",
          overflowY: "scroll",
          overflowX: "hidden"
        }}
        onScroll={handleScroll}
      >
        {/* Spacer establishes the scrollable extent */}
        <div style={{
          height: scrollableSize,
          width: "100%",
          minHeight: "100%",
          position: "relative"
        }}>
          {/* Sticky wrapper keeps SVG + handles pinned to the viewport */}
          <div style={{
            position: "sticky",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none"
          }}>
            {/* Canvas: handles dynamic mode rendering + events */}
            <canvas
              ref={canvasRef}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                cursor: "grab",
                pointerEvents: zoomMode === "dynamic" ? "auto" : "none",
                display: "block",
              }}
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const mx = e.clientX - rect.left;
                const my = e.clientY - rect.top;
                const hit = hitBoxesRef.current.find(
                  b => mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h
                );
                if (hit) {
                  const unit = effectiveUnits.find(u => u.id === hit.id);
                  if (unit) {
                    setHoverUnit(unit);
                    setTooltipPos({ x: e.clientX, y: e.clientY });
                    return;
                  }
                }
                setHoverUnit(null);
              }}
              onMouseLeave={() => setHoverUnit(null)}
            />
            {/* SVG: used for transform mode rendering + events */}
            <svg
              ref={svgRef}
              width="100%"
              height="100%"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                background: zoomMode === "transform" ? "white" : "transparent",
                cursor: "grab",
                pointerEvents: zoomMode === "transform" ? "auto" : "none",
              }}
              onMouseMove={(e) => {
                const unitId = e.target.getAttribute?.("data-unit-id");
                if (unitId) {
                  const unit = effectiveUnits.find(u => u.id === unitId);
                  if (unit) {
                    setHoverUnit(unit);
                    setTooltipPos({ x: e.clientX, y: e.clientY });
                    return;
                  }
                }
                setHoverUnit(null);
              }}
              onMouseLeave={() => setHoverUnit(null)}
            />

            {/* Column Headers */}
            {(() => {
              const k = zoomMode === "dynamic" ? 1 : (currentTransform.k || 1);
              const tx = zoomMode === "dynamic" ? lateralOffset : (currentTransform.x || 0);
              // Canvas for text measurement
              const _hc = document.createElement("canvas");
              const _hctx = _hc.getContext("2d");
              _hctx.font = `${fontBold ? "bold " : ""}${fontItalic ? "italic " : ""}${headerFontSize}px ${fontFamily}`;
              return (
                <div style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: headerHeight,
                  pointerEvents: "auto",
                  zIndex: 10,
                  background: "white",
                  borderBottom: "1px solid black",
                  overflow: "hidden",
                  userSelect: "none",
                }}>
                  {layout.map((col, i) => {
                    const colW = col.width * k;
                    const name = getColDisplayName(col);
                    const textW = _hctx.measureText(name).width;
                    const isVertical = colW < textW + 16;
                    return (
                      <div key={col.id} style={{
                        position: "absolute",
                        left: col.start * k + tx,
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
                        borderLeft: i === 0 ? "1px solid #ccc" : "none",
                        borderRight: "1px solid #ccc",
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
                      const onMove = mv => setHeaderHeight(Math.max(24, startH + mv.clientY - startY));
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
              const k = zoomMode === "dynamic" ? 1 : (currentTransform.k || 1);
              const tx = zoomMode === "dynamic" ? lateralOffset : (currentTransform.x || 0);
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
                      const delta = (moveEvent.clientX - startX) / k;
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
        </div>
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
          fontWeight: "bold",
          background: "#f0f0f0",
          borderBottom: "2px solid #ccc",
          cursor: "pointer",
          userSelect: "none",
          whiteSpace: "nowrap",
          position: "sticky",
          top: 0,
          zIndex: 1,
        });

        const tdStyle = (edited) => ({
          padding: "2px 6px",
          fontSize: 11,
          borderBottom: "1px solid #eee",
          cursor: "text",
          whiteSpace: "nowrap",
          maxWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          background: edited ? "#fffbe6" : "white",
        });

        return (
          <div style={{
            width: editorWidth,
            flexShrink: 0,
            borderLeft: "2px solid #ccc",
            display: "flex",
            flexDirection: "column",
            background: "white",
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
            <div style={{ padding: "8px 10px", borderBottom: "1px solid #ccc", background: "#f8f8f8", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 13, marginRight: 4 }}>Data Editor</strong>
              <input
                placeholder="Search name / id…"
                value={editorSearch}
                onChange={e => setEditorSearch(e.target.value)}
                style={{ fontSize: 11, padding: "2px 6px", border: "1px solid #ccc", width: 150 }}
              />
              <select
                value={editorRankFilter}
                onChange={e => setEditorRankFilter(e.target.value)}
                style={{ fontSize: 11, padding: "2px 4px" }}
              >
                <option value="all">All Ranks</option>
                {allRanks.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <span style={{ fontSize: 11, color: "#666", marginLeft: "auto" }}>{rows.length} units</span>
              <button
                onClick={() => setShowDataEditor(false)}
                style={{ padding: "2px 8px", fontSize: 12, cursor: "pointer" }}
              >✕</button>
            </div>

            {/* Table */}
            <div style={{ overflowY: "auto", flex: 1 }}>
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
                      <tr key={unit.id} style={{ background: Object.keys(edited).length > 0 ? "#fffbe6" : "white" }}>
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
                                  style={{ width: "100%", fontSize: 11, padding: "1px 4px", boxSizing: "border-box" }}
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
        <div style={{
          width: 280,
          flexShrink: 0,
          borderLeft: "1px solid #ccc",
          display: "flex",
          flexDirection: "column",
          background: "#fafafa",
          overflow: "hidden",
        }}>
          {/* Mini-tab bar */}
          <div style={{ display: "flex", borderBottom: "1px solid #ccc", background: "#f0f0f0", flexShrink: 0 }}>
            {["display","picks","export"].map(tab => (
              <button
                key={tab}
                onClick={() => setSettingsTab(tab)}
                style={{
                  flex: 1,
                  padding: "6px 4px",
                  fontSize: 11,
                  border: "none",
                  borderBottom: settingsTab === tab ? "2px solid #333" : "2px solid transparent",
                  background: settingsTab === tab ? "white" : "transparent",
                  cursor: "pointer",
                  fontWeight: settingsTab === tab ? "bold" : "normal",
                }}
              >{tab.charAt(0).toUpperCase() + tab.slice(1)}</button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflowY: "auto", padding: "8px 10px", fontSize: 12 }}>
            {settingsTab === "display" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <div style={{ fontWeight: "bold", fontSize: 11, marginBottom: 4 }}>Column Headers</div>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                    Height:
                    <input type="range" min="24" max="80" value={headerHeight} onChange={e => setHeaderHeight(Number(e.target.value))} style={{ flex: 1 }} />
                    {headerHeight}px
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, marginTop: 4 }}>
                    Font:
                    <input type="range" min="8" max="22" value={headerFontSize} onChange={e => setHeaderFontSize(Number(e.target.value))} style={{ flex: 1 }} />
                    {headerFontSize}px
                  </label>
                </div>
                <div>
                  <div style={{ fontWeight: "bold", fontSize: 11, marginBottom: 4 }}>Block Text</div>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                    Size:
                    <input type="range" min="6" max="16" value={fontSize} onChange={e => setFontSize(Number(e.target.value))} style={{ flex: 1 }} />
                    {fontSize}px
                  </label>
                  <div style={{ marginTop: 4 }}>
                    <select value={fontFamily} onChange={e => setFontFamily(e.target.value)} style={{ fontSize: 11, width: "100%" }}>
                      <option value="Arial, sans-serif">Arial</option>
                      <option value="'Times New Roman', serif">Times New Roman</option>
                      <option value="'Courier New', monospace">Courier New</option>
                      <option value="Georgia, serif">Georgia</option>
                      <option value="Verdana, sans-serif">Verdana</option>
                    </select>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    <label style={{ fontSize: 11 }}><input type="checkbox" checked={fontBold} onChange={e => setFontBold(e.target.checked)} /> Bold</label>
                    <label style={{ fontSize: 11 }}><input type="checkbox" checked={fontItalic} onChange={e => setFontItalic(e.target.checked)} /> Italic</label>
                    <label style={{ fontSize: 11 }}><input type="checkbox" checked={fontUnderline} onChange={e => setFontUnderline(e.target.checked)} /> Underline</label>
                  </div>
                </div>
                <div>
                  <div style={{ fontWeight: "bold", fontSize: 11, marginBottom: 4 }}>Labels</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {["horizontal","vertical"].map(o => (
                      <label key={o} style={{ fontSize: 11 }}>
                        <input type="radio" name="labelOrientation" value={o} checked={labelOrientation === o} onChange={() => setLabelOrientation(o)} />
                        {" "}{o.charAt(0).toUpperCase() + o.slice(1)}
                      </label>
                    ))}
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, marginTop: 4 }}>
                    <input type="checkbox" checked={contrastText} onChange={e => setContrastText(e.target.checked)} />
                    Auto contrast
                  </label>
                  <div style={{ marginTop: 6 }}>
                    <div style={{ fontSize: 10, color: "#666", marginBottom: 3 }}>Unit naming</div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {[["timescale","Time"],["stratigraphic","Strat"],["both","Both"]].map(([v,l]) => (
                        <label key={v} style={{ fontSize: 11 }}>
                          <input type="radio" name="labelMode" value={v} checked={labelMode === v} onChange={() => setLabelMode(v)} />
                          {" "}{l}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
                {scaleType === "equalSize" && (
                  <div>
                    <div style={{ fontWeight: "bold", fontSize: 11, marginBottom: 4 }}>Equal Size Level</div>
                    <select value={equalSizeLevel} onChange={e => setEqualSizeLevel(Number(e.target.value))} style={{ fontSize: 11, width: "100%" }}>
                      {columnConfig.map(col => (
                        <option key={col.level} value={col.level}>{col.label}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <div style={{ fontWeight: "bold", fontSize: 11, marginBottom: 4 }}>Font Size Rules (by age)</div>
                  {fontRules.map(rule => (
                    <div key={rule.id} style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 4, fontSize: 11 }}>
                      <input type="number" value={rule.minAge} onChange={e => setFontRules(fontRules.map(r => r.id === rule.id ? { ...r, minAge: Number(e.target.value) } : r))} style={{ width: 50 }} placeholder="Min" />
                      <span>–</span>
                      <input type="number" value={rule.maxAge} onChange={e => setFontRules(fontRules.map(r => r.id === rule.id ? { ...r, maxAge: Number(e.target.value) } : r))} style={{ width: 50 }} placeholder="Max" />
                      <span>Ma</span>
                      <input type="number" value={rule.fontSize} onChange={e => setFontRules(fontRules.map(r => r.id === rule.id ? { ...r, fontSize: Number(e.target.value) } : r))} style={{ width: 34 }} min={5} max={32} />
                      <button onClick={() => setFontRules(fontRules.filter(r => r.id !== rule.id))} style={{ fontSize: 10, padding: "1px 4px" }}>✕</button>
                    </div>
                  ))}
                  <button
                    onClick={() => setFontRules([...fontRules, { id: String(Date.now()), minAge: 0, maxAge: 66, fontSize: fontSize }])}
                    style={{ fontSize: 11, padding: "2px 8px", marginTop: 2 }}
                  >+ Add Rule</button>
                </div>
              </div>
            )}

            {settingsTab === "picks" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <div style={{ fontWeight: "bold", fontSize: 11, marginBottom: 6 }}>Boundary Mode</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label style={{ fontSize: 11 }}>
                      <input type="radio" name="picksMode" value="auto" checked={picksMode === "auto"} onChange={() => setPicksMode("auto")} />
                      {" "}Auto (deepest visible)
                    </label>
                    <label style={{ fontSize: 11 }}>
                      <input type="radio" name="picksMode" value="adaptive" checked={picksMode === "adaptive"} onChange={() => setPicksMode("adaptive")} />
                      {" "}Adaptive (zoom-aware rank)
                    </label>
                    <label style={{ fontSize: 11 }}>
                      <input type="radio" name="picksMode" value="manual" checked={picksMode === "manual"} onChange={() => setPicksMode("manual")} />
                      {" "}Manual
                    </label>
                  </div>
                  {picksMode === "manual" && (
                    <select
                      value={manualPicksLevel ?? ""}
                      onChange={e => setManualPicksLevel(e.target.value === "" ? null : Number(e.target.value))}
                      style={{ fontSize: 11, marginTop: 6, width: "100%" }}
                    >
                      <option value="">Select Level</option>
                      {columnConfig.map(col => (
                        <option key={col.level} value={col.level}>{col.label}</option>
                      ))}
                    </select>
                  )}
                </div>
                <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={showUncertainty} onChange={e => setShowUncertainty(e.target.checked)} />
                  Show uncertainty
                </label>
                <label style={{ fontSize: 11 }}>
                  Significant figures:
                  <select value={picksSigFigs} onChange={e => setPicksSigFigs(Number(e.target.value))} style={{ marginLeft: 6, fontSize: 11 }}>
                    {[3,4,5,6].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
              </div>
            )}

            {settingsTab === "export" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button onClick={handleExportSVG} style={{ padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>Download SVG</button>
                <button onClick={handleExportPNG} style={{ padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>Download PNG</button>
                <button onClick={handleCopyPNG} style={{ padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>Copy PNG to Clipboard</button>
                <hr style={{ border: "none", borderTop: "1px solid #ddd", margin: "4px 0" }} />
                <div style={{ fontWeight: "bold", fontSize: 11, marginBottom: 4 }}>Data Edits</div>
                {Object.keys(unitEdits).length > 0 && (
                  <button onClick={() => setUnitEdits({})} style={{ padding: "4px 10px", color: "red", border: "1px solid #faa", cursor: "pointer", fontSize: 11 }}>
                    Reset All Edits ({Object.keys(unitEdits).length})
                  </button>
                )}
                <button onClick={handleExportEdits} style={{ padding: "4px 10px", border: "1px solid #aaa", cursor: "pointer", fontSize: 11 }}>Export Edits</button>
                <button onClick={() => importEditsRef.current?.click()} style={{ padding: "4px 10px", border: "1px solid #aaa", cursor: "pointer", fontSize: 11 }}>Import Edits</button>
                <input ref={importEditsRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={handleImportEdits} />
              </div>
            )}
          </div>
        </div>
      )}

      </div>

      {/* Hover tooltip */}
      {hoverUnit && (() => {
        const TOOLTIP_W = 260;
        const TOOLTIP_H = 90;
        const tipLeft = tooltipPos.x + 14 + TOOLTIP_W > window.innerWidth
          ? tooltipPos.x - 14 - TOOLTIP_W
          : tooltipPos.x + 14;
        const tipTop = tooltipPos.y + 14 + TOOLTIP_H > window.innerHeight
          ? tooltipPos.y - 14 - TOOLTIP_H
          : tooltipPos.y + 14;
        return (
        <div style={{
          position: "fixed",
          left: tipLeft,
          top: tipTop,
          background: "rgba(0,0,0,0.82)",
          color: "white",
          padding: "6px 10px",
          borderRadius: 4,
          fontSize: 12,
          lineHeight: 1.4,
          pointerEvents: "none",
          zIndex: 1000,
          maxWidth: 260,
        }}>
          <div style={{ fontWeight: "bold" }}>{hoverUnit.displayName}</div>
          {hoverUnit.displayNameStratigraphic &&
            hoverUnit.displayNameStratigraphic !== hoverUnit.displayName && (
            <div style={{ fontSize: 11, opacity: 0.75 }}>
              {hoverUnit.displayNameStratigraphic}
            </div>
          )}
          <div style={{ fontSize: 11, opacity: 0.75 }}>{hoverUnit.rankTime}</div>
          {hoverUnit.start !== null && (
            <div style={{ fontSize: 11 }}>
              {hoverUnit.end ?? 0}–{hoverUnit.start} Ma
            </div>
          )}
        </div>
        );
      })()}
    </div>
  );
}

export default App;