import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
const ROOT = "E:/repos/carousel-demo/.venv/Lib/site-packages/langgraph";
async function walk(d: string, out: string[] = [], depth = 0): Promise<string[]> {
  if (depth > 6) return out;
  for (const e of await readdir(d, { withFileTypes: true })) {
    const f = join(d, e.name);
    if (e.isFile() && e.name.endsWith(".py")) out.push(f);
    else if (e.isDirectory() && !e.name.startsWith("__") && !e.name.startsWith(".")) await walk(f, out, depth + 1);
  }
  return out;
}
const files = await walk(ROOT);
const src = (await Promise.all(files.map((f) => readFile(f, "utf8")))).join("\n");
console.log("файлов:", files.length, "символов:", src.length);
const re = /(?:class|def)\s+StateGraph\s*[(:][\s\S]{0,2000}?(?:"""|''')([\s\S]{0,400}?)(?:"""|''')/m;
const m = re.exec(src);
console.log("совпадение:", m ? "ДА" : "нет");
if (m) {
  const idx = m.index;
  console.log("контекст до совпадения:", JSON.stringify(src.slice(Math.max(0, idx - 120), idx + 60)));
  console.log("docstring:", JSON.stringify(m[1].slice(0, 150)));
}
