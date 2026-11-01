import { readFileSync } from "node:fs";
import { proposedNames } from "../src/judge.ts";
const rows = readFileSync("bench/detect2-journal.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const bad = rows.filter((r: any) => (r.summary ?? "").includes("ВМЕСТО") && proposedNames(r.summary).includes("предложений"));
console.log(`окон с мусором: ${bad.length}`);
for (const r of bad.slice(0, 3)) {
  const at = r.summary.indexOf("ВМЕСТО");
  const end = r.summary.indexOf("СОЗДАЛ", at);
  console.log("---");
  console.log(JSON.stringify(r.summary.slice(at, end > 0 ? end : undefined).slice(0, 220)));
}
