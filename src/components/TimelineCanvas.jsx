import { useEffect } from "react";

import { computeFitAndWrap } from "../renderers/BlockRenderer";
import {
  clampDomain,
  computeLayout,
  formatTickLabel,
  makeScale,
  zoomToFocal,
} from "../lib/scale.js";
import { UNIT_MAP, isUnitVisible } from "../lib/units.js";
import { buildEffectiveExtents } from "../lib/cropEdges.js";

const MARGIN = 14;

const WAVE_AMP    = 7;
const WAVE_PERIOD = 16;

function buildWaveSegments(x, y, width, amp, period) {
  const half = period / 2;
  const segs = [];
  let cx = x, flip = 1;
  while (cx < x + width) {
    const ex = Math.min(cx + half, x + width);
    segs.push({ cpx: (cx + ex) / 2, cpy: y - amp * flip, ex });
    cx = ex; flip = -flip;
  }
  return segs;
}

function buildWaveSegmentsRTL(x, y, width, amp, period) {
  const half = period / 2;
  const N = Math.ceil(width / half);
  const segs = [];
  let cx = x + width;
  let flip = (N % 2 === 0) ? -1 : 1;
  while (cx > x) {
    const ex = Math.max(cx - half, x);
    segs.push({ cpx: (cx + ex) / 2, cpy: y - amp * flip, ex });
    cx = ex; flip = -flip;
  }
  return segs;
}

export default function TimelineCanvas({
  canvasRef, hitBoxesRef, rafHandleRef,
  visibleDomainRef, lateralOffsetRef,
  dynamicMinAgeRef, dynamicMaxAgeRef,
  clampMinAgeRef, clampMaxAgeRef,
  effectiveMarginRef, scrollContainerRef,
  effectiveUnits, hiddenUnits, columnConfig, effectiveColumnWidths,
  scaleType, equalSizeLevel,
  fontSize, fontFamily, labelOrientation, contrastText, fontBold, fontItalic, fontRules,
  labelMode, picksMode, manualPicksLevel, showUncertainty, picksSigFigs, timeUnit, showGSSP,
  setVisibleDomain, setLateralOffset, setHoverUnit, setTooltipPos,
}) {
  // ── Canvas rAF loop: drawFrame defined inline so refs aren't treated as reactive deps ──
  // Dirty-flag pattern: each tick compares current input snapshot to last-drawn snapshot
  // and skips the draw if nothing changed. Effect re-creation (on dep change) starts with
  // a fresh closure → last.vMin === null forces a redraw. Saves ~60fps of idle CPU burn.
  useEffect(() => {
    const last = { vMin: null, vMax: null, lateral: null, cssW: null, viewH: null, eM: null };

    const drawFrame = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      const viewH = scrollContainerRef.current?.clientHeight ?? cssH;

      const [vMin, vMax] = visibleDomainRef.current;
      const lateral = lateralOffsetRef.current;
      const eM = effectiveMarginRef.current;
      if (last.vMin === vMin && last.vMax === vMax && last.lateral === lateral &&
          last.cssW === cssW && last.viewH === viewH && last.eM === eM) {
        return; // nothing changed since last draw
      }
      last.vMin = vMin; last.vMax = vMax; last.lateral = lateral;
      last.cssW = cssW; last.viewH = viewH; last.eM = eM;

      const needsResize = canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(viewH * dpr);
      if (needsResize) {
        canvas.width  = Math.round(cssW * dpr);
        canvas.height = Math.round(viewH * dpr);
      }

      ctx.restore();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, viewH);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, cssW, viewH);
      ctx.clip();

      const hitBoxes = [];

      const allUnits   = effectiveUnits;
      const visibleSet = new Set(allUnits.filter(u => u.start !== null && isUnitVisible(u.id, hiddenUnits)).map(u => u.id));
      const visLevels = columnConfig.filter(c => c.visible).map(c => c.level).sort((a, b) => a - b);
      const effectiveExtents = buildEffectiveExtents(allUnits, visibleSet, visLevels);
      const cols = [
        { id: "time", type: "time" },
        ...visLevels.map(lv => ({ id: lv, type: "hierarchy", level: lv })),
        { id: "picks", type: "picks" },
      ];
      const frameLayout = computeLayout(cols, effectiveColumnWidths, MARGIN);

      const { toY: scale } = makeScale({
        scaleType,
        vMin, vMax,
        fullMin: dynamicMinAgeRef.current, fullMax: dynamicMaxAgeRef.current,
        eM, viewH,
        units: allUnits, equalSizeLevel,
      });

      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, cssW, viewH);

      const contrastColor = (hex) => {
        if (!hex || hex.length < 7) return "black";
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luma > 0.65 ? "black" : "white";
      };

      const collectedBlocks = [];
      const waveEdges = [];

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

          const ext = effectiveExtents.get(unit.id);
          const effectiveStart = ext ? ext.effectiveStart : unit.start;
          const effectiveEnd   = ext ? ext.effectiveEnd   : unit.end;
          const waveTop        = ext ? ext.waveTop        : false;
          const waveBottom     = ext ? ext.waveBottom     : false;
          const y1 = scale(effectiveStart);
          const y2 = scale(effectiveEnd);
          const y  = Math.min(y1, y2);
          const h  = Math.abs(y2 - y1);

          if (y > viewH || y + h < 0) return;

          const matchingRule = fontRules.find(r =>
            unit.start !== null && unit.start <= r.maxAge && (unit.end ?? 0) >= r.minAge
          );
          const blockFontSize = matchingRule?.fontSize ?? colConf?.fontSize ?? fontSize;
          const leftmostHierarchyStart = frameLayout.find(col => col.id !== "time" && col.id !== "picks")?.start ?? x;
          const orientWidth = !hasVisibleParent
            ? (spanColumns[spanColumns.length - 1].end - leftmostHierarchyStart)
            : w;
          const labelText = (() => {
            const ts = unit.displayName;
            const st = unit.displayNameStratigraphic;
            if (labelMode === "stratigraphic") return st || ts;
            if (labelMode === "both" && st) return `${ts} / ${st}`;
            return ts;
          })();

          collectedBlocks.push({
            unit, x, w, y, h, waveTop, waveBottom,
            colConf, hasVisibleParent, orientWidth,
            labelText, blockFontSize,
          });
          if (waveTop)    waveEdges.push({ x, w, y,       side: 'top' });
          if (waveBottom) waveEdges.push({ x, w, y: y + h, side: 'bottom' });
        });
      });

      // ── Compute wave groups and fill-origin map ──
      const waveGroups = new Map();
      for (const e of waveEdges) {
        const key = e.y.toFixed(1);
        if (!waveGroups.has(key)) waveGroups.set(key, { y: e.y, minX: e.x, maxX: e.x + e.w });
        else {
          const g = waveGroups.get(key);
          g.minX = Math.min(g.minX, e.x);
          g.maxX = Math.max(g.maxX, e.x + e.w);
        }
      }
      const waveOriginByBlock = new Map();
      for (const e of waveEdges) {
        const group = waveGroups.get(e.y.toFixed(1));
        if (e.side === 'top')
          waveOriginByBlock.set(`top,${e.x.toFixed(1)},${e.y.toFixed(1)}`, group.minX);
        else
          waveOriginByBlock.set(`bot,${e.x.toFixed(1)},${e.y.toFixed(1)}`, group.minX);
      }

      // ── Draw collected blocks ──
      for (const b of collectedBlocks) {
        const { unit, x, w, y, h, waveTop, waveBottom } = b;

        hitBoxes.push({ id: unit.id, x, y, w, h });

        if (!waveTop && !waveBottom) {
          ctx.fillStyle = unit.icsColor || "#cccccc";
          ctx.fillRect(x, y, w, h);
          ctx.strokeStyle = "rgba(0,0,0,0.4)";
          ctx.lineWidth = 0.5;
          ctx.strokeRect(x, y, w, h);
        } else {
          // White background
          ctx.fillStyle = "white";
          ctx.fillRect(x, y, w, h);

          // Colored fill — wave origin from group minX so it matches the stroke
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, w, h);
          ctx.clip();

          ctx.fillStyle = unit.icsColor || "#cccccc";
          ctx.beginPath();

          if (waveTop) {
            const originX = waveOriginByBlock.get(`top,${x.toFixed(1)},${y.toFixed(1)}`) ?? x;
            const segs = buildWaveSegments(originX, y, (x + w) - originX, WAVE_AMP, WAVE_PERIOD);
            ctx.moveTo(originX, y);
            segs.forEach(s => ctx.quadraticCurveTo(s.cpx, s.cpy, s.ex, y));
          } else {
            ctx.moveTo(x, y);
            ctx.lineTo(x + w, y);
          }

          ctx.lineTo(x + w, y + h);

          if (waveBottom) {
            const originX = waveOriginByBlock.get(`bot,${x.toFixed(1)},${(y + h).toFixed(1)}`) ?? x;
            const segs = buildWaveSegmentsRTL(originX, y + h, (x + w) - originX, WAVE_AMP, WAVE_PERIOD);
            segs.forEach(s => ctx.quadraticCurveTo(s.cpx, s.cpy, s.ex, y + h));
          } else {
            ctx.lineTo(x, y + h);
          }

          ctx.closePath();
          ctx.fill();
          ctx.restore();

          // Straight borders on non-waved edges
          ctx.strokeStyle = "rgba(0,0,0,0.4)";
          ctx.lineWidth = 0.5;
          ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + h); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.stroke();
          if (!waveTop)    { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.stroke(); }
          if (!waveBottom) { ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + w, y + h); ctx.stroke(); }
        }

        // Label
        const words = (b.labelText || "").trim().split(/\s+/).filter(Boolean);
        if (!words.length) continue;

        const blockOrient = b.colConf?.orientation ?? "auto";
        const resolvedOrient = blockOrient === "auto"
          ? (b.orientWidth >= h ? "horizontal" : "vertical")
          : blockOrient;

        const [fitW, fitH] = resolvedOrient === "vertical" ? [h, w] : [w, h];
        const fitWords = resolvedOrient === "vertical" ? [words.join(" ")] : words;

        const { lines, fitSize } = computeFitAndWrap(fitWords, fitW, fitH, fontFamily, b.blockFontSize, 5);

        const fontPrefix = `${fontBold ? "bold " : ""}${fontItalic ? "italic " : ""}`;
        ctx.font = `${fontPrefix}${fitSize}px ${fontFamily}`;
        ctx.fillStyle = contrastText ? contrastColor(unit.icsColor) : "black";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const cx = x + w / 2;
        const cy = y + h / 2;

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

        ctx.restore();
      }

      // ── Wave stroke post-pass ──
      // Draws each group as a single continuous path spanning all adjacent cropped columns.
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = 1.5;
      ctx.lineCap = "round";
      ctx.setLineDash([]);
      for (const { y: wy, minX, maxX } of waveGroups.values()) {
        const segs = buildWaveSegments(minX, wy, maxX - minX, WAVE_AMP, WAVE_PERIOD);
        ctx.beginPath();
        ctx.moveTo(minX, wy);
        segs.forEach(s => ctx.quadraticCurveTo(s.cpx, s.cpy, s.ex, wy));
        ctx.stroke();
      }
      ctx.lineCap = "butt";

      // ── Time axis ──
      const timeColumn = frameLayout.find(col => col.id === "time");
      if (timeColumn) {
        ctx.fillStyle = "white";
        ctx.fillRect(timeColumn.start + lateral, eM, timeColumn.width, viewH - eM);

        const unitTopY    = scale(dynamicMinAgeRef.current);
        const unitBottomY = scale(dynamicMaxAgeRef.current);
        {
          const tickSpan = vMax - vMin;
          const targetLabels = Math.max(4, Math.floor((viewH - eM) / (fontSize * 5)));
          const rawStep = tickSpan / targetLabels;

          const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
          const normalized = rawStep / magnitude;
          let niceStep;
          if      (normalized < 1.5)  niceStep = 1    * magnitude;
          else if (normalized < 2.25) niceStep = 2    * magnitude;
          else if (normalized < 3.5)  niceStep = 2.5  * magnitude;
          else if (normalized < 7.5)  niceStep = 5    * magnitude;
          else                        niceStep = 10   * magnitude;

          const tickStep = niceStep;

          const firstMajor = Math.ceil(vMin / niceStep) * niceStep;
          const majorTicks = [];
          for (let age = firstMajor; age <= vMax; age += niceStep) {
            majorTicks.push(Math.round(age / niceStep) * niceStep);
          }

          const minorStep = niceStep / 5;
          const firstMinor = Math.ceil(vMin / minorStep) * minorStep;
          const minorTicks = [];
          for (let age = firstMinor; age <= vMax; age += minorStep) {
            const snapped = Math.round(age / minorStep) * minorStep;
            if (Math.abs(snapped / niceStep - Math.round(snapped / niceStep)) < 1e-9) continue;
            minorTicks.push(snapped);
          }

          ctx.strokeStyle = "black";
          ctx.lineWidth = 0.7;
          minorTicks.forEach(age => {
            const pos = scale(age);
            if (pos < unitTopY - 0.5 || pos > unitBottomY + 0.5) return;
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
            if (pos < unitTopY - 0.5 || pos > unitBottomY + 0.5) return;
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
          boundaryMap.forEach(({ uncertainty, approximate }, age) => {
            boundaryAges.push({ age, uncertainty, approximate });
          });
        }

        const _dynMin = dynamicMinAgeRef.current;
        if (!boundaryAges.some(b => b.age === _dynMin)) {
          boundaryAges.push({ age: _dynMin, uncertainty: null, approximate: false });
        }
        const _seen = new Set();
        boundaryAges = boundaryAges
          .filter(b => { if (_seen.has(b.age)) return false; _seen.add(b.age); return true; })
          .sort((a, b) => a.age - b.age);

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
          if (pos < eM - 2 || pos > viewH + 2) return;

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

        ctx.fillStyle = "#DAA520";
        allUnits
          .filter(u => u.ratifiedGSSP === true && u.start !== null && isUnitVisible(u.id, hiddenUnits))
          .forEach(unit => {
            const pos = scale(unit.start);
            if (pos < eM - 2 || pos > viewH + 2) return;
            ctx.fillText("\u25B6", markerX, pos);
          });

        ctx.fillStyle = "#4169E1";
        allUnits
          .filter(u => u.ratifiedGSSA === true && u.start !== null && isUnitVisible(u.id, hiddenUnits))
          .forEach(unit => {
            const pos = scale(unit.start);
            if (pos < eM - 2 || pos > viewH + 2) return;
            ctx.fillText("\u23F1", markerX + 12, pos);
          });
      }

      ctx.restore();
      hitBoxesRef.current = hitBoxes;
    };

    let raf;
    const tick = () => {
      drawFrame();
      raf = requestAnimationFrame(tick);
      rafHandleRef.current = raf;
    };
    raf = requestAnimationFrame(tick);
    rafHandleRef.current = raf;
    return () => cancelAnimationFrame(raf);
  }, [effectiveUnits, hiddenUnits, columnConfig, effectiveColumnWidths, scaleType, equalSizeLevel, fontSize, fontFamily, labelOrientation, contrastText, fontBold, fontItalic, fontRules, labelMode, picksMode, manualPicksLevel, showUncertainty, picksSigFigs, timeUnit, showGSSP]); // eslint-disable-line react-hooks/exhaustive-deps

  // Event wiring: wheel zoom/pan, click-drag pan, keyboard
  useEffect(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;

    let rafId = null;

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
        const cursorY  = (e.offsetY != null) ? e.offsetY : (e.clientY - canvasEl.getBoundingClientRect().top);
        // Use the padded clamp extent so zoom-out can reveal the 10%
        // headroom beyond the data bounds, matching pan clamp behavior.
        const fullMin  = clampMinAgeRef.current;
        const fullMax  = clampMaxAgeRef.current;
        const fullSpan = fullMax - fullMin;
        const speedScale = Math.pow(span / fullSpan, 0.2);
        const zoomFactor = Math.pow(2, zoomDelta * 0.003 * speedScale);

        const [newMin, newMax] = zoomToFocal({
          scaleType,
          vMin: refMin, vMax: refMax,
          fullMin, fullMax,
          eM, viewH: h,
          units: effectiveUnits,
          equalSizeLevel,
          cursorY, zoomFactor,
        });

        if (newMin < newMax) {
          commitDomain(newMin, newMax);
        }
      } else {
        const viewportPx = Math.max(1, h - eM);
        const shift = panDelta * (span / viewportPx);
        const [newMin, newMax] = clampDomain(
          refMin + shift, refMax + shift,
          clampMinAgeRef.current, clampMaxAgeRef.current,
        );
        commitDomain(newMin, newMax);
      }
    };

    canvasEl.addEventListener("wheel", onWheel, { passive: false });

    let pan = null;

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

      const [refMin, refMax] = pan.domain;
      const eM = effectiveMarginRef.current;
      const liveH = scrollContainerRef.current?.clientHeight ?? canvasEl.clientHeight;
      const span = refMax - refMin;
      const viewportPx = Math.max(1, liveH - eM);
      const shift = -dy * (span / viewportPx);
      const [clampedMin, clampedMax] = clampDomain(
        refMin + shift, refMax + shift,
        clampMinAgeRef.current, clampMaxAgeRef.current,
      );
      if (clampedMin < clampedMax) {
        commitDomain(clampedMin, clampedMax);
      }

      const newLateral = pan.lateral + dx;
      lateralOffsetRef.current = newLateral;
      setLateralOffset(newLateral);
    };

    const onMouseUp = () => {
      if (pan) {
        // Flush any pending commitDomain immediately on release.
        if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
        setVisibleDomain([...visibleDomainRef.current]);
      }
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
        const [newMin, newMax] = clampDomain(
          center - newSpan / 2, center + newSpan / 2,
          clampMinAgeRef.current, clampMaxAgeRef.current,
        );
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
        if (newMin < clampMinAgeRef.current) { newMin = clampMinAgeRef.current; newMax = newMin + span; }
        if (newMax > clampMaxAgeRef.current) { newMax = clampMaxAgeRef.current; newMin = Math.max(clampMinAgeRef.current, newMax - span); }
        visibleDomainRef.current = [newMin, newMax];
        setVisibleDomain([newMin, newMax]);
      } else {
        const delta = canvasEl.clientWidth * 0.1 * (event.key === "ArrowLeft" ? 1 : -1);
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
      canvasEl.removeEventListener("wheel", onWheel);
      canvasEl.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [scaleType, equalSizeLevel, effectiveUnits]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        cursor: "grab",
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
  );
}
