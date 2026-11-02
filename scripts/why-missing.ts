/**
 * Почему окно не попало в прогон: какие правки в нём были и куда.
 */
import { createReadStream, readdirSync } from "node:fs";
import { createInterface } from "node:readline";

const DIR = process.argv[2]!;
const files = readdirSync(DIR).filter((f) => f.endsWith(".jsonl"));
const rows: { file: string; edits: number; paths: string[]; ext: string }[] = [];

for (const f of files) {
  const lines = createInterface({ input: createReadStream(`${DIR}/${f}`, { encoding: "utf8" }), crlfDelay: Infinity });
  let edits = 0;
  const paths = new Set<string>();
  const exts = new Set<string>();
  for await (const line of lines) {
    if (!line.includes("tool_use")) continue;
    let rec: any;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const c = rec.message?.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b?.type !== "tool_use") continue;
      if (b.name !== "Write" && b.name !== "Edit") continue;
      const p = String(b.input?.file_path ?? "");
      if (!p) continue;
      edits += 1;
      const norm = p.split("\\").join("/");
      paths.add(norm);
      const dot = norm.lastIndexOf(".");
      if (dot > 0) exts.add(norm.slice(dot));
    }
  }
  if (edits) rows.push({ file: f.slice(0, 8), edits, paths: [...paths].slice(0, 3), ext: [...exts].join(" ") });
}

rows.sort((a, b) => b.edits - a.edits);
for (const r of rows) console.log(`${r.file} ${String(r.edits).padStart(5)} [${r.ext}] ${r.paths[0] ?? ""}`);
console.log(`\nсессий с правками: ${rows.length}`);
