/**
 * parse-chart.cjs
 * Parses chart.txt (ICS Turtle/RDF) and xlabels-en.ttl, merges into geologicTime.json
 *
 * Run: node scripts/parse-chart.cjs
 * Output: src/data/geologicTime.json (updated in place)
 *         scripts/parse-audit.txt   (audit report)
 */

const fs = require("fs");
const path = require("path");

const ROOT         = path.join(__dirname, "..");
const CHART_PATH   = path.join(ROOT, "chart.txt");
const XLABELS_PATH = path.join(__dirname, "xlabels-en.ttl");
const JSON_PATH    = path.join(ROOT, "src", "data", "geologicTime.json");
const AUDIT_PATH   = path.join(__dirname, "parse-audit.txt");

// ───────────────────────────── rank mappings ─────────────────────────────
// levelOrder stored in JSON (before App.jsx adjustments):
//   Super-Eon:0  Eon:1  Era:2  Period:3  Sub-Period:3  Epoch:4  Age:5
const RANK_META = {
  "Super-Eon":  { levelOrder: 0, rankStrat: "Super-Eonothem" },
  "Eon":        { levelOrder: 1, rankStrat: "Eonothem"        },
  "Era":        { levelOrder: 2, rankStrat: "Erathem"         },
  "Period":     { levelOrder: 3, rankStrat: "System"          },
  "Sub-Period": { levelOrder: 3, rankStrat: "Subsystem"       },
  "Epoch":      { levelOrder: 4, rankStrat: "Series"          },
  "Age":        { levelOrder: 5, rankStrat: "Stage"           },
};

// ─────────────────────────────── helpers ─────────────────────────────────
function pickEnglishLabel(block, predicate) {
  const re = new RegExp(
    predicate + `[\\s\\S]*?"([^"]+)"@en(?:-[a-zA-Z-]+)?\\s*[;,.]`
  );
  const m = block.match(re);
  return m ? m[1] : null;
}

// ──────────────── parse xlabels-en.ttl for dual-context labels ───────────
// Builds: { [unitId]: { timescale: string|null, stratigraphic: string|null } }
// Only extracts longform labels (shortform is ignored — we use fullName for that).
function parseDualLabels(xlabelsRaw) {
  const dualLabels = {};
  const blocks = xlabelsRaw.split("\n.\n");

  for (const block of blocks) {
    const iriMatch = block.match(
      /^<http:\/\/resource\.geosciml\.org\/classifier\/ics\/ischart\/(\w+)>/m
    );
    if (!iriMatch) continue;
    const id = iriMatch[1];

    // Extract every [...] blank node (prefLabel entries)
    const blankNodes = [...block.matchAll(/\[([\s\S]+?)\]/g)];
    let timescale = null;
    let stratigraphic = null;

    for (const [, inner] of blankNodes) {
      if (!inner.includes('"longform"')) continue; // only longform labels
      const labelMatch = inner.match(/skosxl:literalForm\s+"([^"]+)"/);
      if (!labelMatch) continue;
      const label = labelMatch[1];
      if (inner.includes('"timescale"'))    timescale    = label;
      if (inner.includes('"stratigraphic"')) stratigraphic = label;
    }

    if (timescale || stratigraphic) {
      dualLabels[id] = { timescale, stratigraphic };
    }
  }
  return dualLabels;
}

// ──────────────────────────── parse the files ─────────────────────────────
const raw = fs.readFileSync(CHART_PATH, "utf8");
// Normalize CRLF → LF so block splitting works regardless of git checkout settings
const xlabelsRaw = fs.readFileSync(XLABELS_PATH, "utf8").replace(/\r\n/g, "\n");

// Split chart.txt on the Turtle statement terminator: "\n.\n"
const blocks = raw.split("\n.\n").filter(b => /^ischart:\w/.test(b.trimStart()));

const dualLabels = parseDualLabels(xlabelsRaw);

const parsed = [];

for (const rawBlock of blocks) {
  const block = rawBlock.trimStart();
  const idMatch = block.match(/^ischart:(\w+)/);
  if (!idMatch) continue;
  const id = idMatch[1];

  // Only process skos:Concept blocks (skip Collections etc)
  if (!block.includes("a skos:Concept")) continue;

  // rank — may be multi-line or list (e.g. "rank:Age ,\n    rank:Epoch")
  const RANK_ORDER = ["Super-Eon","Eon","Era","Period","Sub-Period","Epoch","Age"];
  const rankSection = block.match(/gts:rank([\s\S]+?);/);
  if (!rankSection) continue;
  const rankValues = [...rankSection[1].matchAll(/rank:(\S+)/g)].map(r => r[1].replace(/[,;]/g,""));
  const rank = rankValues.sort((a,b) => RANK_ORDER.indexOf(a) - RANK_ORDER.indexOf(b)).find(r => RANK_META[r]);
  if (!rank) continue;

  // ratifiedGSSP / ratifiedGSSA — now two separate booleans
  const ratifiedGSSP = /gts:ratifiedGSSP\s+true/.test(block);
  const ratifiedGSSA = /gts:ratifiedGSSA\s+true/.test(block);

  // parent (skos:broader)
  const parentMatch = block.match(/skos:broader ischart:(\w+)/);
  const parent = parentMatch ? parentMatch[1] : null;

  // English preferred label from chart.txt (skos:prefLabel)
  const labelEn = pickEnglishLabel(block, "skos:prefLabel");

  // time:hasBeginning block
  const beginBlock = block.match(/time:hasBeginning\s*\[([\s\S]+?)\]/);
  let start = null, startUncertainty = null;
  if (beginBlock) {
    const mya = beginBlock[1].match(/ischart:inMYA\s+([\d.]+)/);
    const moe = beginBlock[1].match(/schema:marginOfError\s+([\d.]+)/);
    if (mya) start = parseFloat(mya[1]);
    if (moe) startUncertainty = parseFloat(moe[1]);
  }

  // time:hasEnd block
  const endBlock = block.match(/time:hasEnd\s*\[([\s\S]+?)\]/);
  let end = null, endUncertainty = null;
  if (endBlock) {
    const mya = endBlock[1].match(/ischart:inMYA\s+([\d.]+)/);
    const moe = endBlock[1].match(/schema:marginOfError\s+([\d.]+)/);
    if (mya) end = parseFloat(mya[1]);
    if (moe) endUncertainty = parseFloat(moe[1]);
  }

  // sh:order
  const orderMatch = block.match(/sh:order\s+(\d+)/);
  const order = orderMatch ? parseInt(orderMatch[1]) : null;

  // short code
  const codeMatch = block.match(/skos:notation\s+"([^"]+)"/);
  const shortCode = codeMatch ? codeMatch[1] : null;

  // color
  const colorMatch = block.match(/schema:color\s+"(#[0-9A-Fa-f]+)"/);
  const color = colorMatch ? colorMatch[1].toUpperCase() : null;

  parsed.push({ id, rank, ratifiedGSSP, ratifiedGSSA, parent, labelEn, start, startUncertainty, end, endUncertainty, order, shortCode, color });
}

// ──────────────────────────── build lookup by id ────────────────────────────
const parsedById = {};
parsed.forEach(u => { parsedById[u.id] = u; });

// ──────────────────────────── load existing JSON ────────────────────────────
const existing = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
const existingById = {};
existing.units.forEach(u => { existingById[u.id] = u; });

// ──────────────────────────────── audit log ─────────────────────────────────
const audit = [];
function log(...args) { audit.push(args.join(" ")); }

log("=== ICS Chart Parse Audit ===");
log(`chart.txt units parsed: ${parsed.length}`);
log(`geologicTime.json units: ${existing.units.length}`);
log(`xlabels-en.ttl dual-label units found: ${Object.keys(dualLabels).length}`);
log("");

// ──────────── Ids in chart but not in JSON ───────────────────────────────
const inChartNotJson = parsed.filter(u => !existingById[u.id]);
if (inChartNotJson.length) {
  log("─── NEW units in chart.txt not in JSON ───");
  inChartNotJson.forEach(u => log(`  + ${u.id}  (${u.rank})  start=${u.start} end=${u.end}`));
  log("");
}

// ──────────── Ids in JSON but not in chart ────────────────────────────────
const inJsonNotChart = existing.units.filter(u => !parsedById[u.id]);
if (inJsonNotChart.length) {
  log("─── units in JSON not found in chart.txt ───");
  inJsonNotChart.forEach(u => log(`  - ${u.id}  (${u.rankTime})`));
  log("");
}

// ──────────── Field-by-field audit on matching ids ────────────────────────
log("─── Field differences for matched units ───");
let diffCount = 0;

parsed.forEach(c => {
  const j = existingById[c.id];
  if (!j) return;

  const diffs = [];

  if (c.start !== null && j.start !== null && Math.abs(c.start - j.start) > 0.0001)
    diffs.push(`start: JSON=${j.start}  chart=${c.start}`);

  const jEnd = j.end === null ? 0 : j.end;
  if (c.end !== null && Math.abs(c.end - jEnd) > 0.0001)
    diffs.push(`end: JSON=${j.end}  chart=${c.end}`);

  const jColor = j.icsColor ? j.icsColor.toUpperCase() : null;
  if (c.color && jColor && c.color !== jColor)
    diffs.push(`color: JSON=${jColor}  chart=${c.color}`);

  const dl = dualLabels[c.id];
  const expectedDisplay = dl?.timescale || c.labelEn;
  if (expectedDisplay && j.displayName !== expectedDisplay)
    diffs.push(`displayName: JSON="${j.displayName}"  chart="${expectedDisplay}"`);

  if (c.parent && j.parent !== c.parent)
    diffs.push(`parent: JSON="${j.parent}"  chart="${c.parent}"`);

  const meta = RANK_META[c.rank];
  if (meta) {
    if (j.rankTime !== c.rank)
      diffs.push(`rankTime: JSON="${j.rankTime}"  chart="${c.rank}"`);
    if (meta.levelOrder !== j.levelOrder && c.rank !== "Sub-Period" && c.rank !== "Epoch" && c.rank !== "Age")
      diffs.push(`levelOrder: JSON=${j.levelOrder}  chart=${meta.levelOrder}`);
  }

  if (diffs.length) {
    diffCount++;
    log(`  ${c.id}:`);
    diffs.forEach(d => log(`    ${d}`));
  }
});

if (diffCount === 0) log("  (no differences found in matched units)");
log("");

// ──────────── Build merged output ────────────────────────────────────────
const merged = parsed
  .map(c => {
    const j = existingById[c.id] || {};
    const meta = RANK_META[c.rank] || {};
    const dl = dualLabels[c.id];

    // displayName: prefer xlabels timescale longform → skos:prefLabel → existing → id
    const displayName = dl?.timescale || c.labelEn || j.displayName || c.id;

    // displayNameStratigraphic: only set when stratigraphic label differs from displayName
    const stratigraphic = dl?.stratigraphic || null;
    const displayNameStratigraphic = (stratigraphic && stratigraphic !== displayName)
      ? stratigraphic
      : null;

    const fullName = j.fullName || `${displayName} ${c.rank}`;

    return {
      id:                      c.id,
      fullName,
      displayName,
      displayNameStratigraphic,
      rankTime:                c.rank,
      rankStrat:               meta.rankStrat || j.rankStrat || null,
      levelOrder:              meta.levelOrder !== undefined ? meta.levelOrder : (j.levelOrder ?? null),
      start:                   c.start !== null ? c.start : (j.start ?? null),
      startUncertainty:        c.startUncertainty,
      end:                     c.end !== null ? c.end : (j.end ?? null),
      endUncertainty:          c.endUncertainty,
      parent:                  c.parent,
      icsColor:                c.color || j.icsColor || null,
      ratifiedGSSP:            c.ratifiedGSSP,
      ratifiedGSSA:            c.ratifiedGSSA,
      shortCode:               c.shortCode,
      order:                   c.order,
    };
  })
  .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));

// ──────────── Audit new fields coverage ──────────────────────────────────
log("─── New field coverage in merged output ───");
const hasStart       = merged.filter(u => u.start !== null).length;
const hasStartUnc    = merged.filter(u => u.startUncertainty !== null).length;
const hasEnd         = merged.filter(u => u.end !== null).length;
const hasEndUnc      = merged.filter(u => u.endUncertainty !== null).length;
const hasGSSP        = merged.filter(u => u.ratifiedGSSP).length;
const hasGSSA        = merged.filter(u => u.ratifiedGSSA).length;
const hasShortCode   = merged.filter(u => u.shortCode !== null).length;
const hasOrder       = merged.filter(u => u.order !== null).length;
const hasDualLabel   = merged.filter(u => u.displayNameStratigraphic !== null).length;
log(`  total units:                ${merged.length}`);
log(`  start age:                  ${hasStart}`);
log(`  startUncertainty:           ${hasStartUnc}`);
log(`  end age:                    ${hasEnd}`);
log(`  endUncertainty:             ${hasEndUnc}`);
log(`  ratifiedGSSP (true):        ${hasGSSP}`);
log(`  ratifiedGSSA (true):        ${hasGSSA}`);
log(`  shortCode:                  ${hasShortCode}`);
log(`  order:                      ${hasOrder}`);
log(`  displayNameStratigraphic:   ${hasDualLabel}`);
log("");

// List the dual-label units
if (hasDualLabel) {
  log("─── Units with dual labels (timescale / stratigraphic) ───");
  merged.filter(u => u.displayNameStratigraphic !== null).forEach(u =>
    log(`  ${u.id}: "${u.displayName}" / "${u.displayNameStratigraphic}"`)
  );
  log("");
}

// ──────────── Write outputs ───────────────────────────────────────────────
const output = { units: merged };
fs.writeFileSync(JSON_PATH, JSON.stringify(output, null, 2));
log(`\n✓ Written ${merged.length} units to src/data/geologicTime.json`);

fs.writeFileSync(AUDIT_PATH, audit.join("\n") + "\n");
console.log(audit.join("\n"));
console.log(`\nAudit saved to scripts/parse-audit.txt`);
