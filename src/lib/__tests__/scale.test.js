import { describe, it, expect } from "vitest";
import {
  buildScale, clampDomain, computeLayout,
  deriveEraEqualBands, makeScale, zoomToFocal,
} from "../scale.js";

// Minimal synthetic unit set covering enough structure for equalSize/eraEqual.
const UNITS = [
  { id: "phan", levelOrder: 1, parent: null, start: 538.8, end: 0 },
  { id: "cen",  levelOrder: 2, parent: "phan", start: 66,    end: 0 },
  { id: "mes",  levelOrder: 2, parent: "phan", start: 251.902, end: 66 },
  { id: "pal",  levelOrder: 2, parent: "phan", start: 538.8, end: 251.902 },
  // Era-level children so equalSize at level 2 gets 3 slots
];

// Richer unit set including Eons (for eraEqual deriveBands) and Eras at level 2.
const FULL_UNITS = [
  { id: "Phanerozoic", rankTime: "Eon", parent: null,           start: 538.8,   end: 0,     levelOrder: 1 },
  { id: "Proterozoic", rankTime: "Eon", parent: "Precambrian",  start: 2500,    end: 538.8, levelOrder: 1 },
  { id: "Archean",     rankTime: "Eon", parent: "Precambrian",  start: 4031,    end: 2500,  levelOrder: 1 },
  { id: "Hadean",      rankTime: "Eon", parent: "Precambrian",  start: 4567,    end: 4031,  levelOrder: 1 },
  { id: "Cenozoic",    rankTime: "Era", parent: "Phanerozoic",  start: 66,      end: 0,     levelOrder: 2 },
  { id: "Mesozoic",    rankTime: "Era", parent: "Phanerozoic",  start: 251.902, end: 66,    levelOrder: 2 },
  { id: "Paleozoic",   rankTime: "Era", parent: "Phanerozoic",  start: 538.8,   end: 251.902, levelOrder: 2 },
];

describe("buildScale round-trip", () => {
  const domain = [0, 4567];
  const range  = [0, 800];

  it("linear: scale.invert(scale(age)) ≈ age", () => {
    const s = buildScale("linear", domain, range, UNITS, 2);
    for (const a of [0, 10, 66, 500, 4567]) {
      expect(s.invert(s(a))).toBeCloseTo(a, 6);
    }
  });

  it("log: scale.invert(scale(age)) ≈ age", () => {
    const s = buildScale("log", [0.001, 4567], range, UNITS, 2);
    for (const a of [0.01, 1, 66, 500, 4567]) {
      expect(s.invert(s(a))).toBeCloseTo(a, 3);
    }
  });

  it("equalSize: scale.invert(scale(age)) ≈ age for ages inside slots", () => {
    const s = buildScale("equalSize", [0, 538.8], range, UNITS, 2);
    // Only test ages that fall strictly inside one of the 3 era slots.
    for (const a of [10, 150, 400]) {
      expect(s.invert(s(a))).toBeCloseTo(a, 1);
    }
  });

  it("eraEqual: scale.invert(scale(age)) ≈ age", () => {
    const s = buildScale("eraEqual", [0, 4567.30], range, UNITS, 2);
    for (const a of [10, 150, 400, 1000]) {
      expect(s.invert(s(a))).toBeCloseTo(a, 1);
    }
  });
});

describe("clampDomain", () => {
  it("returns full range when requested span exceeds it", () => {
    expect(clampDomain(-10, 5000, 0, 4567)).toEqual([0, 4567]);
  });
  it("shifts to preserve span when min below fullMin", () => {
    expect(clampDomain(-50, 150, 0, 4567)).toEqual([0, 200]);
  });
  it("shifts to preserve span when max above fullMax", () => {
    const [lo, hi] = clampDomain(4500, 4700, 0, 4567);
    expect(hi).toBeCloseTo(4567);
    expect(hi - lo).toBeCloseTo(200);
  });
});

describe("computeLayout", () => {
  it("computes sequential starts/ends", () => {
    const cols = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const widths = { a: 10, b: 20, c: 30 };
    const L = computeLayout(cols, widths, 5);
    expect(L[0]).toMatchObject({ id: "a", start: 5,  end: 15 });
    expect(L[1]).toMatchObject({ id: "b", start: 15, end: 35 });
    expect(L[2]).toMatchObject({ id: "c", start: 35, end: 65 });
  });
});

describe("deriveEraEqualBands", () => {
  const realData = [
    { id: "Phanerozoic",  rankTime: "Eon", parent: null,           start: 538.8,   end: 0 },
    { id: "Proterozoic",  rankTime: "Eon", parent: "Precambrian",  start: 2500,    end: 538.8 },
    { id: "Archean",      rankTime: "Eon", parent: "Precambrian",  start: 4031,    end: 2500 },
    { id: "Hadean",       rankTime: "Eon", parent: "Precambrian",  start: 4567,    end: 4031 },
    { id: "Cenozoic",     rankTime: "Era", parent: "Phanerozoic",  start: 66,      end: 0 },
    { id: "Mesozoic",     rankTime: "Era", parent: "Phanerozoic",  start: 251.902, end: 66 },
    { id: "Paleozoic",    rankTime: "Era", parent: "Phanerozoic",  start: 538.8,   end: 251.902 },
  ];

  it("derives 4 bands from real ICS data", () => {
    const bands = deriveEraEqualBands(realData);
    expect(bands).toEqual([
      { start: 66,      end: 0 },
      { start: 251.902, end: 66 },
      { start: 538.8,   end: 251.902 },
      { start: 4567,    end: 538.8 },
    ]);
  });

  it("reflects user edits to Cenozoic start age", () => {
    const edited = realData.map(u => u.id === "Cenozoic" ? { ...u, start: 70, end: 0 } : u);
    const mesoEdited = edited.map(u => u.id === "Mesozoic" ? { ...u, start: 251.902, end: 70 } : u);
    const bands = deriveEraEqualBands(mesoEdited);
    expect(bands[0]).toEqual({ start: 70, end: 0 });
    expect(bands[1]).toEqual({ start: 251.902, end: 70 });
  });

  it("falls back to hardcoded bands when data is missing", () => {
    const bands = deriveEraEqualBands([]);
    expect(bands).toHaveLength(4);
    expect(bands[3].start).toBeCloseTo(4567.30, 2);
  });

  it("falls back when no Phanerozoic eras are present", () => {
    const noEras = realData.filter(u => u.rankTime !== "Era");
    const bands = deriveEraEqualBands(noEras);
    expect(bands).toHaveLength(4);
    expect(bands[0]).toEqual({ start: 66, end: 0 }); // fallback
  });
});

// ---------------------------------------------------------------------------
// makeScale — coordinate contract (see src/lib/coordinates.md)
// ---------------------------------------------------------------------------

// Per-scale-type configs chosen so vMin/vMax sit strictly inside the scale
// domain and round-trip ages fall inside actual slots for equalSize/eraEqual.
const SCALE_CONFIGS = {
  linear: {
    scaleType: "linear",
    vMin: 10, vMax: 1000,
    fullMin: 0, fullMax: 4567,
    units: FULL_UNITS, equalSizeLevel: 2,
    roundTripAges: [10, 100, 500, 900, 1000],
  },
  log: {
    scaleType: "log",
    vMin: 1, vMax: 100,
    fullMin: 0.001, fullMax: 4567,
    units: FULL_UNITS, equalSizeLevel: 2,
    roundTripAges: [1, 5, 20, 50, 100],
  },
  equalSize: {
    scaleType: "equalSize",
    vMin: 10, vMax: 400,
    fullMin: 0, fullMax: 538.8,
    units: FULL_UNITS, equalSizeLevel: 2,
    // Strictly inside Cen/Mes/Pal slots
    roundTripAges: [10, 50, 100, 200, 300, 400],
  },
  eraEqual: {
    scaleType: "eraEqual",
    vMin: 30, vMax: 1000,
    fullMin: 0, fullMax: 4567,
    units: FULL_UNITS, equalSizeLevel: 2,
    // Strictly inside era bands (Cen, Mes, Pal, Precambrian)
    roundTripAges: [30, 100, 400, 800],
  },
};

const VIEWPORT = { eM: 56, viewH: 800 };

function buildScaleCfg(scaleType) {
  return { ...SCALE_CONFIGS[scaleType], ...VIEWPORT };
}

for (const scaleType of ["linear", "log", "equalSize", "eraEqual"]) {
  describe(`makeScale coordinate contract [${scaleType}]`, () => {
    const cfg = buildScaleCfg(scaleType);
    const { toY, toAge } = makeScale(cfg);

    it("toY(vMin) === eM", () => {
      expect(Math.abs(toY(cfg.vMin) - cfg.eM)).toBeLessThan(1e-9);
    });

    it("toY(vMax) === viewH", () => {
      expect(Math.abs(toY(cfg.vMax) - cfg.viewH)).toBeLessThan(1e-9);
    });

    it("toY is monotonically increasing with age", () => {
      let prev = -Infinity;
      const steps = 20;
      for (let i = 0; i <= steps; i++) {
        const age = cfg.vMin + (cfg.vMax - cfg.vMin) * (i / steps);
        const y = toY(age);
        expect(y).toBeGreaterThan(prev);
        prev = y;
      }
    });

    it("toAge(toY(age)) round-trips within 1e-9", () => {
      for (const a of cfg.roundTripAges) {
        expect(Math.abs(toAge(toY(a)) - a)).toBeLessThan(1e-9);
      }
    });

    it("toY(toAge(y)) round-trips for y in [eM, viewH]", () => {
      const span = cfg.viewH - cfg.eM;
      // Skip exact slot boundaries where equalSize/eraEqual invert has a
      // Math.floor ambiguity. Interior samples round-trip cleanly.
      for (const frac of [0.01, 0.17, 0.33, 0.5, 0.67, 0.83, 0.99]) {
        const y = cfg.eM + frac * span;
        expect(Math.abs(toY(toAge(y)) - y)).toBeLessThan(1e-9);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// zoomToFocal — zoom invariants
// ---------------------------------------------------------------------------

for (const scaleType of ["linear", "log", "equalSize", "eraEqual"]) {
  describe(`makeScale zoom invariants [${scaleType}]`, () => {
    const cfg = buildScaleCfg(scaleType);

    it("zoomToFocal keeps focal age under cursor", () => {
      const cursorY = cfg.eM + 0.4 * (cfg.viewH - cfg.eM);
      const { toAge: toAgeBefore } = makeScale(cfg);
      const focalAge = toAgeBefore(cursorY);

      const [nMin, nMax] = zoomToFocal({ ...cfg, cursorY, zoomFactor: 0.5 });
      const { toY: toYAfter } = makeScale({ ...cfg, vMin: nMin, vMax: nMax });

      const clamped = nMin === cfg.fullMin || nMax === cfg.fullMax;
      const tol = clamped ? 400 : 1;
      expect(Math.abs(toYAfter(focalAge) - cursorY)).toBeLessThanOrEqual(tol);
    });

    it("zoomToFocal with zoomFactor=1 is a no-op", () => {
      const cursorY = cfg.eM + 0.5 * (cfg.viewH - cfg.eM);
      const [nMin, nMax] = zoomToFocal({ ...cfg, cursorY, zoomFactor: 1 });
      expect(Math.abs(nMin - cfg.vMin)).toBeLessThan(1e-6);
      expect(Math.abs(nMax - cfg.vMax)).toBeLessThan(1e-6);
    });

    it("zoomToFocal with large zoomFactor clamps to [fullMin, fullMax]", () => {
      const cursorY = cfg.eM + 0.5 * (cfg.viewH - cfg.eM);
      const [nMin, nMax] = zoomToFocal({ ...cfg, cursorY, zoomFactor: 10 });
      expect(nMin).toBeCloseTo(cfg.fullMin, 6);
      expect(nMax).toBeCloseTo(cfg.fullMax, 6);
    });
  });
}

