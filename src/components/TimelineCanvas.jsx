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
      const splitViewData = [];
      const splitViewUnitMap = new Map();

      visLevels.forEach(level => {
        const colConf = columnConfig.find(c => c.level === level);

        if (colConf?.splitView) {
          const colEntry = frameLayout.find(col => col.id === level);
          if (!colEntry) return;
          const bandX = colEntry.start + lateral;
          const bandW = colEntry.end - colEntry.start;
          const propFrac = colConf?.splitPropFraction ?? 0.25;
          const connFrac = colConf?.splitConnFraction ?? 0.25;
          const propW  = bandW * propFrac;
          const connW  = bandW * connFrac;
          const equalW = bandW * (1 - propFrac - connFrac);
          const propX  = bandX;
          const connX  = bandX + propW;
          const equalX = bandX + propW + connW;
          const levelUnitsForSplit = allUnits
            .filter(u => u.levelOrder === level && u.start !== null && visibleSet.has(u.id))
            .map(u => ({ ...u, end: u.end ?? 0 }))
            .sort((a, b) => a.end - b.end);
          const propPositions = levelUnitsForSplit.map(unit => {
            const ext = effectiveExtents.get(unit.id);
            const effectiveStart = ext ? ext.effectiveStart : unit.start;
            const effectiveEnd   = ext ? ext.effectiveEnd   : unit.end;
            let propY0 = Math.min(scale(effectiveStart), scale(effectiveEnd));
            let propY1 = Math.max(scale(effectiveStart), scale(effectiveEnd));
            let pid = unit.parent;
            let svEntry = null;
            while (pid) {
              if (splitViewUnitMap.has(pid)) { svEntry = splitViewUnitMap.get(pid); break; }
              const p = UNIT_MAP[pid]; if (!p) break; pid = p.parent;
            }
            if (svEntry) {
              const pSpan = svEntry.propY1 - svEntry.propY0;
              if (pSpan > 0) {
                const ratio = (svEntry.eqY1 - svEntry.eqY0) / pSpan;
                propY0 = svEntry.eqY0 + (propY0 - svEntry.propY0) * ratio;
                propY1 = svEntry.eqY0 + (propY1 - svEntry.propY0) * ratio;
              }
            }
            return { propY0, propY1 };
          });
          // Anchor the equal-size strip to the full age span of this level's units,
          // not to the min/max of viewport-pixel propPositions. This keeps slot heights
          // stable during zoom/pan even when some units scroll off-screen.
          // Sort order: a.end - b.end ascending → [0] has the youngest end (smallest age),
          // [length-1] has the oldest start (largest age).
          const levelExtentEnd   = levelUnitsForSplit[0]?.end ?? 0;
          const levelExtentStart = levelUnitsForSplit.length
            ? levelUnitsForSplit[levelUnitsForSplit.length - 1].start
            : 0;
          let rawStripTop    = Math.min(scale(levelExtentEnd), scale(levelExtentStart));
          let rawStripBottom = Math.max(scale(levelExtentEnd), scale(levelExtentStart));

          // For daughter split-view columns, apply the same parent-chain remap to the
          // strip anchors that propPositions applies to individual unit boundaries.
          const topSvEntry = (() => {
            if (!levelUnitsForSplit.length) return null;
            let pid = levelUnitsForSplit[0].parent;
            while (pid) {
              if (splitViewUnitMap.has(pid)) return splitViewUnitMap.get(pid);
              const p = UNIT_MAP[pid]; if (!p) break; pid = p.parent;
            }
            return null;
          })();
          const botSvEntry = (() => {
            if (!levelUnitsForSplit.length) return null;
            let pid = levelUnitsForSplit[levelUnitsForSplit.length - 1].parent;
            while (pid) {
              if (splitViewUnitMap.has(pid)) return splitViewUnitMap.get(pid);
              const p = UNIT_MAP[pid]; if (!p) break; pid = p.parent;
            }
            return null;
          })();
          if (topSvEntry) {
            const pSpan = topSvEntry.propY1 - topSvEntry.propY0;
            if (pSpan > 0) {
              const ratio = (topSvEntry.eqY1 - topSvEntry.eqY0) / pSpan;
              rawStripTop = topSvEntry.eqY0 + (rawStripTop - topSvEntry.propY0) * ratio;
            }
          }
          if (botSvEntry) {
            const pSpan = botSvEntry.propY1 - botSvEntry.propY0;
            if (pSpan > 0) {
              const ratio = (botSvEntry.eqY1 - botSvEntry.eqY0) / pSpan;
              rawStripBottom = botSvEntry.eqY0 + (rawStripBottom - botSvEntry.propY0) * ratio;
            }
          }
          const svStripTop    = Math.min(rawStripTop, rawStripBottom);
          const svStripBottom = Math.max(rawStripTop, rawStripBottom);
          const svEqualSlotH  = levelUnitsForSplit.length ? (svStripBottom - svStripTop) / levelUnitsForSplit.length : 0;
          const unitDrawData  = levelUnitsForSplit.map((unit, i) => ({
            unit,
            propY0: propPositions[i].propY0,
            propY1: propPositions[i].propY1,
            eqY0: svStripTop + i * svEqualSlotH,
            eqY1: svStripTop + (i + 1) * svEqualSlotH,
          }));
          for (const d of unitDrawData) splitViewUnitMap.set(d.unit.id, d);
          splitViewData.push({ colConf, propX, connX, equalX, propW, connW, equalW, unitDrawData, stripTop: svStripTop, stripBottom: svStripBottom });
          return;
        }

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
          let y  = Math.min(y1, y2);
          let h  = Math.abs(y2 - y1);

          // Remap into parent's equal-size slot if a split-view ancestor exists
          { let pid = unit.parent;
            let svEntry = null;
            while (pid) {
              if (splitViewUnitMap.has(pid)) { svEntry = splitViewUnitMap.get(pid); break; }
              const p = UNIT_MAP[pid]; if (!p) break; pid = p.parent;
            }
            if (svEntry) {
              const pSpan = svEntry.propY1 - svEntry.propY0;
              if (pSpan > 0) {
                const ratio = (svEntry.eqY1 - svEntry.eqY0) / pSpan;
                y = svEntry.eqY0 + (y - svEntry.propY0) * ratio;
                h = h * ratio;
              }
            }
          }

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
          // White background — expanded to cover wave crests (±WAVE_AMP beyond block bounds)
          const clipY = waveTop ? y - WAVE_AMP : y;
          const clipH = h + (waveTop ? WAVE_AMP : 0) + (waveBottom ? WAVE_AMP : 0);
          ctx.fillStyle = "white";
          ctx.fillRect(x, clipY, w, clipH);

          // Colored fill — wave origin from group minX so it matches the stroke
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, clipY, w, clipH);
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
            const segs = buildWaveSegments(originX, y + h, (x + w) - originX, WAVE_AMP, WAVE_PERIOD);
            for (let i = segs.length - 1; i >= 0; i--) {
              const endX = i === 0 ? originX : segs[i - 1].ex;
              ctx.quadraticCurveTo(segs[i].cpx, segs[i].cpy, endX, y + h);
            }
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

      // ── Picks age→y remapping for split-view ──
      // Use the coarsest split-view column to interpolate any age into its equal-size slot.
      // This keeps all picks in proper visual order even when equal-size expands some slots.
      const pickYForAge = (age) => {
        if (!splitViewData.length) return scale(age);
        const sv = splitViewData[0]; // coarsest (first processed) split-view level
        for (const { unit, propY0, propY1, eqY0, eqY1 } of sv.unitDrawData) {
          const lo = unit.end ?? 0;
          const hi = unit.start;
          if (age >= lo - 1e-9 && age <= hi + 1e-9) {
            if (propY1 <= propY0 + 1e-9) return eqY0;
            const t = Math.max(0, Math.min(1, (scale(age) - propY0) / (propY1 - propY0)));
            return eqY0 + t * (eqY1 - eqY0);
          }
        }
        return scale(age);
      };

      // ── Split-view columns ──
      for (const sv of splitViewData) {
        const { colConf, propX, connX, equalX, propW, connW, equalW, unitDrawData, stripTop, stripBottom } = sv;
        const N = unitDrawData.length;
        if (N === 0) continue;

        // Fills — no stroke
        for (const { unit, propY0, propY1, eqY0, eqY1 } of unitDrawData) {
          ctx.fillStyle = unit.icsColor || "#ccc";
          ctx.fillRect(propX, propY0, propW, propY1 - propY0);
          ctx.beginPath();
          ctx.moveTo(connX,          propY0);
          ctx.lineTo(connX + connW,  eqY0);
          ctx.lineTo(connX + connW,  eqY1);
          ctx.lineTo(connX,          propY1);
          ctx.closePath();
          ctx.fill();
          ctx.fillRect(equalX, eqY0, equalW, eqY1 - eqY0);
        }

        // Boundary lines — separate pass on top of fills
        ctx.strokeStyle = "rgba(0,0,0,0.25)";
        ctx.lineWidth = 0.75;
        ctx.setLineDash([]);

        // Top boundary (above unit 0)
        {
          const { propY0, eqY0 } = unitDrawData[0];
          ctx.beginPath();
          ctx.moveTo(propX,            propY0);
          ctx.lineTo(connX,            propY0);
          ctx.lineTo(connX + connW,    eqY0);
          ctx.lineTo(equalX + equalW,  eqY0);
          ctx.stroke();
        }
        // Interior boundaries
        for (let i = 0; i < N - 1; i++) {
          const { propY1, eqY1 } = unitDrawData[i];
          ctx.beginPath();
          ctx.moveTo(propX,            propY1);
          ctx.lineTo(connX,            propY1);
          ctx.lineTo(connX + connW,    eqY1);
          ctx.lineTo(equalX + equalW,  eqY1);
          ctx.stroke();
        }
        // Bottom boundary (below unit N-1)
        {
          const { propY1, eqY1 } = unitDrawData[N - 1];
          ctx.beginPath();
          ctx.moveTo(propX,            propY1);
          ctx.lineTo(connX,            propY1);
          ctx.lineTo(connX + connW,    eqY1);
          ctx.lineTo(equalX + equalW,  eqY1);
          ctx.stroke();
        }

        // Outer column box — matches the proportional strip's actual extent
        ctx.beginPath(); ctx.moveTo(propX,           stripTop);    ctx.lineTo(propX,           stripBottom); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(equalX + equalW, stripTop);    ctx.lineTo(equalX + equalW, stripBottom); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(propX,           stripTop);    ctx.lineTo(equalX + equalW, stripTop);    ctx.stroke();
        ctx.beginPath(); ctx.moveTo(propX,           stripBottom); ctx.lineTo(equalX + equalW, stripBottom); ctx.stroke();

        // Labels in equal-size strip
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        for (const { unit, eqY0, eqY1 } of unitDrawData) {
          const ts = unit.displayName;
          const st = unit.displayNameStratigraphic;
          const labelText = labelMode === "stratigraphic" ? (st || ts)
            : labelMode === "both" && st ? `${ts} / ${st}`
            : ts;

          const words = (labelText || "").trim().split(/\s+/).filter(Boolean);
          if (!words.length) continue;

          const slotH = eqY1 - eqY0;
          const matchingRule = fontRules.find(r =>
            unit.start !== null && unit.start <= r.maxAge && (unit.end ?? 0) >= r.minAge
          );
          const blockFontSize = matchingRule?.fontSize ?? colConf?.fontSize ?? fontSize;
          const { lines, fitSize } = computeFitAndWrap(words, equalW, slotH, fontFamily, blockFontSize, 5);

          ctx.font = `${fontBold ? "bold " : ""}${fontItalic ? "italic " : ""}${fitSize}px ${fontFamily}`;
          ctx.fillStyle = contrastText ? contrastColor(unit.icsColor) : "black";

          ctx.save();
          ctx.beginPath();
          ctx.rect(equalX, eqY0, equalW, slotH);
          ctx.clip();

          const labelCx = equalX + equalW / 2;
          const labelCy = eqY0 + slotH / 2;
          const lineH = fitSize * 1.2;
          const startLabelY = labelCy - ((lines.length - 1) / 2) * lineH;
          lines.forEach((line, j) => ctx.fillText(line, labelCx, startLabelY + j * lineH));

          ctx.restore();
        }

        // Hitboxes — proportional strip and equal-size strip (skip connector)
        for (const { unit, propY0, propY1, eqY0, eqY1 } of unitDrawData) {
          hitBoxes.push({ id: unit.id, x: propX,  y: propY0, w: propW,  h: propY1 - propY0 });
          hitBoxes.push({ id: unit.id, x: equalX, y: eqY0,   w: equalW, h: eqY1 - eqY0 });
        }
      }

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
          const pos = pickYForAge(age);
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
