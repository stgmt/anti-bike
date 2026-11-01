import { readFileSync } from "node:fs";
const rows = readFileSync("bench/detect2-journal.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
for (const w of [32, 10]) {
  const r = rows.find((x: any) => x.window === w && (x.summary ?? "").includes("ВМЕСТО"));
  if (!r) continue;
  const at = r.summary.indexOf("ВМЕСТО");
  const end = r.summary.indexOf("СОЗДАЛ", at);
  console.log(`--- окно ${w} ---`);
  console.log(JSON.stringify(r.summary.slice(at, end > 0 ? end : undefined)));
  console.log();
}
