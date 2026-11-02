// Замер полезности детектора: считается из сохранённых прогонов, ничего не зовёт.
//
// «До починок» — прогон antibike-fix2 + арбитраж antibike-arb-fix2: разбор
// питона ещё ломается, ось времени не проверяется.
// «После починок» — antibike-t4 + antibike-arb-t4.
import { readFileSync, writeFileSync } from "node:fs";

const TEMP = "C:/Users/stigm/AppData/Local/Temp";
const load = (n) => JSON.parse(readFileSync(`${TEMP}/${n}.json`, "utf8"));

function uniq(hits) {
  const m = new Map();
  for (const h of hits) {
    const k = `${h.own}|${h.ready}`;
    if (!m.has(k)) m.set(k, h);
  }
  return [...m.values()];
}

const RUNS = [
  {
    name: "до починок",
    scan: "antibike-fix2",
    arb: "antibike-arb-fix2",
    falsePositives: ["_basis_date → basis_date"],
    note: "разбор питона ломается, оси времени нет",
  },
  {
    name: "после починок",
    scan: "antibike-t4",
    arb: "antibike-arb-t4",
    falsePositives: [],
    note: "тело по отступам, история файла по git, копии репозитория отсеяны",
  },
];

const runs = [];
let thresholds = [];
for (const r of RUNS) {
  const scan = load(r.scan);
  const arb = load(r.arb);
  const all = uniq(scan.hits);
  const same = new Set(arb.filter((x) => x.same).map((x) => `${x.own}|${x.ready}`));
  runs.push({
    name: r.name,
    note: r.note,
    windows: scan.windows,
    hits: scan.hits.length,
    pairs: all.length,
    afterRule: all.filter((h) => h.readyUses >= 3 && h.ownUses === 0 && h.tokens >= 40).length,
    arbitrated: arb.length,
    confirmed: arb.filter((x) => x.same).length,
    falsePositives: r.falsePositives,
  });
  if (r.name === "после починок") {
    for (const t of [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9]) {
      const kept = all.filter((h) => h.shape >= t);
      thresholds.push({
        threshold: t,
        kept: kept.length,
        found: kept.filter((h) => same.has(`${h.own}|${h.ready}`)).length,
      });
    }
  }
}

const arb = load("antibike-arb-t4");
const neg = arb.filter((x) => !x.same).map((x) => x.shape).sort((a, b) => a - b);
const out = {
  runs,
  thresholds,
  funnel: runs[runs.length - 1],
  positives: arb.filter((x) => x.same).map((x) => ({ pair: `${x.own} → ${x.ready}`, shape: x.shape })),
  negatives: {
    n: neg.length,
    min: neg[0],
    max: neg[neg.length - 1],
    median: neg[Math.floor(neg.length / 2)],
    values: neg,
  },
};
writeFileSync("reports/assets/measure.json", JSON.stringify(out, null, 1), "utf8");
console.log(JSON.stringify(out, null, 1));
