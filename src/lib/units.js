import geologicTime from "../data/geologicTime.json";

export const ALL_UNITS = geologicTime.units.map(u => {
  let adjustedLevel = u.levelOrder;
  if (u.rankTime === "Sub-Period") adjustedLevel = 4;
  if (u.rankTime === "Epoch")      adjustedLevel = 5;
  if (u.rankTime === "Subepoch")   adjustedLevel = 5.5;
  if (u.rankTime === "Age")        adjustedLevel = 6;
  return { ...u, levelOrder: adjustedLevel };
});

export const UNIT_MAP = Object.fromEntries(ALL_UNITS.map(u => [u.id, u]));

export function isUnitVisible(unitId, hiddenUnits) {
  if (hiddenUnits.has(unitId)) return false;
  let pid = UNIT_MAP[unitId]?.parent;
  while (pid) {
    if (hiddenUnits.has(pid)) return false;
    pid = UNIT_MAP[pid]?.parent;
  }
  return true;
}
