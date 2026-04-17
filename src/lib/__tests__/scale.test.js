import { describe, it, expect } from "vitest";
import { buildScale, buildViewScale, computeZoomedDomain, clampDomain, computeLayout } from "../scale.js";

// Minimal synthetic unit set covering enough structure for equalSize/eraEqual.
const UNITS = [
  { id: "phan", levelOrder: 1, parent: null, start: 538.8, end: 0 },
  { id: "cen",  levelOrder: 2, parent: "phan", start: 66,    end: 0 },
  { id: "mes",  levelOrder: 2, parent: "phan", start: 251.902, end: 66 },
  { id: "pal",  levelOrder: 2, parent: "phan", start: 538.8, end: 251.902 },
  // Era-level children so equalSize at level 2 gets 3 slots
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

describe("buildViewScale invariants", () => {
  const baseline = {
    fullMin: 0, fullMax: 4567,
    eM: 56, viewH: 800,
    units: UNITS, equalSizeLevel: 2,
  };

  it("linear: scale maps vMin→eM, vMax→viewH", () => {
    const { scale } = buildViewScale({ ...baseline, scaleType: "linear", vMin: 0, vMax: 100 });
    expect(scale(0)).toBeCloseTo(baseline.eM, 3);
    expect(scale(100)).toBeCloseTo(baseline.viewH, 3);
  });

  it("equalSize: scale maps vMin→eM (top of viewport)", () => {
    const { scale } = buildViewScale({ ...baseline, scaleType: "equalSize", vMin: 66, vMax: 400, fullMax: 538.8 });
    expect(scale(66)).toBeCloseTo(baseline.eM, 1);
  });

  it("eraEqual: scale maps vMin→eM", () => {
    const { scale } = buildViewScale({ ...baseline, scaleType: "eraEqual", vMin: 50, vMax: 500 });
    expect(scale(50)).toBeCloseTo(baseline.eM, 1);
  });
});

describe("computeZoomedDomain focal-point invariant", () => {
  // Core guarantee: after zoom, newScale(focalAge) === cursorY (within 1px).
  const baseline = {
    fullMin: 0, fullMax: 4567,
    eM: 56, viewH: 800,
    units: UNITS, equalSizeLevel: 2,
  };

  function runInvariant(scaleType, vMin, vMax, cursorY, zoomFactor, fullMax = 4567) {
    const bl = { ...baseline, fullMax };
    const { scale: curScale } = buildViewScale({ ...bl, scaleType, vMin, vMax });
    const focalAge = curScale.invert(cursorY);

    const [nMin, nMax] = computeZoomedDomain({
      ...bl, scaleType, vMin, vMax, cursorY, zoomFactor,
    });
    const { scale: newScale } = buildViewScale({ ...bl, scaleType, vMin: nMin, vMax: nMax });
    const cursorYAfter = newScale(focalAge);

    // If domain got clamped to the full range, allow larger drift.
    const clamped = nMin === bl.fullMin || nMax === bl.fullMax;
    const tol = clamped ? 400 : 1;
    expect(Math.abs(cursorYAfter - cursorY)).toBeLessThanOrEqual(tol);
  }

  it("linear: zoom in, cursor mid-viewport", () => {
    runInvariant("linear", 0, 1000, 400, 0.5);
  });

  it("linear: zoom out, cursor high in viewport", () => {
    runInvariant("linear", 100, 300, 200, 2.0);
  });

  it("equalSize: zoom in, cursor mid-viewport — focal-age invariant", () => {
    runInvariant("equalSize", 66, 538.8, 400, 0.5, 538.8);
  });

  it("equalSize: zoom in hard, cursor off-center", () => {
    runInvariant("equalSize", 0, 538.8, 600, 0.25, 538.8);
  });

  it("eraEqual: zoom in, cursor mid-viewport — focal-age invariant", () => {
    runInvariant("eraEqual", 0, 4567, 500, 0.5);
  });

  it("eraEqual: zoom in, cursor high", () => {
    runInvariant("eraEqual", 100, 3000, 200, 0.3);
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
