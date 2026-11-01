import { readFileSync } from "node:fs";
import { proposedNames } from "../src/judge.ts";
const rows = readFileSync("bench/detect2-journal.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
for (const w of [32, 10]) {
  const cands = rows.filter((x: any) => x.window === w && (x.summary ?? "").includes("ВМЕСТО"));
  cands.forEach((r: any, i: number) => {
    const at = r.summary.indexOf("ВМЕСТО");
    const end = r.summary.indexOf("СОЗДАЛ", at);
    const body = r.summary.slice(at, end > 0 ? end : undefined);
    console.log(`окно ${w} вариант ${i}: имён ${proposedNames(r.summary).length} ${JSON.stringify(proposedNames(r.summary).slice(0,2))}`);
    console.log(`   тело: ${JSON.stringify(body.slice(0, 200))}`);
  });
}
