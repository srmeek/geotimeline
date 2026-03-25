import { renderPicks } from "./renderers/PicksRenderer";
import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";

import { renderBlocks } from "./renderers/BlockRenderer";
import geologicTime from "./data/geologicTime.json";

const ICS_MIN_AGE = 0;
const ICS_MAX_AGE = 4567.30;
const MARGIN = 40; // px of blank space above/below the timeline

// ===== Static unit data (adjusted levels, built once) =====
const ALL_UNITS = geologicTime.units.map(u => {
  let adjustedLevel = u.levelOrder;
  if (u.rankTime === "Sub-Period") adjustedLevel = 4;
  if (u.rankTime === "Epoch")      adjustedLevel = 5;
  if (u.rankTime === "Age")        adjustedLevel = 6;
  return { ...u, levelOrder: adjustedLevel };
});
const UNIT_MAP = Object.fromEntries(ALL_UNITS.map(u => [u.id, u]));

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
    const width = columnWidths[col.id] ?? columnWidths[col.level];
    const start = offset;
    const end = start + width;
    offset = end;

    return { ...col, start, width, end };
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
      const candidates = [0, 0.001, 0.01, 0.1, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 4000, 4567];
      return candidates.filter(t => t >= domain[0] && t <= domain[1]);
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
    fn.ticks = () => eras.map(e => e.start).concat([0]);
    return fn;
  }

  return d3.scaleLinear().domain(domain).range(range);
}

function App() {
  const svgRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const isScrollSyncing = useRef(false);
  const [scrollableSize, setScrollableSize] = useState(800);

  const [orientation, setOrientation] = useState("vertical");
  const [activeTab, setActiveTab] = useState("View");

  const [columnConfig, setColumnConfig] = useState([
    { level: 0, label: "Super-Eon", labelStrat: "Super-Eonothem", visible: true },
    { level: 1, label: "Eon",       labelStrat: "Eonothem",       visible: true },
    { level: 2, label: "Era",       labelStrat: "Erathem",        visible: true },
    { level: 3, label: "Period",    labelStrat: "System",         visible: true },
    { level: 4, label: "Subperiod", labelStrat: "Subsystem",      visible: true },
    { level: 5, label: "Epoch",     labelStrat: "Series",         visible: true },
    { level: 6, label: "Age",       labelStrat: "Stage",          visible: true }
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

  const [timeUnit, setTimeUnit] = useState("Ma"); // "Ga" | "Ma" | "ka"

  const [currentTransform, setCurrentTransform] = useState(d3.zoomIdentity);
  const transformRef = useRef(d3.zoomIdentity);

  const [zoomMode, setZoomMode] = useState("transform"); // "transform" | "dynamic"
  const [visibleDomain, setVisibleDomain] = useState([ICS_MIN_AGE, ICS_MAX_AGE]);
  const visibleDomainRef = useRef([ICS_MIN_AGE, ICS_MAX_AGE]);
  const zoomBehaviorRef = useRef(null);
  // lateralOffset: perpendicular-to-axis translation in dynamic mode (x for vertical, y for horizontal)
  const [lateralOffset, setLateralOffset] = useState(0);
  const lateralOffsetRef = useRef(0);

  const [hiddenUnits, setHiddenUnits] = useState(() => new Set());
  const [expandedNodes, setExpandedNodes] = useState(() => new Set());
  const [showDataEditor, setShowDataEditor] = useState(false);
  const [unitEdits, setUnitEdits] = useState({}); // { [id]: { field: value, ... } }
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
    const w = svgElement.clientWidth;

    if (newMode === "transform") {
      // Convert current visibleDomain → equivalent D3 transform
      const [domMin, domMax] = visibleDomainRef.current;
      const fullScale = d3.scaleLinear()
        .domain([dynamicMinAge, dynamicMaxAge])
        .range(orientation === "vertical" ? [MARGIN, h - MARGIN] : [w - MARGIN, MARGIN]);
      const p1 = fullScale(domMin);
      const p2 = fullScale(domMax);
      let newTransform;
      if (orientation === "vertical") {
        const k  = (h - 2 * MARGIN) / (p2 - p1);
        const ty = MARGIN - p1 * k;
        newTransform = d3.zoomIdentity.translate(0, ty).scale(k);
      } else {
        const k  = (w - 2 * MARGIN) / (p1 - p2);
        const tx = (w - MARGIN) - p1 * k;
        newTransform = d3.zoomIdentity.translate(tx, 0).scale(k);
      }
      transformRef.current = newTransform;
      setCurrentTransform(newTransform);
    } else {
      // Convert current transform → equivalent visibleDomain
      const { k, x: tx, y: ty } = transformRef.current;
      const fullScale = d3.scaleLinear()
        .domain([dynamicMinAge, dynamicMaxAge])
        .range(orientation === "vertical" ? [MARGIN, h - MARGIN] : [w - MARGIN, MARGIN]);
      let newMin, newMax;
      if (orientation === "vertical") {
        newMin = fullScale.invert((MARGIN - ty) / k);
        newMax = fullScale.invert((h - MARGIN - ty) / k);
      } else {
        newMin = fullScale.invert((w - MARGIN - tx) / k);
        newMax = fullScale.invert((MARGIN - tx) / k);
      }
      const clampedMin = Math.max(dynamicMinAge, Math.min(dynamicMaxAge, newMin));
      const clampedMax = Math.max(dynamicMinAge, Math.min(dynamicMaxAge, newMax));
      if (clampedMin < clampedMax) {
        visibleDomainRef.current = [clampedMin, clampedMax];
        setVisibleDomain([clampedMin, clampedMax]);
      }
      // Resize handles are positioned in document coords in dynamic mode (no transform applied)
      setCurrentTransform(d3.zoomIdentity);
      lateralOffsetRef.current = 0;
      setLateralOffset(0);
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

  function handleScroll(e) {
    if (isScrollSyncing.current) return;
    const container = e.currentTarget;
    const svgEl = svgRef.current;
    if (!svgEl) return;

    if (orientation === "vertical") {
      const scrollTop = container.scrollTop;
      const viewH = container.clientHeight;
      const totalH = scrollableSize;
      const scrollRange = totalH - viewH;
      if (scrollRange <= 0) return;

      if (zoomMode === "transform") {
        const k = transformRef.current.k || 1;
        // scrollTop=0 means top of content visible → ty = MARGIN
        // scrollTop=max means bottom of content visible → content bottom at viewH
        const newTy = MARGIN - scrollTop * (k - 1) / (scrollRange / viewH);
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
    } else {
      const scrollLeft = container.scrollLeft;
      const viewW = container.clientWidth;
      const totalW = scrollableSize;
      const scrollRange = totalW - viewW;
      if (scrollRange <= 0) return;

      if (zoomMode === "transform") {
        const k = transformRef.current.k || 1;
        const newTx = MARGIN - scrollLeft;
        const newTransform = d3.zoomIdentity
          .translate(newTx, transformRef.current.y || 0)
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
        // In horizontal mode the oldest content is on the LEFT (scrollLeft=0).
        // scrollLeft increasing → scroll right → view younger content → domain[0] decreases.
        const fraction = scrollLeft / scrollRange;
        const newMin = dynamicMaxAgeRef.current - visibleSpan - fraction * (fullSpan - visibleSpan);
        const newMax = newMin + visibleSpan;
        isScrollSyncing.current = true;
        visibleDomainRef.current = [newMin, newMax];
        setVisibleDomain([newMin, newMax]);
        isScrollSyncing.current = false;
      }
    }
  }

  // Compute scrollableSize based on zoom level / visible domain
  useEffect(() => {
    const containerEl = scrollContainerRef.current;
    if (!containerEl) return;
    const viewSize = orientation === "vertical"
      ? containerEl.clientHeight
      : containerEl.clientWidth;
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
  }, [orientation, zoomMode, currentTransform, visibleDomain, dynamicMinAge, dynamicMaxAge]);

  const [picksMode, setPicksMode] = useState("auto");
// "auto" | "manual"

  const [manualPicksLevel, setManualPicksLevel] = useState(null);
  const [showUncertainty, setShowUncertainty] = useState(false);
  const [picksSigFigs, setPicksSigFigs] = useState(4);

  const [labelMode, setLabelMode] = useState("timescale"); // "timescale" | "stratigraphic"
  const [contrastText, setContrastText] = useState(true);
  const [fontSize, setFontSize] = useState(10);
  const [fontFamily, setFontFamily] = useState("Arial, sans-serif");
  const [labelOrientation, setLabelOrientation] = useState("horizontal"); // "horizontal" | "vertical"

  const [scaleType, setScaleType] = useState("linear"); // "linear" | "log" | "equalSize" | "eraEqual"
  const [equalSizeLevel, setEqualSizeLevel] = useState(3);

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

  const layout = computeLayout(columns, columnWidths, MARGIN);

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
    if (col.id === "picks") return "Picks";
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

    if (orientation === "vertical") {
      const viewH = container.clientHeight;
      const scrollRange = Math.max(0, scrollableSize - viewH);
      if (scrollRange <= 0) return;
      let scrollTop;
      if (zoomMode === "transform") {
        const ty = currentTransform.y || 0;
        scrollTop = Math.max(0, Math.min(scrollRange, MARGIN - ty));
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
    } else {
      const viewW = container.clientWidth;
      const scrollRange = Math.max(0, scrollableSize - viewW);
      if (scrollRange <= 0) return;
      let scrollLeft;
      if (zoomMode === "transform") {
        const tx = currentTransform.x || 0;
        scrollLeft = Math.max(0, Math.min(scrollRange, MARGIN - tx));
      } else {
        const fullSpan = dynamicMaxAge - dynamicMinAge;
        const visibleSpan = Math.max(0.001, visibleDomain[1] - visibleDomain[0]);
        if (fullSpan <= visibleSpan) return;
        // In horizontal mode oldest is on the LEFT (scrollLeft=0). Invert the fraction.
        const fraction = 1 - (visibleDomain[0] - dynamicMinAge) / (fullSpan - visibleSpan);
        scrollLeft = Math.max(0, Math.min(scrollRange, fraction * scrollRange));
      }
      isScrollSyncing.current = true;
      container.scrollLeft = scrollLeft;
      isScrollSyncing.current = false;
    }
  }, [orientation, zoomMode, currentTransform, visibleDomain, scrollableSize, dynamicMinAge, dynamicMaxAge]);

  useEffect(() => {

    const svgElement = svgRef.current;
    while (svgElement.firstChild) {
      svgElement.removeChild(svgElement.firstChild);
    }

    const width = svgElement.clientWidth;
    const height = svgElement.clientHeight;

    const svg = d3.select(svgElement);
    const zoomLayer = svg.append("g");

    if (zoomMode === "transform") {
      zoomLayer.attr("transform", transformRef.current);
    } else {
      const lo = lateralOffsetRef.current;
      zoomLayer.attr("transform", orientation === "vertical"
        ? `translate(${lo}, 0)`
        : `translate(0, ${lo})`);
    }

// ===== Rendering Layers =====
const backgroundLayer = zoomLayer.append("g");
const blockLayer = zoomLayer.append("g");
const picksLayer = zoomLayer.append("g");

const scaleDomain = zoomMode === "dynamic" ? visibleDomain : [dynamicMinAge, dynamicMaxAge];

    const allUnits = effectiveUnits;

const scale = buildScale(
  scaleType,
  scaleDomain,
  orientation === "vertical"
    ? [MARGIN, height - MARGIN]
    : [width - MARGIN, MARGIN],
  allUnits,
  equalSizeLevel
);

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

  // Map age → startUncertainty (deepest-level unit wins; deepest iterated first)
  const boundaryMap = new Map();

  sortedLevels.forEach(level => {

    const unitsAtLevel = allUnits
      .filter(u => u.levelOrder === level)
      .filter(u => u.start !== null)
      .filter(u => isUnitVisible(u.id, hiddenUnits));

    unitsAtLevel.forEach(unit => {

      if (!boundaryMap.has(unit.start)) {
        boundaryMap.set(unit.start, unit.startUncertainty ?? null);
      }

    });

  });

  boundaryMap.forEach((uncertainty, age) => {
    boundaryAges.push({ age, uncertainty });
  });

}

// Always include present day (0 Ma)
if (!boundaryAges.some(b => b.age === 0)) {
  boundaryAges.push({ age: 0, uncertainty: null });
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

if (orientation === "vertical") {
  timeBackground.setAttribute("x", timeColumn.start);
  timeBackground.setAttribute("y", MARGIN);
  timeBackground.setAttribute("width", timeColumn.width);
  timeBackground.setAttribute("height", height - 2 * MARGIN);
} else {
  timeBackground.setAttribute("x", MARGIN);
  timeBackground.setAttribute("y", timeColumn.start);
  timeBackground.setAttribute("width", width - 2 * MARGIN);
  timeBackground.setAttribute("height", timeColumn.width);
}

timeBackground.setAttribute("fill", "white");
timeBackground.setAttribute("stroke", "none");

backgroundLayer.node().appendChild(timeBackground);


// Tick labels
// ===== Time Axis Ticks =====

const tickValues = scale.ticks(40);
const visSpan = scaleDomain[1] - scaleDomain[0];
const tickStep = scaleType === "linear"
  ? (tickValues.length > 1 ? tickValues[1] - tickValues[0] : 1)
  : Math.max(1, visSpan / 20); // For non-linear: base decimals on visible span
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
  tick.setAttribute("data-base-stroke", "1");

  backgroundLayer.node().appendChild(tick);

  // Label only major ticks
  if (isMajor) {

    const label = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "text"
    );

    label.setAttribute("dominant-baseline", "middle");
    if (orientation === "vertical") {
      label.setAttribute("x", timeColumn.end - majorLength - 4);
      label.setAttribute("y", pos);
      label.setAttribute("text-anchor", "end");
    } else {
      label.setAttribute("x", pos);
      label.setAttribute("y", timeColumn.end - majorLength - 4);
      label.setAttribute("text-anchor", "middle");
    }

    label.setAttribute("font-size", fontSize);
    label.setAttribute("data-base-font-size", fontSize);
    label.setAttribute("font-family", fontFamily);
    label.textContent = formatTickLabel(age, tickStep, timeUnit);

    backgroundLayer.node().appendChild(label);
  }

});

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

    // ===== Vertical geometry from scale =====

    const pos1 = scale(unit.start);
    const pos2 = scale(unit.end);

    const blockY = orientation === "vertical"
      ? Math.min(pos1, pos2)
      : colBandStart;

    const blockWidth = orientation === "vertical"
      ? colBandWidth
      : Math.abs(pos2 - pos1);

    const blockHeight = orientation === "vertical"
      ? Math.abs(pos2 - pos1)
      : colBandWidth;

    // Skip blocks entirely outside the viewport — prevents SVG coordinate
    // overflow issues at extreme zoom levels.
    if (orientation === "vertical") {
      if (Math.min(pos1, pos2) > height || Math.max(pos1, pos2) < 0) return;
    } else {
      if (Math.min(pos1, pos2) > width || Math.max(pos1, pos2) < 0) return;
    }

    resolvedBlocks.push({
      x: orientation === "vertical" ? colBandStart : Math.min(pos1, pos2),
      y: blockY,
      width: blockWidth,
      height: blockHeight,
      fill: unit.icsColor || "#ccc",
      label: (() => {
        const ts = unit.displayName;
        const st = unit.displayNameStratigraphic;
        if (labelMode === "stratigraphic") return st || ts;
        if (labelMode === "both" && st)    return `${ts} / ${st}`;
        return ts;
      })(),
      labelX: orientation === "vertical"
        ? labelColStart + labelColWidth / 2
        : Math.min(pos1, pos2) + Math.abs(pos2 - pos1) / 2,
      labelY: orientation === "vertical"
        ? blockY + Math.abs(pos2 - pos1) / 2
        : labelColStart + labelColWidth / 2
    });

  });

});

renderBlocks({
  svg: blockLayer.node(),
  blocks: resolvedBlocks,
  fontSize,
  fontFamily,
  labelOrientation,
  contrastText
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
    height,
    margin: MARGIN,
    showUncertainty,
    picksSigFigs
  });
}


  }, [orientation, columnConfig, columnWidths, picksMode, manualPicksLevel, zoomMode, visibleDomain, timeUnit, lateralOffset, showUncertainty, picksSigFigs, labelMode, contrastText, fontSize, fontFamily, labelOrientation, scaleType, equalSizeLevel, hiddenUnits, dynamicMinAge, dynamicMaxAge, unitEdits]);

  // Re-apply counter-scale after the render effect rebuilds the SVG (transform mode only).
  // MUST be declared after the render effect so React runs it second.
  useEffect(() => {
    if (zoomMode !== "transform") return;
    const k = transformRef.current.k;
    if (k === 1) return;
    const svg = d3.select(svgRef.current);
    const zoomLayerG = svg.select("g");
    zoomLayerG.selectAll("text").each(function() {
      const base = parseFloat(this.getAttribute("data-base-font-size") || "10");
      this.setAttribute("font-size", base / k);
    });
    zoomLayerG.selectAll("[data-base-stroke]").each(function() {
      const base = parseFloat(this.getAttribute("data-base-stroke") || "0.5");
      this.setAttribute("stroke-width", base / k);
    });
  }, [orientation, columnConfig, columnWidths, picksMode, manualPicksLevel, zoomMode, visibleDomain, timeUnit, lateralOffset, showUncertainty, picksSigFigs, labelMode, contrastText, fontSize, fontFamily, labelOrientation, scaleType, equalSizeLevel, hiddenUnits, dynamicMinAge, dynamicMaxAge, unitEdits]);

  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement) return;
    const svg = d3.select(svgElement);
    const svgWidth = svgElement.clientWidth;
    const svgHeight = svgElement.clientHeight;

    const onContextMenu = (e) => e.preventDefault();
    svgElement.addEventListener("contextmenu", onContextMenu);

    // Helper: apply counter-scaling so text and strokes stay constant screen size.
    // Scoped to the zoomLayer (first <g>) only — header layer is outside and must not scale.
    function applyCounterScale(k) {
      const zoomLayerG = svg.select("g");
      zoomLayerG.selectAll("text").each(function() {
        const base = parseFloat(this.getAttribute("data-base-font-size") || "10");
        this.setAttribute("font-size", base / k);
      });
      zoomLayerG.selectAll("[data-base-stroke]").each(function() {
        const base = parseFloat(this.getAttribute("data-base-stroke") || "0.5");
        this.setAttribute("stroke-width", base / k);
      });
    }

    if (zoomMode === "transform") {
      // ===== TRANSFORM MODE: D3 zoom handles pan + wheel =====
      const zoom = d3.zoom()
        .scaleExtent([0.1, 1e8])
        .translateExtent([[-Infinity, -Infinity], [Infinity, Infinity]])
        .filter(event => {
          if (event.type === "dblclick") return false;
          return event.type === "wheel" || event.button === 0;
        })
        .on("zoom", (event) => {
          transformRef.current = event.transform;
          svg.select("g").attr("transform", event.transform);
          setCurrentTransform(event.transform);
          applyCounterScale(event.transform.k);
        });

      const onKeyDown = (event) => {
        if (!event.ctrlKey) return;
        const isZoomIn  = event.key === "+" || event.key === "=";
        const isZoomOut = event.key === "-";
        if (!isZoomIn && !isZoomOut) return;
        event.preventDefault();
        const factor = isZoomIn ? 1.5 : 1 / 1.5;
        svg.call(zoom.scaleBy, factor, [svgWidth / 2, svgHeight / 2]);
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
      // ===== DYNAMIC MODE: D3 for wheel zoom, raw mouse events for pan =====
      let isResetting = false;

      const zoom = d3.zoom()
        .scaleExtent([0.1, 1e8])
        .translateExtent([[-Infinity, -Infinity], [Infinity, Infinity]])
        .filter(event => event.type === "wheel")
        .on("zoom", (event) => {
          if (isResetting) return;
          const { k, x: tx, y: ty } = event.transform;
          const [refMin, refMax] = visibleDomainRef.current;
          const refScale = d3.scaleLinear()
            .domain([refMin, refMax])
            .range(orientation === "vertical"
              ? [MARGIN, svgHeight - MARGIN]
              : [svgWidth - MARGIN, MARGIN]);
          let newMin, newMax;
          if (orientation === "vertical") {
            newMin = refScale.invert((MARGIN - ty) / k);
            newMax = refScale.invert((svgHeight - MARGIN - ty) / k);
          } else {
            newMin = refScale.invert((svgWidth - MARGIN - tx) / k);
            newMax = refScale.invert((MARGIN - tx) / k);
          }
          const clampedMin = Math.max(dynamicMinAgeRef.current, newMin);
          const clampedMax = Math.min(dynamicMaxAgeRef.current, newMax);
          if (clampedMin < clampedMax) {
            visibleDomainRef.current = [clampedMin, clampedMax];
            setVisibleDomain([clampedMin, clampedMax]);
          }
          isResetting = true;
          svg.call(zoom.transform, d3.zoomIdentity);
          isResetting = false;
        });

      svg.call(zoom);
      zoomBehaviorRef.current = zoom;

      // Pan: track raw mouse displacement from mousedown, apply to frozen start domain
      let pan = null; // { startX, startY, domain, lateral }

      const onMouseDown = (e) => {
        if (e.button !== 0) return;
        e.preventDefault(); // prevent text selection during drag
        pan = {
          startX: e.clientX,
          startY: e.clientY,
          domain: [...visibleDomainRef.current],
          lateral: lateralOffsetRef.current
        };
        svgElement.style.cursor = "grabbing";
      };

      const onMouseMove = (e) => {
        if (!pan) return;
        const dx = e.clientX - pan.startX;
        const dy = e.clientY - pan.startY;

        // Axial pan (along the time axis)
        const d = orientation === "vertical" ? dy : dx;
        const [refMin, refMax] = pan.domain;
        const refScale = d3.scaleLinear()
          .domain([refMin, refMax])
          .range(orientation === "vertical"
            ? [MARGIN, svgHeight - MARGIN]
            : [svgWidth - MARGIN, MARGIN]);
        const newMin = orientation === "vertical"
          ? refScale.invert(MARGIN - d)
          : refScale.invert(svgWidth - MARGIN - d);
        // Clamp while preserving span so pan never changes zoom level
        const span = refMax - refMin;
        let clampedMin = Math.max(dynamicMinAgeRef.current, newMin);
        let clampedMax = clampedMin + span;
        if (clampedMax > dynamicMaxAgeRef.current) {
          clampedMax = dynamicMaxAgeRef.current;
          clampedMin = Math.max(dynamicMinAgeRef.current, dynamicMaxAgeRef.current - span);
        }
        if (clampedMin < clampedMax) {
          visibleDomainRef.current = [clampedMin, clampedMax];
          setVisibleDomain([clampedMin, clampedMax]);
        }

        // Lateral pan (perpendicular to time axis) — direct DOM for smooth feedback
        const lateralD = orientation === "vertical" ? dx : dy;
        const newLateral = pan.lateral + lateralD;
        lateralOffsetRef.current = newLateral;
        svg.select("g").attr("transform", orientation === "vertical"
          ? `translate(${newLateral}, 0)`
          : `translate(0, ${newLateral})`);
        setLateralOffset(newLateral);
      };

      const onMouseUp = () => {
        pan = null;
        svgElement.style.cursor = "grab";
      };

      const onKeyDown = (event) => {
        if (!event.ctrlKey) return;
        const isZoomIn  = event.key === "+" || event.key === "=";
        const isZoomOut = event.key === "-";
        if (!isZoomIn && !isZoomOut) return;
        event.preventDefault();
        const factor = isZoomIn ? 1.5 : 1 / 1.5;
        svg.call(zoom.scaleBy, factor, [svgWidth / 2, svgHeight / 2]);
      };

      svgElement.addEventListener("mousedown", onMouseDown);
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
      window.addEventListener("keydown", onKeyDown);

      return () => {
        svg.on(".zoom", null);
        svgElement.removeEventListener("contextmenu", onContextMenu);
        svgElement.removeEventListener("mousedown", onMouseDown);
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        window.removeEventListener("keydown", onKeyDown);
      };
    }
  }, [orientation, columnConfig, columnWidths, picksMode, manualPicksLevel, zoomMode]);

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
        {["View", "Columns", "Picks", "Display", "Filter", "Data", "Export"].map(tab => (
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
        {activeTab === "View" && (
          <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>
            <button onClick={() =>
              setOrientation(o =>
                o === "vertical" ? "horizontal" : "vertical"
              )
            }>
              Orientation
            </button>

            <strong>Zoom Mode:</strong>
            <label>
              <input
                type="radio"
                name="zoomMode"
                value="transform"
                checked={zoomMode === "transform"}
                onChange={() => handleSwitchZoomMode("transform")}
              />
              Transform
            </label>
            <label>
              <input
                type="radio"
                name="zoomMode"
                value="dynamic"
                checked={zoomMode === "dynamic"}
                onChange={() => handleSwitchZoomMode("dynamic")}
              />
              Dynamic
            </label>

            <button onClick={handleResetZoom}>Reset Zoom</button>

            <strong>Time Units:</strong>
            {["Ga", "Ma", "ka"].map(unit => (
              <label key={unit}>
                <input
                  type="radio"
                  name="timeUnit"
                  value={unit}
                  checked={timeUnit === unit}
                  onChange={() => setTimeUnit(unit)}
                />
                {unit}
              </label>
            ))}
          </div>
        )}

        {activeTab === "Columns" && (
          <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>
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

            <label>
              <input
                type="checkbox"
                checked={showUncertainty}
                onChange={e => setShowUncertainty(e.target.checked)}
              />
              Show uncertainty
            </label>

            <label>
              Significant figures:
              <select
                value={picksSigFigs}
                onChange={e => setPicksSigFigs(Number(e.target.value))}
                style={{ marginLeft: 6 }}
              >
                {[3, 4, 5, 6].map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>

          </div>
        )}

        {activeTab === "Display" && (
          <div style={{ display: "flex", gap: "20px", alignItems: "center", flexWrap: "wrap" }}>
            <strong>Text:</strong>
            <label>
              Size:
              <input
                type="range"
                min="6"
                max="16"
                value={fontSize}
                onChange={e => setFontSize(Number(e.target.value))}
                style={{ marginLeft: 6 }}
              />
              {fontSize}px
            </label>
            <label>
              Font:
              <select
                value={fontFamily}
                onChange={e => setFontFamily(e.target.value)}
                style={{ marginLeft: 6 }}
              >
                <option value="Arial, sans-serif">Arial</option>
                <option value="'Times New Roman', serif">Times New Roman</option>
                <option value="'Courier New', monospace">Courier New</option>
                <option value="Georgia, serif">Georgia</option>
                <option value="Verdana, sans-serif">Verdana</option>
              </select>
            </label>
            <strong>Labels:</strong>
            <label>
              <input
                type="radio"
                name="labelOrientation"
                value="horizontal"
                checked={labelOrientation === "horizontal"}
                onChange={() => setLabelOrientation("horizontal")}
              />
              Horizontal
            </label>
            <label>
              <input
                type="radio"
                name="labelOrientation"
                value="vertical"
                checked={labelOrientation === "vertical"}
                onChange={() => setLabelOrientation("vertical")}
              />
              Vertical
            </label>
            <label>
              <input
                type="checkbox"
                checked={contrastText}
                onChange={e => setContrastText(e.target.checked)}
              />
              {" "}Auto text contrast
            </label>
            <strong>Naming:</strong>
            {[
              { value: "timescale",    label: "Timescale" },
              { value: "stratigraphic",label: "Stratigraphic" },
              { value: "both",         label: "Both" }
            ].map(opt => (
              <label key={opt.value}>
                <input
                  type="radio"
                  name="labelMode"
                  value={opt.value}
                  checked={labelMode === opt.value}
                  onChange={() => setLabelMode(opt.value)}
                />
                {opt.label}
              </label>
            ))}
            <strong>Scale:</strong>
            {[
              { value: "linear",    label: "Linear" },
              { value: "log",       label: "Logarithmic" },
              { value: "equalSize", label: "Equal Size" },
              { value: "eraEqual",  label: "Era Equal" }
            ].map(opt => (
              <label key={opt.value}>
                <input
                  type="radio"
                  name="scaleType"
                  value={opt.value}
                  checked={scaleType === opt.value}
                  onChange={() => setScaleType(opt.value)}
                />
                {opt.label}
              </label>
            ))}
            {scaleType === "equalSize" && (
              <select
                value={equalSizeLevel}
                onChange={e => setEqualSizeLevel(Number(e.target.value))}
              >
                {columnConfig.map(col => (
                  <option key={col.level} value={col.level}>{col.label}</option>
                ))}
              </select>
            )}
          </div>
        )}

        {activeTab === "Filter" && (() => {
          // Recursive tree renderer — shows all non-stage units with toggle checkboxes
          function renderUnitTree(parentId, depth) {
            const children = effectiveUnits
              .filter(u => u.parent === parentId && u.levelOrder < 6 && u.start !== null)
              .sort((a, b) => b.start - a.start); // oldest first
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
            <div style={{ padding: "6px 10px", fontSize: 11, overflowY: "auto", maxHeight: 260, minWidth: 220 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <strong style={{ fontSize: 12 }}>Show / Hide Units</strong>
                <button onClick={() => setHiddenUnits(new Set())} style={{ fontSize: 10, padding: "1px 6px" }}>Show All</button>
              </div>
              {renderUnitTree(null, 0)}
            </div>
          );
        })()}

        {activeTab === "Data" && (
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <button
              onClick={() => setShowDataEditor(v => !v)}
              style={{ padding: "4px 12px", fontWeight: showDataEditor ? "bold" : "normal", background: showDataEditor ? "#ddd" : "#fff", border: "1px solid #aaa", cursor: "pointer" }}
            >
              {showDataEditor ? "Close Data Editor" : "Open Data Editor"}
            </button>
            {Object.keys(unitEdits).length > 0 && (
              <button onClick={() => setUnitEdits({})} style={{ padding: "4px 10px", color: "red", border: "1px solid #faa", cursor: "pointer" }}>
                Reset All Edits ({Object.keys(unitEdits).length})
              </button>
            )}
          </div>
        )}

        {activeTab === "Export" && (
          <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>
          </div>
        )}
      </div>

      {/* Main area: visualization + optional data editor sidebar */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

      {/* Visualization Area — scroll container */}
      <div
        ref={scrollContainerRef}
        style={{
          flex: 1,
          position: "relative",
          overflowY: orientation === "vertical" ? "scroll" : "hidden",
          overflowX: orientation === "horizontal" ? "scroll" : "hidden"
        }}
        onScroll={handleScroll}
      >
        {/* Spacer establishes the scrollable extent */}
        <div style={{
          height: orientation === "vertical" ? scrollableSize : "100%",
          width: orientation === "horizontal" ? scrollableSize : "100%",
          minHeight: orientation === "vertical" ? "100%" : undefined,
          minWidth: orientation === "horizontal" ? "100%" : undefined,
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
            <svg
              ref={svgRef}
              width="100%"
              height="100%"
              style={{ background: "white", cursor: "grab", pointerEvents: "auto" }}
            />

            {/* Column Headers */}
            {(() => {
              const k = zoomMode === "dynamic" ? 1 : (currentTransform.k || 1);
              const tx = zoomMode === "dynamic"
                ? (orientation === "vertical" ? lateralOffset : 0)
                : (currentTransform.x || 0);
              const ty = zoomMode === "dynamic"
                ? (orientation === "vertical" ? 0 : lateralOffset)
                : (currentTransform.y || 0);
              return (
                <div style={{
                  position: "absolute",
                  top: orientation === "vertical" ? 0 : undefined,
                  left: orientation === "vertical" ? undefined : 0,
                  right: orientation === "vertical" ? undefined : 0,
                  bottom: orientation === "vertical" ? undefined : 0,
                  [orientation === "vertical" ? "left" : "top"]: 0,
                  [orientation === "vertical" ? "right" : "bottom"]: 0,
                  [orientation === "vertical" ? "height" : "width"]: MARGIN,
                  pointerEvents: "none",
                  zIndex: 10,
                  background: "white",
                  [orientation === "vertical" ? "borderBottom" : "borderRight"]: "1px solid black",
                  overflow: "hidden"
                }}>
                  {layout.map(col => {
                    if (orientation === "vertical") {
                      return (
                        <div key={col.id} style={{
                          position: "absolute",
                          left: col.start * k + tx,
                          width: col.width * k,
                          top: 0,
                          height: MARGIN,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 11,
                          fontWeight: "bold",
                          overflow: "hidden",
                          whiteSpace: "nowrap"
                        }}>{getColDisplayName(col)}</div>
                      );
                    } else {
                      return (
                        <div key={col.id} style={{
                          position: "absolute",
                          top: col.start * k + ty,
                          height: col.width * k,
                          left: 0,
                          width: MARGIN,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 11,
                          fontWeight: "bold",
                          writingMode: "vertical-rl",
                          transform: "rotate(180deg)",
                          overflow: "hidden",
                          whiteSpace: "nowrap"
                        }}>{getColDisplayName(col)}</div>
                      );
                    }
                  })}
                </div>
              );
            })()}

            {/* Resize Handles */}
            {layout.map(col => {

              const k = zoomMode === "dynamic" ? 1 : (currentTransform.k || 1);
              const tx = zoomMode === "dynamic"
                ? (orientation === "vertical" ? lateralOffset : 0)
                : (currentTransform.x || 0);
              const ty = zoomMode === "dynamic"
                ? (orientation === "vertical" ? 0 : lateralOffset)
                : (currentTransform.y || 0);

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
              }

              // Horizontal orientation
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
                    zIndex: 15,
                    pointerEvents: "auto"
                  }}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    setColumnWidths(prev => ({ ...prev, [col.id]: autoFitColumnWidth(col) }));
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    const startY = e.clientY;
                    const startHeight = col.width;
                    const onMouseMove = (moveEvent) => {
                      const delta = (moveEvent.clientY - startY) / k;
                      const newHeight = Math.max(20, startHeight + delta);
                      setColumnWidths(prev => ({ ...prev, [col.id]: newHeight }));
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

        const thStyle = (key) => ({
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

      </div>
    </div>
  );
}

export default App;